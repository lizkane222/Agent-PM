"""Activity-log entries for changes made to calendar events.

The Activity Log's Events tab lists *what happened to events* — created, edited, deleted,
marked attended, time logged, notes added — not the events themselves. Every entry is an
`AgentActivityEvent` of type ``calendar_event.<action>`` carrying the event id, title and
start in its metadata, so the tab needs no join back to the calendar table (which matters
for "deleted": the row is gone by the time anyone reads the log).

Recording never raises: a history write must not undo or block the change it describes.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# Fields whose change counts as an edit, with the label shown in the log.
TRACKED_FIELDS = {
    "title": "title",
    "description": "description",
    "location": "location",
    "start_datetime": "time",
    "end_datetime": "time",
    "all_day": "all-day",
    "event_category": "type",
    "status": "status",
    "account_id": "account",
}

# Every ``event_type`` the Events tab lists. ``meeting_notes`` is written by the Gong/Zoom
# import (integrations.meeting_notes.notify_notes_added).
EVENT_UPDATE_TYPES = (
    "calendar_event.created",
    "calendar_event.updated",
    "calendar_event.deleted",
    "calendar_event.attendance",
    "calendar_event.time_logged",
    "meeting_notes",
)


def snapshot(event) -> dict:
    """The tracked fields of `event` as comparable plain values."""
    return {name: str(getattr(event, name, "")) for name in TRACKED_FIELDS}


def changed_labels(before: dict, event) -> list[str]:
    """Human labels for the tracked fields that differ from `before`, in stable order."""
    after = snapshot(event)
    labels: list[str] = []
    for name, label in TRACKED_FIELDS.items():
        if before.get(name) != after.get(name) and label not in labels:
            labels.append(label)
    return labels


def record_event_change(user, action: str, event=None, *, title: str = "", message: str = "",
                        detail: str = "", extra: dict | None = None) -> None:
    """Persist one entry for `action` (created / updated / deleted / attendance / time_logged)."""
    try:
        from realtime.sync import publish_activity_event

        name = title or (getattr(event, "title", "") or "Untitled event")
        start = getattr(event, "start_datetime", None)
        metadata = {
            "action": action,
            "event_title": name,
            "event_start": start.isoformat() if start else None,
            "resource": {"type": "calendar_event", "id": getattr(event, "pk", None)},
            "links": [{"label": "View calendar", "path": "/calendar"}],
            **(extra or {}),
        }
        publish_activity_event(
            user, f"calendar_event.{action}", message or f'Event {action}: "{name}"',
            detail=detail, metadata=metadata,
        )
    except Exception:
        logger.exception("Could not record calendar event %s for user %s", action, getattr(user, "pk", "?"))
