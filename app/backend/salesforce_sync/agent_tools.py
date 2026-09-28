"""
MCP tools for Cloud Coach time logging.

Registered from `SalesforceSyncConfig.ready()` rather than by adding decorators to
`agents/mcp_server.py`, because that file is being edited by a concurrent session.
The registry, the agent system prompt and the skills catalog are all *derived* from
`mcp_server` (see `MCPServer.grouped_catalog` / `skill_safe_tools`), so registering
from here reaches every consumer with no edit to a file this session does not own.

Both tools are `skill_safe=False`: a skill author should not be able to wire up
timesheet writes, and it keeps `agents/tests/test_mcp_catalog.py`'s locked
`EXPECTED_SKILL_SAFE` set green.

ORM access uses `sync_to_async(..., thread_sensitive=True)` rather than the
`run_in_executor` the older tools use — per finding (b) in `TWILIO_WIRING.md`, that
keeps these testable inside `APITestCase` and does not leak a DB connection per call.
"""

from __future__ import annotations

import logging

from asgiref.sync import sync_to_async

logger = logging.getLogger(__name__)

_NOT_AUTHORIZED = {"status": "error", "message": "Not authorized for this record"}

PREVIEW_SCHEMA = {"input_schema": {
    "type": "object",
    "properties": {
        "week_start": {
            "type": "string",
            "description": (
                "ISO date (YYYY-MM-DD) anywhere in the target week. Any day resolves "
                "to that week's Monday. Omit for the current week."
            ),
        },
        "account_name": {
            "type": "string",
            "description": "Optional — restrict to one account's meetings.",
        },
    },
}}

LOG_SCHEMA = {"input_schema": {
    "type": "object",
    "properties": {
        "week_start": {
            "type": "string",
            "description": (
                "ISO date (YYYY-MM-DD) anywhere in the target week. Omit for the "
                "current week."
            ),
        },
        "account_name": {
            "type": "string",
            "description": "Optional — restrict to one account's meetings.",
        },
    },
}}

LOOKUP_SCHEMA = {"input_schema": {
    "type": "object",
    "properties": {
        "name": {
            "type": "string",
            "description": (
                "All or part of the project name, as the user said it. Matching is "
                "case-insensitive and partial, so 'autodesk segment' finds "
                "'Twilio & Autodesk Enterprise - Segment Sync'."
            ),
        },
    },
    "required": ["name"],
}}


def _summary(report: dict) -> str:
    """A one-line spoken-friendly summary of a plan report."""
    parts = [
        f"{report['total_hours']} hours across {report['entry_count']} "
        f"project {'entry' if report['entry_count'] == 1 else 'entries'}"
    ]
    if report["unlinked_count"]:
        parts.append(f"{report['unlinked_count']} not linked to an account")
    if report["account_without_project_count"]:
        parts.append(
            f"{report['account_without_project_count']} with no Cloud Coach project"
        )
    if report["not_attended_count"]:
        parts.append(f"{report['not_attended_count']} marked did not attend")
    if report["already_logged_count"]:
        parts.append(f"{report['already_logged_count']} already logged")
    return "; ".join(parts)


def _compact(report: dict) -> dict:
    """
    Trim a report to what the model needs.

    The full plan carries every skipped event's title and id; on a busy week that is
    hundreds of entries and none of it is speakable. The counts plus per-project totals
    are what an answer is built from — the same trimming
    `get_meeting_notes_from_email` does to its `skipped` list.
    """
    return {
        "status": "ok",
        "week_start": report["week_start"],
        "week_end": report["week_end"],
        "total_hours": report["total_hours"],
        "entry_count": report["entry_count"],
        "entries": [
            {
                "date": e["date"],
                "project_name": e["project_name"],
                "hours": e["hours"],
            }
            for e in report["entries"]
        ],
        "unlinked_count": report["unlinked_count"],
        "not_attended_count": report["not_attended_count"],
        "account_without_project_count": report["account_without_project_count"],
        "already_logged_count": report["already_logged_count"],
        "fields_skipped": report["fields_skipped"],
        "summary": _summary(report),
    }


def _plan_sync(user, week_start: str, account_name: str) -> dict:
    from .cloudcoach import parse_week_start
    from .log_week import plan_week

    plan = plan_week(
        user,
        parse_week_start(week_start),
        account_name=account_name or None,
    )
    return plan.as_dict()


def _lookup_sync(user, name: str) -> dict:
    from .client import get_client
    from .cloudcoach import find_projects_by_name

    sf = get_client(user)
    sf_user_id = ""
    try:
        sf_user_id = user.sf_config.sf_user_id or ""
    except Exception:
        sf_user_id = ""
    return find_projects_by_name(sf, name, sf_user_id=sf_user_id)


def _humanize_role(field_name: str) -> str:
    """`Solution_Architect_Primary__c` -> `Solution Architect Primary`, for speech."""
    return field_name.removesuffix("__c").replace("_", " ").strip()


