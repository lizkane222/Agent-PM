"""POST /api/v1/scheduler/notifications/test/ {"channels": ["sms", "push", ...]}

Sends a real test notification on each requested channel through the *same* senders reminder
delivery uses (scheduler/tasks.py), so a passing test means reminders will arrive too.

Those senders return quietly when a precondition is missing (no bot token, no phone number,
no registered browser) — right for a background job, useless for a test button. So each
precondition is checked here first and reported as `skipped` with a reason the user can act
on; a send that raises is `failed` with a fixed message (exception text stays in the log).

Channels: in_app, push, sms, slack (reminder channels) and email / slack_general (the
profile's general notification toggles). There is no email sender in the app, so email
reports `skipped` rather than pretending.
"""

from __future__ import annotations

import logging
from types import SimpleNamespace

from django.conf import settings
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

from . import tasks

logger = logging.getLogger(__name__)

CHANNELS = ("in_app", "push", "sms", "slack", "slack_general", "email")


class TestNotificationThrottle(UserRateThrottle):
    # Each call can send a real SMS — keep a stuck button from texting someone 200 times.
    rate = "10/min"


def _test_reminder():
    return SimpleNamespace(
        pk=None,
        title="Test notification from AgentPM",
        body="Your notification settings are working.",
        resource_type="",
        resource_id=None,
        resource_label="",
        due_at=timezone.now(),
    )


def _precondition(channel: str, user, profile) -> str | None:
    """A user-facing reason the channel can't deliver, or None if it can try."""
    if not tasks._notification_allowed(user):
        return "Notifications are limited to an allowlist on this server."
    if channel == "push":
        if not (settings.VAPID_PRIVATE_KEY and settings.VAPID_PUBLIC_KEY):
            return "Push isn't configured on the server."
        if not getattr(profile, "push_subscription", None):
            return 'Register this browser first ("Register this browser").'
    if channel == "sms":
        if not (settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN and settings.TWILIO_PHONE_NUMBER):
            return "SMS isn't configured on the server."
        if not getattr(profile, "phone_number", ""):
            return "Add a phone number under Your Profile."
    if channel in ("slack", "slack_general"):
        if not settings.SLACK_BOT_TOKEN:
            return "Slack notifications aren't configured on the server (no bot token)."
        if not getattr(profile, "slack_user_id", ""):
            return "Add your Slack user ID under Your Profile."
    if channel == "email":
        return "Email notifications aren't available yet."
    return None


def _send(channel: str, user, profile, reminder) -> None:
    if channel == "in_app":
        tasks._send_in_app(user, reminder)
    elif channel == "push":
        tasks._send_push(profile, reminder)
    elif channel == "sms":
        tasks._send_sms(profile, reminder)
    elif channel in ("slack", "slack_general"):
        tasks._send_slack(user, profile, reminder)


FAILED_MESSAGE = {
    "push": "The browser rejected the notification — try registering it again.",
    "sms": "Twilio couldn't deliver the text — check the number.",
    "slack": "Slack rejected the message — check your Slack user ID.",
    "slack_general": "Slack rejected the message — check your Slack user ID.",
    "in_app": "Couldn't publish to your activity feed.",
}


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([TestNotificationThrottle])
def send_test_notifications(request):
    requested = request.data.get("channels")
    if not isinstance(requested, list) or not requested:
        return Response({"channels": "Provide a non-empty list of channels."}, status=400)
    unknown = [c for c in requested if c not in CHANNELS]
    if unknown:
        return Response({"channels": f"Unknown channel(s): {', '.join(map(str, unknown))}."}, status=400)

    from team.models import UserProfile

    profile, _ = UserProfile.objects.get_or_create(user=request.user)
    reminder = _test_reminder()
    results = []
    for channel in dict.fromkeys(requested):  # de-dupe, keep order
        reason = _precondition(channel, request.user, profile)
        if reason:
            results.append({"channel": channel, "status": "skipped", "detail": reason})
            continue
        try:
            _send(channel, request.user, profile, reminder)
            results.append({"channel": channel, "status": "sent", "detail": ""})
        except Exception:
            logger.exception("Test notification failed on %s for user %s", channel, request.user.pk)
            results.append({"channel": channel, "status": "failed", "detail": FAILED_MESSAGE.get(channel, "Delivery failed.")})
    return Response({"results": results})
