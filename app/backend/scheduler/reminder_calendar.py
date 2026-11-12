"""
A reminder's presence on the calendar.

A reminder can be on the calendar **any number of times**, each a 15-minute block starting at
the moment the user wants to be reminded. Each block is an *occurrence*: a `CalendarEvent` on
the `reminders` calendar whose `reminder` FK points back at it. Two things make a moment:

* the reminder's `due_at` — its first notification, and the occurrence created with it;
* any further occurrence the user adds by dragging the reminder onto the grid.

Every occurrence notifies at its own start (the one at `due_at` through the reminder's own
`status`, the rest through `CalendarEvent.reminder_notified_at`; see `scheduler/tasks.py`).

The reminder form, the Reminders page and the agent's `create_reminder` all create the first
occurrence server-side, so they agree. Changing `due_at` moves *that* occurrence and leaves the
others where the user put them.

Occurrences are never mirrored to Google Calendar: they would come back from Google as ordinary
events, and a reminder is not a meeting. (`integrations.views` skips them on push and on pull.)
"""

from __future__ import annotations

import logging
from datetime import timedelta

logger = logging.getLogger(__name__)

REMINDERS_CALENDAR_ID = "reminders"

#: Every occurrence is this long on the grid. The user does not set a length.
OCCURRENCE_MINUTES = 15

# A reminder in one of these states is still something to act on, so it stays on the grid.
# A dismissed one is done with and is taken off.
VISIBLE_STATUSES = ("pending", "sent", "snoozed")


def occurrence_end(start):
    return start + timedelta(minutes=OCCURRENCE_MINUTES)


def _minute(dt):
    return dt.replace(second=0, microsecond=0)


def _linked_account(reminder):
    from . import reminder_links

    return reminder_links.linked_account(reminder)


def occurrences(reminder):
    """The reminder's calendar occurrences, earliest first."""
    from .models import CalendarEvent

    return CalendarEvent.objects.filter(
        reminder=reminder, calendar_id=REMINDERS_CALENDAR_ID, owner=reminder.created_by
    ).order_by("start_datetime", "pk")


def occurrence_at(reminder, start):
    """The occurrence starting in the same minute as `start`, or None."""
    return next((o for o in occurrences(reminder) if _minute(o.start_datetime) == _minute(start)), None)


def sync_reminder_block(reminder, *, created: bool = False, previous_due_at=None, previous_status=None) -> None:
    """Make the reminder's calendar occurrences match the reminder. Never raises.

    * dismissed → every occurrence is removed;
    * title / account → copied onto every occurrence;
    * `created` → the first occurrence is added at `due_at`;
    * a dismissed reminder re-armed (`previous_status` was not visible) → its first occurrence
      comes back at `due_at`;
    * `previous_due_at` (the due time before this save) → the occurrence that sat there moves
      to the new `due_at`, and the user's other occurrences stay where they are.
    """
    try:
        _sync(reminder, created, previous_due_at, previous_status)
    except Exception:
        logger.exception("Could not sync the calendar for reminder %s", getattr(reminder, "pk", "?"))


def _sync(reminder, created, previous_due_at, previous_status) -> None:
    owned = occurrences(reminder)

    if reminder.status not in VISIBLE_STATUSES:
        owned.delete()
        return

    # Title and account follow the reminder on every occurrence.
    account = _linked_account(reminder)
    for occ in owned:
        if occ.title != reminder.title or occ.account_id != getattr(account, "pk", None):
            occ.title = reminder.title
            occ.account = account
            occ.save(update_fields=["title", "account", "updated_at"])

    came_back = previous_status is not None and previous_status not in VISIBLE_STATUSES
    if created or came_back:
        add_occurrence(reminder, reminder.due_at)
        return

    if previous_due_at is not None and _minute(previous_due_at) != _minute(reminder.due_at):
        moved = occurrence_at(reminder, previous_due_at)
        if moved is not None and occurrence_at(reminder, reminder.due_at) is None:
            _place(moved, reminder.due_at)
        elif occurrence_at(reminder, reminder.due_at) is None:
            add_occurrence(reminder, reminder.due_at)


def _place(occ, start) -> None:
    """Put an occurrence at `start` for 15 minutes and re-arm its notification."""
    occ.start_datetime = start
    occ.end_datetime = occurrence_end(start)
    occ.reminder_notified_at = None
    occ.save(update_fields=["start_datetime", "end_datetime", "reminder_notified_at", "updated_at"])


def add_occurrence(reminder, start):
    """Add the reminder to the calendar at `start`. Returns `(occurrence, created)`.

    The same minute twice is one occurrence, not two stacked blocks: asking again returns
    the existing one.
    """
    from .models import CalendarEvent

    existing = occurrence_at(reminder, start)
    if existing is not None:
        return existing, False
    occ = CalendarEvent.objects.create(
        owner=reminder.created_by,
        calendar_id=REMINDERS_CALENDAR_ID,
        reminder=reminder,
        title=reminder.title,
        account=_linked_account(reminder),
        start_datetime=start,
        end_datetime=occurrence_end(start),
        all_day=False,
        status="confirmed",
    )
    return occ, True


def move_occurrence(reminder, occ, start):
    """Move one occurrence to `start`. If it was the one at `due_at`, the due time moves too.

    Returns the occurrence, or None when `start` is already taken by another occurrence.
    """
    other = occurrence_at(reminder, start)
    if other is not None and other.pk != occ.pk:
        return None
    was_due = _minute(occ.start_datetime) == _minute(reminder.due_at)
    _place(occ, start)
    if was_due:
        reminder.due_at = start
        reminder.save(update_fields=["due_at", "updated_at"])
        rearm_if_future(reminder)
    return occ


def rearm_if_future(reminder) -> None:
    """A reminder that already fired (or was left snoozed) and is moved to a future time fires again."""
    from django.utils import timezone

    if reminder.status in ("sent", "snoozed") and reminder.due_at > timezone.now():
        reminder.status = "pending"
        reminder.save(update_fields=["status", "updated_at"])
