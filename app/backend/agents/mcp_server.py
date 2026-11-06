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
# True only while a tool runs that the user explicitly approved (voice's spoken "yes", or chat's
# redeemed confirmation token). Tools that email third parties read it and fail closed: with no
# approval they still do their local work but send nothing.
_current_approved: ContextVar[bool] = ContextVar("_current_approved", default=False)

logger = logging.getLogger(__name__)


from .tool_policy import error_result  # noqa: E402 — the standard tool error shape


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


def _now():
    """Indirection so tests can pin the clock."""
    from datetime import datetime, timezone
    return datetime.now(timezone.utc)


# How far back a calendar event may start. Wide enough to backfill "I had a call yesterday";
# narrow enough to catch a model that guessed the wrong year (2025 for 2026).
MAX_EVENT_BACKDATE_DAYS = 7


def _caller_zone(user: Any):
    """
    The caller's timezone as a ``ZoneInfo`` ("PST" and "Eastern" are understood).

    Reads ``user.profile`` — a query — so call it from the sync executor closures, never from
    the async body of a tool (SynchronousOnlyOperation).
    """
    from core.timezones import resolve_zone

    return resolve_zone(getattr(getattr(user, "profile", None), "timezone", "") if user else "")


def _localize(value, zone):
    """A naive datetime means the caller's local wall-clock time; an aware one is left alone."""
    return value.replace(tzinfo=zone) if value is not None and value.tzinfo is None else value


def _user_collab_id(user: Any) -> str:
    """Return the user's Airtable collaborator id, or '' if unavailable."""
    if not user:
        return ""
    return getattr(getattr(user, "profile", None), "airtable_collaborator_id", "") or ""


def _resolve_airtable_account(account_name: str | None):
    """
    Find the AirtableAccount a spoken name refers to, tolerating transcription errors.

    Returns ``(account, error)``: exactly one is set, except a blank name which is
    ``(None, None)`` (no link requested). On a miss or an ambiguous name ``error`` is a
    tool-shaped dict listing the closest real accounts, so the agent can read them back to
    the caller instead of guessing or silently saving the record unlinked.
    """
    from airtable_sync.models import AirtableAccount
    from agents.fuzzy import resolve_name

    if not (account_name or "").strip():
        return None, None
    accounts = {a.name: a for a in AirtableAccount.objects.exclude(name="")}
    res = resolve_name(account_name, list(accounts))
    if res.match:
        return accounts[res.match], None
    if res.candidates:
        return None, {
            "status": "error",
            "error": f"No account named '{account_name}'. Did you mean one of these?",
            "candidates": res.candidates,
        }
    return None, {
        "status": "error",
        "error": f"No account named '{account_name}' and nothing close to it.",
        "candidates": [],
    }


def _resolve_team_member(name: str):
    """``(TeamMember, None)`` for a clear fuzzy match on a teammate's name, else ``(None, error)``."""
    from team.models import TeamMember
    from agents.fuzzy import resolve_name

    members = {m.full_name: m for m in TeamMember.objects.exclude(full_name="")}
    res = resolve_name(name, list(members))
    if res.match:
        return members[res.match], None
    return None, error_result(
        "not_found",
        f"No teammate matches '{name}'." + (" Did you mean one of these?" if res.candidates else ""),
        extra={"candidates": res.candidates},
    )


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


# Ordering and headings for the generated "== YOUR TOOLS ==" prompt section. A flat
# alphabetical list of 21 tools reads materially worse to the model than grouped
# headings, so the curated grouping is kept — but it now lives on the tool itself
# (see MCPServer.tool's `group=`) instead of in a hand-maintained list that drifts.
GROUP_ORDER = ("read", "create", "update", "delete", "communicate", "skills", "other")

GROUP_LABELS = {
    "read": "READ / SEARCH",
    "create": "CREATE",
    "update": "UPDATE",
    "delete": "DELETE (not available for accounts or users)",
    "communicate": "COMMUNICATE",
    "skills": "SAVED WORKFLOWS",
    "other": "OTHER",
}


