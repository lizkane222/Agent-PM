"""
MCP tools for the two Public-profile actions that are not a calendar write:
``email_person`` and ``leave_note_for``.

"Schedule a call with <person>" needs no tool of its own: ``find_person`` →
``get_colleague_availability`` → ``create_calendar_event`` → ``invite_to_meeting`` already do
it, and ``invite_to_meeting`` is the gated one (see CLAUDE.md, "Outbound communication
governance"). The Agent Capabilities card says so rather than inventing a second invite path.

* ``email_person`` sends **nothing**. It resolves the person and returns a Gmail compose link;
  the user opens it and presses Send themselves. Read-only, so ungated.
* ``leave_note_for`` posts a private note through the app's own endpoint
  (``POST /team/members/<id>/leave-note/``) via the REST bridge, so it has exactly the UI's
  rules: no empty note, no note to yourself, no note to someone without an account. It
  notifies another person, so it is ``group="communicate"`` and therefore in
  ``CONFIRM_REQUIRED`` and ``VOICE_CONFIRM_TOOLS``; a saved skill can never reach it.

Registered from ``AgentsConfig.ready()``, like ``people_tools``.
"""

from __future__ import annotations

import logging
from urllib.parse import quote

from asgiref.sync import sync_to_async

from . import rest_bridge
from .tool_policy import ToolPolicyError

logger = logging.getLogger(__name__)

NOTE_MAX_CHARS = 2000

EMAIL_PERSON_SCHEMA = {"input_schema": {
    "type": "object",
    "properties": {
        "person": {"type": "string", "maxLength": 200, "description": "The colleague's name, as spoken."},
    },
    "required": ["person"],
}}

LEAVE_NOTE_SCHEMA = {"input_schema": {
    "type": "object",
    "properties": {
        "person": {"type": "string", "maxLength": 200, "description": "The colleague's name, as spoken."},
        "note": {"type": "string", "maxLength": NOTE_MAX_CHARS, "description": "The note to leave. Only they will see it."},
    },
    "required": ["person", "note"],
}}


def compose_url(email: str) -> str:
    return f"https://mail.google.com/mail/?view=cm&fs=1&to={quote(email, safe='@')}"


def _email_person_sync(person: str) -> dict:
    from .people_tools import _resolve_person

    member, problem = _resolve_person(person)
    if problem:
        return problem
    return {
        "status": "found",
        "person": {"name": member.full_name, "email": member.email},
        "compose_url": compose_url(member.email),
        "sent": False,
        "message": "Nothing has been sent. Give the user this link; they write and send the email themselves.",
    }


def _leave_note_sync(user, person: str, note: str) -> dict:
    from .people_tools import _resolve_person

    member, problem = _resolve_person(person)
    if problem:
        return problem
    note = (note or "").strip()
    if not note:
        raise ToolPolicyError("invalid_arguments", "A note cannot be empty.")
    status, payload = rest_bridge.call(
        user, "POST", f"team/members/{member.pk}/leave-note/", data={"body": note}
    )
    rest_bridge.check(status, payload, action=f"leave a note for {member.full_name}")
    return {"status": "sent", "to": member.full_name, "message": f"{member.full_name} has been notified."}


def register(mcp_server) -> None:
    """Attach the tools to the shared registry. Idempotent per process."""
    if "email_person" in mcp_server.list_tools():
        return

    @mcp_server.tool(group="read", skill_safe=False, schema=EMAIL_PERSON_SCHEMA)
    async def email_person(person: str) -> dict:
        """Get a Gmail compose link addressed to a colleague. Sends nothing: the user opens the link and sends the email themselves. If the name is ambiguous or unknown it says so instead of guessing."""
        from agents.mcp_server import _current_user

        if not _current_user.get():
            return {"status": "error", "error": "No authenticated user available."}
        try:
            return await sync_to_async(_email_person_sync, thread_sensitive=True)(person)
        except Exception:  # noqa: BLE001
            logger.exception("email_person failed")
            return {"status": "error", "error": "Could not look that person up."}

    @mcp_server.tool(group="communicate", skill_safe=False, schema=LEAVE_NOTE_SCHEMA)
    async def leave_note_for(person: str, note: str) -> dict:
        """Leave a private note for a colleague. It is not shown on their public page; they are notified in the app. If the name is ambiguous or unknown nothing is sent."""
        from agents.mcp_server import _current_user

        user = _current_user.get()
        if not user:
            return {"status": "error", "error": "No authenticated user available."}

        def body():
            try:
                return _leave_note_sync(user, person, note)
            except ToolPolicyError as refusal:
                return refusal.as_result()

        return await sync_to_async(body, thread_sensitive=True)()
