"""
Database writes for a voice call.

Every function is bound at module level and wrapped in @database_sync_to_async, so
test_consumers.py can patch them the same way it already patches
`realtime.consumers._create_voice_conversation`.

This is where three previously-dead code paths come alive:
  * VoiceSession.user was never set by anything, so VoiceSessionViewSet.get_queryset
    (filtered on user) always returned nothing and the `if user:` Sync publish in
    VoiceStatusCallbackView never fired.
  * ToolCall has existed since the agents app was created with no writer anywhere in
    the codebase. Voice is the first.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

from channels.db import database_sync_to_async
from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)

VOICE_SESSION_TITLE_PREFIX = "Voice: "


@dataclass
class ToolCallRecord:
    """
    One tool invocation, buffered by the consumer until the turn's assistant message
    exists so it can be linked to it.
    """

    tool_name: str
    arguments: dict
    result: Any = None
    status: str = "success"
    error_message: str = ""
    duration_ms: int = 0
    # Set when the call was gated by a spoken confirmation rather than dispatched.
    gated: bool = False
    extra: dict = field(default_factory=dict)


@database_sync_to_async
def attach_user_to_voice_session(call_sid: str, user) -> None:
    """
    Set VoiceSession.user for this call, creating the row if the relay won the race.

    `defaults` deliberately carries *only* `user`. VoiceStatusCallbackView writes
    from_number/to_number/status/duration from the other side, and the two race in
    both directions — the status callback can arrive before or after the relay's
    setup frame. update_or_create from both sides with disjoint defaults is the
    correct convergent pattern; passing the other fields here would blank whatever
    the callback had already written.
    """
    from realtime.models import VoiceSession  # noqa: PLC0415

    if not call_sid:
        return
    VoiceSession.objects.update_or_create(call_sid=call_sid, defaults={"user": user})


@database_sync_to_async
def open_agent_session(user, call_sid: str) -> int | None:
    """
    Create the AgentSession for this call and return its pk.

    The "Voice: " title prefix is what makes these distinguishable from chat sessions
    in the existing Sessions UI without any frontend change — voice calls appearing
    in chat history is a deliberate, called-out visible change.
    """
    from agents.models import AgentSession  # noqa: PLC0415

    if user is None:
        return None
    session = AgentSession.objects.create(
        user=user, title=f"{VOICE_SESSION_TITLE_PREFIX}{call_sid[-8:]}"
    )
    return session.pk


@database_sync_to_async
def record_message(
    session_id: int | None,
    role: str,
    content: str,
    input_tokens: int = 0,
    output_tokens: int = 0,
) -> int | None:
    """Append an AgentMessage and return its pk (None when there is no session)."""
    from agents.models import AgentMessage  # noqa: PLC0415

    if not session_id:
        return None
    message = AgentMessage.objects.create(
        session_id=session_id,
        role=role,
        content=content,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )
    return message.pk


@database_sync_to_async
def record_tool_calls(message_id: int | None, records: list[ToolCallRecord]) -> int:
    """
    Write buffered ToolCall rows, linked to `message_id`.

    `message_id` may be None: tool calls happen *before* the turn's assistant message
    exists, so if the turn raises partway there is no message to attach them to.
    That is exactly what ToolCall.message's null=True is for — losing the record of a
    tool that already ran would be worse than an unlinked row.
    """
    from agents.models import ToolCall  # noqa: PLC0415

    if not records:
        return 0
    rows = [
        ToolCall(
            message_id=message_id,
            tool_name=record.tool_name,
            arguments=record.arguments or {},
            # JSONField, so the value must be JSON-serialisable; tool results can
            # contain datetimes and model instances.
            result=json.loads(json.dumps(record.result, default=str)),
            status=record.status,
            error_message=record.error_message or "",
            duration_ms=max(0, int(record.duration_ms)),
        )
        for record in records
    ]
    ToolCall.objects.bulk_create(rows)
    return len(rows)


@database_sync_to_async
def append_transcript(call_sid: str, role: str, content: str) -> None:
    """Append one turn to VoiceSession.transcript, preserving order."""
    from realtime.models import VoiceSession  # noqa: PLC0415

    if not call_sid or not content:
        return
    session = VoiceSession.objects.filter(call_sid=call_sid).first()
    if session is None:
        return
    line = f"{role}: {content}"
    session.transcript = f"{session.transcript}\n{line}" if session.transcript else line
    session.save(update_fields=["transcript", "updated_at"])


@database_sync_to_async
def close_agent_session(session_id: int | None) -> None:
    """Mark the session completed on hangup."""
    from agents.models import AgentSession  # noqa: PLC0415

    if not session_id:
        return
    AgentSession.objects.filter(pk=session_id).update(
        status="completed", ended_at=timezone.now()
    )


@database_sync_to_async
def load_skill_inventory(user) -> str:
    """
    "name — description" lines for the skills this user may run.

    Injected into the voice system prompt at setup so skills fire with *zero*
    discovery round-trips. list_skills + load_skill would be two extra requests
    before the real work starts — 1–2 seconds of dead air on a phone call.
    AgentSkill.description is documented as the auto-trigger signal, so the model
    only needs load_skill to fetch the instructions.

    Bounded by VOICE_SKILL_INVENTORY_LIMIT / VOICE_SKILL_DESCRIPTION_CHARS: the
    inventory sits in every request's system prompt for the whole call.
    """
    from agents.mcp_server import _list_skills_sync  # noqa: PLC0415

    if user is None:
        return ""
    limit = getattr(settings, "VOICE_SKILL_INVENTORY_LIMIT", 25)
    chars = getattr(settings, "VOICE_SKILL_DESCRIPTION_CHARS", 200)
    lines = []
    for skill in _list_skills_sync(user, "")[:limit]:
        description = " ".join((skill["description"] or "").split())[:chars]
        lines.append(f"- {skill['name']} — {description}")
    return "\n".join(lines)
