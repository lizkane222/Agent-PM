"""
Snoozing a reminder: pick a new time, and it fires again then.

The client sends either an explicit instant (`until`) or the one choice only the server can
resolve (`preset: "next_account_meeting"`). Everything is validated here, so a bad or past time
can never silently kill a reminder.

"Before the next account meeting" means the next real meeting on the reminder's account, found
in the owner's own calendar: not another reminder, not a work-tracking block, not cancelled,
all-day, or one the user marked as not attending.
"""

from __future__ import annotations

from datetime import timedelta, timezone as dt_timezone

from django.utils import timezone
from django.utils.dateparse import parse_datetime

PRESET_NEXT_ACCOUNT_MEETING = "next_account_meeting"

#: How long before the meeting the reminder fires.
LEAD_BEFORE_MEETING = timedelta(minutes=15)
#: How far ahead to look for "the next meeting".
MEETING_LOOKAHEAD = timedelta(days=60)
#: The soonest a snoozed reminder can fire, so a meeting starting in five minutes still reminds.
MIN_SNOOZE = timedelta(minutes=1)

NON_MEETING_CALENDARS = ("reminders", "work_tracking")


def reminder_account(reminder):
    """The Account a reminder belongs to: linked directly, or via a meeting or action item it is about."""
    from . import reminder_links

    return reminder_links.linked_account(reminder)


def next_account_meeting(reminder, now=None):
    """The reminder owner's next meeting on the reminder's account, or None."""
    from .models import CalendarEvent

    account = reminder_account(reminder)
    if account is None:
        return None
    now = now or timezone.now()
    return (
        CalendarEvent.objects
        .filter(owner=reminder.created_by, account=account,
                start_datetime__gt=now, start_datetime__lte=now + MEETING_LOOKAHEAD,
                all_day=False)
        .exclude(calendar_id__in=NON_MEETING_CALENDARS)
        .exclude(status="cancelled")
        .exclude(attended=False)
        .order_by("start_datetime")
        .first()
    )


def resolve_until(reminder, data, now=None):
    """`(until, error)` for a snooze request body. Exactly one of the two is None."""
    now = now or timezone.now()
    preset = data.get("preset")

    if preset == PRESET_NEXT_ACCOUNT_MEETING:
        if reminder_account(reminder) is None:
            return None, "Link this reminder to an account to snooze it until before that account's next meeting."
        meeting = next_account_meeting(reminder, now)
        if meeting is None:
            return None, "There is no upcoming meeting on this account to snooze it before."
        return max(meeting.start_datetime - LEAD_BEFORE_MEETING, now + MIN_SNOOZE), None

    if preset is not None:
        return None, "Unknown snooze option."

    raw = data.get("until")
    if raw in (None, ""):
        return None, "Choose when to be reminded again."
    until = parse_datetime(str(raw))
    if until is None:
        return None, "That isn't a valid time."
    if timezone.is_naive(until):
        until = timezone.make_aware(until, dt_timezone.utc)
    if until <= now:
        return None, "Pick a time in the future."
    return until, None
