"""
Celery tasks for reminder delivery.

deliver_due_reminders runs every minute via Celery Beat. For each pending
reminder whose due_at has passed it dispatches one sub-task per notification
channel the user requested, then marks the reminder as sent.

Channel implementations:
  in_app  — Twilio Sync activity feed (same stream as agent events)
  slack   — Slack WebAPI chat.postMessage to user's DM channel (bot token)
  push    — W3C Web Push via pywebpush + VAPID keys
  sms     — Twilio Programmable SMS (reuses existing send_sms logic)
"""

from __future__ import annotations

import json
import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)


# ── Notification allowlist guard ──────────────────────────────────────────────

def _notification_allowed(user) -> bool:
    """
    Returns True if notifications may be sent to this user.

    When NOTIFICATION_ALLOWED_EMAILS is set (comma-separated), only those
    addresses receive notifications. Leave it empty (or unset) to allow all
    users — do that only once the connectors are fully validated in production.
    """
    allowed = settings.NOTIFICATION_ALLOWED_EMAILS
    if not allowed:
        return True  # allowlist disabled — open to all users
    return user.email.lower() in allowed


# ── Entry point — runs every minute ──────────────────────────────────────────

@shared_task(name="scheduler.deliver_due_reminders", ignore_result=True)
def deliver_due_reminders() -> None:
    """Find all pending reminders that are due and kick off delivery."""
    from .models import Reminder

    now = timezone.now()
    due = Reminder.objects.filter(status="pending", due_at__lte=now).select_related(
        "created_by__profile"
    )

    for reminder in due:
        # Claim before delivering. One conditional UPDATE, so if two runs overlap (a slow
        # minute, or two beat processes) exactly one of them flips the row out of
        # `pending` and delivers; the other sees 0 rows changed and skips. Without this a
        # reminder could be sent twice — including twice by SMS. Race-free on SQLite and
        # Postgres alike, with no lock table.
        claimed = Reminder.objects.filter(pk=reminder.pk, status="pending").update(status="sent")
        if not claimed:
            continue
        _dispatch_reminder(reminder)

    deliver_due_occurrences()


#: An occurrence whose start is older than this is stale (the worker was down, or it was added
#: to a moment already past): it is marked handled without notifying, so a late worker never
#: floods someone with reminders for things that are long over.
OCCURRENCE_STALE_AFTER = timedelta(minutes=10)


def deliver_due_occurrences() -> None:
    """
    Notify at the start of every calendar occurrence of a reminder.

    A reminder can be on the calendar several times; each is a moment the user asked to be
    reminded, so each notifies once, at its start, with the reminder's details and over its
    channels. Called at the end of `deliver_due_reminders`, so it runs on the same
    every-minute beat. The occurrence at the reminder's own `due_at` is skipped here: `deliver_due_reminders`
    already notifies for that moment, and doing both would send it twice.
    """
    from . import reminder_calendar
    from .models import CalendarEvent

    now = timezone.now()
    due = (
        CalendarEvent.objects.filter(
            calendar_id=reminder_calendar.REMINDERS_CALENDAR_ID,
            reminder__isnull=False,
            reminder_notified_at__isnull=True,
            start_datetime__lte=now,
        )
        .select_related("reminder", "reminder__created_by__profile")
    )
    for occ in due:
        reminder = occ.reminder
        # Claim first (one conditional UPDATE), exactly as reminders are, so overlapping runs
        # cannot notify twice.
        claimed = CalendarEvent.objects.filter(pk=occ.pk, reminder_notified_at__isnull=True).update(
            reminder_notified_at=now
        )
        if not claimed:
            continue
        if reminder.status not in reminder_calendar.VISIBLE_STATUSES:
            continue
        if reminder_calendar._minute(occ.start_datetime) == reminder_calendar._minute(reminder.due_at):
            continue  # the reminder itself notifies for its due time
        if now - occ.start_datetime > OCCURRENCE_STALE_AFTER:
            logger.info("Reminder %s occurrence %s is stale; not notifying", reminder.pk, occ.pk)
            continue
        _dispatch_reminder(reminder, fired_for=occ.start_datetime)


