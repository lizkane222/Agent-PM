"""
Free time across several calendars — a Python port of ``findFreeSlots`` in
``frontend/src/lib/availability.ts``, so the voice agent offers the same slots the
"Find free time" button paints on the grid.

The one deliberate difference: the browser evaluates working hours in its own timezone, but
this runs on a server whose clock is UTC, so the caller's timezone is passed in. A 9-to-5
window in UTC is the middle of the night in Los Angeles.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from django.utils.dateparse import parse_datetime

from core.timezones import resolve_zone

DAY_START_HOUR = 9
DAY_END_HOUR = 17
MIN_MINUTES = 30


def _zone(tz_name: str) -> ZoneInfo:
    return resolve_zone(tz_name)


def _aware(value) -> datetime | None:
    """A timezone-aware datetime from an ISO string or datetime, or None if unusable."""
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = parse_datetime(value) if isinstance(value, str) else None
        except ValueError:
            parsed = None
    if parsed is None:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _intervals(busy: list[dict]) -> list[tuple[datetime, datetime]]:
    out = []
    for block in busy:
        if block.get("all_day"):
            # An OOO marker on one person's calendar hides that day only for them.
            continue
        start, end = _aware(block.get("start")), _aware(block.get("end"))
        if start is None or end is None or end <= start:
            continue
        out.append((start, end))
    return sorted(out)


def find_free_slots(
    busy: list[dict],
    range_start: datetime,
    range_end: datetime,
    *,
    tz_name: str = "UTC",
    min_minutes: int = MIN_MINUTES,
    day_start_hour: int = DAY_START_HOUR,
    day_end_hour: int = DAY_END_HOUR,
    now: datetime | None = None,
    include_weekends: bool = False,
) -> list[dict]:
    """
    Gaps of at least ``min_minutes`` inside working hours where nobody is busy.

    ``busy`` is every person's blocks pooled together (``{"start", "end", "all_day"}``).
    Returns ``[{"start": aware datetime, "end": aware datetime}]`` in ``tz_name``, never
    reaching before ``now``. Malformed or inverted blocks are ignored rather than fatal.
    """
    zone = _zone(tz_name)
    now = _aware(now) or datetime.now(timezone.utc)
    intervals = _intervals(busy)
    range_start, range_end = range_start.astimezone(zone), range_end.astimezone(zone)

    slots: list[dict] = []
    day = range_start.date()
    while True:
        window_start = datetime.combine(day, time(day_start_hour), tzinfo=zone)
        if window_start >= range_end:
            break
        # Weekday 5 and 6 are Saturday and Sunday.
        if include_weekends or day.weekday() < 5:
            window_end = datetime.combine(day, time(day_end_hour), tzinfo=zone)
            cursor = max(window_start, now, range_start)
            stop = min(window_end, range_end)
            for start, end in intervals:
                if end <= cursor:
                    continue
                if start >= stop:
                    break
                if start - cursor >= timedelta(minutes=min_minutes):
                    # `start` is in whatever zone the busy block arrived in; the caller reads
                    # these as local clock times, so normalise before handing them back.
                    slots.append({"start": cursor, "end": start.astimezone(zone)})
                cursor = max(cursor, end.astimezone(zone))
            if stop - cursor >= timedelta(minutes=min_minutes):
                slots.append({"start": cursor, "end": stop})
        day += timedelta(days=1)
    return slots
