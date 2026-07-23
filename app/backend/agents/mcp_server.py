"""
MCP (Model Context Protocol) server.

Holds a registry of async tool callables and dispatches tool_use requests
that arrive from the Claude agent. Each tool is a plain async function
decorated with @mcp_server.tool().
"""

from __future__ import annotations

import asyncio
import logging
import re
from contextvars import ContextVar
from typing import Any, Callable, Coroutine

_E164_RE = re.compile(r"^\+[1-9]\d{1,14}$")

# Set by AgentOrchestrator before each tool dispatch so tools can
# associate created records with the correct Django user.
_current_user: ContextVar[Any] = ContextVar("_current_user", default=None)

logger = logging.getLogger(__name__)


def _airtable_url(record_id: str, table_setting: str) -> str | None:
    """Build a direct Airtable record URL, or None if settings are missing."""
    try:
        from django.conf import settings
        base_id = getattr(settings, "AIRTABLE_BASE_ID", "")
        table_id = getattr(settings, table_setting, "")
        if base_id and table_id and record_id and not record_id.startswith("pending-"):
            return f"https://airtable.com/{base_id}/{table_id}/{record_id}"
    except Exception:
        pass
    return None


def _is_staff(user: Any) -> bool:
    """Best-effort staff check that tolerates None / lazy user objects."""
    return bool(user) and bool(getattr(user, "is_staff", False))


def _user_collab_id(user: Any) -> str:
    """Return the user's Airtable collaborator id, or '' if unavailable."""
    if not user:
        return ""
    return getattr(getattr(user, "profile", None), "airtable_collaborator_id", "") or ""


def _allowed_airtable_ids_for(user: Any) -> set[str]:
    """Set of AirtableAccount.airtable_id values the user is a team member of.

    Empty set for anonymous callers. Staff callers get an empty set here — callers
    must check `_is_staff(user)` separately to bypass scoping.
    """
    if not user:
        return set()
    from accounts.models import Account
    return set(
        Account.objects.filter(team_members__user=user)
        .values_list("airtable_id", flat=True)
    )


class MCPServer:
    """Registry and dispatcher for async MCP tools."""

    def __init__(self) -> None:
        self._registry: dict[str, Callable[..., Coroutine[Any, Any, Any]]] = {}
        self._schemas: dict[str, dict] = {}

    def tool(self, name: str | None = None, schema: dict | None = None):
        """Decorator that registers an async function as an MCP tool."""

        def decorator(fn: Callable):
            tool_name = name or fn.__name__
            if tool_name in self._registry:
                raise ValueError(f"Tool '{tool_name}' is already registered.")
            self._registry[tool_name] = fn
            self._schemas[tool_name] = schema or {}
            logger.debug("Registered MCP tool: %s", tool_name)
            return fn

        return decorator

    def list_tools(self) -> list[str]:
        return list(self._registry.keys())

    async def dispatch(self, tool_name: str, arguments: dict[str, Any], user: Any = None) -> Any:
        if tool_name not in self._registry:
            raise ValueError(f"Unknown tool '{tool_name}'. Available: {self.list_tools()}")
        fn = self._registry[tool_name]
        logger.info("Dispatching tool '%s' with args: %s", tool_name, arguments)
        token = _current_user.set(user)
        try:
            return await fn(**arguments)
        finally:
            _current_user.reset(token)

    def tool_schemas(self) -> list[dict]:
        schemas = []
        for name, fn in self._registry.items():
            custom = self._schemas.get(name, {})
            schemas.append({
                "name": name,
                "description": (fn.__doc__ or "").strip().split("\n")[0],
                "input_schema": custom.get("input_schema", {
                    "type": "object",
                    "properties": {},
                    "required": [],
                }),
            })
        return schemas


mcp_server = MCPServer()


# ── Google Calendar ───────────────────────────────────────────────────────────

@mcp_server.tool(schema={"input_schema": {
    "type": "object",
    "properties": {
        "calendar_id": {"type": "string", "default": "primary"},
        "date_start": {"type": "string", "description": "ISO 8601 datetime"},
        "date_end": {"type": "string", "description": "ISO 8601 datetime"},
        "max_results": {"type": "integer", "default": 20},
    },
}})
async def get_calendar_events(
    calendar_id: str = "primary",
    date_start: str | None = None,
    date_end: str | None = None,
    max_results: int = 20,
) -> list[dict]:
    """Return a list of calendar events within the given date range."""
    from django.utils.dateparse import parse_datetime
    from scheduler.models import CalendarEvent
    user = _current_user.get()
    logger.info("get_calendar_events: calendar=%s start=%s end=%s user=%s", calendar_id, date_start, date_end, user)
    loop = asyncio.get_running_loop()

    def _query():
        qs = CalendarEvent.objects.all()
        if user:
            qs = qs.filter(owner=user)
        if calendar_id and calendar_id != "primary":
            qs = qs.filter(calendar_id=calendar_id)
        if date_start:
            dt = parse_datetime(date_start)
            if dt:
                qs = qs.filter(start_datetime__gte=dt)
        if date_end:
            dt = parse_datetime(date_end)
            if dt:
                qs = qs.filter(end_datetime__lte=dt)
        qs = qs.order_by("start_datetime")[:max_results]
        return [
            {
                "id": e.id,
                "title": e.title,
                "start": str(e.start_datetime),
                "end": str(e.end_datetime),
                "all_day": e.all_day,
                "status": e.status,
                "location": e.location or "",
                "meet_link": e.meet_link or "",
                "calendar_id": e.calendar_id or "primary",
            }
            for e in qs
        ]

    return await loop.run_in_executor(None, _query)


