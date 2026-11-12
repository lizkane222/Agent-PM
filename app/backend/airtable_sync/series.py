"""Recurring-meeting account links.

A Google recurring event expands (``singleEvents=True``) into instances whose ids are
``<series id>_<YYYYMMDD>`` or ``<series id>_<YYYYMMDDTHHMMSSZ>``. The account link
(`CalendarEventAccountLink`) is keyed by that instance id, so linking one week used to leave every
other week unlinked. These helpers let one assignment reach the rest of the series:

* **update_subsequent** -- later instances already synced get the link now, and the first link is
  flagged ``apply_to_future`` so instances that sync *later* inherit it (`inherit_series_link`).
* **update_historical** -- earlier instances already synced get the link now, so a meeting-notes
  scan can file recaps for them under the account.

Dates are compared from the instance ids themselves, not from stored datetimes, so the order is
the one Google assigned and does not depend on timezones.
"""
import re

from .models import AirtableAccount, CalendarEventAccountLink

_INSTANCE = re.compile(r"^(?P<series>[A-Za-z0-9]+)_(?P<date>\d{8})(T\d{6}Z)?$")


def parse_instance(uid: str):
    """``(series_id, 'YYYYMMDD')`` for a recurring-instance id, else None."""
    m = _INSTANCE.match(uid or "")
    return (m.group("series"), m.group("date")) if m else None


def resolve_uid(user, uid: str) -> str:
    """The Google event id for `uid`, which may be a CalendarEvent pk (the page's fallback key)."""
    if uid and uid.isdigit():
        from scheduler.models import CalendarEvent

        gid = (
            CalendarEvent.objects.filter(owner=user, pk=int(uid))
            .values_list("google_event_id", flat=True)
            .first()
        )
        if gid:
            return gid
    return uid


def sibling_uids(user, series: str) -> list[str]:
    """Google ids of this user's synced instances of `series` (the event itself included)."""
    from scheduler.models import CalendarEvent

    ids = CalendarEvent.objects.filter(
        owner=user, google_event_id__startswith=f"{series}_"
    ).values_list("google_event_id", flat=True)
    return [i for i in ids if (p := parse_instance(i)) and p[0] == series]


def apply_series(user, uid: str, account: AirtableAccount, *, subsequent: bool, historical: bool) -> dict:
    """Copy `account` from the instance `uid` onto its siblings. Returns counts and the uids touched."""
    result = {"subsequent": 0, "historical": 0, "uids": []}
    parsed = parse_instance(resolve_uid(user, uid))
    if not parsed or not (subsequent or historical):
        return result
    series, pivot = parsed
    for sibling in sibling_uids(user, series):
        date = parse_instance(sibling)[1]
        if date == pivot:
            continue
        later = date > pivot
        if later and not subsequent or not later and not historical:
            continue
        CalendarEventAccountLink.objects.update_or_create(
            calendar_event_uid=sibling,
            defaults={"account": account, "categorization": "", "match_method": "series"},
        )
        result["subsequent" if later else "historical"] += 1
        result["uids"].append(sibling)
    return result


def inherit_series_link(uid: str, rules=None):
    """Link a recurring instance that has none, from the nearest earlier ``apply_to_future`` link.

    `rules` lets a batch caller pass one pre-fetched queryset per series. Returns the link or None.
    """
    parsed = parse_instance(uid)
    if not parsed:
        return None
    series, date = parsed
    if rules is None:
        rules = CalendarEventAccountLink.objects.filter(
            calendar_event_uid__startswith=f"{series}_", apply_to_future=True, account__isnull=False
        )
    best, best_date = None, ""
    for rule in rules:
        p = parse_instance(rule.calendar_event_uid)
        if p and p[0] == series and best_date < p[1] < date:
            best, best_date = rule, p[1]
    if best is None:
        return None
    link, _ = CalendarEventAccountLink.objects.get_or_create(
        calendar_event_uid=uid,
        defaults={"account": best.account, "match_method": "series"},
    )
    return link