def _dispatch_reminder(reminder, fired_for=None) -> None:
    """Deliver one reminder across all requested channels, to the creator and any recipients.

    `fired_for` is the moment that triggered it (the due time, or the start of a calendar block);
    it is recorded on each in-app notification so snoozing from the alert moves the right block."""
    from types import SimpleNamespace

    from . import reminder_recipients

    creator = reminder.created_by
    fired_for = fired_for or reminder.due_at
    _deliver_to(creator, reminder, reminder, fired_for=fired_for)

    # Other people the creator chose to notify (approved when they were added). Opt-outs are
    # re-read here, so someone who switched it off since then is skipped.
    recipients = reminder_recipients.deliverable_recipients(reminder)
    if not recipients:
        return
    sender = reminder_recipients.display_name(creator)
    body = f"Set by {sender}" + (f" — {reminder.body}" if reminder.body else "")
    for person in recipients:
        # What the channel senders read. It carries the sender's name, since a stranger's SMS or
        # Slack DM with no "from" would be unintelligible — and the channels are THEIRS: the
        # creator's "notify me via" boxes are about how the creator wants to be told, not how
        # everyone else is. Each person is reached the way they chose in their own Settings.
        shared = SimpleNamespace(
            pk=reminder.pk, title=reminder.title, body=body,
            resource_type=reminder.resource_type, resource_id=reminder.resource_id,
            resource_label=reminder.resource_label, due_at=reminder.due_at,
            **reminder_recipients.channels_for(person),
        )
        _deliver_to(person, shared, reminder, is_recipient=True, fired_for=fired_for)


def _deliver_to(user, reminder, original, is_recipient: bool = False, fired_for=None) -> None:
    """Send `reminder` to one person over the channels it asks for, recording each result."""
    if not _notification_allowed(user):
        logger.info(
            "Reminder %s skipped — %s is not in NOTIFICATION_ALLOWED_EMAILS",
            original.pk, user.email,
        )
        # Already claimed as sent by the caller, so it does not loop forever.
        return

    try:
        profile = user.profile
    except Exception:
        profile = None

    errors = []

    def _record(channel, status):
        from team.notifications import record_notification

        from . import reminder_links

        return record_notification(
            user, channel, "reminder", f"⏰ {reminder.title}", reminder.body or "",
            "/profile" if is_recipient else "/reminders", status,
            account=reminder_links.linked_account(original),
            reminder=original, fired_for=fired_for,
        )

    if reminder.notify_in_app:
        try:
            _send_in_app(user, reminder)
            _record("in_app", "sent")
        except Exception as exc:
            errors.append(f"in_app: {exc}")
            _record("in_app", "failed")
            logger.warning("Reminder %s in-app delivery failed: %s", original.pk, exc)

    if reminder.notify_slack:
        try:
            _record("slack", "sent" if _send_slack(user, profile, reminder) else "skipped")
        except Exception as exc:
            errors.append(f"slack: {exc}")
            _record("slack", "failed")
            logger.warning("Reminder %s Slack delivery failed: %s", original.pk, exc)

    if reminder.notify_push:
        try:
            _record("push", "sent" if _send_push(profile, reminder) else "skipped")
        except Exception as exc:
            errors.append(f"push: {exc}")
            _record("push", "failed")
            logger.warning("Reminder %s push delivery failed: %s", original.pk, exc)

    if reminder.notify_sms:
        try:
            sms_sid = _send_sms(profile, reminder)
            row = _record("sms", "sent" if sms_sid else "skipped")
            # Twilio only *queued* it; the carrier's verdict arrives later.
            if row is not None and isinstance(sms_sid, str):
                _schedule_sms_check(row.pk, sms_sid)
        except Exception as exc:
            errors.append(f"sms: {exc}")
            _record("sms", "failed")
            logger.warning("Reminder %s SMS delivery failed: %s", original.pk, exc)

    # The row was claimed as "sent" before delivery so it cannot be picked up twice. A
    # channel failure does not re-arm it (that would retry every minute forever, and could
    # re-send the channels that did succeed); it is logged at WARNING so it is visible.
    if errors:
        logger.warning("Reminder %s delivered to user %s with channel failures: %s", original.pk, user.pk, errors)
    else:
        logger.info("Reminder %s delivered to user %s", original.pk, user.pk)


# ── Channel implementations ───────────────────────────────────────────────────

def _send_in_app(user, reminder) -> None:
    """Push a reminder notification to the user's Twilio Sync activity feed."""
    from realtime.sync import publish_activity_event

    publish_activity_event(
        user=user,
        event_type="reminder",
        title=f"⏰ {reminder.title}",
        detail=reminder.body or "",
        metadata={
            "reminder_id": reminder.pk,
            "resource_type": reminder.resource_type,
            "resource_id": reminder.resource_id,
            "resource_label": reminder.resource_label,
            "due_at": reminder.due_at.isoformat(),
        },
    )