@mcp_server.tool(schema={"input_schema": {
    "type": "object",
    "properties": {
        "title": {"type": "string", "description": "Event title"},
        "start_datetime": {"type": "string", "description": "ISO 8601 datetime, e.g. 2026-06-23T08:00:00"},
        "end_datetime": {"type": "string", "description": "ISO 8601 datetime, e.g. 2026-06-23T09:00:00"},
        "description": {"type": "string"},
        "location": {"type": "string"},
        "all_day": {"type": "boolean", "default": False},
        "calendar_id": {"type": "string", "default": "primary"},
    },
    "required": ["title", "start_datetime", "end_datetime"],
}})
async def create_calendar_event(
    title: str,
    start_datetime: str,
    end_datetime: str,
    description: str = "",
    location: str = "",
    all_day: bool = False,
    calendar_id: str = "primary",
) -> dict:
    """Create a new calendar event and return its id and details."""
    from django.utils.dateparse import parse_datetime
    from scheduler.models import CalendarEvent
    user = _current_user.get()
    if not user:
        return {"status": "error", "error": "No authenticated user available."}

    start = parse_datetime(start_datetime)
    end = parse_datetime(end_datetime)
    if not start or not end:
        return {"status": "error", "error": f"Could not parse datetimes: {start_datetime!r}, {end_datetime!r}"}

    loop = asyncio.get_running_loop()

    def _create():
        event = CalendarEvent.objects.create(
            owner=user,
            title=title,
            description=description,
            location=location,
            start_datetime=start,
            end_datetime=end,
            all_day=all_day,
            status="confirmed",
            calendar_id=calendar_id,
            is_synced=False,
        )
        return {
            "status": "created",
            "id": event.id,
            "title": event.title,
            "start": str(event.start_datetime),
            "end": str(event.end_datetime),
            "calendar_id": event.calendar_id,
        }

    try:
        result = await loop.run_in_executor(None, _create)
        logger.info("Calendar event created: %s by user %s", result.get("id"), user)
        return result
    except Exception as exc:
        logger.exception("create_calendar_event failed: %s", exc)
        return {"status": "error", "error": str(exc)}


# ── Gmail ─────────────────────────────────────────────────────────────────────

@mcp_server.tool(schema={"input_schema": {
    "type": "object",
    "properties": {
        "query": {"type": "string"},
        "max_results": {"type": "integer", "default": 10},
        "label_ids": {"type": "array", "items": {"type": "string"}},
    },
}})
async def get_emails(
    query: str = "",
    max_results: int = 10,
    label_ids: list[str] | None = None,
) -> list[dict]:
    """Search the user's Gmail inbox and return matching messages."""
    logger.info("get_emails: query=%s", query)
    return []


# send_email is not yet implemented — omitted from registry to avoid
# Claude calling it and receiving a confusing not_implemented response.
# Re-register with @mcp_server.tool() once the implementation is complete.


# ── Airtable ──────────────────────────────────────────────────────────────────

@mcp_server.tool(schema={"input_schema": {
    "type": "object",
    "properties": {
        "table_name": {"type": "string", "description": "One of: action_items, accounts, meetings"},
        "filter_formula": {"type": "string", "description": "Optional text filter applied to the name/task field"},
        "max_records": {"type": "integer", "default": 100},
    },
    "required": ["table_name"],
}})
async def get_airtable_records(
    table_name: str,
    filter_formula: str = "",
    max_records: int = 100,
    sort: list[dict] | None = None,
) -> list[dict]:
    """Fetch records from the local Airtable-synced tables (action_items, accounts, or meetings)."""
    from airtable_sync.models import AirtableActionItem, AirtableAccount, AirtableMeeting
    user = _current_user.get()
    loop = asyncio.get_running_loop()
    logger.info("get_airtable_records: table=%s filter=%s", table_name, filter_formula)

    def _query():
        tbl = table_name.lower().replace(" ", "_").replace("-", "_")
        staff = _is_staff(user)
        allowed_ids = _allowed_airtable_ids_for(user) if not staff else None
        collab_id = _user_collab_id(user) if not staff else ""
        if tbl in ("action_items", "action-items", "actionitems"):
            qs = AirtableActionItem.objects.select_related("account")
            if filter_formula:
                qs = qs.filter(task__icontains=filter_formula)
            if not staff:
                # Visible when either the linked account is one the user is on, OR
                # the item is directly assigned to the user.
                from django.db.models import Q
                qs = qs.filter(
                    Q(account__airtable_id__in=allowed_ids)
                    | (Q(assignee_airtable_id=collab_id) if collab_id else Q(pk__in=[]))
                )
            return [
                {
                    "id": i.id,
                    "airtable_id": i.airtable_id,
                    "task": i.task,
                    "status": i.status,
                    "priority": i.priority,
                    "due_date": str(i.due_date) if i.due_date else None,
                    "account_name": i.account.name if i.account else None,
                    "assignee_name": i.assignee_name or "",
                    "url": _airtable_url(i.airtable_id, "AIRTABLE_TABLE_ACTION_ITEMS"),
                }
                for i in qs[:max_records]
            ]
        elif tbl in ("accounts",):
            qs = AirtableAccount.objects.all()
            if filter_formula:
                qs = qs.filter(name__icontains=filter_formula)
            if not staff:
                qs = qs.filter(airtable_id__in=allowed_ids)
            return [
                {
                    "id": a.id,
                    "airtable_id": a.airtable_id,
                    "name": a.name,
                    "url": _airtable_url(a.airtable_id, "AIRTABLE_TABLE_ACCOUNTS"),
                }
                for a in qs[:max_records]
            ]
        elif tbl in ("meetings",):
            qs = AirtableMeeting.objects.select_related("account")
            if filter_formula:
                qs = qs.filter(name__icontains=filter_formula)
            if not staff:
                qs = qs.filter(account__airtable_id__in=allowed_ids)
            return [
                {
                    "id": m.id,
                    "airtable_id": m.airtable_id,
                    "name": m.name,
                    "date": str(m.date) if m.date else None,
                    "account_name": m.account.name if m.account else None,
                    "url": _airtable_url(m.airtable_id, "AIRTABLE_TABLE_MEETINGS"),
                }
                for m in qs[:max_records]
            ]
        return {"error": f"Unknown table '{table_name}'. Use: action_items, accounts, meetings"}

    return await loop.run_in_executor(None, _query)


