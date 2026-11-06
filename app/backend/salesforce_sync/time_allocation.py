"""
Time Allocation: where the user's time went, by day and account.

Logged time (`SalesforceTimeEntry`) is the record of what the user said they spent, but it only
exists for days they have run Log Time. A week that has not been logged yet — and this week never
has been — would show nothing. So the calendar fills the gaps:

    for each (day, account):
        logged time exists  -> use it, and ignore that day's calendar events for that account
        otherwise           -> that account's calendar events for the day

Both sources drop anything the user did not actually spend time on:

* meetings marked **did not attend** (`attended is False`), cancelled events, all-day events,
  out-of-office / working-location / focus-time blocks, zero-length events;
* events that have not started yet (an ongoing one counts up to `now`);
* for **logged** entries, any event line in the entry's description that matches a meeting since
  marked did-not-attend — Log Time itself skips those, but one marked afterwards is still inside an
  already-saved entry, and "do not include it at all" has to hold for that too.

An event's account is, in order: the one it is linked to; the account of the action item it is a
block for; or — when neither — the single one of the user's accounts its title names as a whole word
(the same conservative rule the time-entry backfill uses; display only, nothing is written). An event
that still has no account is left out of the rows and counted in `unlinked_calendar_minutes`, so
100 hours of internal meetings do not bury the accounts, and the omission is visible, not silent.
Logged time with no account is kept (as account "") because the user logged it.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone as dt_timezone
from zoneinfo import ZoneInfo

from core.timezones import zone_name

# Events in these categories are not time spent with an account.
NON_WORK_CATEGORIES = ("out_of_office", "working_location", "focus_time")
CALENDARS = ("primary", "work_tracking")
MAX_RANGE_DAYS = 125  # previous month through today is at most ~62; leave headroom, not unbounded


@dataclass
class Row:
    date: date
    account: str
    minutes: int
    source: str  # "logged" | "calendar"

    def as_dict(self) -> dict:
        return {"date": self.date.isoformat(), "account": self.account, "minutes": self.minutes, "source": self.source}


def user_zone(user) -> ZoneInfo:
    return ZoneInfo(zone_name(getattr(getattr(user, "profile", None), "timezone", "")))


_DURATION_RE = re.compile(r"\((?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\)\s*$")
_TITLE_SUFFIX_RE = re.compile(r"\s*\([^)]*\)\s*$")


def line_minutes(line: str) -> int:
    """Minutes in a trailing "(1h 45m)" / "(30m)" / "(2h)", else 0."""
    m = _DURATION_RE.search(line or "")
    if not m or not (m.group(1) or m.group(2)):
        return 0
    return int(m.group(1) or 0) * 60 + int(m.group(2) or 0)


def _norm(title: str) -> str:
    return re.sub(r"\s+", " ", (title or "").strip()).lower()


def _event_account_names(events, user) -> dict[int, tuple[str, bool]]:
    """{event pk: (account name, inferred)} — linked, else the action item's, else named in the title."""
    from .time_entry_accounts import account_matcher

    from airtable_sync.models import AirtableActionItem

    item_ids = {e.agentpm_airtable_id for e in events if not e.account_id and e.agentpm_airtable_id}
    item_account = {
        i.airtable_id: i.account.name
        for i in AirtableActionItem.objects.filter(airtable_id__in=item_ids, account__isnull=False).select_related("account")
    } if item_ids else {}
    match = account_matcher(user)
    out = {}
    for e in events:
        if e.account_id:
            out[e.pk] = (e.account.company_name, False)
        elif e.agentpm_airtable_id in item_account:
            out[e.pk] = (item_account[e.agentpm_airtable_id], False)
        else:
            named = match(e.title)
            out[e.pk] = (named.company_name, True) if named else ("", False)
    return out


def _local_date(dt: datetime, tz: ZoneInfo) -> date:
    return dt.astimezone(tz).date()


