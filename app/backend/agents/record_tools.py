"""
Agent tools for every user-facing record the earlier tool set did not cover: reminders,
artifacts, account notes, quick links, customer contacts and their notes, projects and
goals, project members, action-item steps and dependencies and link attachments, meeting
notes, comments, tasks, feedback, working sessions, page notes, and team members (read).

Create, read and update only. **No delete tool lives here, by design** — deletes stay in the
app, where the user can see what they are removing.

Every tool calls the app's own REST endpoint through `agents.rest_bridge`, as the signed-in
user. That is the whole security model of this module: the agent gets exactly the scoping,
validation, permission checks and side effects (Airtable write-back, activity log, Cloud
Coach push, Google push) the browser gets, and nothing a view would refuse can happen here.
None of these tools re-implements a permission rule.

Deliberately not exposed: credentials and OAuth tokens, integration configs, account roles
and team memberships (they grant access), user profiles (push subscriptions, staff
overrides), and executable ClaudeSkill code.

Registered from `AgentsConfig.ready()`, like `people_tools`. All use
`sync_to_async(thread_sensitive=True)`.
"""

from __future__ import annotations

import logging
from typing import Any

from asgiref.sync import sync_to_async

from . import rest_bridge
from .tool_policy import ToolPolicyError, error_result

logger = logging.getLogger(__name__)

# Keep tool results small: the model re-reads every result on every later round.
DEFAULT_LIMIT = 25
MAX_LIMIT = 100


# ── Shared helpers ────────────────────────────────────────────────────────────


def _user():
    from .mcp_server import _current_user

    return _current_user.get()


def _run(fn):
    """Run a sync body on the request thread; ToolPolicyError becomes the standard result."""

    async def wrapper(*args, **kwargs):
        def body():
            try:
                return fn(*args, **kwargs)
            except ToolPolicyError as refusal:
                return refusal.as_result()

        return await sync_to_async(body, thread_sensitive=True)()

    wrapper.__name__ = fn.__name__
    wrapper.__doc__ = fn.__doc__
    return wrapper


def _req(method: str, path: str, *, action: str, data: Any = None, params: dict | None = None):
    status, payload = rest_bridge.call(_user(), method, path, data=data, params=params)
    return rest_bridge.check(status, payload, action=action)


def _limit(value: int | None) -> int:
    return max(1, min(int(value or DEFAULT_LIMIT), MAX_LIMIT))


def _pick(record: dict, *keys: str) -> dict:
    return {k: record.get(k) for k in keys if k in record}


def _clean(**fields) -> dict:
    """Drop arguments the model did not pass, so a PATCH changes only what was asked."""
    return {k: v for k, v in fields.items() if v is not None}


def _require_changes(patch: dict, what: str) -> None:
    if not patch:
        raise ToolPolicyError("invalid_arguments", f"Nothing to change on the {what}. Pass at least one field.")


def _resolve_account(name: str) -> dict:
    """
    The caller's account named `name` (fuzzy). Resolved through the accounts list endpoint,
    so only accounts the caller can already see are candidates — a name can never reach an
    account they are not on.
    """
    from .fuzzy import resolve_name

    if not (name or "").strip():
        raise ToolPolicyError("invalid_arguments", "An account name is required.")
    data = _req("GET", "accounts/accounts/", action="look up accounts", params={"page_size": 1000})
    accounts = {a["company_name"]: a for a in rest_bridge.results(data) if a.get("company_name")}
    res = resolve_name(name, list(accounts))
    if res.match:
        return accounts[res.match]
    raise ToolPolicyError(
        "not_found",
        f"No account of yours matches '{name}'."
        + (" Did you mean one of these?" if res.candidates else ""),
        extra={"candidates": res.candidates},
    )


def _action_item_pk(airtable_id: str) -> int:
    """Steps, dependencies and attachments are keyed by the item's integer pk."""
    data = _req("GET", "airtable/action-items/", action="look up that action item",
                params={"airtable_id": airtable_id})
    rows = rest_bridge.results(data)
    if not rows:
        raise ToolPolicyError("not_found", "Couldn't find that record, or you don't have access to it.")
    return rows[0]["id"]


def _obj(properties: dict, required: list[str] | None = None) -> dict:
    return {"input_schema": {"type": "object", "properties": properties, "required": required or []}}


_LIMIT_PROP = {"type": "integer", "minimum": 1, "maximum": MAX_LIMIT, "description": f"Max results (default {DEFAULT_LIMIT})."}
_ACCOUNT_PROP = {"type": "string", "description": "Account name (close spellings are matched)."}


# ── Registration ──────────────────────────────────────────────────────────────