class MCPServer:
    """Registry and dispatcher for async MCP tools."""

    def __init__(self) -> None:
        self._registry: dict[str, Callable[..., Coroutine[Any, Any, Any]]] = {}
        self._schemas: dict[str, dict] = {}
        self._meta: dict[str, dict] = {}

    def tool(
        self,
        name: str | None = None,
        schema: dict | None = None,
        *,
        group: str = "other",
        skill_safe: bool = False,
    ):
        """
        Decorator that registers an async function as an MCP tool.

        `group` and `skill_safe` are declared here, at the single point of
        registration, so the two downstream consumers — the agent system prompt's
        tool section and the skills app's allowed-tools catalog — are *derived*
        rather than hand-maintained. A new tool cannot silently go missing from one
        of them, which is exactly how get_meeting_notes_from_email came to be
        absent from the prompt while present in the schemas Claude received.
        """

        def decorator(fn: Callable):
            tool_name = name or fn.__name__
            if tool_name in self._registry:
                raise ValueError(f"Tool '{tool_name}' is already registered.")
            if group not in GROUP_ORDER:
                raise ValueError(
                    f"Tool '{tool_name}' declares unknown group {group!r}; "
                    f"expected one of {GROUP_ORDER}."
                )
            self._registry[tool_name] = fn
            self._schemas[tool_name] = schema or {}
            self._meta[tool_name] = {"group": group, "skill_safe": skill_safe}
            logger.debug("Registered MCP tool: %s", tool_name)
            return fn

        return decorator

    def list_tools(self) -> list[str]:
        return list(self._registry.keys())

    def _description(self, name: str) -> str:
        """First docstring line — the same source tool_schemas() sends to Claude."""
        fn = self._registry[name]
        return (fn.__doc__ or "").strip().split("\n")[0]

    def grouped_catalog(self) -> dict[str, list[tuple[str, str]]]:
        """
        {group: [(tool_name, description), ...]} ordered by GROUP_ORDER.

        Covers every registered tool exactly once. Empty groups are omitted.
        """
        catalog: dict[str, list[tuple[str, str]]] = {}
        for group in GROUP_ORDER:
            entries = [
                (name, self._description(name))
                for name in self._registry
                if self._meta.get(name, {}).get("group", "other") == group
            ]
            if entries:
                catalog[group] = entries
        return catalog

    def skill_safe_tools(self) -> list[str]:
        """Tool names a skill author may reference in `allowed_tools`."""
        return [
            name
            for name in self._registry
            if self._meta.get(name, {}).get("skill_safe", False)
        ]

    def group_of(self, tool_name: str) -> str:
        return self._meta.get(tool_name, {}).get("group", "other")

    async def dispatch(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        user: Any = None,
        *,
        confirmed: bool = False,
    ) -> Any:
        """
        Run one tool on behalf of `user`, through every rule in `agents.tool_policy`.

        This is the only way any surface (chat, voice, saved workflows) reaches a tool, so
        it is where the agent's actions are protected. Policy refusals and tool failures
        are *returned* as the standard error dict rather than raised, so the model always
        gets a well-formed tool_result and never sees exception text.

        `confirmed=True` is passed only by voice's spoken gate, after the caller has said
        yes to the exact arguments. Chat clears a confirmation-required tool by passing
        the single-use `confirmation_token` the first refusal handed back.
        """
        from . import tool_policy as policy

        if tool_name not in self._registry:
            return policy.error_result(
                "unknown_tool", f"There is no tool named {tool_name!r}."
            )
        if not user or not getattr(user, "is_authenticated", False) or not getattr(user, "is_active", True):
            # Rule 1: before this, four tools dropped their owner filter when no user was
            # attached and returned every user's data.
            return policy.error_result(
                "not_authenticated",
                "No signed-in user is attached to this request, so no tool can run.",
            )

        schema = self._schemas.get(tool_name, {}).get("input_schema", {}) or {}
        arguments = dict(arguments or {})
        confirmation_token = arguments.pop("confirmation_token", None)
        meta = self._meta.get(tool_name, {})
        try:
            arguments = policy.validate_arguments(tool_name, schema, arguments)
            policy.check_skill_scope(tool_name, meta)
            approved_by_user = bool(confirmed)
            if tool_name in policy.CONFIRM_REQUIRED and not confirmed:
                if isinstance(confirmation_token, str) and policy.redeem_confirmation(
                    confirmation_token, user.pk, tool_name, arguments
                ):
                    # A redeemed single-use token IS the user's approval on chat, the same as
                    # a spoken yes on voice. Tools that email third parties read this and fail
                    # closed without it.
                    approved_by_user = True
                else:
                    token = policy.issue_confirmation(user.pk, tool_name, arguments)
                    return policy.error_result(
                        "confirmation_required",
                        f"{tool_name} needs the user's explicit approval. Describe exactly what "
                        f"will happen and ask them to confirm. Only after they say yes, call "
                        f"{tool_name} again with the same arguments plus this confirmation_token. "
                        f"If they decline, do nothing.",
                        extra={"confirmation_token": token, "pending_arguments": arguments,
                               "expires_in": policy.CONFIRM_TTL_SECONDS},
                    )
            policy.check_rate_limit(user.pk, policy.category_for(tool_name, self.group_of(tool_name)))
        except policy.ToolPolicyError as refusal:
            logger.info("Tool '%s' refused for user %s: %s", tool_name, user.pk, refusal.error_code)
            return refusal.as_result()

        fn = self._registry[tool_name]
        logger.info("Dispatching tool '%s' for user %s", tool_name, user.pk)
        ctx_token = _current_user.set(user)
        approved_token = _current_approved.set(approved_by_user)
        try:
            async with policy._concurrency_gate():
                return await asyncio.wait_for(fn(**arguments), timeout=policy._timeout_for(tool_name))
        except policy.ToolPolicyError as refusal:
            # An expected refusal raised from inside a tool (recipient not allowed, nothing
            # to change, a record the caller cannot reach) — not a crash, so no traceback.
            logger.info("Tool '%s' refused for user %s: %s", tool_name, user.pk, refusal.error_code)
            return refusal.as_result()
        except Exception as exc:  # noqa: BLE001 — every failure becomes a safe result
            import uuid as _uuid

            ref = _uuid.uuid4().hex[:8]
            logger.exception("Tool '%s' failed for user %s (ref %s)", tool_name, user.pk, ref)
            return policy.classify_exception(exc, tool_name, ref)
        finally:
            _current_approved.reset(approved_token)
            _current_user.reset(ctx_token)

    def tool_schemas(self) -> list[dict]:
        from .tool_policy import CONFIRM_REQUIRED

        schemas = []
        for name in self._registry:
            custom = self._schemas.get(name, {})
            input_schema = custom.get("input_schema", {
                "type": "object",
                "properties": {},
                "required": [],
            })
            if name in CONFIRM_REQUIRED:
                # Advertised to the model so the second, confirmed call is schema-valid.
                # Never stored in the registry schema itself: dispatch strips it before
                # argument validation and redeems it against the cached digest.
                input_schema = {
                    **input_schema,
                    "properties": {
                        **input_schema.get("properties", {}),
                        "confirmation_token": {
                            "type": "string",
                            "description": "Only after the user explicitly approves: the token returned by the first call.",
                        },
                    },
                }
            schemas.append({
                "name": name,
                "description": self._description(name),
                "input_schema": input_schema,
            })
        return schemas