@mcp_server.tool(schema={"input_schema": {
    "type": "object",
    "properties": {
        "task": {"type": "string", "description": "Action item title / description"},
        "task_details": {"type": "string", "description": "Additional context or notes"},
        "status": {"type": "string", "enum": ["Open", "In Progress", "Done", "Blocked"], "default": "Open"},
        "priority": {"type": "string", "enum": ["Critical", "High", "Medium", "Low"], "default": "Medium"},
        "due_date": {"type": "string", "description": "Due date in YYYY-MM-DD format, or null"},
        "account_name": {"type": "string", "description": "Account name to link this item to, or null for No Account"},
        "assignee_name": {"type": "string", "description": "Full name of the person to assign this to"},
    },
    "required": ["task"],
}})
async def create_action_item(
    task: str,
    task_details: str = "",
    status: str = "Open",
    priority: str = "Medium",
    due_date: str | None = None,
    account_name: str | None = None,
    assignee_name: str | None = None,
) -> dict:
    """Create a new action item (and sync it to Airtable). Returns the created item's id and airtable_id."""
    import uuid as _uuid
    from airtable_sync.models import AirtableAccount, AirtableActionItem
    from airtable_sync.write_back import push_action_item_create
    user = _current_user.get()
    loop = asyncio.get_running_loop()

    def _create():
        account = None
        if account_name:
            account = AirtableAccount.objects.filter(name__iexact=account_name).first()

        # Ownership check — mirror update_action_item (Pass 2 Fix #1) so the chat
        # surface can't plant items on accounts the caller doesn't belong to.
        # A null account is allowed (item lands in the caller's Admin bucket).
        if account is not None and not _is_staff(user):
            if not user:
                return {"status": "error", "message": "Not authorized for this account"}
            from accounts.models import Account as _DjangoAccount
            allowed = _DjangoAccount.objects.filter(
                airtable_id=account.airtable_id,
                team_members__user=user,
            ).exists() or _DjangoAccount.objects.filter(
                airtable_id=account.airtable_id,
                admin_owner=user,
            ).exists()
            if not allowed:
                return {"status": "error", "message": "Not authorized for this account"}

        resolved_assignee_name = assignee_name or ""
        resolved_assignee_id = ""
        if not resolved_assignee_name and user:
            try:
                from team.models import UserProfile
                profile = UserProfile.objects.filter(user=user).first()
                if profile:
                    resolved_assignee_name = profile.display_name or ""
                    resolved_assignee_id = profile.airtable_collaborator_id or ""
            except Exception:
                pass

        item = AirtableActionItem(
            airtable_id=f"pending-{_uuid.uuid4().hex}",
            task=task,
            task_details=task_details or "",
            status=status,
            priority=priority,
            due_date=due_date or None,
            account=account,
            assignee_name=resolved_assignee_name,
            assignee_airtable_id=resolved_assignee_id,
        )
        item.save()

        airtable_id = push_action_item_create(item)
        if airtable_id:
            item.airtable_id = airtable_id
            item.save(update_fields=["airtable_id"])
            from airtable_sync.sync import mirror_action_item_to_scheduler
            mirror_action_item_to_scheduler(item)
        else:
            item.delete()
            return {"status": "error", "error": "Airtable write failed — item not created."}

        return {
            "status": "created",
            "id": item.id,
            "airtable_id": item.airtable_id,
            "task": item.task,
            "due_date": str(item.due_date) if item.due_date else None,
            "account_name": item.account.name if item.account else None,
            "priority": item.priority,
            "url": _airtable_url(item.airtable_id, "AIRTABLE_TABLE_ACTION_ITEMS"),
        }

    try:
        result = await loop.run_in_executor(None, _create)
        logger.info("Action item created: %s by user %s", result.get("airtable_id"), user)
        return result
    except Exception as exc:
        logger.exception("create_action_item failed: %s", exc)
        return {"status": "error", "error": str(exc)}


# ── Record search (fuzzy lookup across all types) ────────────────────────────

