"""
MCP tools for people and their calendars: find_person, get_colleague_availability,
invite_to_meeting.

The web app can search for a colleague, overlay their calendar and paint "Find free time";
the voice agent could do none of it, so asked to meet someone it could only say it had no
access to their calendar. These tools expose the same capabilities with the same rules:

* Busy time comes from ``scheduler.availability.compute_availability`` — the exact function
  behind the REST endpoint — so another person's meeting titles never reach the model.
* Free slots come from ``scheduler.free_slots.find_free_slots``, a port of the button's
  algorithm, evaluated in the caller's timezone.
* Names are resolved with ``agents.fuzzy``. A resolution picks *a person*, and for
  ``invite_to_meeting`` that means emailing them, so an ambiguous or unknown name stops the
  whole call instead of guessing.

Registered from ``AgentsConfig.ready()`` so these live beside the fuzzy resolver they use
rather than growing ``mcp_server.py``. All three are ``skill_safe=False``: a skill author
should not be able to wire up emailing colleagues, and the locked ``EXPECTED_SKILL_SAFE``
set in ``test_mcp_catalog`` stays green.

ORM work uses ``sync_to_async(thread_sensitive=True)`` (see TWILIO_WIRING.md finding (b)),
which keeps it testable inside a plain ``TestCase``.
"""

from __future__ import annotations

import logging
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from asgiref.sync import sync_to_async
from django.utils import timezone as _dj_timezone
from django.utils.dateparse import parse_date

from core.timezones import zone_name

logger = logging.getLogger(__name__)

MAX_PEOPLE = 8
MAX_RANGE_DAYS = 14

_NEED_USER = {"status": "error", "error": "No authenticated user available."}


def _now() -> datetime:
    """Indirection so tests can pin the clock."""
    return datetime.now(timezone.utc)


def _user_zone(user) -> tuple[str, ZoneInfo]:
    """The caller's zone. The profile field is free text ("PST"), so it is resolved, not trusted."""
    name = zone_name(getattr(getattr(user, "profile", None), "timezone", ""))
    return name, ZoneInfo(name)


# ── Person resolution ────────────────────────────────────────────────────────────────────

def _resolve_person(name: str):
    """
    ``(member, None)`` on a clear match, else ``(None, result)`` where ``result`` is a
    tool-shaped dict (``ambiguous`` / ``not_found`` / ``no_email`` / ``error``).
    """
    from agents.fuzzy import resolve_name
    from team.models import TeamMember

    name = (name or "").strip()
    if not name:
        return None, {"status": "error", "error": "A name is required."}

    members = {m.full_name: m for m in TeamMember.objects.exclude(full_name="")}
    resolution = resolve_name(name, list(members))
    if resolution.match:
        member = members[resolution.match]
        if not (member.email or "").strip():
            return None, {
                "status": "no_email",
                "name": member.full_name,
                "error": f"{member.full_name} has no email address on file, so their calendar "
                         f"cannot be checked and they cannot be invited.",
            }
        return member, None
    if resolution.candidates:
        return None, {
            "status": "ambiguous",
            "name": name,
            "candidates": [
                {"name": members[c].full_name, "title": members[c].title or ""} for c in resolution.candidates
            ],
            "error": f"'{name}' could be more than one person. Ask which one is meant.",
        }
    return None, {
        "status": "not_found",
        "name": name,
        "error": f"No teammate matching '{name}' was found.",
    }


# ── find_person ───────────────────────────────────────────────────────────────────────────

def _find_person_sync(name: str) -> dict:
    member, problem = _resolve_person(name)
    if problem:
        return problem
    return {
        "status": "found",
        "person": {"name": member.full_name, "email": member.email, "title": member.title or ""},
    }


# ── get_colleague_availability ──────────────────────────────────────────────────────────

def _parse_day(value: str):
    try:
        return parse_date((value or "").strip())
    except ValueError:
        return None


def _in_zone(value: str, zone: ZoneInfo) -> str:
    """
    An ISO timestamp re-expressed in ``zone``. Google returns busy blocks as ``...Z``, which a
    model reads as local time (12:00Z is 5am in Los Angeles but sounds like noon), so every
    time handed back uses the same zone as the free slots. Unparseable input is left as-is.
    """
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return value
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(zone).isoformat()