mcp_server = MCPServer()


# ── Google Calendar ───────────────────────────────────────────────────────────

@mcp_server.tool(group="read", skill_safe=False, schema={"input_schema": {
    "type": "object",
    "properties": {
        "calendar_id": {"type": "string", "default": "primary"},
        "date_start": {"type": "string", "description": "ISO 8601 datetime"},
        "date_end": {"type": "string", "description": "ISO 8601 datetime"},
        "max_results": {"type": "integer", "default": 20, "minimum": 1, "maximum": 200},
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
        zone = _caller_zone(user)
        # Unconditional: the dispatcher already refuses a call with no user, and this
        # filter must never be the thing that decides whether it applies.
        qs = CalendarEvent.objects.filter(owner=user)
        if calendar_id and calendar_id != "primary":
            qs = qs.filter(calendar_id=calendar_id)
        if date_start:
            dt = _localize(parse_datetime(date_start), zone)
            if dt:
                qs = qs.filter(start_datetime__gte=dt)
        if date_end:
            dt = _localize(parse_datetime(date_end), zone)
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


@mcp_server.tool(group="create", skill_safe=True, schema={"input_schema": {
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

    start = parse_datetime(start_datetime)
    end = parse_datetime(end_datetime)
    if not start or not end:
        return {"status": "error", "error": f"Could not parse datetimes: {start_datetime!r}, {end_datetime!r}"}

    loop = asyncio.get_running_loop()

    def _create():
        # A time with no offset is the caller's local wall-clock time. TIME_ZONE is UTC, so
        # without this "noon" was stored as 5am in Los Angeles.
        zone = _caller_zone(user)
        start_at, end_at = _localize(start, zone), _localize(end, zone)
        if end_at <= start_at:
            return {"status": "error", "error": "The end time must be after the start time."}

        # A model with no clock created "Monday, October 19th" in 2025: the row existed and
        # the agent reported success, but it was a year in the past so the caller never saw
        # it. Refuse a start that far back, and say what today is so the model can correct.
        from datetime import timedelta
        now = _now()
        if start_at < now - timedelta(days=MAX_EVENT_BACKDATE_DAYS):
            return {
                "status": "error",
                "error": (
                    f"That start time ({start_datetime}) is in the past. Today is "
                    f"{now.astimezone(zone):%Y-%m-%d}. Check the year and try again."
                ),
            }

        # Written through the real view, not the ORM: that is what pushes a primary-calendar
        # event to Google, auto-links its account, runs the account-membership check and
        # writes the activity log — none of which the direct create used to do.
        from . import rest_bridge
        status_code, data = rest_bridge.call(user, "POST", "scheduler/events/", data={
            "title": title,
            "description": description,
            "location": location,
            "start_datetime": start_at.isoformat(),
            "end_datetime": end_at.isoformat(),
            "all_day": all_day,
            "status": "confirmed",
            "calendar_id": calendar_id,
        })
        data = rest_bridge.check(status_code, data, action="create the event")
        from django.utils.dateparse import parse_datetime as _pd
        result = {
            "status": "created",
            "id": data["id"],
            "title": data["title"],
            "start": _pd(data["start_datetime"]).astimezone(zone).isoformat(),
            "end": _pd(data["end_datetime"]).astimezone(zone).isoformat(),
            "calendar_id": data.get("calendar_id"),
        }
        google = data.get("google_sync") or {}
        if google:
            result["google_sync"] = google.get("status")
        return result

    from asgiref.sync import sync_to_async
    result = await sync_to_async(_create, thread_sensitive=True)()
    logger.info("Calendar event created: %s by user %s", result.get("id"), user)
    return result


# ── Gmail ─────────────────────────────────────────────────────────────────────

@mcp_server.tool(group="read", skill_safe=False, schema={"input_schema": {
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

@mcp_server.tool(group="read", skill_safe=True, schema={"input_schema": {
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


@mcp_server.tool(group="create", skill_safe=True, schema={"input_schema": {
    "type": "object",
    "properties": {
        "task": {"type": "string", "description": "Action item title / description"},
        "task_details": {"type": "string", "description": "Additional context or notes"},
        "status": {"type": "string", "enum": ["Open", "In Progress", "Done", "Blocked"], "default": "Open"},
        "priority": {"type": "string", "enum": ["Critical", "High", "Medium", "Low"], "default": "Medium"},
        "due_date": {"type": "string", "description": "Due date in YYYY-MM-DD format, or null"},
        "account_name": {"type": "string", "description": "Account name to link this item to, or null for No Account. If no account matches, the item is still created under No Account."},
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
    from airtable_sync.write_back import last_airtable_error, push_action_item_create
    user = _current_user.get()
    loop = asyncio.get_running_loop()

    def _create():
        # An account that cannot be found must not cost the caller their action item:
        # fall back to "No Account" (no link) and say so in the result. The closest
        # names ride along so the agent can offer to re-file it.
        account, account_error = _resolve_airtable_account(account_name)
        account_fallback = None
        if account_error:
            account_fallback = {
                "requested": account_name,
                "candidates": account_error.get("candidates", []),
            }

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
            reason = last_airtable_error()
            return {
                "status": "error",
                "error": "Airtable write failed — item not created."
                + (f" Airtable said: {reason}" if reason else ""),
            }

        result = {
            "status": "created",
            "id": item.id,
            "airtable_id": item.airtable_id,
            "task": item.task,
            "due_date": str(item.due_date) if item.due_date else None,
            "account_name": item.account.name if item.account else None,
            "priority": item.priority,
            "url": _airtable_url(item.airtable_id, "AIRTABLE_TABLE_ACTION_ITEMS"),
        }
        if account_fallback:
            result["account_fallback"] = (
                f"No account matching '{account_fallback['requested']}' was found, so this "
                f"was saved under No Account."
            )
            result["account_candidates"] = account_fallback["candidates"]
        return result

    try:
        result = await loop.run_in_executor(None, _create)
        logger.info("Action item created: %s by user %s", result.get("airtable_id"), user)
        return result
    except Exception as exc:
        logger.exception("create_action_item failed: %s", exc)
        return {"status": "error", "error": str(exc)}


# ── Record search (fuzzy lookup across all types) ────────────────────────────

@mcp_server.tool(group="read", skill_safe=True, schema={"input_schema": {
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
            qs = CalendarEvent.objects.filter(title__icontains=query, owner=user)
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

@mcp_server.tool(group="update", skill_safe=True, schema={"input_schema": {
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
    from asgiref.sync import sync_to_async
    from . import rest_bridge
    user = _current_user.get()

    def _update():
        # The same endpoint every in-app editor uses. It applies the app's write rule
        # (only your own or unassigned items — the old direct save let any team member
        # edit anyone's), the account-membership check, `can_assign`, marked_done_at
        # bookkeeping and the Airtable push.
        body: dict = {}
        for key, value in (("task", task), ("task_details", task_details), ("status", status),
                           ("priority", priority)):
            if value is not None:
                body[key] = value
        if due_date is not None:
            body["due_date"] = due_date or None
        if account_name is not None:
            if not account_name.strip():
                body["account"] = None
                body["account_name"] = ""
            else:
                # Spoken names are fuzzy-matched first (agents.fuzzy); an unmatched name is
                # reported, never silently unlinked.
                acct, account_error = _resolve_airtable_account(account_name)
                if account_error:
                    return account_error
                body["account"] = acct.pk
                body["account_name"] = acct.name
        if assignee_name is not None:
            if not assignee_name.strip():
                body["assignee_airtable_id"] = ""
                body["assignee_name"] = ""
            else:
                member, member_error = _resolve_team_member(assignee_name)
                if member_error:
                    return member_error
                # The in-app assignee pickers write String(TeamMember.id); match them, so
                # the write rule recognises the new assignee afterwards.
                body["assignee_airtable_id"] = str(member.pk)
                body["assignee_name"] = member.full_name
        if not body:
            return error_result("invalid_arguments", "Nothing to change on the action item. Pass at least one field.")

        code, data = rest_bridge.call(user, "PATCH", f"airtable/action-items/{airtable_id}/fields/", data=body)
        data = rest_bridge.check(code, data, action="update the action item")
        return {
            "status": "updated",
            "id": data.get("id"),
            "airtable_id": data.get("airtable_id", airtable_id),
            "task": data.get("task"),
            "status_value": data.get("status"),
            "priority": data.get("priority"),
            "assignee_name": data.get("assignee_name"),
            "account_name": data.get("account_name"),
            "url": _airtable_url(data.get("airtable_id", airtable_id), "AIRTABLE_TABLE_ACTION_ITEMS"),
        }

    return await sync_to_async(_update, thread_sensitive=True)()

# ── Delete action item ────────────────────────────────────────────────────────

@mcp_server.tool(group="delete", skill_safe=False, schema={"input_schema": {
    "type": "object",
    "properties": {
        "airtable_id": {"type": "string", "description": "The airtable_id of the action item to delete"},
    },
    "required": ["airtable_id"],
}})
async def delete_action_item(airtable_id: str) -> dict:
    """Permanently delete an action item from the platform and Airtable. Cannot be undone."""
    from asgiref.sync import sync_to_async
    from airtable_sync.models import AirtableActionItem
    from . import rest_bridge
    user = _current_user.get()

    def _delete():
        item = AirtableActionItem.objects.filter(airtable_id=airtable_id).only("id").first()
        if item is None:
            return error_result("not_found", "Couldn't find that record, or you don't have access to it.")
        # The real destroy path: the app's write rule, the Airtable delete and the
        # scheduler unmirror. Reached only after the user has explicitly approved it.
        code, data = rest_bridge.call(user, "DELETE", f"airtable/action-items/{item.pk}/")
        rest_bridge.check(code, data, action="delete the action item")
        return {"status": "deleted", "airtable_id": airtable_id}

    return await sync_to_async(_delete, thread_sensitive=True)()

# ── Update calendar event ─────────────────────────────────────────────────────

@mcp_server.tool(group="update", skill_safe=True, schema={"input_schema": {
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
    from asgiref.sync import sync_to_async
    from django.utils.dateparse import parse_datetime
    from . import rest_bridge
    user = _current_user.get()

    def _update():
        zone = _caller_zone(user)
        details = {}
        if title is not None:
            details["title"] = title
        if description is not None:
            details["description"] = description
        if location is not None:
            details["location"] = location
        for key, raw in (("start_datetime", start_datetime), ("end_datetime", end_datetime)):
            if raw is not None:
                parsed = _localize(parse_datetime(raw), zone)
                if parsed is None:
                    return error_result("invalid_arguments", f"Could not read {key} {raw!r} as a date and time.")
                details[key] = parsed.isoformat()
        if not details and status is None:
            return error_result("invalid_arguments", "Nothing to change on the event. Pass at least one field.")

        # The same endpoints the calendar page uses. `details/` is what lets you edit your own
        # meeting even when it is linked to an account you are not on, and it pushes the
        # change to Google so the next sync does not revert it.
        data = None
        if details:
            code, data = rest_bridge.call(user, "PATCH", f"scheduler/events/{event_id}/details/", data=details)
            data = rest_bridge.check(code, data, action="update the event")
        if status is not None:
            code, data = rest_bridge.call(user, "PATCH", f"scheduler/events/{event_id}/", data={"status": status})
            data = rest_bridge.check(code, data, action="change the event's status")
        return {
            "status": "updated",
            "id": data["id"],
            "title": data["title"],
            "start": parse_datetime(data["start_datetime"]).astimezone(zone).isoformat(),
            "end": parse_datetime(data["end_datetime"]).astimezone(zone).isoformat(),
            "event_status": data.get("status"),
        }

    return await sync_to_async(_update, thread_sensitive=True)()

# ── Delete calendar event ─────────────────────────────────────────────────────

@mcp_server.tool(group="delete", skill_safe=False, schema={"input_schema": {
    "type": "object",
    "properties": {
        "event_id": {"type": "integer", "description": "The id of the calendar event to delete"},
    },
    "required": ["event_id"],
}})
async def delete_calendar_event(event_id: int) -> dict:
    """Delete a calendar event. Cannot be undone."""
    from asgiref.sync import sync_to_async
    from . import rest_bridge
    user = _current_user.get()

    def _delete():
        # The real destroy path: also removes it from Google and returns tracked time it
        # held to its action item. The dispatcher only lets this run after the user has
        # explicitly approved it.
        code, data = rest_bridge.call(user, "DELETE", f"scheduler/events/{event_id}/")
        rest_bridge.check(code, data, action="delete the event")
        return {"status": "deleted", "id": event_id}

    return await sync_to_async(_delete, thread_sensitive=True)()

# ── Update meeting summary notes (Airtable) ──────────────────────────────────
#
# Notes only, deliberately. The app can edit a meeting's Gong / Zoom summary and nothing
# else about it, so this tool matches that exactly by calling the same notes endpoints.
# It used to rename, re-date and re-file meetings onto other accounts — none of which the
# UI can do — and to "delete" meetings, which the next Airtable pull silently recreated.
# Both are gone.

@mcp_server.tool(group="update", skill_safe=True, schema={"input_schema": {
    "type": "object",
    "properties": {
        "airtable_id": {"type": "string", "description": "The airtable_id of the meeting (from search_records)"},
        "notes": {"type": "string", "description": "The full summary text to save. Replaces the existing summary for that source."},
        "source": {"type": "string", "enum": ["gong", "zoom"], "default": "gong",
                   "description": "Which summary to write: the Gong recap or the Zoom recap."},
    },
    "required": ["airtable_id", "notes"],
}})
async def update_meeting(airtable_id: str, notes: str, source: str = "gong") -> dict:
    """Set a meeting's Gong or Zoom summary notes. Only the summary can be edited; name, date and account cannot."""
    from asgiref.sync import sync_to_async
    from airtable_sync.models import AirtableMeeting
    from . import rest_bridge
    user = _current_user.get()

    def _update():
        meeting = AirtableMeeting.objects.filter(airtable_id=airtable_id).only("id").first()
        if meeting is None:
            return error_result("not_found", "Couldn't find that record, or you don't have access to it.")
        key = "gong_notes" if source == "gong" else "zoom_notes"
        status_code, data = rest_bridge.call(
            user, "PATCH", f"airtable/meetings/{meeting.id}/{source}-notes/", data={key: notes},
        )
        data = rest_bridge.check(status_code, data, action="update that meeting's notes")
        return {
            "status": "updated",
            "id": data.get("id"),
            "airtable_id": data.get("airtable_id"),
            "name": data.get("name"),
            "source": source,
            "url": _airtable_url(data.get("airtable_id", ""), "AIRTABLE_TABLE_MEETINGS"),
        }

    return await sync_to_async(_update, thread_sensitive=True)()


# ── Update account ────────────────────────────────────────────────────────────

@mcp_server.tool(group="update", skill_safe=True, schema={"input_schema": {
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
    from asgiref.sync import sync_to_async
    from . import rest_bridge
    user = _current_user.get()

    def _update():
        from .fuzzy import resolve_name

        # Resolve the name among the caller's own accounts only, then PATCH through the
        # real view, which requires the caller to be the account's owner. The old direct
        # save let any team member rename an account or change its ARR.
        code, data = rest_bridge.call(user, "GET", "accounts/accounts/", params={"page_size": 1000})
        accounts = {a["company_name"]: a for a in rest_bridge.results(rest_bridge.check(code, data, action="look up accounts"))}
        res = resolve_name(account_name, list(accounts))
        if not res.match:
            return error_result("not_found", f"No account of yours matches '{account_name}'.",
                                extra={"candidates": res.candidates})
        acct = accounts[res.match]
        patch = {k: v for k, v in {
            "company_name": new_name, "website": website, "industry": industry,
            "status": status, "arr": arr,
        }.items() if v is not None}
        if not patch:
            return error_result("invalid_arguments", "Nothing to change on the account. Pass at least one field.")
        code, data = rest_bridge.call(user, "PATCH", f"accounts/accounts/{acct['id']}/", data=patch)
        data = rest_bridge.check(code, data, action="update the account")
        return {
            "status": "updated",
            "id": data["id"],
            "company_name": data["company_name"],
            "status_value": data.get("status"),
            "arr": float(data["arr"]) if data.get("arr") is not None else None,
            "url": _airtable_url(data.get("airtable_id") or "", "AIRTABLE_TABLE_ACCOUNTS") if data.get("airtable_id") else None,
        }

    return await sync_to_async(_update, thread_sensitive=True)()

# ── Add account note ──────────────────────────────────────────────────────────

@mcp_server.tool(group="create", skill_safe=True, schema={"input_schema": {
    "type": "object",
    "properties": {
        "account_name": {"type": "string", "description": "Name of the account to add the note to"},
        "content": {"type": "string", "description": "The note content"},
    },
    "required": ["account_name", "content"],
}})
async def add_account_note(account_name: str, content: str) -> dict:
    """Add a timestamped note to an account. Great for quick verbal updates like 'Acme said they want to expand to 3 seats.'"""
    from asgiref.sync import sync_to_async
    from . import rest_bridge
    user = _current_user.get()

    def _add():
        from .fuzzy import resolve_name

        code, data = rest_bridge.call(user, "GET", "accounts/accounts/", params={"page_size": 1000})
        accounts = {a["company_name"]: a for a in rest_bridge.results(rest_bridge.check(code, data, action="look up accounts"))}
        res = resolve_name(account_name, list(accounts))
        if not res.match:
            return error_result("not_found", f"No account of yours matches '{account_name}'.",
                                extra={"candidates": res.candidates})
        acct = accounts[res.match]
        # Through the real notes endpoint, which also writes the activity log entry.
        code, note = rest_bridge.call(user, "POST", f"accounts/accounts/{acct['id']}/notes/", data={"content": content})
        note = rest_bridge.check(code, note, action="add the note")
        return {
            "status": "created",
            "note_id": note["id"],
            "account_name": acct["company_name"],
            "content": note["content"],
            "url": _airtable_url(acct.get("airtable_id") or "", "AIRTABLE_TABLE_ACCOUNTS") if acct.get("airtable_id") else None,
        }

    return await sync_to_async(_add, thread_sensitive=True)()

# ── Meeting notes from email ──────────────────────────────────────────────────

@mcp_server.tool(group="read", skill_safe=True, schema={"input_schema": {
    "type": "object",
    "properties": {
        "days": {
            "type": "integer",
            "default": 30,
            "description": "How many days back to scan for recap emails (max 180).",
        },
        "account_name": {
            "type": "string",
            "description": "Optional — restrict to one account's meetings.",
        },
    },
}})
async def get_meeting_notes_from_email(days: int = 30, account_name: str = "") -> dict:
    """Scan the user's Gmail for Gong or Zoom recap emails and attach any missing AI meeting summary to the matching meeting. Call this when the user asks to fetch, pull, refresh, or back-fill meeting notes or call recaps, or says a meeting is missing its summary. Matches emails to meetings by name and date, prefers Gong over Zoom, stores both, and never overwrites an existing summary."""
    from integrations.meeting_notes import GmailNotConnected, sync_meeting_notes_from_email

    user = _current_user.get()
    if not user:
        return {"status": "error", "message": "Not authorized for this record"}

    loop = asyncio.get_running_loop()

    def _run():
        return sync_meeting_notes_from_email(user, days=days, account_name=account_name or "")

    try:
        report = await loop.run_in_executor(None, _run)
    except GmailNotConnected:
        return {
            "status": "error",
            "message": "Gmail is not connected. Connect Gmail from the Settings page first.",
        }
    except Exception as exc:
        logger.exception("get_meeting_notes_from_email failed: %s", exc)
        return {"status": "error", "error": str(exc)}

    # Keep the tool result compact — Claude only needs what changed, and the raw
    # `skipped` list on a busy account can run to hundreds of entries.
    return {
        "status": "ok",
        "scanned_emails": report["scanned_emails"],
        "scanned_meetings": report["scanned_meetings"],
        "updated_count": len(report["updated"]),
        "updated": [
            {
                "meeting_name": item["meeting_name"],
                "date": item["date"],
                "account_name": item["account_name"],
                "sources": item["sources"],
            }
            for item in report["updated"]
        ],
        "skipped_count": len(report["skipped"]),
        "summaries_truncated": report["summaries_truncated"],
    }


# ── Slack ─────────────────────────────────────────────────────────────────────

@mcp_server.tool(group="read", skill_safe=False, schema={"input_schema": {
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
) -> dict:
    """Retrieve recent messages from a Slack channel (id or #name) or DM you can see."""
    logger.info("get_slack_messages: channel=%s", channel)
    from asgiref.sync import sync_to_async
    from integrations.slack_channels import fetch_messages

    user = _current_user.get()
    if user is None:
        return {"enabled": False, "messages": [], "detail": "Not signed in."}
    return await sync_to_async(fetch_messages, thread_sensitive=True)(user, channel, limit, oldest, latest)


# send_slack_message is not yet implemented — omitted from registry to avoid
# Claude calling it and receiving a confusing not_implemented response.
# Re-register with @mcp_server.tool() once the implementation is complete.


def _allowed_phone_numbers(user: Any) -> dict[str, str]:
    """
    {E.164 number: whose it is} for the numbers this user may text or call.

    The allowlist is the profile phone number of the user, of everyone who shares an
    account with them, and of everyone who shares a team with them. It is the guard that
    stops an injected instruction ("text +1 555... the account list") from reaching an
    arbitrary number from the org's Twilio line: tool results include text written by
    third parties (Airtable notes, Gmail-derived summaries), and the model can be steered.
    Customer contacts have no phone field, so they are not reachable this way.
    """
    from django.db.models import Q
    from accounts.models import Account
    from team.models import UserProfile

    my_accounts = Account.objects.filter(Q(team_members__user=user) | Q(admin_owner=user))
    profiles = (
        UserProfile.objects.filter(
            Q(user=user)
            | Q(user__team_member__member_accounts__in=my_accounts)
            | Q(user__memberships__team__memberships__user=user)
        )
        .exclude(phone_number="")
        .select_related("user")
        .distinct()
    )
    allowed: dict[str, str] = {}
    for profile in profiles:
        number = re.sub(r"[\s().-]", "", profile.phone_number or "")
        if _E164_RE.match(number):
            label = "you" if profile.user_id == user.pk else (
                profile.display_name or profile.user.get_full_name() or profile.user.username
            )
            allowed[number] = label
    return allowed


def _check_outbound_recipient(user: Any, to: str) -> tuple[str, str]:
    """Normalise `to` and require it to be on the allowlist. Returns (number, whose)."""
    from .tool_policy import ToolPolicyError, check_rate_limit

    number = re.sub(r"[\s().-]", "", to or "")
    if not _E164_RE.match(number):
        raise ToolPolicyError("invalid_arguments",
                              "The number must include its country code, e.g. +14155550123.")
    allowed = _allowed_phone_numbers(user)
    if number not in allowed:
        raise ToolPolicyError(
            "recipient_not_allowed",
            "That number isn't on file for you or a teammate, so the agent can't text or call it. "
            "Add it to the person's profile in the app first.",
        )
    # Second, narrower budget: at most a few messages to any single person per hour,
    # on top of the user's overall outbound budget the dispatcher already applied.
    check_rate_limit(user.pk, f"outbound-to:{number}")
    return number, allowed[number]


# ── Twilio SMS ────────────────────────────────────────────────────────────────

@mcp_server.tool(group="communicate", skill_safe=False, schema={"input_schema": {
    "type": "object",
    "properties": {
        "to": {"type": "string", "description": "Recipient phone number in E.164 format. Must be a number on file for you or a teammate."},
        "body": {"type": "string", "maxLength": 1600, "description": "SMS message body (max 1600 chars)"},
    },
    "required": ["to", "body"],
}})
async def send_sms(to: str, body: str) -> dict:
    """Send an SMS message to a phone number via Twilio on behalf of the user."""
    from asgiref.sync import sync_to_async
    from django.conf import settings

    user = _current_user.get()
    number, whose = await sync_to_async(_check_outbound_recipient, thread_sensitive=True)(user, to)
    if not (settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN and settings.TWILIO_PHONE_NUMBER):
        return error_result("not_configured", "Texting isn't set up on this server.")

    loop = asyncio.get_running_loop()

    def _send():
        from twilio.rest import Client
        client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
        message = client.messages.create(body=body, from_=settings.TWILIO_PHONE_NUMBER, to=number)
        return {"status": "sent", "sid": message.sid, "delivery_status": message.status, "to": whose}

    # Twilio failures (including 20429 / 14107 rate limits) propagate to the dispatcher,
    # which classifies them without exposing the exception text (it carries the account SID).
    result = await loop.run_in_executor(None, _send)
    logger.info("SMS sent via Twilio: sid=%s user=%s", result.get("sid"), user.pk)
    return result


# ── Token usage ──────────────────────────────────────────────────────────────

@mcp_server.tool(group="read", skill_safe=False, schema={"input_schema": {
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

        msg_qs = AgentMessage.objects.filter(session__user=user)
        inv_qs = SkillInvocation.objects.filter(invoked_by=user)

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
        session_qs = AgentSession.objects.filter(user=user)
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

@mcp_server.tool(group="communicate", skill_safe=False, schema={"input_schema": {
    "type": "object",
    "properties": {
        "to": {"type": "string", "description": "Phone number to call in E.164 format. Must be a number on file for you or a teammate."},
        "message": {"type": "string", "maxLength": 1000, "description": "Message to read via TTS when the call connects"},
    },
    "required": ["to"],
}})
async def make_phone_call(to: str, message: str = "Hello from Agent PM.") -> dict:
    """Initiate an outbound phone call via Twilio, reading a message via text-to-speech."""
    from asgiref.sync import sync_to_async
    from django.conf import settings

    user = _current_user.get()
    number, whose = await sync_to_async(_check_outbound_recipient, thread_sensitive=True)(user, to)
    if not (settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN and settings.TWILIO_PHONE_NUMBER):
        return error_result("not_configured", "Calling isn't set up on this server.")

    from twilio.twiml.voice_response import VoiceResponse
    response = VoiceResponse()
    response.say(message)
    twiml = str(response)
    loop = asyncio.get_running_loop()

    def _call():
        from twilio.rest import Client
        client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
        call = client.calls.create(twiml=twiml, from_=settings.TWILIO_PHONE_NUMBER, to=number)
        return {"status": "calling", "sid": call.sid, "call_status": call.status, "to": whose}

    result = await loop.run_in_executor(None, _call)
    logger.info("Outbound call initiated: sid=%s user=%s", result.get("sid"), user.pk)
    return result


# ── Saved workflows (AgentSkill) ──────────────────────────────────────────────
#
# These two make saved workflows reachable from the agent — most importantly from
# voice, where the user can only *say* a skill's name. `AgentSkill` is imported
# inside the function bodies (the style used throughout this module) so there is no
# agents ↔ skills import cycle.
#
# Both use sync_to_async(thread_sensitive=True) rather than the
# loop.run_in_executor(None, ...) the other 17 tools use. Two reasons: a bare
# executor thread never runs Django's close_old_connections, so it can leak a DB
# connection per call (pre-existing, but voice multiplies tool calls per session);
# and executor threads cannot see APITestCase transaction data, so run_in_executor
# tools are untestable from inside a TestCase.


def _skill_scope(user: Any):
    """
    Approved skills this user may run.

    Mirrors AgentSkillViewSet.get_queryset intersected with status="approved":
    staff sees all approved, everyone else sees their own approved skills (private
    ones they authored included) plus public+approved. Drafts are excluded for
    everyone — they have not passed security review, matching the guard on
    AgentSkillViewSet.run. Anonymous callers see nothing, as with every other tool.
    """
    from django.db.models import Q
    from skills.models import AgentSkill

    if not user:
        return AgentSkill.objects.none()
    qs = AgentSkill.objects.filter(status="approved")
    if not _is_staff(user):
        qs = qs.filter(Q(created_by=user) | Q(visibility="public")).distinct()
    return qs


def _list_skills_sync(user: Any, query: str) -> list[dict]:
    from django.db.models import Q

    qs = _skill_scope(user)
    if query:
        qs = qs.filter(Q(name__icontains=query) | Q(description__icontains=query))
    return [
        {"name": s.name, "description": s.description, "allowed_tools": s.allowed_tools or []}
        for s in qs.order_by("name")
    ]


def _load_skill_sync(user: Any, name: str) -> dict:
    skill = _skill_scope(user).filter(name=name).first()
    if skill is None:
        # One message for every miss — unknown name, unapproved draft and someone
        # else's private skill are deliberately indistinguishable, so this cannot be
        # used to probe which skills exist.
        return {
            "error": f"No approved workflow named '{name}' is available to you.",
            "available": [s["name"] for s in _list_skills_sync(user, "")],
        }
    return {
        "name": skill.name,
        "description": skill.description,
        "instructions": skill.instructions,
        "allowed_tools": skill.allowed_tools or [],
    }


@mcp_server.tool(group="skills", skill_safe=False, schema={"input_schema": {
    "type": "object",
    "properties": {
        "query": {"type": "string", "description": "Optional keyword filter on name or description."},
    },
}})
async def list_skills(query: str = "") -> list[dict]:
    """List the saved workflows (skills) available to this user. Call this when the user names a workflow you don't recognize, or asks what you can do."""
    from asgiref.sync import sync_to_async

    user = _current_user.get()
    logger.info("list_skills: query=%r user=%s", query, user)
    return await sync_to_async(_list_skills_sync, thread_sensitive=True)(user, query)


@mcp_server.tool(group="skills", skill_safe=False, schema={"input_schema": {
    "type": "object",
    "properties": {
        "text": {"type": "string", "description": (
            "Text containing @#-- keywords, e.g. @#--all-action-items-${Acme} or "
            "@#--all-meeting-notes-${Acme}-${october}. Kinds: all-action-items, "
            "all-meeting-notes, all-artifacts, all-account-notes. Date ranges: last-30-days, "
            "this-week, last-month, october, 2026-10-01..2026-10-31.")},
    },
    "required": ["text"],
}})
async def resolve_skill_keywords(text: str) -> dict:
    """Expand @#-- lookup keywords into the caller's own records (action items, meetings, artifacts, notes)."""
    from skills import keywords

    user = _current_user.get()

    def body():
        found = keywords.find_keywords(text)[:10]
        if not found:
            return {"status": "ok", "results": [], "note": "No @#-- keywords found."}
        return {"status": "ok", "results": [keywords.expand_keyword(user, k) for k in found]}

    from asgiref.sync import sync_to_async

    return await sync_to_async(body, thread_sensitive=True)()


@mcp_server.tool(group="skills", skill_safe=False, schema={"input_schema": {
    "type": "object",
    "properties": {
        "name": {"type": "string", "description": "Exact skill name, kebab-case."},
    },
    "required": ["name"],
}})
async def load_skill(name: str) -> dict:
    """Load a saved workflow's step-by-step instructions before doing the work. Call this FIRST, before any other tool, when the request matches a workflow's description — the instructions tell you which tools to call and in what order."""
    from asgiref.sync import sync_to_async

    user = _current_user.get()
    logger.info("load_skill: name=%r user=%s", name, user)
    return await sync_to_async(_load_skill_sync, thread_sensitive=True)(user, name)