def _send_slack(user, profile, reminder) -> None:
    """Send a Slack DM to the user via the org bot token."""
    if not settings.SLACK_BOT_TOKEN:
        logger.debug("SLACK_BOT_TOKEN not set — skipping Slack reminder for user %s", user.pk)
        return False

    slack_user_id = getattr(profile, "slack_user_id", "") if profile else ""
    if not slack_user_id:
        logger.debug("No slack_user_id for user %s — skipping Slack reminder", user.pk)
        return False

    from slack_sdk import WebClient
    from slack_sdk.errors import SlackApiError

    client = WebClient(token=settings.SLACK_BOT_TOKEN)

    body_text = f"\n>{reminder.body}" if reminder.body else ""
    resource_context = (
        f"\n*Linked to*: {reminder.resource_label}" if reminder.resource_label else ""
    )
    text = (
        f":alarm_clock: *Reminder: {reminder.title}*"
        f"{body_text}"
        f"{resource_context}"
    )

    try:
        client.chat_postMessage(channel=slack_user_id, text=text)
    except SlackApiError as exc:
        raise RuntimeError(f"Slack API error: {exc.response['error']}") from exc
    return True

def _send_push(profile, reminder) -> None:
    """Send a Web Push notification using VAPID keys."""
    if not (settings.VAPID_PRIVATE_KEY and settings.VAPID_PUBLIC_KEY):
        logger.debug("VAPID keys not set — skipping push notification")
        return False

    subscription = getattr(profile, "push_subscription", None) if profile else None
    if not subscription:
        logger.debug("No push subscription for profile %s", getattr(profile, "pk", "?"))
        return False

    from pywebpush import webpush, WebPushException

    payload = json.dumps({
        "title": reminder.title,
        "body": reminder.body or "",
        "reminder_id": reminder.pk,
        "resource_label": reminder.resource_label or "",
    })

    try:
        webpush(
            subscription_info=subscription,
            data=payload,
            vapid_private_key=settings.VAPID_PRIVATE_KEY,
            vapid_claims={"sub": f"mailto:{settings.VAPID_ADMIN_EMAIL}"},
        )
    except WebPushException as exc:
        # 410 Gone means the subscription expired — clear it so we don't retry
        if exc.response is not None and exc.response.status_code == 410:
            if profile:
                type(profile).objects.filter(pk=profile.pk).update(push_subscription=None)
                logger.info("Cleared expired push subscription for profile %s", profile.pk)
        raise
    return True

def _send_sms(profile, reminder) -> None:
    """Send an SMS via Twilio Programmable SMS."""
    if not (settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN and settings.TWILIO_PHONE_NUMBER):
        logger.debug("Twilio credentials not set — skipping SMS reminder")
        return False

    phone = getattr(profile, "phone_number", "") if profile else ""
    if not phone:
        logger.debug("No phone_number on profile — skipping SMS reminder")
        return False

    from twilio.rest import Client

    body_text = f": {reminder.body}" if reminder.body else ""
    message_body = f"Reminder: {reminder.title}{body_text}"

    client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
    message = client.messages.create(
        body=message_body,
        from_=settings.TWILIO_PHONE_NUMBER,
        to=phone,
    )
    # The message SID (truthy) so callers can look up the carrier's final verdict.
    return getattr(message, "sid", None) or True


def _schedule_sms_check(notification_id: int, message_sid: str, attempt: int = 0) -> None:
    """Queue a delivery re-check. Never raises: a missing broker must not fail the reminder."""
    from . import sms_delivery

    if attempt >= len(sms_delivery.RECHECK_DELAYS):
        return
    try:
        check_sms_delivery.apply_async(
            args=[notification_id, message_sid, attempt],
            countdown=sms_delivery.RECHECK_DELAYS[attempt],
        )
    except Exception:
        logger.warning("Could not schedule SMS delivery check for %s", message_sid, exc_info=True)


@shared_task(name="scheduler.check_sms_delivery", ignore_result=True)
def check_sms_delivery(notification_id: int, message_sid: str, attempt: int = 0) -> None:
    """
    Read back what the carrier did with a text and correct the Notification if it was refused.
    A message still in flight is re-checked on a widening schedule; one that never reports
    (some carriers send no receipt) is left as "sent".
    """
    from team.models import Notification

    from . import sms_delivery

    outcome = sms_delivery.fetch_outcome(message_sid)
    if outcome is None:
        _schedule_sms_check(notification_id, message_sid, attempt + 1)
        return
    status, error_code = outcome
    if status in sms_delivery.FAILED_STATUSES:
        note = f"Text not delivered: {sms_delivery.describe_error(error_code)}"
        if error_code:
            note += f" (Twilio error {error_code})"
        row = Notification.objects.filter(pk=notification_id).first()
        if row is not None:
            Notification.objects.filter(pk=row.pk).update(
                status="failed", body=f"{row.body}\n{note}".strip(),
            )
        logger.warning("SMS %s not delivered: status=%s code=%s", message_sid, status, error_code)
    elif status not in sms_delivery.DELIVERED_STATUSES:
        _schedule_sms_check(notification_id, message_sid, attempt + 1)
