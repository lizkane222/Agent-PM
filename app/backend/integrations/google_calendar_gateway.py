"""
The only way this app writes to Google Calendar.

Every ``events().insert / patch / update / delete`` goes through :func:`write_event`, which:

* **always sets ``sendUpdates`` explicitly.** Never left to Google's default, which has
  differed by method. The value comes from :func:`integrations.invite_gate.decide`, and the
  only way to get ``"all"`` is to pass every check there.
* **writes an audit row before calling Google** (``GoogleWriteLog``) and completes it after,
  so a crash mid-call still leaves evidence of what was about to be sent, and to whom.
* **records ``invite_sent`` only after Google confirms**, in a transaction that re-reads the
  row under a lock. Two workers racing on the same event cannot both be allowed to send.

Why it exists: a customer received 2,000+ invitations after one meeting was moved, and there
was no record of what the app had sent. Call sites used to build their own ``sendUpdates``
(or omit it); now they cannot.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .invite_gate import ALL, NONE, REASON_OK, decide, guest_emails
from .models import GoogleWriteLog

logger = logging.getLogger(__name__)

VERBS = ("insert", "patch", "update", "delete")

# Reason recorded when the per-event guest ceiling stops a send.
REASON_TOO_MANY_GUESTS = "too_many_guests"

# Cap on addresses stored per audit row; the true count is always in ``guest_count``.
MAX_LOGGED_GUESTS = 50


def _sent_recently(user) -> int:
    """Guest emails this user's events actually caused in the last hour."""
    since = timezone.now() - timedelta(hours=1)
    rows = GoogleWriteLog.objects.filter(
        user=user, send_updates=ALL, outcome=GoogleWriteLog.OUTCOME_OK, created_at__gte=since
    ).values_list("guest_count", flat=True)
    return sum(rows)


def write_event(
    service,
    action: str,
    event,
    *,
    body: dict | None = None,
    source: str,
    approved: bool = False,
    approved_at=None,
    calendar_id: str = "primary",
    extra: dict | None = None,
    num_retries: int = 5,
):
    """
    Perform one Google Calendar write for ``event`` and return Google's response.

    ``approved`` / ``approved_at`` carry the user's explicit go-ahead to email guests. Without
    them Google is told ``sendUpdates="none"`` — the event is still created, changed or
    deleted, but nobody is emailed.
    """
    if action not in VERBS:
        raise ValueError(f"Unsupported Google Calendar action: {action!r}")

    now = timezone.now()
    owner = event.owner
    guests = guest_emails(event)

    decision = decide(
        event,
        approved=approved,
        approved_at=approved_at,
        now=now,
        enabled=bool(getattr(settings, "GOOGLE_GUEST_NOTIFICATIONS", False)),
        freshness_seconds=getattr(settings, "GOOGLE_INVITE_FRESHNESS_SECONDS", 60),
        sent_recently=_sent_recently(owner),
        max_per_hour=getattr(settings, "GOOGLE_MAX_GUEST_EMAILS_PER_HOUR", 20),
        horizon_days=getattr(settings, "GOOGLE_INVITE_HORIZON_DAYS", 14),
        single_event_horizon_days=getattr(settings, "GOOGLE_INVITE_SINGLE_EVENT_HORIZON_DAYS", 60),
    )
    reason = decision.reason
    send_updates = decision.send_updates

    # Per-event ceiling: a very large guest list is never notified automatically.
    ceiling = getattr(settings, "GOOGLE_MAX_GUESTS_PER_NOTIFIED_EVENT", 25)
    if send_updates == ALL and len(guests) > ceiling:
        send_updates, reason = NONE, REASON_TOO_MANY_GUESTS

    # Who the email goes to when one is sent; otherwise everyone on the event, for the record.
    logged = list(decision.recipients) if send_updates == ALL else guests
    log = GoogleWriteLog.objects.create(
        user=owner,
        event_pk=event.pk,
        google_event_id=event.google_event_id or "",
        action=action,
        source=source,
        send_updates=send_updates,
        guest_count=len(logged),
        guests=logged[:MAX_LOGGED_GUESTS],
        decision_reason=reason,
    )

    kwargs = {"calendarId": calendar_id, "sendUpdates": send_updates, **(extra or {})}
    if action != "insert":
        kwargs["eventId"] = event.google_event_id
    if body is not None and action != "delete":
        kwargs["body"] = body

    try:
        result = getattr(service.events(), action)(**kwargs).execute(num_retries=num_retries)
    except Exception as exc:
        GoogleWriteLog.objects.filter(pk=log.pk).update(
            outcome=GoogleWriteLog.OUTCOME_FAILED, error=str(exc)[:1000]
        )
        raise

    GoogleWriteLog.objects.filter(pk=log.pk).update(outcome=GoogleWriteLog.OUTCOME_OK)

    if send_updates == ALL and reason == REASON_OK:
        _record_sent(event, now, list(decision.recipients))
    return result