@mcp_server.tool(schema={"input_schema": {
    "type": "object",
    "properties": {
        "record_type": {
            "type": "string",
            "description": "One of: action_item, meeting, account, calendar_event",
            "enum": ["action_item", "meeting", "account", "calendar_event"],
        },
        "query": {"type": "string", "description": "Free-text search — matched against title/task/name"},
        "max_results": {"type": "integer", "default": 10},
    },
    "required": ["record_type", "query"],
}})
async def search_records(
    record_type: str,
    query: str,
    max_results: int = 10,
) -> list[dict]:
    """Search for records by keyword across action items, meetings, accounts, or calendar events. Use this to resolve vague references like 'that meeting where...' or 'the action item about...'."""
    from airtable_sync.models import AirtableActionItem, AirtableMeeting, AirtableAccount
    from scheduler.models import CalendarEvent
    user = _current_user.get()
    loop = asyncio.get_running_loop()

    def _query():
        rt = record_type.lower()
        staff = _is_staff(user)
        allowed_ids = _allowed_airtable_ids_for(user) if not staff else None
        collab_id = _user_collab_id(user) if not staff else ""
        if rt == "action_item":
            base = AirtableActionItem.objects.select_related("account")
            branch_a = base.filter(task__icontains=query)
            branch_b = base.filter(task_details__icontains=query)
            if not staff:
                # `|`-unions can't be filtered post-hoc, so scope each branch
                # before unioning. Mirror get_airtable_records: allow rows on
                # allowed accounts OR items directly assigned to the caller.
                from django.db.models import Q
                scope = (
                    Q(account__airtable_id__in=allowed_ids)
                    | (Q(assignee_airtable_id=collab_id) if collab_id else Q(pk__in=[]))
                )
                branch_a = branch_a.filter(scope)
                branch_b = branch_b.filter(scope)
            qs = branch_a | branch_b
            return [
                {
                    "id": i.id,
                    "airtable_id": i.airtable_id,
                    "task": i.task,
                    "task_details": i.task_details or "",
                    "status": i.status,
                    "priority": i.priority,
                    "due_date": str(i.due_date) if i.due_date else None,
                    "account_name": i.account.name if i.account else None,
                    "assignee_name": i.assignee_name or "",
                    "url": _airtable_url(i.airtable_id, "AIRTABLE_TABLE_ACTION_ITEMS"),
                }
                for i in qs.distinct()[:max_results]
            ]
        elif rt == "meeting":
            base = AirtableMeeting.objects.select_related("account")
            branch_a = base.filter(name__icontains=query)
            branch_b = base.filter(expected_topics__icontains=query)
            branch_c = base.filter(gong_notes__icontains=query)
            if not staff:
                # `|`-unions can't be filtered post-hoc — scope per branch.
                branch_a = branch_a.filter(account__airtable_id__in=allowed_ids)
                branch_b = branch_b.filter(account__airtable_id__in=allowed_ids)
                branch_c = branch_c.filter(account__airtable_id__in=allowed_ids)
            qs = branch_a | branch_b | branch_c
            return [
                {
                    "id": m.id,
                    "airtable_id": m.airtable_id,
                    "name": m.name,
                    "date": str(m.date) if m.date else None,
                    "account_name": m.account.name if m.account else None,
                    "expected_topics": m.expected_topics or "",
                    "url": _airtable_url(m.airtable_id, "AIRTABLE_TABLE_MEETINGS"),
                }
                for m in qs.distinct()[:max_results]
            ]
        elif rt == "account":
            qs = AirtableAccount.objects.filter(name__icontains=query)
            if not staff:
                qs = qs.filter(airtable_id__in=allowed_ids)
            return [
                {
                    "id": a.id,
                    "airtable_id": a.airtable_id,
                    "name": a.name,
                    "health_score": a.health_score,
                    "url": _airtable_url(a.airtable_id, "AIRTABLE_TABLE_ACCOUNTS"),
                }
                for a in qs[:max_results]
            ]
        elif rt == "calendar_event":
            qs = CalendarEvent.objects.filter(title__icontains=query)
            if user:
                qs = qs.filter(owner=user)
            return [
                {
                    "id": e.id,
                    "title": e.title,
                    "start": str(e.start_datetime),
                    "end": str(e.end_datetime),
                    "status": e.status,
                    "location": e.location or "",
                }
                for e in qs[:max_results]
            ]
        return []

    return await loop.run_in_executor(None, _query)


# ── Update action item ────────────────────────────────────────────────────────

