from unittest.mock import MagicMock, patch

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.utils import timezone

from team.models import UserProfile

from .models import Reminder
from .tasks import _send_sms, deliver_due_reminders


def _make_user(email="test@example.com", phone="+15551234567"):
    user = User.objects.create_user(username=email, email=email, password="x")
    profile = UserProfile.objects.get_or_create(user=user)[0]
    profile.phone_number = phone
    profile.save()
    return user


def _make_reminder(user, *, due_offset_seconds=-10, notify_sms=True, **kwargs):
    return Reminder.objects.create(
        created_by=user,
        title="Team sync",
        body="Don't forget to prep the deck",
        due_at=timezone.now() + timezone.timedelta(seconds=due_offset_seconds),
        notify_sms=notify_sms,
        notify_in_app=False,
        **kwargs,
    )


TWILIO_SETTINGS = dict(
    TWILIO_ACCOUNT_SID="ACtest",
    TWILIO_AUTH_TOKEN="token",
    TWILIO_PHONE_NUMBER="+15550000000",
    NOTIFICATION_ALLOWED_EMAILS="",  # allow all
)


# ── _send_sms unit tests ───────────────────────────────────────────────────────

class SendSmsTests(TestCase):

    def setUp(self):
        self.user = _make_user()
        self.reminder = _make_reminder(self.user)
        self.profile = self.user.profile

    @override_settings(**TWILIO_SETTINGS)
    @patch("twilio.rest.Client")
    def test_sends_sms_with_title_and_body(self, MockClient):
        mock_messages = MockClient.return_value.messages
        _send_sms(self.profile, self.reminder)

        mock_messages.create.assert_called_once_with(
            body="Reminder: Team sync: Don't forget to prep the deck",
            from_="+15550000000",
            to="+15551234567",
        )

    @override_settings(**TWILIO_SETTINGS)
    @patch("twilio.rest.Client")
    def test_sends_sms_title_only_when_no_body(self, MockClient):
        self.reminder.body = ""
        mock_messages = MockClient.return_value.messages
        _send_sms(self.profile, self.reminder)

        call_kwargs = mock_messages.create.call_args.kwargs
        self.assertEqual(call_kwargs["body"], "Reminder: Team sync")

    @override_settings(TWILIO_ACCOUNT_SID="", TWILIO_AUTH_TOKEN="", TWILIO_PHONE_NUMBER="")
    @patch("twilio.rest.Client")
    def test_skips_when_credentials_missing(self, MockClient):
        _send_sms(self.profile, self.reminder)
        MockClient.assert_not_called()

    @override_settings(**TWILIO_SETTINGS)
    @patch("twilio.rest.Client")
    def test_skips_when_no_phone_number(self, MockClient):
        self.profile.phone_number = ""
        self.profile.save()
        _send_sms(self.profile, self.reminder)
        MockClient.assert_not_called()

    @override_settings(**TWILIO_SETTINGS)
    @patch("twilio.rest.Client")
    def test_skips_when_profile_is_none(self, MockClient):
        _send_sms(None, self.reminder)
        MockClient.assert_not_called()


# ── deliver_due_reminders integration tests ───────────────────────────────────

class DeliverDueRemindersTests(TestCase):

    def setUp(self):
        self.user = _make_user()

    @override_settings(**TWILIO_SETTINGS)
    @patch("twilio.rest.Client")
    @patch("scheduler.tasks._send_in_app")
    def test_due_sms_reminder_is_sent_and_marked(self, mock_in_app, MockClient):
        reminder = _make_reminder(self.user)
        deliver_due_reminders()

        MockClient.return_value.messages.create.assert_called_once()
        reminder.refresh_from_db()
        self.assertEqual(reminder.status, "sent")

    @override_settings(**TWILIO_SETTINGS)
    @patch("twilio.rest.Client")
    def test_future_reminder_is_not_sent(self, MockClient):
        _make_reminder(self.user, due_offset_seconds=3600)  # 1 hour from now
        deliver_due_reminders()
        MockClient.return_value.messages.create.assert_not_called()

    @override_settings(**TWILIO_SETTINGS)
    @patch("twilio.rest.Client")
    def test_sms_skipped_when_notify_sms_false(self, MockClient):
        _make_reminder(self.user, notify_sms=False)
        deliver_due_reminders()
        MockClient.return_value.messages.create.assert_not_called()

    @override_settings(
        TWILIO_ACCOUNT_SID="ACtest",
        TWILIO_AUTH_TOKEN="token",
        TWILIO_PHONE_NUMBER="+15550000000",
        NOTIFICATION_ALLOWED_EMAILS="other@example.com",  # user not in list
    )
    @patch("twilio.rest.Client")
    def test_allowlist_blocks_delivery(self, MockClient):
        _make_reminder(self.user)
        deliver_due_reminders()
        MockClient.return_value.messages.create.assert_not_called()

    @override_settings(**TWILIO_SETTINGS)
    @patch("twilio.rest.Client")
    @patch("scheduler.tasks._send_in_app")
    def test_already_sent_reminder_is_not_resent(self, mock_in_app, MockClient):
        reminder = _make_reminder(self.user, status="sent")
        deliver_due_reminders()
        MockClient.return_value.messages.create.assert_not_called()
