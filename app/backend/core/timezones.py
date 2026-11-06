"""
Resolve the free-text ``UserProfile.timezone`` into a real zone.

Settings offers a plain text box (placeholder "America/New_York") and the server never
validates it, so people type what they think of their zone as: "PST", "Eastern", "pacific".
Python's tz database recognises none of those, and falling back to UTC silently put a "9 to
noon UTC" meeting in front of someone in Los Angeles.

Abbreviations map to the *region*, not a fixed offset. "PST" typed in October means Pacific
time, which is currently daylight time (UTC-7); a literal fixed UTC-8 would be an hour wrong
for half the year. Only the unambiguous US zones are mapped: "IST" is India, Ireland or
Israel and "CST" is also China, so those are not guessed.
"""

from __future__ import annotations

from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_ZONE = "UTC"

_ALIASES = {
    "pst": "America/Los_Angeles", "pdt": "America/Los_Angeles", "pt": "America/Los_Angeles",
    "pacific": "America/Los_Angeles", "pacific time": "America/Los_Angeles",
    "us/pacific": "America/Los_Angeles",
    "mst": "America/Denver", "mdt": "America/Denver", "mt": "America/Denver",
    "mountain": "America/Denver", "mountain time": "America/Denver", "us/mountain": "America/Denver",
    "cst": "America/Chicago", "cdt": "America/Chicago", "ct": "America/Chicago",
    "central": "America/Chicago", "central time": "America/Chicago", "us/central": "America/Chicago",
    "est": "America/New_York", "edt": "America/New_York", "et": "America/New_York",
    "eastern": "America/New_York", "eastern time": "America/New_York", "us/eastern": "America/New_York",
}


def zone_name(value: str | None) -> str:
    """The IANA name for what a person typed, or "UTC" when it cannot be understood."""
    cleaned = " ".join((value or "").split())
    if not cleaned:
        return DEFAULT_ZONE
    alias = _ALIASES.get(cleaned.lower())
    if alias:
        return alias
    try:
        ZoneInfo(cleaned)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        return DEFAULT_ZONE
    return cleaned


def resolve_zone(value: str | None) -> ZoneInfo:
    """A ``ZoneInfo`` for what a person typed; never raises."""
    return ZoneInfo(zone_name(value))
