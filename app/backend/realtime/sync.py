"""
Twilio Sync publishing helpers.

Call publish_activity_event() from anywhere in the backend to:
  1. Save an AgentActivityEvent to the database.
  2. Append it to the Twilio Sync list "agent-feed-<user_id>" so the
     frontend receives it in real time.
"""

from __future__ import annotations

import logging
import threading
from typing import Any

from django.conf import settings

logger = logging.getLogger(__name__)

_sync_client = None
_sync_client_lock = threading.Lock()


def _get_sync_client():
    global _sync_client
    if _sync_client is not None:
        return _sync_client
    with _sync_client_lock:
        # Double-checked locking: re-test inside the lock.
        if _sync_client is not None:
            return _sync_client
        if not (settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN):
            return None
        from twilio.rest import Client
        _sync_client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
    return _sync_client


def publish_activity_event(
    user,
    event_type: str,
    title: str,
    detail: str = "",
    metadata: dict[str, Any] | None = None,
) -> None:
    """
    Persist an AgentActivityEvent and push it to the user's Sync list.

    Safe to call from sync or async context — never raises, only logs on failure.
    Each user gets their own Sync list: "agent-feed-<user_pk>".
    """
    from .models import AgentActivityEvent

    metadata = metadata or {}

    # 1. Persist to DB.
    event = AgentActivityEvent.objects.create(
        user=user,
        event_type=event_type,
        title=title,
        detail=detail,
        metadata=metadata,
    )

    # 2. Push to Twilio Sync.
    client = _get_sync_client()
    if client is None:
        logger.debug("Twilio not configured — skipping Sync publish for event %s", event.pk)
        return

    sync_list_name = f"agent-feed-{user.pk}"
    try:
        item = client.sync.v1 \
            .services(settings.TWILIO_SYNC_SERVICE_SID) \
            .sync_lists(sync_list_name) \
            .sync_list_items \
            .create(data={
                "id": event.pk,
                "event_type": event_type,
                "title": title,
                "detail": detail,
                "metadata": metadata,
                "created_at": event.created_at.isoformat(),
            })
        AgentActivityEvent.objects.filter(pk=event.pk).update(sync_document_id=item.sid)
        logger.debug("Published activity event %s to Sync list item %s", event.pk, item.sid)
    except Exception as exc:
        logger.warning("Failed to publish event %s to Twilio Sync: %s", event.pk, exc)