def register(mcp_server) -> None:  # noqa: C901 — one flat registry is easier to audit
    tool = mcp_server.tool

    # ── Reminders ────────────────────────────────────────────────────────────
    REMINDER_FIELDS = ("id", "title", "body", "due_at", "status", "resource_type",
                       "resource_id", "resource_label", "notify_in_app", "notify_slack",
                       "notify_push", "notify_sms")

    @tool(group="read", skill_safe=True, schema=_obj({
        "status": {"type": "string", "enum": ["pending", "sent", "dismissed", "snoozed"]},
        "search": {"type": "string", "description": "Text to match in the title or body."},
        "limit": _LIMIT_PROP,
    }))
    @_run
    def list_reminders(status=None, search=None, limit=None):
        """List your reminders, soonest first. Filter by status or search text."""
        data = _req("GET", "scheduler/reminders/", action="list reminders",
                    params=_clean(status=status, search=search))
        rows = rest_bridge.results(data)[: _limit(limit)]
        return {"status": "ok", "count": len(rows), "reminders": [_pick(r, *REMINDER_FIELDS) for r in rows]}

    @tool(group="create", skill_safe=True, schema=_obj({
        "title": {"type": "string", "maxLength": 500},
        "due_at": {"type": "string", "description": "When to remind, ISO 8601 with offset, e.g. 2026-10-20T09:00:00-07:00."},
        "body": {"type": "string"},
        "notify_in_app": {"type": "boolean"}, "notify_slack": {"type": "boolean"},
        "notify_push": {"type": "boolean"}, "notify_sms": {"type": "boolean"},
        "resource_type": {"type": "string", "enum": ["account", "calendar_event", "action_item", "task", "general"]},
        "resource_id": {"type": "integer", "minimum": 0},
        "resource_label": {"type": "string", "maxLength": 300},
    }, ["title", "due_at"]))
    @_run
    def create_reminder(title, due_at, body=None, notify_in_app=None, notify_slack=None,
                        notify_push=None, notify_sms=None, resource_type=None,
                        resource_id=None, resource_label=None):
        """Create a reminder that notifies you at a set time (in-app by default; Slack, push or SMS optional)."""
        data = _req("POST", "scheduler/reminders/", action="create the reminder", data=_clean(
            title=title, due_at=due_at, body=body, notify_in_app=notify_in_app,
            notify_slack=notify_slack, notify_push=notify_push, notify_sms=notify_sms,
            resource_type=resource_type, resource_id=resource_id, resource_label=resource_label,
        ))
        return {"status": "created", "reminder": _pick(data, *REMINDER_FIELDS)}

    @tool(group="update", skill_safe=True, schema=_obj({
        "reminder_id": {"type": "integer"},
        "title": {"type": "string", "maxLength": 500},
        "due_at": {"type": "string", "description": "ISO 8601 with offset. Setting a new time re-arms a sent or snoozed reminder."},
        "body": {"type": "string"},
        "status": {"type": "string", "enum": ["pending", "dismissed", "snoozed"]},
        "notify_in_app": {"type": "boolean"}, "notify_slack": {"type": "boolean"},
        "notify_push": {"type": "boolean"}, "notify_sms": {"type": "boolean"},
    }, ["reminder_id"]))
    @_run
    def update_reminder(reminder_id, title=None, due_at=None, body=None, status=None,
                        notify_in_app=None, notify_slack=None, notify_push=None, notify_sms=None):
        """Change a reminder: reschedule it, edit it, dismiss or snooze it, or change how it notifies you."""
        patch = _clean(title=title, due_at=due_at, body=body, status=status,
                       notify_in_app=notify_in_app, notify_slack=notify_slack,
                       notify_push=notify_push, notify_sms=notify_sms)
        _require_changes(patch, "reminder")
        if due_at is not None and status is None:
            # Delivery only picks up `pending` rows. Rescheduling a sent or snoozed
            # reminder without this would silently never fire again.
            patch["status"] = "pending"
        data = _req("PATCH", f"scheduler/reminders/{reminder_id}/", action="update the reminder", data=patch)
        return {"status": "updated", "reminder": _pick(data, *REMINDER_FIELDS)}

    # ── Account notes & quick links ──────────────────────────────────────────
    @tool(group="read", skill_safe=True, schema=_obj({"account_name": _ACCOUNT_PROP, "limit": _LIMIT_PROP}, ["account_name"]))
    @_run
    def list_account_notes(account_name, limit=None):
        """List the notes logged on one of your accounts, newest first."""
        acct = _resolve_account(account_name)
        rows = rest_bridge.results(_req("GET", f"accounts/accounts/{acct['id']}/notes/", action="list notes"))
        return {"status": "ok", "account_name": acct["company_name"],
                "notes": [_pick(n, "id", "content", "author_username", "created_at") for n in rows[: _limit(limit)]]}

    @tool(group="update", skill_safe=True, schema=_obj({
        "note_id": {"type": "integer"}, "content": {"type": "string"},
    }, ["note_id", "content"]))
    @_run
    def update_account_note(note_id, content):
        """Edit the text of an account note you wrote."""
        data = _req("PATCH", f"accounts/notes/{note_id}/", action="edit that note", data={"content": content})
        return {"status": "updated", "note": _pick(data, "id", "content", "updated_at")}

    @tool(group="read", skill_safe=True, schema=_obj({"account_name": _ACCOUNT_PROP}, ["account_name"]))
    @_run
    def list_quick_links(account_name):
        """List the quick links (bookmarked URLs) on one of your accounts."""
        acct = _resolve_account(account_name)
        rows = rest_bridge.results(_req("GET", f"accounts/accounts/{acct['id']}/quick-links/", action="list quick links"))
        return {"status": "ok", "account_name": acct["company_name"],
                "quick_links": [_pick(q, "id", "name", "url", "position") for q in rows]}

    @tool(group="create", skill_safe=True, schema=_obj({
        "account_name": _ACCOUNT_PROP, "name": {"type": "string", "maxLength": 300}, "url": {"type": "string"},
    }, ["account_name", "name", "url"]))
    @_run
    def create_quick_link(account_name, name, url):
        """Add a quick link (a named, bookmarked URL) to one of your accounts."""
        acct = _resolve_account(account_name)
        data = _req("POST", f"accounts/accounts/{acct['id']}/quick-links/", action="add the quick link",
                    data={"name": name, "url": url})
        return {"status": "created", "account_name": acct["company_name"], "quick_link": _pick(data, "id", "name", "url")}

    @tool(group="update", skill_safe=True, schema=_obj({
        "quick_link_id": {"type": "integer"}, "name": {"type": "string", "maxLength": 300}, "url": {"type": "string"},
    }, ["quick_link_id"]))
    @_run
    def update_quick_link(quick_link_id, name=None, url=None):
        """Rename a quick link or change its URL."""
        patch = _clean(name=name, url=url)
        _require_changes(patch, "quick link")
        data = _req("PATCH", f"accounts/quick-links/{quick_link_id}/", action="update the quick link", data=patch)
        return {"status": "updated", "quick_link": _pick(data, "id", "name", "url")}

    # ── Artifacts (links only) ───────────────────────────────────────────────
    ARTIFACT_FIELDS = ("id", "name", "artifact_type", "url", "description", "uploaded_by_username", "created_at")

    @tool(group="read", skill_safe=True, schema=_obj({"account_name": _ACCOUNT_PROP, "limit": _LIMIT_PROP}, ["account_name"]))
    @_run
    def list_artifacts(account_name, limit=None):
        """List the artifacts (links and files) attached to one of your accounts."""
        acct = _resolve_account(account_name)
        rows = rest_bridge.results(_req("GET", f"accounts/accounts/{acct['id']}/artifacts/", action="list artifacts"))
        return {"status": "ok", "account_name": acct["company_name"],
                "artifacts": [_pick(a, *ARTIFACT_FIELDS) for a in rows[: _limit(limit)]]}

    @tool(group="create", skill_safe=True, schema=_obj({
        "account_name": _ACCOUNT_PROP,
        "name": {"type": "string", "maxLength": 300},
        "url": {"type": "string", "description": "The link. File uploads are not available to the agent; add files in the app."},
        "description": {"type": "string"},
    }, ["account_name", "name", "url"]))
    @_run
    def create_artifact(account_name, name, url, description=None):
        """Add a link artifact (a document, deck or page URL) to one of your accounts."""
        acct = _resolve_account(account_name)
        if not str(url).lower().startswith(("https://", "http://")):
            raise ToolPolicyError("invalid_arguments", "url must start with http:// or https://.")
        data = _req("POST", f"accounts/accounts/{acct['id']}/artifacts/", action="add the artifact",
                    data=_clean(artifact_type="link", name=name, url=url, description=description))
        return {"status": "created", "account_name": acct["company_name"], "artifact": _pick(data, *ARTIFACT_FIELDS)}

    @tool(group="update", skill_safe=True, schema=_obj({
        "artifact_id": {"type": "integer"}, "name": {"type": "string", "maxLength": 300},
        "url": {"type": "string"}, "description": {"type": "string"},
    }, ["artifact_id"]))
    @_run
    def update_artifact(artifact_id, name=None, url=None, description=None):
        """Rename an artifact you added, or change its URL or description."""
        patch = _clean(name=name, url=url, description=description)
        _require_changes(patch, "artifact")
        data = _req("PATCH", f"accounts/artifacts/{artifact_id}/", action="update the artifact", data=patch)
        return {"status": "updated", "artifact": _pick(data, *ARTIFACT_FIELDS)}

    # ── Customer contacts & their notes ──────────────────────────────────────
    CONTACT_FIELDS = ("id", "name", "role", "email", "description", "notes_count")

    @tool(group="read", skill_safe=True, schema=_obj({"account_name": _ACCOUNT_PROP}, ["account_name"]))
    @_run
    def list_customer_contacts(account_name):
        """List the customer-side contacts on one of your accounts."""
        acct = _resolve_account(account_name)
        rows = rest_bridge.results(_req("GET", "accounts/contacts/", action="list contacts",
                                        params={"account": acct["id"]}))
        return {"status": "ok", "account_name": acct["company_name"],
                "contacts": [_pick(c, *CONTACT_FIELDS) for c in rows]}

    @tool(group="create", skill_safe=True, schema=_obj({
        "account_name": _ACCOUNT_PROP, "name": {"type": "string", "maxLength": 300},
        "role": {"type": "string", "maxLength": 200}, "email": {"type": "string"},
        "description": {"type": "string"},
    }, ["account_name", "name"]))
    @_run
    def create_customer_contact(account_name, name, role=None, email=None, description=None):
        """Add a customer contact (a person on the customer's side) to one of your accounts."""
        acct = _resolve_account(account_name)
        data = _req("POST", "accounts/contacts/", action="add the contact",
                    data=_clean(account=acct["id"], name=name, role=role, email=email, description=description))
        return {"status": "created", "account_name": acct["company_name"], "contact": _pick(data, *CONTACT_FIELDS)}

    @tool(group="update", skill_safe=True, schema=_obj({
        "contact_id": {"type": "integer"}, "name": {"type": "string", "maxLength": 300},
        "role": {"type": "string", "maxLength": 200}, "email": {"type": "string"},
        "description": {"type": "string"},
    }, ["contact_id"]))
    @_run
    def update_customer_contact(contact_id, name=None, role=None, email=None, description=None):
        """Update a customer contact's name, role, email or description."""
        patch = _clean(name=name, role=role, email=email, description=description)
        _require_changes(patch, "contact")
        data = _req("PATCH", f"accounts/contacts/{contact_id}/", action="update the contact", data=patch)
        return {"status": "updated", "contact": _pick(data, *CONTACT_FIELDS)}

    @tool(group="create", skill_safe=True, schema=_obj({
        "contact_id": {"type": "integer"}, "content": {"type": "string"},
    }, ["contact_id", "content"]))
    @_run
    def add_contact_note(contact_id, content):
        """Log a note on a customer contact (e.g. what they said on a call)."""
        data = _req("POST", f"accounts/contacts/{contact_id}/notes/", action="add the note", data={"content": content})
        return {"status": "created", "note": _pick(data, "id", "content", "created_at")}

    @tool(group="update", skill_safe=True, schema=_obj({
        "note_id": {"type": "integer"}, "content": {"type": "string"},
    }, ["note_id", "content"]))
    @_run
    def update_contact_note(note_id, content):
        """Edit a note on a customer contact."""
        data = _req("PATCH", f"accounts/contact-notes/{note_id}/", action="edit that note", data={"content": content})
        return {"status": "updated", "note": _pick(data, "id", "content")}

    # ── Projects, goals, project members ─────────────────────────────────────
    PROJECT_FIELDS = ("id", "name", "kind", "description", "url", "sf_project_id", "goal_ids", "action_ids", "meeting_ids")

    @tool(group="read", skill_safe=True, schema=_obj({
        "account_name": _ACCOUNT_PROP, "kind": {"type": "string", "enum": ["project", "goal"]},
    }, ["account_name"]))
    @_run
    def list_projects(account_name, kind=None):
        """List the projects and goals on one of your accounts."""
        acct = _resolve_account(account_name)
        rows = rest_bridge.results(_req("GET", "accounts/projects/", action="list projects",
                                        params={"account": acct["id"]}))
        if kind:
            rows = [r for r in rows if r.get("kind") == kind]
        return {"status": "ok", "account_name": acct["company_name"],
                "projects": [_pick(p, *PROJECT_FIELDS) for p in rows]}

    @tool(group="create", skill_safe=True, schema=_obj({
        "account_name": _ACCOUNT_PROP, "name": {"type": "string", "maxLength": 512},
        "kind": {"type": "string", "enum": ["project", "goal"], "default": "project"},
        "description": {"type": "string"}, "url": {"type": "string", "maxLength": 2048},
        "parent_project_id": {"type": "integer", "description": "For a goal: the project it belongs to."},
    }, ["account_name", "name"]))
    @_run
    def create_project(account_name, name, kind="project", description=None, url=None, parent_project_id=None):
        """Create a project or a goal on one of your accounts. A goal can be attached to a parent project."""
        acct = _resolve_account(account_name)
        data = _req("POST", "accounts/projects/", action="create the project",
                    data=_clean(account=acct["id"], name=name, kind=kind, description=description, url=url))
        result = {"status": "created", "account_name": acct["company_name"], "project": _pick(data, *PROJECT_FIELDS)}
        if parent_project_id is not None:
            parent = _req("GET", f"accounts/projects/{parent_project_id}/", action="look up the parent project")
            goal_ids = [*(parent.get("goal_ids") or []), data["id"]]
            _req("PATCH", f"accounts/projects/{parent_project_id}/", action="attach the goal",
                 data={"goal_ids": goal_ids})
            result["attached_to_project"] = parent_project_id
        return result

    @tool(group="update", skill_safe=True, schema=_obj({
        "project_id": {"type": "integer"}, "name": {"type": "string", "maxLength": 512},
        "description": {"type": "string"}, "url": {"type": "string", "maxLength": 2048},
        "sf_project_id": {"type": "string", "maxLength": 32},
        "add_action_item_ids": {"type": "array", "items": {"type": "string"}, "description": "airtable_ids of action items to link."},
        "add_meeting_ids": {"type": "array", "items": {"type": "string"}, "description": "airtable_ids of meetings to link."},
    }, ["project_id"]))
    @_run
    def update_project(project_id, name=None, description=None, url=None, sf_project_id=None,
                       add_action_item_ids=None, add_meeting_ids=None):
        """Update a project or goal, or link action items and meetings to it."""
        patch = _clean(name=name, description=description, url=url, sf_project_id=sf_project_id)
        if add_action_item_ids or add_meeting_ids:
            current = _req("GET", f"accounts/projects/{project_id}/", action="look up the project")
            if add_action_item_ids:
                patch["action_ids"] = list(dict.fromkeys([*(current.get("action_ids") or []), *add_action_item_ids]))
            if add_meeting_ids:
                patch["meeting_ids"] = list(dict.fromkeys([*(current.get("meeting_ids") or []), *add_meeting_ids]))
        _require_changes(patch, "project")
        data = _req("PATCH", f"accounts/projects/{project_id}/", action="update the project", data=patch)
        return {"status": "updated", "project": _pick(data, *PROJECT_FIELDS)}

    @tool(group="read", skill_safe=True, schema=_obj({"project_id": {"type": "integer"}}, ["project_id"]))
    @_run
    def list_project_members(project_id):
        """List who is on a project and their roles."""
        rows = rest_bridge.results(_req("GET", "accounts/project-members/", action="list project members",
                                        params={"project": project_id}))
        return {"status": "ok", "members": [_pick(m, "id", "team_member", "team_member_name", "role") for m in rows]}

    # Not skill-safe: when the project is linked to Salesforce this also writes the person into
    # Cloud Coach, a third-party system — a saved workflow should not do that on its own.
    @tool(group="create", skill_safe=False, schema=_obj({
        "project_id": {"type": "integer"}, "person_name": {"type": "string", "description": "The team member's name."},
        "role": {"type": "string", "maxLength": 150},
    }, ["project_id", "person_name"]))
    @_run
    def add_project_member(project_id, person_name, role=None):
        """Add a team member to a project (also added in Cloud Coach when the project is linked)."""
        from .fuzzy import resolve_name

        members = rest_bridge.results(_req("GET", "team/members/", action="look up team members",
                                           params={"page_size": 1000}))
        by_name = {m["full_name"]: m for m in members if m.get("full_name")}
        res = resolve_name(person_name, list(by_name))
        if not res.match:
            raise ToolPolicyError("not_found", f"No team member matches '{person_name}'.",
                                  extra={"candidates": res.candidates})
        data = _req("POST", "accounts/project-members/", action="add them to the project",
                    data=_clean(project=project_id, team_member=by_name[res.match]["id"], role=role))
        return {"status": "created", "member": res.match, "role": data.get("role"),
                "cloud_coach": data.get("cloud_coach")}

    # ── Action-item steps, dependencies, link attachments ────────────────────
    @tool(group="read", skill_safe=True, schema=_obj({"airtable_id": {"type": "string"}}, ["airtable_id"]))
    @_run
    def list_action_item_steps(airtable_id):
        """List the checklist steps on an action item."""
        pk = _action_item_pk(airtable_id)
        rows = rest_bridge.results(_req("GET", "airtable/steps/", action="list steps", params={"action_item": pk}))
        return {"status": "ok", "steps": [_pick(s, "id", "title", "status", "order") for s in rows]}

    @tool(group="create", skill_safe=True, schema=_obj({
        "airtable_id": {"type": "string"}, "title": {"type": "string", "maxLength": 512},
    }, ["airtable_id", "title"]))
    @_run
    def create_action_item_step(airtable_id, title):
        """Add a checklist step to an action item."""
        pk = _action_item_pk(airtable_id)
        existing = rest_bridge.results(_req("GET", "airtable/steps/", action="list steps", params={"action_item": pk}))
        data = _req("POST", "airtable/steps/", action="add the step",
                    data={"action_item": pk, "title": title, "order": len(existing)})
        return {"status": "created", "step": _pick(data, "id", "title", "status", "order")}

    @tool(group="update", skill_safe=True, schema=_obj({
        "step_id": {"type": "integer"}, "title": {"type": "string", "maxLength": 512},
        "status": {"type": "string", "enum": ["Open", "Done", "Blocked", "Archived"]},
    }, ["step_id"]))
    @_run
    def update_action_item_step(step_id, title=None, status=None):
        """Rename a checklist step or mark it Done / Blocked / Archived."""
        patch = _clean(title=title, status=status)
        _require_changes(patch, "step")
        data = _req("PATCH", f"airtable/steps/{step_id}/", action="update the step", data=patch)
        return {"status": "updated", "step": _pick(data, "id", "title", "status")}

    @tool(group="update", skill_safe=True, schema=_obj({
        "airtable_id": {"type": "string", "description": "The action item that is blocked."},
        "waiting_on_airtable_id": {"type": "string", "description": "The action item it is waiting on."},
    }, ["airtable_id", "waiting_on_airtable_id"]))
    @_run
    def add_action_item_dependency(airtable_id, waiting_on_airtable_id):
        """Mark one action item as waiting on another. Circular dependencies are refused."""
        pk = _action_item_pk(airtable_id)
        other = _action_item_pk(waiting_on_airtable_id)
        data = _req("POST", f"airtable/action-items/{pk}/add-dependency/", action="add the dependency",
                    data={"waiting_on_id": other})
        return {"status": "updated", "airtable_id": airtable_id, "waiting_on": data.get("waiting_on")}

    @tool(group="create", skill_safe=True, schema=_obj({
        "airtable_id": {"type": "string"}, "name": {"type": "string"},
        "url": {"type": "string"},
        "artifact_id": {"type": "integer", "description": "Optional: an existing account artifact this link comes from."},
    }, ["airtable_id", "name", "url"]))
    @_run
    def attach_link_to_action_item(airtable_id, name, url, artifact_id=None):
        """Attach a link (document, ticket, page) to an action item. File uploads stay in the app."""
        if not str(url).lower().startswith(("https://", "http://")):
            raise ToolPolicyError("invalid_arguments", "url must start with http:// or https://.")
        pk = _action_item_pk(airtable_id)
        data = _req("POST", f"airtable/action-items/{pk}/attachments/", action="attach the link",
                    data=_clean(artifact_type="link", name=name, url=url, source_artifact=artifact_id))
        return {"status": "created", "attachment": _pick(data, "id", "name", "url")}

    # ── Meeting notes (bullets on a calendar event) ──────────────────────────
    @tool(group="read", skill_safe=True, schema=_obj({"event_id": {"type": "integer"}}, ["event_id"]))
    @_run
    def list_meeting_notes(event_id):
        """List the bullet notes taken on one of your calendar events."""
        rows = rest_bridge.results(_req("GET", "scheduler/meeting-notes/", action="list meeting notes",
                                        params={"event": event_id}))
        return {"status": "ok", "notes": [_pick(n, "id", "text", "due_date", "author_display", "created_at") for n in rows]}

    @tool(group="create", skill_safe=True, schema=_obj({
        "event_id": {"type": "integer"}, "text": {"type": "string"},
        "due_date": {"type": "string", "description": "YYYY-MM-DD, for a follow-up bullet."},
    }, ["event_id", "text"]))
    @_run
    def add_meeting_note(event_id, text, due_date=None):
        """Add a bullet note to a calendar event (shows live to anyone viewing the meeting)."""
        existing = rest_bridge.results(_req("GET", "scheduler/meeting-notes/", action="list meeting notes",
                                            params={"event": event_id}))
        data = _req("POST", "scheduler/meeting-notes/", action="add the note",
                    data=_clean(event=event_id, text=text, html=f"<p>{_escape(text)}</p>",
                                due_date=due_date, position=len(existing)))
        return {"status": "created", "note": _pick(data, "id", "text", "due_date")}

    @tool(group="update", skill_safe=True, schema=_obj({
        "note_id": {"type": "integer"}, "text": {"type": "string"},
        "due_date": {"type": "string", "description": "YYYY-MM-DD"},
    }, ["note_id"]))
    @_run
    def update_meeting_note(note_id, text=None, due_date=None):
        """Edit a meeting bullet you wrote."""
        patch = _clean(text=text, due_date=due_date)
        if text is not None:
            patch["html"] = f"<p>{_escape(text)}</p>"
        _require_changes(patch, "meeting note")
        data = _req("PATCH", f"scheduler/meeting-notes/{note_id}/", action="edit that note", data=patch)
        return {"status": "updated", "note": _pick(data, "id", "text", "due_date")}

    # ── Comments ─────────────────────────────────────────────────────────────
    COMMENT_TYPES = ["account", "airtable_account", "action_item", "action_item_step", "meeting",
                     "calendar_event", "reminder", "task", "account_note", "artifact", "meeting_note"]

    @tool(group="read", skill_safe=True, schema=_obj({
        "resource_type": {"type": "string", "enum": COMMENT_TYPES},
        "resource_id": {"type": "integer", "description": "The record's numeric id."},
    }, ["resource_type", "resource_id"]))
    @_run
    def list_comments(resource_type, resource_id):
        """Read the comment thread on a record."""
        rows = rest_bridge.results(_req("GET", "comments/comments/", action="list comments",
                                        params={"resource_type": resource_type, "resource_id": resource_id}))
        def shape(c):
            return {**_pick(c, "id", "content", "author_display", "created_at"),
                    "replies": [_pick(r, "id", "content", "author_display", "created_at") for r in c.get("replies") or []]}
        return {"status": "ok", "comments": [shape(c) for c in rows]}

    @tool(group="create", skill_safe=True, schema=_obj({
        "resource_type": {"type": "string", "enum": COMMENT_TYPES},
        "resource_id": {"type": "integer"},
        "content": {"type": "string"},
        "reply_to_comment_id": {"type": "integer"},
    }, ["resource_type", "resource_id", "content"]))
    @_run
    def add_comment(resource_type, resource_id, content, reply_to_comment_id=None):
        """Comment on a record, or reply to an existing comment. Teammates who can see the record will see it."""
        data = _req("POST", "comments/comments/", action="post the comment",
                    data=_clean(resource_type=resource_type, resource_id=resource_id,
                                content=content, parent=reply_to_comment_id))
        return {"status": "created", "comment": _pick(data, "id", "content", "created_at")}

    @tool(group="update", skill_safe=True, schema=_obj({
        "comment_id": {"type": "integer"}, "content": {"type": "string"},
    }, ["comment_id", "content"]))
    @_run
    def update_comment(comment_id, content):
        """Edit a top-level comment you wrote."""
        data = _req("PATCH", f"comments/comments/{comment_id}/", action="edit that comment", data={"content": content})
        return {"status": "updated", "comment": _pick(data, "id", "content")}

    # ── Tasks ────────────────────────────────────────────────────────────────
    TASK_FIELDS = ("id", "title", "description", "status", "priority", "due_date", "assigned_to_username")
    TASK_STATUS = ["backlog", "todo", "in_progress", "review", "done", "archived"]
    TASK_PRIORITY = ["urgent", "high", "normal", "low"]

    @tool(group="read", skill_safe=True, schema=_obj({
        "view": {"type": "string", "enum": ["mine", "team"], "default": "mine"},
        "status": {"type": "string", "enum": TASK_STATUS}, "limit": _LIMIT_PROP,
    }))
    @_run
    def list_tasks(view="mine", status=None, limit=None):
        """List tasks assigned to you, or to your team."""
        rows = rest_bridge.results(_req("GET", "scheduler/tasks/", action="list tasks",
                                        params=_clean(view=view, status=status)))
        return {"status": "ok", "tasks": [_pick(t, *TASK_FIELDS) for t in rows[: _limit(limit)]]}

    @tool(group="create", skill_safe=True, schema=_obj({
        "title": {"type": "string", "maxLength": 500}, "description": {"type": "string"},
        "status": {"type": "string", "enum": TASK_STATUS}, "priority": {"type": "string", "enum": TASK_PRIORITY},
        "due_date": {"type": "string", "description": "YYYY-MM-DD"},
    }, ["title"]))
    @_run
    def create_task(title, description=None, status=None, priority=None, due_date=None):
        """Create a task assigned to you."""
        user = _user()
        data = _req("POST", "scheduler/tasks/", action="create the task", data=_clean(
            title=title, description=description, status=status, priority=priority,
            due_date=due_date, assigned_to=user.pk,
        ))
        return {"status": "created", "task": _pick(data, *TASK_FIELDS)}

    @tool(group="update", skill_safe=True, schema=_obj({
        "task_id": {"type": "integer"}, "title": {"type": "string", "maxLength": 500},
        "description": {"type": "string"}, "status": {"type": "string", "enum": TASK_STATUS},
        "priority": {"type": "string", "enum": TASK_PRIORITY},
        "due_date": {"type": "string", "description": "YYYY-MM-DD"},
    }, ["task_id"]))
    @_run
    def update_task(task_id, title=None, description=None, status=None, priority=None, due_date=None):
        """Update a task's title, status, priority, due date or description."""
        patch = _clean(title=title, description=description, status=status, priority=priority, due_date=due_date)
        _require_changes(patch, "task")
        data = _req("PATCH", f"scheduler/tasks/{task_id}/", action="update the task", data=patch)
        return {"status": "updated", "task": _pick(data, *TASK_FIELDS)}

    # ── Feedback ─────────────────────────────────────────────────────────────
    @tool(group="read", skill_safe=True, schema=_obj({
        "status": {"type": "string", "enum": ["open", "in_progress", "resolved", "wont_fix"]}, "limit": _LIMIT_PROP,
    }))
    @_run
    def list_feedback(status=None, limit=None):
        """List product feedback you have submitted."""
        rows = rest_bridge.results(_req("GET", "feedback/feedback/", action="list feedback"))
        if status:
            rows = [r for r in rows if r.get("status") == status]
        return {"status": "ok", "feedback": [_pick(f, "id", "description", "status", "page_url", "created_at")
                                             for f in rows[: _limit(limit)]]}

    @tool(group="create", skill_safe=True, schema=_obj({
        "description": {"type": "string"}, "page_url": {"type": "string", "maxLength": 2000},
    }, ["description"]))
    @_run
    def submit_feedback(description, page_url=None):
        """Submit product feedback or a bug report about the app."""
        data = _req("POST", "feedback/feedback/", action="submit the feedback",
                    data=_clean(description=description, page_url=page_url))
        return {"status": "created", "feedback": _pick(data, "id", "description", "status")}

    @tool(group="create", skill_safe=True, schema=_obj({
        "feedback_id": {"type": "integer"}, "content": {"type": "string"},
    }, ["feedback_id", "content"]))
    @_run
    def add_feedback_comment(feedback_id, content):
        """Add a follow-up comment to feedback you submitted."""
        data = _req("POST", "feedback/comments/", action="add the comment",
                    data={"feedback": feedback_id, "content": content})
        return {"status": "created", "comment": _pick(data, "id", "content")}

    # ── Working sessions & page notes ────────────────────────────────────────
    @tool(group="read", skill_safe=True, schema=_obj({}))
    @_run
    def list_working_sessions():
        """List your saved working sessions (canvas layouts)."""
        rows = rest_bridge.results(_req("GET", "layouts/working-sessions/", action="list working sessions"))
        return {"status": "ok", "sessions": [_pick(w, "id", "name", "updated_at") for w in rows]}

    @tool(group="create", skill_safe=True, schema=_obj({"name": {"type": "string", "maxLength": 255}}, ["name"]))
    @_run
    def create_working_session(name):
        """Create a new, empty working session (canvas) with a name."""
        data = _req("POST", "layouts/working-sessions/", action="create the working session", data={"name": name})
        return {"status": "created", "session": _pick(data, "id", "name")}

    @tool(group="update", skill_safe=True, schema=_obj({
        "session_id": {"type": "integer"}, "name": {"type": "string", "maxLength": 255},
    }, ["session_id", "name"]))
    @_run
    def rename_working_session(session_id, name):
        """Rename one of your working sessions."""
        data = _req("PATCH", f"layouts/working-sessions/{session_id}/", action="rename it", data={"name": name})
        return {"status": "updated", "session": _pick(data, "id", "name")}

    @tool(group="read", skill_safe=True, schema=_obj({}))
    @_run
    def get_page_notes():
        """Read your personal notepad."""
        rows = rest_bridge.results(_req("GET", "layouts/page-notes/", action="read your notepad"))
        return {"status": "ok", "notes": [_pick(n, "id", "content", "account_ref_label", "updated_at") for n in rows]}

    @tool(group="update", skill_safe=True, schema=_obj({
        "content": {"type": "string", "description": "The full notepad text (replaces what is there)."},
    }, ["content"]))
    @_run
    def set_page_notes(content):
        """Replace your personal notepad text. Creates the notepad if you don't have one."""
        rows = rest_bridge.results(_req("GET", "layouts/page-notes/", action="read your notepad"))
        if rows:
            data = _req("PATCH", f"layouts/page-notes/{rows[0]['id']}/", action="save your notepad",
                        data={"content": content})
            return {"status": "updated", "note": _pick(data, "id", "updated_at")}
        data = _req("POST", "layouts/page-notes/", action="save your notepad", data={"content": content})
        return {"status": "created", "note": _pick(data, "id", "updated_at")}

    # ── Team members (read only) ─────────────────────────────────────────────
    @tool(group="read", skill_safe=True, schema=_obj({
        "search": {"type": "string", "description": "Name, email, title or department."}, "limit": _LIMIT_PROP,
    }))
    @_run
    def list_team_members(search=None, limit=None):
        """Look up teammates by name, title or department. Read only; changes to the team are made by an admin."""
        rows = rest_bridge.results(_req("GET", "team/members/", action="list team members",
                                        params=_clean(search=search, page_size=MAX_LIMIT)))
        return {"status": "ok", "members": [_pick(m, "id", "full_name", "email", "title", "department", "status")
                                            for m in rows[: _limit(limit)]]}


def _escape(text: str) -> str:
    import html

    return html.escape(text or "")
