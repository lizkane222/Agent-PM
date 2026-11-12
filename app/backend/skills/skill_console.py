"""
The skill-run Console: what a saved skill did, tool by tool, including what it created.

Everything here is best effort and **never raises** into the caller — a logging failure must not
break a tool call or a chat turn. Arguments and results are summarised, not stored: note text,
emails and phone numbers are reduced to a length, and long strings are cut.
"""

from __future__ import annotations

import logging
import uuid
from datetime import timedelta
from typing import Any

from asgiref.sync import sync_to_async
from django.db.models import F
from django.utils import timezone

from .models import SkillRun, SkillRunEvent

logger = logging.getLogger(__name__)

MAX_EVENTS_PER_RUN = 500
RUN_CLAIM_WINDOW = timedelta(hours=6)
MAX_STR = 80

# Argument names whose value is free text a person wrote, or contact data: never stored, only sized.
_PRIVATE_ARG_HINTS = (
    "body", "content", "text", "note", "message", "description", "details", "email", "phone",
    "number", "to", "attendee", "address", "summary", "transcript",
)
_LABEL_KEYS = ("title", "task", "name", "subject", "label", "company_name", "full_name", "content", "note")
_URL_KEYS = ("url", "link", "href")


def summarize_args(args: Any) -> dict:
    """A small, safe picture of a tool's arguments (keys kept, values reduced)."""
    if not isinstance(args, dict):
        return {}
    out: dict = {}
    for key, val in list(args.items())[:20]:
        k = str(key)
        if isinstance(val, str):
            if any(h in k.lower() for h in _PRIVATE_ARG_HINTS) and len(val) > 12:
                out[k] = f"<{len(val)} characters>"
            else:
                out[k] = val if len(val) <= MAX_STR else val[:MAX_STR] + "…"
        elif isinstance(val, (int, float, bool)) or val is None:
            out[k] = val
        elif isinstance(val, (list, tuple)):
            out[k] = f"[{len(val)} item{'s' if len(val) != 1 else ''}]"
        elif isinstance(val, dict):
            out[k] = "{…}"
        else:
            out[k] = str(type(val).__name__)
    return out


def _label_of(rec: dict) -> str:
    for key in _LABEL_KEYS:
        v = rec.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()[:80]
    return ""


def extract_record(tool_name: str, result: Any) -> dict | None:
    """
    The record a successful create/update touched, or None.

    Tools answer `{"status": "created"|"updated", "<kind>": {id, …}}` (REST-bridge tools) or put
    the id at the top level (the older tools). One helper over both shapes keeps the tools free of
    Console code.
    """
    if not isinstance(result, dict) or result.get("status") not in ("created", "updated"):
        return None
    nested = next((k for k, v in result.items() if isinstance(v, dict) and (v.get("id") or v.get("airtable_id"))), None)
    rec = result[nested] if nested else result
    rid = rec.get("airtable_id") or rec.get("id")
    kind = nested or tool_name.split("_", 1)[-1]
    if rid in (None, "") and not _label_of(rec):
        return None
    url = next((rec[k] for k in _URL_KEYS if isinstance(rec.get(k), str)), "")
    return {"type": kind[:40], "id": str(rid or "")[:64], "label": _label_of(rec), "url": url[:500],
            "created": result.get("status") == "created"}


def _event_from(tool_name: str, arguments: Any, result: Any, duration_ms: int | None) -> dict | None:
    """The fields for one Console line, or None when this call shouldn't appear."""
    status, code, summary = "ok", "", ""
    if isinstance(result, dict) and result.get("status") == "error":
        code = str(result.get("error_code") or "error")[:60]
        if code == "confirmation_required":
            return None           # the user's approval prompt, not something the skill did
        status = "error"
        summary = str(result.get("message") or "")[:300]
    record = extract_record(tool_name, result)
    if record:
        status = "created" if record["created"] else "updated"
    return {
        "tool_name": tool_name[:100], "status": status, "error_code": code, "summary": summary,
        "args": summarize_args(arguments), "duration_ms": duration_ms, "record": record,
    }


# ── Run lifecycle ──────────────────────────────────────────────────────────────────────


def create_run(user, skill, *, surface: str, page: str = "", params: dict | None = None) -> SkillRun:
    run = SkillRun.objects.create(
        user=user, skill=skill, skill_name=skill.name, surface=surface, page=(page or "")[:30],
        params=summarize_args(params or {}),
    )
    SkillRunEvent.objects.create(run=run, kind="launched", status="ok", summary=f"{skill.name} launched in {surface}")
    return run


def claim_run(user, run_id) -> SkillRun | None:
    """A run this user may attach a chat turn to: theirs, unfinished, recent. Anything else → None."""
    if not run_id:
        return None
    try:
        run_id = uuid.UUID(str(run_id))          # malformed ids are "no run", never an error
    except ValueError:
        return None
    run = SkillRun.objects.filter(pk=run_id, user=user, status__in=("launched", "running")).first()
    if run is None or run.started_at < timezone.now() - RUN_CLAIM_WINDOW:
        return None
    return run


def finish_run(run_id, *, failed: bool = False, input_tokens: int = 0, output_tokens: int = 0) -> None:
    """Close a run and write its closing line. Safe to call twice; never raises."""
    try:
        run = SkillRun.objects.filter(pk=run_id, status__in=("launched", "running")).first()
        if run is None:
            return
        run.status = "failed" if failed else "completed"
        run.finished_at = timezone.now()
        run.input_tokens, run.output_tokens = max(0, input_tokens), max(0, output_tokens)
        run.save(update_fields=["status", "finished_at", "input_tokens", "output_tokens"])
        SkillRunEvent.objects.create(
            run=run, kind="finished", status="error" if failed else "ok",
            summary=(f"{run.tool_count} tool call{'s' if run.tool_count != 1 else ''}, "
                     f"{run.records_created} created, {run.records_updated} updated"),
        )
    except Exception:
        logger.exception("Could not finish skill run %s", run_id)


def _record_sync(run_id, tool_name, arguments, result, duration_ms) -> None:
    fields = _event_from(tool_name, arguments, result, duration_ms)
    if fields is None:
        return
    run = SkillRun.objects.filter(pk=run_id).only("id", "tool_count").first()
    if run is None or run.tool_count >= MAX_EVENTS_PER_RUN:
        return
    rec = fields.pop("record")
    SkillRunEvent.objects.create(
        run=run, kind="tool",
        record_type=rec["type"] if rec else "", record_id=rec["id"] if rec else "",
        record_label=rec["label"] if rec else "", record_url=rec["url"] if rec else "", **fields,
    )
    updates = {"tool_count": F("tool_count") + 1, "status": "running"}
    if rec:
        updates["records_created" if rec["created"] else "records_updated"] = (
            F("records_created" if rec["created"] else "records_updated") + 1)
    SkillRun.objects.filter(pk=run_id).update(**updates)


async def record_tool_event(run_id, tool_name: str, arguments: Any, result: Any, duration_ms: int | None = None) -> None:
    """Called by MCPServer.dispatch after every tool in a skill run. Never raises."""
    try:
        await sync_to_async(_record_sync, thread_sensitive=True)(run_id, tool_name, arguments, result, duration_ms)
    except Exception:
        logger.exception("Could not record skill-run event for %s", tool_name)