def _lookup_summary(query: str, matches: list[dict]) -> str:
    """One spoken-friendly sentence. Names the user's role, which is the useful part."""
    first = matches[0]
    account = f" for {first['accountName']}" if first.get("accountName") else ""
    roles = [_humanize_role(r) for r in first.get("myRoles", [])]
    if roles:
        standing = f"you are the {' and '.join(roles)} on it"
    else:
        standing = "you are not assigned to it"
    extra = f" ({len(matches) - 1} other match{'es' if len(matches) > 2 else ''})" if len(matches) > 1 else ""
    return f"{first['projectName']}{account} — {standing}{extra}."


def _write_sync(user, week_start: str, account_name: str) -> dict:
    from .cloudcoach import parse_week_start
    from .log_week import plan_week, write_week

    plan = plan_week(
        user,
        parse_week_start(week_start),
        account_name=account_name or None,
    )
    return write_week(user, plan)


def register(mcp_server) -> None:
    """Attach both tools to the shared registry. Idempotent per process."""
    if "log_time_week" in mcp_server.list_tools():
        return

    @mcp_server.tool(group="read", skill_safe=False, schema=PREVIEW_SCHEMA)
    async def preview_time_log_week(week_start: str = "", account_name: str = "") -> dict:
        """Preview what would be logged to Salesforce Cloud Coach for a week, without writing anything. Call this when the user asks how many hours they have, what their timesheet looks like, or which meetings can't be logged. Returns per-project hours plus counts of meetings that are skipped because they have no linked account, no Cloud Coach project, or are marked did-not-attend."""
        from agents.mcp_server import _current_user

        user = _current_user.get()
        if not user:
            return _NOT_AUTHORIZED
        try:
            report = await sync_to_async(_plan_sync, thread_sensitive=True)(
                user, week_start, account_name
            )
        except ValueError:
            return {"status": "error", "message": "week_start must be an ISO date like 2026-08-31."}
        except Exception as exc:
            logger.exception("preview_time_log_week failed: %s", exc)
            return {"status": "error", "error": str(exc)}
        return _compact(report)

    @mcp_server.tool(group="create", skill_safe=False, schema=LOG_SCHEMA)
    async def log_time_week(week_start: str = "", account_name: str = "") -> dict:
        """Log a week of calendar activity to Salesforce Cloud Coach as time entries. Call this when the user asks to log, submit, or file their time or timesheet for a week. Meetings with no linked account, no Cloud Coach project, or marked did-not-attend are skipped and reported back. Use preview_time_log_week first if the user wants to see the hours before anything is written."""
        from agents.mcp_server import _current_user

        from .cloudcoach import CloudCoachError

        user = _current_user.get()
        if not user:
            return _NOT_AUTHORIZED

        try:
            result = await sync_to_async(_write_sync, thread_sensitive=True)(
                user, week_start, account_name
            )
        except ValueError:
            return {"status": "error", "message": "week_start must be an ISO date like 2026-08-31."}
        except PermissionError:
            return {
                "status": "error",
                "message": "Salesforce is not connected. Connect it from the Settings page first.",
            }
        except CloudCoachError as exc:
            return {"status": "error", "message": str(exc)}
        except Exception as exc:
            logger.exception("log_time_week failed: %s", exc)
            return {"status": "error", "error": str(exc)}

        return {
            **_compact(result),
            "status": "logged",
            "written": result.get("logged", 0),
        }

    @mcp_server.tool(group="read", skill_safe=False, schema=LOOKUP_SCHEMA)
    async def find_cloud_coach_project(name: str) -> dict:
        """Find a Salesforce Cloud Coach project by name and report whether the user is on it. Call this when the user asks whether a project exists, what its account or dates are, whether they are assigned to it, or what their role on it is — e.g. 'is there a Cloud Coach project called Autodesk Segment Sync', 'am I on the Acme rollout', 'what project should I log this to'. Matching is partial and case-insensitive."""
        from agents.mcp_server import _current_user

        from .cloudcoach import CloudCoachError

        user = _current_user.get()
        if not user:
            return _NOT_AUTHORIZED
        if not (name or "").strip():
            return {"status": "error", "message": "A project name is required."}

        try:
            result = await sync_to_async(_lookup_sync, thread_sensitive=True)(user, name)
        except PermissionError:
            return {
                "status": "error",
                "message": "Salesforce is not connected. Connect it from the Settings page first.",
            }
        except CloudCoachError as exc:
            return {"status": "error", "message": str(exc)}
        except Exception as exc:
            logger.exception("find_cloud_coach_project failed: %s", exc)
            return {"status": "error", "error": str(exc)}

        matches = result["projects"]
        if not matches:
            return {
                "status": "not_found",
                "query": name,
                "matches": [],
                "summary": f"No Cloud Coach project matching '{name}'.",
            }
        return {
            "status": "ok",
            "query": name,
            "match_count": len(matches),
            "matches": matches,
            "summary": _lookup_summary(name, matches),
        }

    logger.debug("Registered Cloud Coach MCP tools.")
