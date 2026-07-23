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
        _dispatch_reminder(reminder)


def _dispatch_reminder(reminder) -> None:
    """Deliver one reminder across all requested channels then mark it sent."""
    from .models import Reminder

    user = reminder.created_by

    if not _notification_allowed(user):
        logger.info(
            "Reminder %s skipped — %s is not in NOTIFICATION_ALLOWED_EMAILS",
            reminder.pk, user.email,
        )
        # Still mark sent so the reminder doesn't loop forever.
        Reminder.objects.filter(pk=reminder.pk).update(status="sent")
        return

    try:
        profile = user.profile
    except Exception:
        profile = None

    errors = []

    if reminder.notify_in_app:
        try:
            _send_in_app(user, reminder)
        except Exception as exc:
            errors.append(f"in_app: {exc}")
            logger.warning("Reminder %s in-app delivery failed: %s", reminder.pk, exc)

    if reminder.notify_slack:
        try:
            _send_slack(user, profile, reminder)
        except Exception as exc:
            errors.append(f"slack: {exc}")
            logger.warning("Reminder %s Slack delivery failed: %s", reminder.pk, exc)

    if reminder.notify_push:
        try:
            _send_push(profile, reminder)
        except Exception as exc:
            errors.append(f"push: {exc}")
            logger.warning("Reminder %s push delivery failed: %s", reminder.pk, exc)

    if reminder.notify_sms:
        try:
            _send_sms(profile, reminder)
        except Exception as exc:
            errors.append(f"sms: {exc}")
            logger.warning("Reminder %s SMS delivery failed: %s", reminder.pk, exc)

    # Mark sent even if some channels failed — prevents infinite retry loops.
    # Errors are logged; operators can inspect logs for delivery issues.
    new_status = "sent" if not errors else "sent"
    Reminder.objects.filter(pk=reminder.pk).update(status=new_status)
    logger.info(
        "Reminder %s delivered (errors=%s)",
        reminder.pk,
        errors or "none",
    )


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
        return

    slack_user_id = getattr(profile, "slack_user_id", "") if profile else ""
    if not slack_user_id:
        logger.debug("No slack_user_id for user %s — skipping Slack reminder", user.pk)
        return

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


def _send_push(profile, reminder) -> None:
    """Send a Web Push notification using VAPID keys."""
    if not (settings.VAPID_PRIVATE_KEY and settings.VAPID_PUBLIC_KEY):
        logger.debug("VAPID keys not set — skipping push notification")
        return

    subscription = getattr(profile, "push_subscription", None) if profile else None
    if not subscription:
        logger.debug("No push subscription for profile %s", getattr(profile, "pk", "?"))
        return

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


def _send_sms(profile, reminder) -> None:
    """Send an SMS via Twilio Programmable SMS."""
    if not (settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN and settings.TWILIO_PHONE_NUMBER):
        logger.debug("Twilio credentials not set — skipping SMS reminder")
        return

    phone = getattr(profile, "phone_number", "") if profile else ""
    if not phone:
        logger.debug("No phone_number on profile — skipping SMS reminder")
        return

    from twilio.rest import Client

    body_text = f": {reminder.body}" if reminder.body else ""
    message_body = f"Reminder: {reminder.title}{body_text}"

    client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
    client.messages.create(
        body=message_body,
        from_=settings.TWILIO_PHONE_NUMBER,
        to=phone,
    )