def _availability_sync(user, names: list[str], date_start: str, date_end: str) -> dict:
    from scheduler.availability import compute_availability
    from scheduler.free_slots import find_free_slots
    from scheduler.models import CalendarEvent

    names = [n for n in (names or []) if (n or "").strip()]
    if not names:
        return {"status": "error", "error": "Give at least one colleague's name."}
    if len(names) > MAX_PEOPLE:
        return {"status": "error", "error": f"At most {MAX_PEOPLE} people at a time."}

    first, last = _parse_day(date_start), _parse_day(date_end or date_start)
    if first is None or last is None:
        return {"status": "error", "error": "Dates must be YYYY-MM-DD, for example 2026-10-19."}
    if last < first:
        return {"status": "error", "error": "The end date is before the start date."}
    if (last - first).days >= MAX_RANGE_DAYS:
        return {"status": "error", "error": f"Look at no more than {MAX_RANGE_DAYS} days at a time."}

    # Resolve every name before touching anyone's calendar: one doubtful name stops the lot.
    people, seen = [], set()
    for name in names:
        member, problem = _resolve_person(name)
        if problem:
            return problem
        email = member.email.strip().lower()
        if email == (user.email or "").strip().lower() or email in seen:
            continue  # the caller's own calendar is the baseline, and duplicates add nothing
        seen.add(email)
        people.append(member)
    if not people:
        return {"status": "error", "error": "Name at least one colleague other than the caller."}

    tz_name, zone = _user_zone(user)
    range_start = datetime.combine(first, time.min, tzinfo=zone)
    range_end = datetime.combine(last + timedelta(days=1), time.min, tzinfo=zone)

    computed = {
        p["email"]: p
        for p in compute_availability(user, [m.email.strip().lower() for m in people], range_start, range_end)
    }

    out_people, pooled, incomplete = [], [], False
    for member in people:
        email = member.email.strip().lower()
        entry = computed.get(email)
        if entry is None:
            continue
        reason = entry.get("error")
        if reason:
            incomplete = True
            out_people.append({"name": member.full_name, "unavailable_reason": reason, "busy": []})
            continue
        busy = [{"start": _in_zone(b["start"], zone), "end": _in_zone(b["end"], zone)} for b in entry["busy"]]
        pooled.extend({**b, "all_day": False} for b in entry["busy"] if not b.get("all_day"))
        out_people.append({"name": member.full_name, "busy": busy})

    # The caller's own busy time blocks a shared slot too.
    mine = (
        CalendarEvent.objects
        .filter(owner=user, start_datetime__lt=range_end, end_datetime__gt=range_start)
        .exclude(status="cancelled")
        .exclude(attended=False)
        .exclude(calendar_id__in=("work_tracking", "reminders"))
        .values("start_datetime", "end_datetime", "all_day")
    )
    pooled.extend(
        {"start": r["start_datetime"], "end": r["end_datetime"], "all_day": r["all_day"]} for r in mine
    )

    # With any colleague's calendar unreadable the gaps would be fiction, so offer none.
    slots = [] if incomplete else find_free_slots(
        pooled, range_start, range_end, tz_name=tz_name, now=_now()
    )
    return {
        "status": "partial" if incomplete else "ok",
        "timezone": tz_name,
        "people": out_people,
        "free_slots": [{"start": s["start"].isoformat(), "end": s["end"].isoformat()} for s in slots],
        **({"note": "Some calendars could not be read, so no shared free time is offered."} if incomplete else {}),
    }


# ── invite_to_meeting ───────────────────────────────────────────────────────────────────

