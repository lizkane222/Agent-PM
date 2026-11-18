from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APITestCase

from team.models import TeamMember

User = get_user_model()
URL = "/api/v1/integrations/slack/notify-mention/"


@override_settings(SLACK_BOT_TOKEN="xoxb-test")
class SlackNotifyMentionTest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("sender", "s@twilio.com", "pw", first_name="Sam", last_name="Sender")
        TeamMember.objects.create(full_name="Pat", email="p@twilio.com", slack_handle="@pat")

    def _client(self):
        c = MagicMock()
        c.users_list.return_value = {"members": [{"id": "U1", "name": "pat", "profile": {}}]}
        c.conversations_open.return_value = {"channel": {"id": "D1"}}
        return c

    def test_requires_login(self):
        self.assertEqual(self.client.post(URL, {"slack_handle": "pat", "message": "hi"}).status_code, 401)

    def test_unknown_handle_sends_nothing(self):
        self.client.force_authenticate(self.user)
        with patch("slack_sdk.WebClient") as wc:
            r = self.client.post(URL, {"slack_handle": "stranger", "message": "hi"}, format="json")
        self.assertEqual(r.status_code, 200)
        wc.assert_not_called()

    def test_oversized_message_refused(self):
        self.client.force_authenticate(self.user)
        r = self.client.post(URL, {"slack_handle": "pat", "message": "x" * 501}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_message_names_the_sender(self):
        self.client.force_authenticate(self.user)
        fake = self._client()
        with patch("slack_sdk.WebClient", return_value=fake):
            r = self.client.post(URL, {"slack_handle": "@pat", "message": "look"}, format="json")
        self.assertEqual(r.data["detail"], "Sent.")
        self.assertIn("Sam Sender mentioned you", fake.chat_postMessage.call_args.kwargs["text"])

    @override_settings(REST_FRAMEWORK={**__import__("django.conf").conf.settings.REST_FRAMEWORK,
                                       "DEFAULT_THROTTLE_RATES": {**__import__("django.conf").conf.settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"], "slack_dm": "2/hour"}})
    def test_rate_limited(self):
        from rest_framework.throttling import ScopedRateThrottle
        ScopedRateThrottle.THROTTLE_RATES = __import__("django.conf").conf.settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]
        self.client.force_authenticate(self.user)
        codes = [self.client.post(URL, {"slack_handle": "stranger", "message": "hi"}, format="json").status_code for _ in range(3)]
        self.assertEqual(codes[-1], 429)