@mcp_server.tool(schema={"input_schema": {
    "type": "object",
    "properties": {
        "airtable_id": {"type": "string", "description": "The airtable_id of the action item to update"},
        "task": {"type": "string", "description": "Updated title/description"},
        "task_details": {"type": "string", "description": "Updated notes or details"},
        "status": {"type": "string", "enum": ["Open", "In Progress", "Done", "Blocked"]},
        "priority": {"type": "string", "enum": ["Critical", "High", "Medium", "Low"]},
        "due_date": {"type": "string", "description": "YYYY-MM-DD or null"},
        "account_name": {"type": "string", "description": "Reassign to this account, or null to clear"},
        "assignee_name": {"type": "string", "description": "Reassign to this person"},
    },
    "required": ["airtable_id"],
}})
async def update_action_item(
    airtable_id: str,
    task: str | None = None,
    task_details: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    due_date: str | None = None,
    account_name: str | None = None,
    assignee_name: str | None = None,
) -> dict:
    """Update an existing action item. Pass only the fields you want to change. Syncs to Airtable automatically."""
    from airtable_sync.models import AirtableActionItem, AirtableAccount
    from airtable_sync.write_back import push_action_item_update
    user = _current_user.get()
    loop = asyncio.get_running_loop()

    def _update():
        try:
            item = AirtableActionItem.objects.select_related("account").get(airtable_id=airtable_id)
        except AirtableActionItem.DoesNotExist:
            return {"status": "error", "error": f"Action item '{airtable_id}' not found."}

        # Ownership check — the caller must either belong to the item's account
        # or be the assignee (mirrors the API-side rule in update_action_item_fields).
        if not _is_staff(user):
            collab_id = _user_collab_id(user)
            allowed_ids = _allowed_airtable_ids_for(user)
            item_at_id = item.account.airtable_id if item.account else None
            if not (
                (item_at_id and item_at_id in allowed_ids)
                or (collab_id and item.assignee_airtable_id == collab_id)
            ):
                return {"status": "error", "message": "Not authorized for this record"}

        update_fields = []
        if task is not None:
            item.task = task; update_fields.append("task")
        if task_details is not None:
            item.task_details = task_details; update_fields.append("task_details")
        if status is not None:
            item.status = status; update_fields.append("status")
        if priority is not None:
            item.priority = priority; update_fields.append("priority")
        if due_date is not None:
            item.due_date = due_date or None; update_fields.append("due_date")
        if account_name is not None:
            acct = AirtableAccount.objects.filter(name__iexact=account_name).first()
            item.account = acct; update_fields.append("account")
        if assignee_name is not None:
            item.assignee_name = assignee_name; update_fields.append("assignee_name")

        if update_fields:
            item.save(update_fields=update_fields)
            push_action_item_update(item)
            from airtable_sync.sync import mirror_action_item_to_scheduler
            mirror_action_item_to_scheduler(item)

        return {
            "status": "updated",
            "id": item.id,
            "airtable_id": item.airtable_id,
            "task": item.task,
            "status_value": item.status,
            "priority": item.priority,
            "account_name": item.account.name if item.account else None,
            "url": _airtable_url(item.airtable_id, "AIRTABLE_TABLE_ACTION_ITEMS"),
        }

    try:
        return await loop.run_in_executor(None, _update)
    except Exception as exc:
        logger.exception("update_action_item failed: %s", exc)
        return {"status": "error", "error": str(exc)}


# ── Delete action item ────────────────────────────────────────────────────────

@mcp_server.tool(schema={"input_schema": {
    "type": "object",
    "properties": {
        "airtable_id": {"type": "string", "description": "The airtable_id of the action item to delete"},
    },
    "required": ["airtable_id"],
}})
async def delete_action_item(airtable_id: str) -> dict:
    """Permanently delete an action item from the platform and Airtable. Cannot be undone."""
    from airtable_sync.models import AirtableActionItem
    from airtable_sync.write_back import push_action_item_delete
    user = _current_user.get()
    loop = asyncio.get_running_loop()

    def _delete():
        try:
            item = AirtableActionItem.objects.select_related("account").get(airtable_id=airtable_id)
        except AirtableActionItem.DoesNotExist:
            return {"status": "error", "error": f"Action item '{airtable_id}' not found."}

        # Ownership check — mirrors update_action_item.
        if not _is_staff(user):
            collab_id = _user_collab_id(user)
            allowed_ids = _allowed_airtable_ids_for(user)
            item_at_id = item.account.airtable_id if item.account else None
            if not (
                (item_at_id and item_at_id in allowed_ids)
                or (collab_id and item.assignee_airtable_id == collab_id)
            ):
                return {"status": "error", "message": "Not authorized for this record"}

        at_id = item.airtable_id
        item.delete()
        push_action_item_delete(at_id)
        from airtable_sync.sync import unmirror_action_item
        unmirror_action_item(at_id)
        return {"status": "deleted", "airtable_id": at_id}

    try:
        return await loop.run_in_executor(None, _delete)
    except Exception as exc:
        logger.exception("delete_action_item failed: %s", exc)
        return {"status": "error", "error": str(exc)}


# ── Update calendar event ─────────────────────────────────────────────────────

@mcp_server.tool(schema={"input_schema": {
    "type": "object",
    "properties": {
        "event_id": {"type": "integer", "description": "The id of the calendar event to update"},
        "title": {"type": "string"},
        "start_datetime": {"type": "string", "description": "ISO 8601 datetime"},
        "end_datetime": {"type": "string", "description": "ISO 8601 datetime"},
        "description": {"type": "string"},
        "location": {"type": "string"},
        "status": {"type": "string", "enum": ["confirmed", "tentative", "cancelled"]},
    },
    "required": ["event_id"],
}})
async def update_calendar_event(
    event_id: int,
    title: str | None = None,
    start_datetime: str | None = None,
    end_datetime: str | None = None,
    description: str | None = None,
    location: str | None = None,
    status: str | None = None,
) -> dict:
    """Update an existing calendar event. Pass only the fields you want to change."""
    from django.utils.dateparse import parse_datetime
    from scheduler.models import CalendarEvent
    user = _current_user.get()
    loop = asyncio.get_running_loop()

    def _update():
        qs = CalendarEvent.objects.filter(pk=event_id)
        if user:
            qs = qs.filter(owner=user)
        try:
            event = qs.get()
        except CalendarEvent.DoesNotExist:
            return {"status": "error", "error": f"Calendar event {event_id} not found."}

        update_fields = []
        if title is not None:
            event.title = title; update_fields.append("title")
        if start_datetime is not None:
            dt = parse_datetime(start_datetime)
            if dt:
                event.start_datetime = dt; update_fields.append("start_datetime")
        if end_datetime is not None:
            dt = parse_datetime(end_datetime)
            if dt:
                event.end_datetime = dt; update_fields.append("end_datetime")
        if description is not None:
            event.description = description; update_fields.append("description")
        if location is not None:
            event.location = location; update_fields.append("location")
        if status is not None:
            event.status = status; update_fields.append("status")

        if update_fields:
            event.save(update_fields=update_fields)

        return {
            "status": "updated",
            "id": event.id,
            "title": event.title,
            "start": str(event.start_datetime),
            "end": str(event.end_datetime),
        }

    try:
        return await loop.run_in_executor(None, _update)
    except Exception as exc:
        logger.exception("update_calendar_event failed: %s", exc)
        return {"status": "error", "error": str(exc)}


