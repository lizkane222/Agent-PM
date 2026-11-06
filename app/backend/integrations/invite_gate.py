"""
The single rule for when Google may email calendar guests.

Why this exists: a customer received over 2,000 invitations after one meeting was moved.
Google emails guests whenever a Calendar write carries ``sendUpdates="all"`` — and the
API's default for an unset value has differed by method — so the decision cannot be left to
each of the call sites. It is taken here, once, by a pure function with no database and no
Google access, so it can be read, reasoned about and tested exhaustively.

The rule (the product owner's, in order):

1. **Has this invite already been sent?** Yes → never send again.
2. **Was the event created or updated in AgentPM at this moment?** The row's own
   ``created_at`` / ``updated_at`` must be *now* (inside a short window). An event that came
   from Google never sends, and neither does a write replayed later by a sync.
3. **Did the user approve this send?** And the approval must itself be recent, so a "yes" to
   one question cannot authorise a different action minutes later.

4. **Never a recurring instance.** A series is ONE invitation; Google asks each guest "this
   event or all events" itself. 92% of the stored Google events are instances of just 42
   series, some expanding to 730 — an app that notified per instance multiplied one change
   into hundreds of emails.
5. **Never far ahead.** Nothing starting beyond a short horizon (default 14 days, or 60 days for a
   one-off event that does not repeat) is announced
   automatically, so no invitation goes out "for months, weeks or years in advance".
6. **No second email, even for a newly added guest.** The owner's wish was that adding one
   address emails only that address. Google cannot do that: ``attendees`` REPLACES the whole
   list, and ``sendUpdates="all"`` notifies ALL guests (its docs offer no "new guests only").
   Notifying for one newcomer would therefore re-email everyone already invited — exactly the
   incident. So once any invitation has gone out, later changes are silent; the newcomer is
   added to the event without an email. ``invited_emails`` records who was emailed.

Anything else is ``"none"``. Every uncertain case — a missing timestamp, a future timestamp,
no approval time — resolves to *don't send*. There is deliberately no path that returns
``"all"`` without passing every check.

Beyond the three questions, two more guards: a global switch (default **off**, so the system
fails closed) and an hourly budget of guest emails per user.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta

REASON_OK = "ok"
REASON_ALREADY_SENT = "already_sent"
REASON_FROM_GOOGLE = "from_google"
REASON_NOT_FRESH = "not_fresh"
REASON_NO_APPROVAL = "no_approval"
REASON_STALE_APPROVAL = "stale_approval"
REASON_NO_GUESTS = "no_guests"
REASON_DISABLED = "disabled"
REASON_RATE_LIMITED = "rate_limited"
REASON_RECURRING_INSTANCE = "recurring_instance"
REASON_TOO_FAR_AHEAD = "too_far_ahead"

# Where an event came from. Only AgentPM-originated events may ever email.
ORIGIN_AGENTPM = "agentpm"
ORIGIN_GOOGLE = "google"

NONE = "none"
ALL = "all"

DEFAULT_FRESHNESS_SECONDS = 60
DEFAULT_MAX_GUEST_EMAILS_PER_HOUR = 20
DEFAULT_HORIZON_DAYS = 14
# A one-off (non-recurring) event may be announced further out. Owner's decision 2026-11-04:
# upcoming two weeks for anything, or up to 60 days for a single event that does not repeat.
DEFAULT_SINGLE_EVENT_HORIZON_DAYS = 60
# A meeting that started a moment ago ("call now and invite them") is still announced, but a
# stale start is not — this grace is deliberately small so it cannot become a back door.
PAST_GRACE = timedelta(minutes=5)


@dataclass(frozen=True)
class Decision:
    send: bool
    send_updates: str  # exactly "none" or "all" — the value to hand to Google
    reason: str
    # Exactly who will be emailed. Never "everyone on the event" unless all of them are new.
    recipients: list = field(default_factory=list)

    @property
    def allowed(self) -> bool:
        return self.send


def _no(reason: str) -> Decision:
    return Decision(False, NONE, reason)


def guest_emails(event) -> list[str]:
    """Distinct guest addresses on ``event``, excluding blanks and the owner's own address."""
    own = (getattr(getattr(event, "owner", None), "email", "") or "").strip().lower()
    seen: list[str] = []
    for attendee in getattr(event, "attendees", None) or []:
        email = (attendee.get("email") or "").strip().lower() if isinstance(attendee, dict) else ""
        if email and email != own and email not in seen:
            seen.append(email)
    return seen


