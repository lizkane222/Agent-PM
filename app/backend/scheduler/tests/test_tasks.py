from unittest.mock import MagicMock, patch

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.utils import timezone

from team.models import UserProfile

from ..models import Reminder
from ..tasks import _send_sms, deliver_due_reminders


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


class ReminderClaimTests(TestCase):
    """A due reminder is delivered exactly once, even when two runs overlap."""

    def setUp(self):
        self.user = _make_user()

    @override_settings(**TWILIO_SETTINGS)
    @patch("twilio.rest.Client")
    @patch("scheduler.tasks._send_in_app")
    def test_a_reminder_claimed_by_another_run_is_not_delivered_again(self, mock_in_app, MockClient):
        from scheduler.models import Reminder
        from scheduler import tasks

        reminder = _make_reminder(self.user)
        original = tasks._dispatch_reminder
        dispatched = []

        def overlapping_run(r):
            # While this run is delivering, a second run starts and sees the same row.
            dispatched.append(r.pk)
            if len(dispatched) == 1:
                tasks.deliver_due_reminders()
            return original(r)

        with patch("scheduler.tasks._dispatch_reminder", side_effect=overlapping_run):
            tasks.deliver_due_reminders()

        self.assertEqual(dispatched, [reminder.pk])
        MockClient.return_value.messages.create.assert_called_once()
        self.assertEqual(Reminder.objects.get(pk=reminder.pk).status, "sent")

    @override_settings(**TWILIO_SETTINGS)
    @patch("twilio.rest.Client")
    @patch("scheduler.tasks._send_in_app")
    def test_a_channel_failure_is_logged_and_does_not_re_arm(self, mock_in_app, MockClient):
        from scheduler.models import Reminder

        MockClient.return_value.messages.create.side_effect = RuntimeError("twilio down")
        reminder = _make_reminder(self.user)
        with self.assertLogs("scheduler.tasks", level="WARNING") as logs:
            deliver_due_reminders()
        self.assertEqual(Reminder.objects.get(pk=reminder.pk).status, "sent")
        self.assertTrue(any("channel failures" in line for line in logs.output))
        deliver_due_reminders()  # a second run must not retry it
        self.assertEqual(MockClient.return_value.messages.create.call_count, 1)


# ── Carrier verdict after Twilio accepts a text ───────────────────────────────

class SmsDeliveryFollowUpTests(TestCase):
    """Twilio queues the text; the carrier can refuse it afterwards (e.g. 30034)."""

    def setUp(self):
        from team.models import Notification

        self.Notification = Notification
        self.user = _make_user()

    def _deliver(self, MockClient, sid="SMabc"):
        MockClient.return_value.messages.create.return_value.sid = sid
        _make_reminder(self.user)
        with patch("scheduler.tasks.check_sms_delivery.apply_async") as sched:
            deliver_due_reminders()
        return sched

    @override_settings(**TWILIO_SETTINGS)
    @patch("twilio.rest.Client")
    def test_send_sms_returns_the_message_sid(self, MockClient):
        MockClient.return_value.messages.create.return_value.sid = "SMabc"
        reminder = _make_reminder(self.user)
        self.assertEqual(_send_sms(self.user.profile, reminder), "SMabc")

    @override_settings(**TWILIO_SETTINGS)
    @patch("twilio.rest.Client")
    def test_a_delivery_check_is_scheduled_for_the_recorded_row(self, MockClient):
        sched = self._deliver(MockClient)
        row = self.Notification.objects.get(channel="sms")
        self.assertEqual(row.status, "sent")
        sched.assert_called_once()
        self.assertEqual(sched.call_args.kwargs["args"], [row.pk, "SMabc", 0])

    @override_settings(**TWILIO_SETTINGS)
    @patch("twilio.rest.Client")
    def test_a_broker_outage_does_not_break_delivery(self, MockClient):
        MockClient.return_value.messages.create.return_value.sid = "SMabc"
        reminder = _make_reminder(self.user)
        with patch("scheduler.tasks.check_sms_delivery.apply_async", side_effect=OSError("redis down")):
            deliver_due_reminders()
        reminder.refresh_from_db()
        self.assertEqual(reminder.status, "sent")
        self.assertEqual(self.Notification.objects.get(channel="sms").status, "sent")

    @override_settings(**TWILIO_SETTINGS)
    @patch("scheduler.sms_delivery.fetch_outcome", return_value=("undelivered", 30034))
    @patch("twilio.rest.Client")
    def test_a_carrier_refusal_marks_the_notification_failed_with_a_reason(self, MockClient, _fetch):
        from ..tasks import check_sms_delivery

        self._deliver(MockClient)
        row = self.Notification.objects.get(channel="sms")
        check_sms_delivery(row.pk, "SMabc")
        row.refresh_from_db()
        self.assertEqual(row.status, "failed")
        self.assertIn("A2P 10DLC", row.body)
        self.assertIn("30034", row.body)
        self.assertNotIn("ACtest", row.body)

    @override_settings(**TWILIO_SETTINGS)
    @patch("scheduler.sms_delivery.fetch_outcome", return_value=("delivered", None))
    @patch("twilio.rest.Client")
    def test_a_delivered_text_stays_sent_and_is_not_rechecked(self, MockClient, _fetch):
        from ..tasks import check_sms_delivery

        self._deliver(MockClient)
        row = self.Notification.objects.get(channel="sms")
        with patch("scheduler.tasks.check_sms_delivery.apply_async") as sched:
            check_sms_delivery(row.pk, "SMabc")
        row.refresh_from_db()
        self.assertEqual(row.status, "sent")
        sched.assert_not_called()

    @override_settings(**TWILIO_SETTINGS)
    @patch("scheduler.sms_delivery.fetch_outcome", return_value=("sent", None))
    @patch("twilio.rest.Client")
    def test_a_text_still_in_flight_is_rechecked_later_then_given_up_on(self, MockClient, _fetch):
        from ..tasks import check_sms_delivery
        from .. import sms_delivery

        self._deliver(MockClient)
        row = self.Notification.objects.get(channel="sms")
        with patch("scheduler.tasks.check_sms_delivery.apply_async") as sched:
            check_sms_delivery(row.pk, "SMabc", 0)
            self.assertEqual(sched.call_args.kwargs["args"], [row.pk, "SMabc", 1])
            sched.reset_mock()
            check_sms_delivery(row.pk, "SMabc", len(sms_delivery.RECHECK_DELAYS) - 1)
            sched.assert_not_called()
        row.refresh_from_db()
        self.assertEqual(row.status, "sent")

    def test_error_codes_map_to_fixed_text_only(self):
        from .. import sms_delivery

        self.assertIn("A2P", sms_delivery.describe_error(30034))
        self.assertEqual(sms_delivery.describe_error("nope"), sms_delivery.GENERIC_HELP)
        self.assertEqual(sms_delivery.describe_error(99999), sms_delivery.GENERIC_HELP)