# ── Delete calendar event ─────────────────────────────────────────────────────

@mcp_server.tool(schema={"input_schema": {
    "type": "object",
    "properties": {
        "event_id": {"type": "integer", "description": "The id of the calendar event to delete"},
    },
    "required": ["event_id"],
}})
async def delete_calendar_event(event_id: int) -> dict:
    """Delete a calendar event. Cannot be undone."""
    from scheduler.models import CalendarEvent
    user = _current_user.get()
    loop = asyncio.get_running_loop()

    def _delete():
        qs = CalendarEvent.objects.filter(pk=event_id)
        if user:
            qs = qs.filter(owner=user)
        try:
            event = qs.get()
        except CalendarEvent.DoesNotExist:
            return {"status": "error", "error": f"Calendar event {event_id} not found."}
        event.delete()
        return {"status": "deleted", "id": event_id}

    try:
        return await loop.run_in_executor(None, _delete)
    except Exception as exc:
        logger.exception("delete_calendar_event failed: %s", exc)
        return {"status": "error", "error": str(exc)}


# ── Update meeting (Airtable) ─────────────────────────────────────────────────

@mcp_server.tool(schema={"input_schema": {
    "type": "object",
    "properties": {
        "airtable_id": {"type": "string", "description": "The airtable_id of the meeting to update"},
        "name": {"type": "string"},
        "date": {"type": "string", "description": "ISO 8601 datetime"},
        "expected_topics": {"type": "string"},
        "gong_notes": {"type": "string", "description": "Meeting notes / summary to append or set"},
        "account_name": {"type": "string"},
    },
    "required": ["airtable_id"],
}})
async def update_meeting(
    airtable_id: str,
    name: str | None = None,
    date: str | None = None,
    expected_topics: str | None = None,
    gong_notes: str | None = None,
    account_name: str | None = None,
) -> dict:
    """Update an existing meeting record — name, date, topics, or notes. Syncs to Airtable."""
    from airtable_sync.models import AirtableMeeting, AirtableAccount
    from airtable_sync.write_back import push_meeting_gong_notes
    user = _current_user.get()
    loop = asyncio.get_running_loop()

    def _update():
        try:
            meeting = AirtableMeeting.objects.select_related("account").get(airtable_id=airtable_id)
        except AirtableMeeting.DoesNotExist:
            return {"status": "error", "error": f"Meeting '{airtable_id}' not found."}

        # Ownership check — caller must belong to the linked account's team.
        if not _is_staff(user):
            allowed_ids = _allowed_airtable_ids_for(user)
            meeting_at_id = meeting.account.airtable_id if meeting.account else None
            if not (meeting_at_id and meeting_at_id in allowed_ids):
                return {"status": "error", "message": "Not authorized for this record"}

        update_fields = []
        if name is not None:
            meeting.name = name; update_fields.append("name")
        if date is not None:
            from django.utils.dateparse import parse_datetime
            dt = parse_datetime(date)
            if dt:
                meeting.date = dt; update_fields.append("date")
        if expected_topics is not None:
            meeting.expected_topics = expected_topics; update_fields.append("expected_topics")
        if gong_notes is not None:
            meeting.gong_notes = gong_notes; update_fields.append("gong_notes")
        if account_name is not None:
            acct = AirtableAccount.objects.filter(name__iexact=account_name).first()
            if acct:
                meeting.account = acct; update_fields.append("account")

        if update_fields:
            meeting.save(update_fields=update_fields)
            push_meeting_gong_notes(meeting)

        return {
            "status": "updated",
            "id": meeting.id,
            "airtable_id": meeting.airtable_id,
            "name": meeting.name,
            "date": str(meeting.date) if meeting.date else None,
            "account_name": meeting.account.name if meeting.account else None,
            "url": _airtable_url(meeting.airtable_id, "AIRTABLE_TABLE_MEETINGS"),
        }

    try:
        return await loop.run_in_executor(None, _update)
    except Exception as exc:
        logger.exception("update_meeting failed: %s", exc)
        return {"status": "error", "error": str(exc)}


# ── Delete meeting ────────────────────────────────────────────────────────────

@mcp_server.tool(schema={"input_schema": {
    "type": "object",
    "properties": {
        "airtable_id": {"type": "string", "description": "The airtable_id of the meeting to delete"},
    },
    "required": ["airtable_id"],
}})
async def delete_meeting(airtable_id: str) -> dict:
    """Delete a meeting record from the platform and Airtable. Cannot be undone."""
    from airtable_sync.models import AirtableMeeting
    user = _current_user.get()
    loop = asyncio.get_running_loop()

    def _delete():
        try:
            meeting = AirtableMeeting.objects.select_related("account").get(airtable_id=airtable_id)
        except AirtableMeeting.DoesNotExist:
            return {"status": "error", "error": f"Meeting '{airtable_id}' not found."}

        # Ownership check — caller must belong to the linked account's team.
        if not _is_staff(user):
            allowed_ids = _allowed_airtable_ids_for(user)
            meeting_at_id = meeting.account.airtable_id if meeting.account else None
            if not (meeting_at_id and meeting_at_id in allowed_ids):
                return {"status": "error", "message": "Not authorized for this record"}

        meeting.delete()
        return {"status": "deleted", "airtable_id": airtable_id}

    try:
        return await loop.run_in_executor(None, _delete)
    except Exception as exc:
        logger.exception("delete_meeting failed: %s", exc)
        return {"status": "error", "error": str(exc)}