# Google recurring-instance ids: "<series id>_<YYYYMMDD>" or "<series id>_<YYYYMMDDTHHMMSSZ>".
_INSTANCE_ID = re.compile(r"^[A-Za-z0-9]+_\d{8}(T\d{6}Z)?$")


def is_recurring_instance(event) -> bool:
    return bool(_INSTANCE_ID.match(getattr(event, "google_event_id", "") or ""))


def is_recurring(event) -> bool:
    """An instance of a series, or anything carrying recurrence data. Never gets the long window."""
    return bool(
        is_recurring_instance(event)
        or getattr(event, "recurrence", None)
        or getattr(event, "recurring_event_id", None)
    )


def new_guest_emails(event) -> list[str]:
    """Guests on ``event`` who have not already been emailed — the only people to notify."""
    already = {(e or "").strip().lower() for e in (getattr(event, "invited_emails", None) or [])}
    return [e for e in guest_emails(event) if e not in already]


def _is_now(moment: datetime | None, now: datetime, window: timedelta) -> bool:
    """True only for a moment inside ``window`` before ``now``. A future time is not trusted."""
    if moment is None:
        return False
    return timedelta(0) <= (now - moment) <= window


def decide(
    event,
    *,
    approved: bool,
    approved_at: datetime | None,
    now: datetime,
    enabled: bool,
    freshness_seconds: int = DEFAULT_FRESHNESS_SECONDS,
    sent_recently: int = 0,
    max_per_hour: int = DEFAULT_MAX_GUEST_EMAILS_PER_HOUR,
    horizon_days: int = DEFAULT_HORIZON_DAYS,
    single_event_horizon_days: int = DEFAULT_SINGLE_EVENT_HORIZON_DAYS,
) -> Decision:
    """
    May Google email this event's guests *right now*?

    ``sent_recently`` is how many guest emails this user's events caused in the last hour.
    The order is the order of the owner's questions; the first failing check decides.
    """
    window = timedelta(seconds=freshness_seconds)

    # Question 1 — has this invite already been sent? Either flag counts: ``invited_emails`` is
    # the record of WHO was emailed, and anyone having been emailed means Google would re-email
    # all of them if asked to notify again for a newcomer.
    if getattr(event, "invite_sent", False) or (getattr(event, "invited_emails", None) or []):
        return _no(REASON_ALREADY_SENT)

    # Anything that came from Google is Google's to announce, never ours.
    if getattr(event, "origin", ORIGIN_AGENTPM) != ORIGIN_AGENTPM:
        return _no(REASON_FROM_GOOGLE)

    # A recurring series is one invitation. Its instances never email on their own.
    if is_recurring_instance(event):
        return _no(REASON_RECURRING_INSTANCE)

    # The global switch. Default is off, so a missing configuration cannot email anyone.
    if not enabled:
        return _no(REASON_DISABLED)

    # Question 2 — created (or, for an edit, updated) at this moment, in AgentPM?
    if not (
        _is_now(getattr(event, "created_at", None), now, window)
        or _is_now(getattr(event, "updated_at", None), now, window)
    ):
        return _no(REASON_NOT_FRESH)

    # Nothing in the past, and nothing beyond the horizon, is ever announced automatically.
    start = getattr(event, "start_datetime", None)
    # Inside ``horizon_days`` for anything; out to ``single_event_horizon_days`` only for a
    # one-off event. A recurring event never gets the longer window.
    reach = horizon_days if is_recurring(event) else max(horizon_days, single_event_horizon_days)
    if start is None or not (-PAST_GRACE <= (start - now) <= timedelta(days=reach)):
        return _no(REASON_TOO_FAR_AHEAD)

    # Question 3 — did the user approve it, and is that approval itself recent?
    if not approved:
        return _no(REASON_NO_APPROVAL)
    if not _is_now(approved_at, now, window):
        return _no(REASON_STALE_APPROVAL)

    # Only the guests who have not already been emailed.
    recipients = new_guest_emails(event)
    if not recipients:
        return _no(REASON_NO_GUESTS)

    # Budget: a runaway cannot exceed this many guest emails per user per hour.
    if sent_recently + len(recipients) > max_per_hour:
        return _no(REASON_RATE_LIMITED)

    return Decision(True, ALL, REASON_OK, recipients)