# What the agent may say when the gate declined to email. Read aloud, so plain words.
_WHY_NO_EMAIL = {
    "already_sent": "An invitation was already sent for this meeting, and it is never sent twice. "
                    "Anyone added now is on the event but was not emailed.",
    "recurring_instance": "This is one occurrence of a recurring series. Google already handles "
                          "invitations for the whole series, so nothing was emailed for this one.",
    "too_far_ahead": "This meeting is outside the window for invitation emails (the next {days} days, "
                     "or the next {single} days for a one-off meeting that does not repeat), or has "
                     "already passed, so no invitation was emailed.",
    "from_google": "This meeting came from Google Calendar, so Google owns its invitations and "
                   "nothing was emailed from here.",
    "disabled": "Invitation emails are switched off for this app, so nothing was emailed.",
    "rate_limited": "The hourly limit on invitation emails has been reached, so nothing was emailed.",
    "too_many_guests": "This meeting has too many guests to email automatically, so nothing was emailed.",
    "no_guests": "There was nobody new to email.",
    "not_fresh": "The meeting was not just created or changed here, so nothing was emailed.",
    "stale_approval": "The approval was too old, so nothing was emailed. Ask again to send it.",
    "no_approval": "It was not approved, so nothing was emailed.",
}


def _why_no_email(event_pk: int) -> str:
    """The gate's own reason for the most recent write to this event, in words."""
    from django.conf import settings

    from integrations.models import GoogleWriteLog

    row = GoogleWriteLog.objects.filter(event_pk=event_pk).order_by("-id").first()
    text = _WHY_NO_EMAIL.get(row.decision_reason if row else "", "")
    return text.format(
        days=getattr(settings, "GOOGLE_INVITE_HORIZON_DAYS", 14),
        single=getattr(settings, "GOOGLE_INVITE_SINGLE_EVENT_HORIZON_DAYS", 60),
    ) if text else ""


def _invite_sync(user, event_id: int, attendee_names: list[str], approved: bool = False) -> dict:
    from scheduler.models import CalendarEvent
    from scheduler.views import CalendarEventViewSet

    names = [n for n in (attendee_names or []) if (n or "").strip()]
    if not names:
        return {"status": "error", "error": "Name at least one person to invite."}

    event = CalendarEvent.objects.filter(pk=event_id, owner=user).first()
    if event is None:
        # Same answer for "does not exist" and "belongs to someone else".
        return {"status": "error", "error": "No such event on your calendar."}

    people, seen = [], set()
    for name in names:
        member, problem = _resolve_person(name)
        if problem:
            return problem  # nobody is invited on a partial guess
        email = member.email.strip()
        if email.lower() not in seen:
            seen.add(email.lower())
            people.append({"name": member.full_name, "email": email})

    existing = list(event.attendees or [])
    have = {(a.get("email") or "").lower() for a in existing if isinstance(a, dict)}
    for p in people:
        if p["email"].lower() not in have:
            existing.append({"email": p["email"], "displayName": p["name"]})
    event.attendees = existing
    event.save(update_fields=["attendees", "updated_at"])

    # Emailing guests needs the user's explicit approval (voice: the spoken yes). Without it the
    # attendees are still recorded and Google is still updated, but nobody is emailed. Passed to
    # the gateway, which also enforces "once only", "AgentPM events only", the global switch
    # and the hourly budget — so approval is necessary here, never sufficient.
    approved_at = _dj_timezone.now() if approved else None

    # Whether an invitation had already gone out before this call. "Invited" must mean *this*
    # call sent one: reading the flag afterwards alone would report a fresh email on a repeat
    # request when the gate (correctly) sent nothing.
    already_sent_before = bool(event.invite_sent)

    viewset = CalendarEventViewSet()
    reached_google = True
    try:
        if event.google_event_id:
            viewset._update_in_google(
                event, approved=approved, approved_at=approved_at, source="voice.invite",
            )
        else:
            reached_google = bool(viewset._push_to_google(event, send_invites=approved))
    except Exception:  # noqa: BLE001 — the local event is authoritative; never leak Google's error
        logger.exception("invite_to_meeting: Google push failed for event %s", event.pk)
        reached_google = False

    event.refresh_from_db(fields=["invite_sent"])
    emailed = bool(approved and reached_google and event.invite_sent and not already_sent_before)
    if emailed:
        note = ""
    elif not approved:
        note = ("They were added to the event, but no invitation email was sent because it was "
                "not approved.")
    elif not reached_google:
        note = ("They were added to the event but no invitation email went out, because "
                "Google Calendar could not be reached from here.")
    else:
        note = ("They were added to the event. " + (_why_no_email(event.pk) or
                "No invitation email was sent: invitations are limited to one per event, for "
                "upcoming events created here, and may be switched off."))

    return {
        "status": "invited" if emailed else "added_not_emailed",
        "event_id": event.pk,
        "title": event.title,
        "invited": people,
        **({"note": note} if note else {}),
    }