# ── Update account ────────────────────────────────────────────────────────────

@mcp_server.tool(schema={"input_schema": {
    "type": "object",
    "properties": {
        "account_name": {"type": "string", "description": "Current name of the account to update"},
        "new_name": {"type": "string", "description": "New company name"},
        "website": {"type": "string"},
        "industry": {"type": "string"},
        "status": {"type": "string", "enum": ["prospect", "active", "inactive", "churned"]},
        "arr": {"type": "number", "description": "Annual Recurring Revenue in dollars"},
    },
    "required": ["account_name"],
}})
async def update_account(
    account_name: str,
    new_name: str | None = None,
    website: str | None = None,
    industry: str | None = None,
    status: str | None = None,
    arr: float | None = None,
) -> dict:
    """Update an account's details (name, website, industry, status, ARR). Does NOT delete accounts."""
    from accounts.models import Account
    from airtable_sync.write_back import push_account_update
    user = _current_user.get()
    loop = asyncio.get_running_loop()

    def _update():
        qs = Account.objects.filter(company_name__iexact=account_name)
        if not _is_staff(user):
            if not user:
                return {"status": "error", "message": "Not authorized for this record"}
            qs = qs.filter(team_members__user=user)
        acct = qs.distinct().first()
        if not acct:
            # Existence not leaked — same error whether missing or forbidden.
            return {"status": "error", "message": "Not authorized for this record"}

        update_fields = []
        if new_name is not None:
            acct.company_name = new_name; update_fields.append("company_name")
        if website is not None:
            acct.website = website; update_fields.append("website")
        if industry is not None:
            acct.industry = industry; update_fields.append("industry")
        if status is not None:
            acct.status = status; update_fields.append("status")
        if arr is not None:
            acct.arr = arr; update_fields.append("arr")

        if update_fields:
            acct.save(update_fields=update_fields)
            push_account_update(acct)

        return {
            "status": "updated",
            "id": acct.id,
            "company_name": acct.company_name,
            "status_value": acct.status,
            "arr": float(acct.arr) if acct.arr is not None else None,
            "url": _airtable_url(acct.airtable_id, "AIRTABLE_TABLE_ACCOUNTS") if acct.airtable_id else None,
        }

    try:
        return await loop.run_in_executor(None, _update)
    except Exception as exc:
        logger.exception("update_account failed: %s", exc)
        return {"status": "error", "error": str(exc)}


# ── Add account note ──────────────────────────────────────────────────────────

@mcp_server.tool(schema={"input_schema": {
    "type": "object",
    "properties": {
        "account_name": {"type": "string", "description": "Name of the account to add the note to"},
        "content": {"type": "string", "description": "The note content"},
    },
    "required": ["account_name", "content"],
}})
async def add_account_note(account_name: str, content: str) -> dict:
    """Add a timestamped note to an account. Great for quick verbal updates like 'Acme said they want to expand to 3 seats.'"""
    from accounts.models import Account, AccountNote
    user = _current_user.get()
    loop = asyncio.get_running_loop()

    def _add():
        qs = Account.objects.filter(company_name__iexact=account_name)
        if not _is_staff(user):
            if not user:
                return {"status": "error", "message": "Not authorized for this record"}
            qs = qs.filter(team_members__user=user)
        acct = qs.distinct().first()
        if not acct:
            return {"status": "error", "message": "Not authorized for this record"}
        note = AccountNote.objects.create(
            account=acct,
            content=content,
            author=user,
        )
        return {
            "status": "created",
            "note_id": note.id,
            "account_name": acct.company_name,
            "content": note.content,
            "url": _airtable_url(acct.airtable_id, "AIRTABLE_TABLE_ACCOUNTS") if acct.airtable_id else None,
        }

    try:
        return await loop.run_in_executor(None, _add)
    except Exception as exc:
        logger.exception("add_account_note failed: %s", exc)
        return {"status": "error", "error": str(exc)}


# ── Slack ─────────────────────────────────────────────────────────────────────

@mcp_server.tool(schema={"input_schema": {
    "type": "object",
    "properties": {
        "channel": {"type": "string"},
        "limit": {"type": "integer", "default": 20},
        "oldest": {"type": "string"},
        "latest": {"type": "string"},
    },
    "required": ["channel"],
}})
async def get_slack_messages(
    channel: str,
    limit: int = 20,
    oldest: str | None = None,
    latest: str | None = None,
) -> list[dict]:
    """Retrieve recent messages from a Slack channel."""
    logger.info("get_slack_messages: channel=%s", channel)
    return []


# send_slack_message is not yet implemented — omitted from registry to avoid
# Claude calling it and receiving a confusing not_implemented response.
# Re-register with @mcp_server.tool() once the implementation is complete.


# ── Twilio SMS ────────────────────────────────────────────────────────────────

