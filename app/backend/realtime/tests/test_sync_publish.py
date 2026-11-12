"""publish_activity_event: the live-feed push must survive the user's Sync list not existing yet."""

from unittest import mock

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from twilio.base.exceptions import TwilioRestException

from realtime.models import AgentActivityEvent
from realtime.sync import publish_activity_event


def _not_found():
    return TwilioRestException(404, "/Lists/agent-feed-1/Items", "The requested resource was not found")


@override_settings(TWILIO_SYNC_SERVICE_SID="IS123")
class PublishToSyncTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("liz", email="liz@example.com", password="x")
        self.client_mock = mock.MagicMock()
        patcher = mock.patch("realtime.sync._get_sync_client", return_value=self.client_mock)
        patcher.start()
        self.addCleanup(patcher.stop)
        svc = self.client_mock.sync.v1.services.return_value
        self.create_item = svc.sync_lists.return_value.sync_list_items.create
        self.create_list = svc.sync_lists.create

    def publish(self):
        publish_activity_event(self.user, "reminder", "⏰ Prep", detail="Slides")
        return AgentActivityEvent.objects.get()

    def test_publishes_when_the_list_exists(self):
        self.create_item.return_value.sid = "ET1"
        event = self.publish()
        self.create_list.assert_not_called()
        self.assertEqual(self.create_item.call_count, 1)
        self.assertEqual(event.sync_document_id, "ET1")

    def test_creates_the_list_and_retries_when_it_does_not_exist(self):
        ok = mock.MagicMock(sid="ET2")
        self.create_item.side_effect = [_not_found(), ok]
        event = self.publish()
        self.create_list.assert_called_once_with(unique_name=f"agent-feed-{self.user.pk}")
        self.assertEqual(self.create_item.call_count, 2)
        self.assertEqual(event.sync_document_id, "ET2")

    def test_does_not_create_a_list_for_other_errors(self):
        self.create_item.side_effect = TwilioRestException(500, "/x", "boom")
        event = self.publish()
        self.create_list.assert_not_called()
        self.assertEqual(self.create_item.call_count, 1)
        self.assertEqual(event.sync_document_id, "", "the event is still saved locally")

    def test_gives_up_quietly_if_the_retry_also_fails(self):
        self.create_item.side_effect = [_not_found(), _not_found()]
        event = self.publish()  # must not raise
        self.assertEqual(self.create_item.call_count, 2)
        self.assertEqual(event.sync_document_id, "")

    def test_a_failure_to_create_the_list_never_raises(self):
        self.create_item.side_effect = _not_found()
        self.create_list.side_effect = TwilioRestException(403, "/x", "no")
        self.publish()