def build_allocation(user, start: date, end: date, now: datetime | None = None) -> dict:
    """Rows for `start..end` (inclusive, the user's local days). `now` is injectable for tests."""
    from scheduler.models import CalendarEvent

    from .models import SalesforceTimeEntry
    from .time_entry_accounts import entry_account_name

    now = now or datetime.now(dt_timezone.utc)
    tz = user_zone(user)

    # Widen the UTC window by a day each side; the local-date test below is the real filter.
    lo = datetime.combine(start - timedelta(days=1), datetime.min.time(), tzinfo=dt_timezone.utc)
    hi = datetime.combine(end + timedelta(days=2), datetime.min.time(), tzinfo=dt_timezone.utc)
    events = list(
        CalendarEvent.objects
        .filter(owner=user, calendar_id__in=CALENDARS, start_datetime__gte=lo, start_datetime__lt=hi)
        .exclude(status="cancelled")
        .exclude(event_category__in=NON_WORK_CATEGORIES)
        .select_related("account")
    )
    in_range = [e for e in events if start <= _local_date(e.start_datetime, tz) <= end and not e.all_day]

    # Did-not-attend meetings, by local day: dropped from the calendar side, and subtracted from
    # any already-logged entry that mentions them.
    skipped_titles: dict[date, dict[str, int]] = defaultdict(dict)
    for e in in_range:
        if e.attended is False:
            skipped_titles[_local_date(e.start_datetime, tz)][_norm(e.title)] = 1

    names = _event_account_names([e for e in in_range if e.attended is not False], user)
    calendar: dict[tuple[date, str], float] = defaultdict(float)
    unlinked = 0.0
    inferred_by_key: dict[tuple[date, str], float] = defaultdict(float)
    for e in in_range:
        if e.attended is False or e.start_datetime > now:
            continue
        stop = min(e.end_datetime, now)
        minutes = (stop - e.start_datetime).total_seconds() / 60
        if minutes <= 0:
            continue
        account, was_inferred = names.get(e.pk, ("", False))
        if not account:
            unlinked += minutes
            continue
        key = (_local_date(e.start_datetime, tz), account)
        calendar[key] += minutes
        if was_inferred:
            inferred_by_key[key] += minutes

    logged: dict[tuple[date, str], int] = defaultdict(int)
    entries = (
        SalesforceTimeEntry.objects
        .filter(user=user, date__gte=start, date__lte=end)
        .select_related("account", "project__account")
    )
    for entry in entries:
        minutes = entry.duration_minutes
        dna = skipped_titles.get(entry.date, {})
        if dna:
            for line in (entry.description or "").split("\n"):
                title = _TITLE_SUFFIX_RE.sub("", line)
                if _norm(title) in dna:
                    minutes -= line_minutes(line)
        logged[(entry.date, entry_account_name(entry))] += max(0, minutes)

    rows: list[Row] = []
    shown_inferred = 0.0  # inferred minutes in rows actually returned, not masked by logged time
    for key, minutes in sorted(logged.items()):
        if minutes > 0:
            rows.append(Row(key[0], key[1], int(minutes), "logged"))
    for key, minutes in sorted(calendar.items()):
        # Logged time for this day+account wins even when it nets out to zero: the day was logged,
        # and re-adding its calendar events would count meetings the user chose to drop.
        if key in logged:
            continue
        if round(minutes) > 0:
            rows.append(Row(key[0], key[1], int(round(minutes)), "calendar"))
            shown_inferred += inferred_by_key.get(key, 0.0)
    rows.sort(key=lambda r: (r.date, r.account, r.source))

    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "rows": [r.as_dict() for r in rows],
        "logged_minutes": sum(r.minutes for r in rows if r.source == "logged"),
        "calendar_minutes": sum(r.minutes for r in rows if r.source == "calendar"),
        # Of the calendar minutes, how many were matched to an account by name rather than by a link.
        "inferred_minutes": int(round(shown_inferred)),
        # Calendar time that could not be tied to any account, and so is not in `rows`.
        "unlinked_calendar_minutes": int(round(unlinked)),
    }