# ── Registration ────────────────────────────────────────────────────────────────────────

FIND_PERSON_SCHEMA = {"input_schema": {
    "type": "object",
    "properties": {"name": {"type": "string", "description": "The colleague's name as spoken, e.g. 'Melissa Ramirez'."}},
    "required": ["name"],
}}

AVAILABILITY_SCHEMA = {"input_schema": {
    "type": "object",
    "properties": {
        "names": {"type": "array", "items": {"type": "string"}, "description": "Colleagues to check, as spoken."},
        "date_start": {"type": "string", "description": "First day to check, YYYY-MM-DD."},
        "date_end": {"type": "string", "description": "Last day to check, YYYY-MM-DD. Defaults to date_start."},
    },
    "required": ["names", "date_start"],
}}

INVITE_SCHEMA = {"input_schema": {
    "type": "object",
    "properties": {
        "event_id": {"type": "integer", "description": "The id returned by create_calendar_event."},
        "attendee_names": {"type": "array", "items": {"type": "string"}, "description": "People to invite, as spoken."},
    },
    "required": ["event_id", "attendee_names"],
}}


def register(mcp_server) -> None:
    """Attach the tools to the shared registry. Idempotent per process."""
    if "find_person" in mcp_server.list_tools():
        return

    @mcp_server.tool(group="read", skill_safe=False, schema=FIND_PERSON_SCHEMA)
    async def find_person(name: str) -> dict:
        """Look up a colleague by name and return their name, email and title. Use this to confirm who someone is before inviting them. If the name could match several people it returns the candidates so you can ask which one."""
        from agents.mcp_server import _current_user

        if not _current_user.get():
            return _NEED_USER
        try:
            return await sync_to_async(_find_person_sync, thread_sensitive=True)(name)
        except Exception as exc:  # noqa: BLE001
            logger.exception("find_person failed: %s", exc)
            return {"status": "error", "error": "Could not look that person up."}

    @mcp_server.tool(group="read", skill_safe=False, schema=AVAILABILITY_SCHEMA)
    async def get_colleague_availability(names: list[str], date_start: str, date_end: str = "") -> dict:
        """See when colleagues are busy and when everyone, including the caller, is free. Returns each colleague's busy blocks (never meeting titles) and the shared free slots within working hours, in the caller's timezone. Use it to find a time before creating a meeting. If a name is ambiguous or unknown it stops and says so instead of guessing."""
        from agents.mcp_server import _current_user

        user = _current_user.get()
        if not user:
            return _NEED_USER
        try:
            return await sync_to_async(_availability_sync, thread_sensitive=True)(user, names, date_start, date_end)
        except Exception as exc:  # noqa: BLE001
            logger.exception("get_colleague_availability failed: %s", exc)
            return {"status": "error", "error": "Could not check those calendars."}

    @mcp_server.tool(group="communicate", skill_safe=False, schema=INVITE_SCHEMA)
    async def invite_to_meeting(event_id: int, attendee_names: list[str]) -> dict:
        """Add colleagues to one of the caller's calendar events and email them a Google Calendar invitation. Create the event first with create_calendar_event and pass its id. If any name is ambiguous or unknown nobody is invited."""
        from agents.mcp_server import _current_approved, _current_user

        user = _current_user.get()
        if not user:
            return _NEED_USER
        approved = _current_approved.get()
        try:
            return await sync_to_async(_invite_sync, thread_sensitive=True)(user, event_id, attendee_names, approved)
        except Exception as exc:  # noqa: BLE001
            logger.exception("invite_to_meeting failed: %s", exc)
            return {"status": "error", "error": "Could not send those invitations."}