def _record_sent(event, now, recipients) -> None:
    """
    Mark the invite as sent, atomically. The row is re-read under a lock so two workers that
    both decided "send" cannot both record it; the loser logs and leaves the first send's
    timestamp untouched.
    """
    from scheduler.models import CalendarEvent

    with transaction.atomic():
        locked = CalendarEvent.objects.select_for_update().get(pk=event.pk)
        if locked.invite_sent:
            logger.error(
                "Duplicate guest notification for event %s: a second writer also sent. "
                "Keeping the first timestamp.", event.pk,
            )
            return
        CalendarEvent.objects.filter(pk=event.pk).update(
            invite_sent=True, invite_sent_at=now, invited_emails=sorted(set(recipients)),
        )
    event.invite_sent, event.invite_sent_at = True, now
    event.invited_emails = sorted(set(recipients))


def delete_by_id(service, user, google_event_id: str, *, source: str, event_pk=None,
                 calendar_id: str = "primary", num_retries: int = 5):
    """
    Delete a Google event when only its id is known (the local row is already gone).

    Always ``sendUpdates="none"``: there is no event left to run the invite gate against, and
    Google announces a cancellation to guests, so this never emails. Still audited.
    """
    log = GoogleWriteLog.objects.create(
        user=user, event_pk=event_pk, google_event_id=google_event_id or "", action="delete",
        source=source, send_updates=NONE, guest_count=0, guests=[], decision_reason="delete_by_id",
    )
    try:
        result = service.events().delete(
            calendarId=calendar_id, eventId=google_event_id, sendUpdates=NONE
        ).execute(num_retries=num_retries)
    except Exception as exc:
        GoogleWriteLog.objects.filter(pk=log.pk).update(
            outcome=GoogleWriteLog.OUTCOME_FAILED, error=str(exc)[:1000]
        )
        raise
    GoogleWriteLog.objects.filter(pk=log.pk).update(outcome=GoogleWriteLog.OUTCOME_OK)
    return result


def write_guestless(service, action: str, user, *, body: dict, source: str,
                    google_event_id: str = "", calendar_id: str = "primary", num_retries: int = 5):
    """
    Write a private block (an action item or reminder) that has no guests and no event row.

    Always ``sendUpdates="none"`` and audited. A body carrying ``attendees`` is refused before
    it reaches Google (and logged as blocked): this entry point must never become a way to
    invite someone around the invite gate.
    """
    if action not in ("insert", "update"):
        raise ValueError(f"write_guestless supports insert/update, not {action!r}")

    log = GoogleWriteLog.objects.create(
        user=user, google_event_id=google_event_id or "", action=action, source=source,
        send_updates=NONE, guest_count=0, guests=[], decision_reason="guestless",
    )
    if body.get("attendees"):
        GoogleWriteLog.objects.filter(pk=log.pk).update(
            outcome=GoogleWriteLog.OUTCOME_BLOCKED, error="body contained attendees"
        )
        raise ValueError("write_guestless refuses a body with attendees; use write_event")

    kwargs = {"calendarId": calendar_id, "sendUpdates": NONE, "body": body}
    if action == "update":
        kwargs["eventId"] = google_event_id
    try:
        result = getattr(service.events(), action)(**kwargs).execute(num_retries=num_retries)
    except Exception as exc:
        GoogleWriteLog.objects.filter(pk=log.pk).update(
            outcome=GoogleWriteLog.OUTCOME_FAILED, error=str(exc)[:1000]
        )
        raise
    GoogleWriteLog.objects.filter(pk=log.pk).update(outcome=GoogleWriteLog.OUTCOME_OK)
    return result