@mcp_server.tool(schema={"input_schema": {
    "type": "object",
    "properties": {
        "to": {"type": "string", "description": "Recipient phone number in E.164 format, e.g. +15005550006"},
        "body": {"type": "string", "description": "SMS message body (max 1600 chars)"},
    },
    "required": ["to", "body"],
}})
async def send_sms(to: str, body: str) -> dict:
    """Send an SMS message to a phone number via Twilio on behalf of the user."""
    if not _E164_RE.match(to):
        return {"status": "error", "error": f"Invalid phone number '{to}'. Must be E.164 format, e.g. +15005550006."}

    from django.conf import settings

    if not (settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN and settings.TWILIO_PHONE_NUMBER):
        return {"status": "error", "error": "Twilio credentials not configured."}

    loop = asyncio.get_running_loop()

    def _send():
        from twilio.rest import Client
        client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
        message = client.messages.create(
            body=body,
            from_=settings.TWILIO_PHONE_NUMBER,
            to=to,
        )
        return {"sid": message.sid, "status": message.status, "to": to}

    try:
        result = await loop.run_in_executor(None, _send)
        logger.info("SMS sent via Twilio: sid=%s to=%s", result.get("sid"), to)
        return result
    except Exception as exc:
        logger.exception("Twilio SMS send failed: %s", exc)
        return {"status": "error", "error": str(exc)}


# ── Token usage ──────────────────────────────────────────────────────────────

@mcp_server.tool(schema={"input_schema": {
    "type": "object",
    "properties": {
        "period": {
            "type": "string",
            "enum": ["today", "this_week", "this_month", "all_time"],
            "description": "Time window to aggregate. Defaults to all_time.",
        },
    },
    "required": [],
}})
async def get_token_usage(period: str = "all_time") -> dict:
    """Return token usage totals for agent messages and skill invocations in a given period."""
    import asyncio
    from django.utils import timezone
    from django.db.models import Sum

    user = _current_user.get()

    now = timezone.now()
    if period == "today":
        since = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "this_week":
        since = (now - timezone.timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "this_month":
        since = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        since = None

    loop = asyncio.get_running_loop()

    def _query():
        from agents.models import AgentMessage, AgentSession
        from skills.models import SkillInvocation

        msg_qs = AgentMessage.objects.all()
        inv_qs = SkillInvocation.objects.all()

        if user:
            msg_qs = msg_qs.filter(session__user=user)
            inv_qs = inv_qs.filter(invoked_by=user)

        if since:
            msg_qs = msg_qs.filter(created_at__gte=since)
            inv_qs = inv_qs.filter(invoked_at__gte=since)

        msg_agg = msg_qs.aggregate(
            inp=Sum("input_tokens"),
            out=Sum("output_tokens"),
        )
        inv_agg = inv_qs.aggregate(
            inp=Sum("input_tokens"),
            out=Sum("output_tokens"),
        )

        agent_in  = msg_agg["inp"] or 0
        agent_out = msg_agg["out"] or 0
        skill_in  = inv_agg["inp"] or 0
        skill_out = inv_agg["out"] or 0

        # Top 5 sessions by token spend
        session_qs = AgentSession.objects.all()
        if user:
            session_qs = session_qs.filter(user=user)
        if since:
            session_qs = session_qs.filter(started_at__gte=since)

        by_session = []
        for session in session_qs.prefetch_related("messages"):
            total = sum(
                (m.input_tokens or 0) + (m.output_tokens or 0)
                for m in session.messages.all()
            )
            by_session.append({"session_title": session.title or f"Session {session.id}", "total_tokens": total})

        by_session.sort(key=lambda x: x["total_tokens"], reverse=True)

        return {
            "period": period,
            "agent_input_tokens":  agent_in,
            "agent_output_tokens": agent_out,
            "agent_total_tokens":  agent_in + agent_out,
            "skill_input_tokens":  skill_in,
            "skill_output_tokens": skill_out,
            "skill_total_tokens":  skill_in + skill_out,
            "grand_total_tokens":  agent_in + agent_out + skill_in + skill_out,
            "by_session":          by_session[:5],
        }

    return await loop.run_in_executor(None, _query)


# ── Twilio Voice (initiate outbound call) ─────────────────────────────────────

@mcp_server.tool(schema={"input_schema": {
    "type": "object",
    "properties": {
        "to": {"type": "string", "description": "Phone number to call in E.164 format"},
        "message": {"type": "string", "description": "Message to read via TTS when the call connects"},
    },
    "required": ["to"],
}})
async def make_phone_call(to: str, message: str = "Hello from Agent PM.") -> dict:
    """Initiate an outbound phone call via Twilio, reading a message via text-to-speech."""
    if not _E164_RE.match(to):
        return {"status": "error", "error": f"Invalid phone number '{to}'. Must be E.164 format, e.g. +15005550006."}

    from django.conf import settings

    if not (settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN and settings.TWILIO_PHONE_NUMBER):
        return {"status": "error", "error": "Twilio credentials not configured."}

    loop = asyncio.get_running_loop()
    from twilio.twiml.voice_response import VoiceResponse
    _vr = VoiceResponse()
    _vr.say(message)
    twiml = str(_vr)

    def _call():
        from twilio.rest import Client
        client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
        call = client.calls.create(
            twiml=twiml,
            from_=settings.TWILIO_PHONE_NUMBER,
            to=to,
        )
        return {"sid": call.sid, "status": call.status, "to": to}

    try:
        result = await loop.run_in_executor(None, _call)
        logger.info("Outbound call initiated: sid=%s to=%s", result.get("sid"), to)
        return result
    except Exception as exc:
        logger.exception("Twilio call initiation failed: %s", exc)
        return {"status": "error", "error": str(exc)}
