"""
Twilio Conversations API helpers for ConversationRelay voice session integration.

Each voice call gets a Conversations thread that records the full transcript:
  customer messages  → author="customer"
  LLM responses      → author="agent-pm"

All functions are synchronous (blocking Twilio REST calls). Callers inside
async Django Channels consumers must wrap them with sync_to_async.
"""

import json
import logging

from django.conf import settings

logger = logging.getLogger(__name__)


def _client():
    from twilio.rest import Client  # noqa: PLC0415 — lazy import avoids import-time side effects
    return Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)


def _service_sid() -> str:
    return getattr(settings, "TWILIO_CONVERSATIONS_SERVICE_SID", "")


def create_voice_conversation(call_sid: str) -> str:
    """
    Create a Conversations thread for a voice call.

    Returns the new conversation SID (e.g. "CHxxxxxx…").
    Raises on API error so the caller can decide whether to proceed without it.
    """
    client = _client()
    sid = _service_sid()
    attrs = json.dumps({"source": "voice", "call_sid": call_sid})
    friendly = f"Voice Call {call_sid}"

    if sid:
        conv = client.conversations.v1.services(sid).conversations.create(
            friendly_name=friendly,
            attributes=attrs,
        )
    else:
        conv = client.conversations.v1.conversations.create(
            friendly_name=friendly,
            attributes=attrs,
        )

    logger.info("conversations: created %s for call %s", conv.sid, call_sid)
    return conv.sid


def add_conversation_message(conversation_sid: str, author: str, body: str) -> None:
    """Add a message to a Conversations thread. Logs and swallows errors."""
    if not body:
        return
    client = _client()
    sid = _service_sid()
    try:
        if sid:
            client.conversations.v1.services(sid).conversations(conversation_sid).messages.create(
                author=author, body=body
            )
        else:
            client.conversations.v1.conversations(conversation_sid).messages.create(
                author=author, body=body
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("conversations: failed to add message to %s: %s", conversation_sid, exc)


def close_voice_conversation(conversation_sid: str) -> None:
    """Close a Conversations thread when the call ends. Logs and swallows errors."""
    client = _client()
    sid = _service_sid()
    try:
        if sid:
            client.conversations.v1.services(sid).conversations(conversation_sid).update(state="closed")
        else:
            client.conversations.v1.conversations(conversation_sid).update(state="closed")
        logger.info("conversations: closed %s", conversation_sid)
    except Exception as exc:  # noqa: BLE001
        logger.warning("conversations: failed to close %s: %s", conversation_sid, exc)
