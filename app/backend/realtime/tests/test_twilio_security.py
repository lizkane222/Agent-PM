"""Security regressions for the Twilio surface: transcript access, relay token, recordings, numbers."""

import asyncio
from unittest.mock import patch

from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import SimpleTestCase, TransactionTestCase, override_settings
from rest_framework.test import APITestCase

from core.phone_safety import check_number, is_sendable
from realtime.consumers import ConversationRelayConsumer, VoiceTranscriptConsumer
from realtime.models import VoiceSession

User = get_user_model()
SID = "CA" + "a" * 32
LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}


class PhoneSafetyTests(SimpleTestCase):
    def test_normal_numbers_pass(self):
        self.assertEqual(check_number("+1 (415) 555-0123"), "+14155550123")
        self.assertTrue(is_sendable("+442071838750"))

    def test_premium_and_satellite_ranges_blocked(self):
        for n in ("+19005551234", "+19765551234", "+8821234567", "+870123456", "+449012345678", "+447012345678"):
            self.assertFalse(is_sendable(n), n)

    def test_must_be_e164(self):
        for n in ("4155550123", "+0123", "abc", ""):
            self.assertFalse(is_sendable(n), n)

    @override_settings(TWILIO_ALLOWED_COUNTRY_CODES="1,44")
    def test_country_allow_list(self):
        self.assertTrue(is_sendable("+14155550123"))
        self.assertFalse(is_sendable("+4915112345678"))


class TranscriptOwnershipTests(TransactionTestCase):
    def setUp(self):
        self.owner = User.objects.create_user("owner", password="x")
        self.other = User.objects.create_user("other", password="x")
        self.admin = User.objects.create_user("adm", password="x", is_staff=True)

    def _connect(self, user):
        async def inner():
            comm = WebsocketCommunicator(VoiceTranscriptConsumer.as_asgi(), f"/ws/voice-transcript/{SID}/")
            comm.scope["url_route"] = {"kwargs": {"call_sid": SID}}
            comm.scope["user"] = user
            ok, code = await comm.connect()
            if ok:
                await comm.disconnect()
            return ok, code
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(inner())
        finally:
            loop.close()

    @override_settings(CHANNEL_LAYERS=LAYERS)
    def test_other_user_cannot_listen_to_a_call(self):
        VoiceSession.objects.create(call_sid=SID, user=self.owner)
        ok, code = self._connect(self.other)
        self.assertFalse(ok)
        self.assertEqual(code, 4003)

    @override_settings(CHANNEL_LAYERS=LAYERS)
    def test_owner_can_listen(self):
        VoiceSession.objects.create(call_sid=SID, user=self.owner)
        self.assertTrue(self._connect(self.owner)[0])


class RelayTokenRequiredTests(TransactionTestCase):
    @override_settings(VOICE_RELAY_TOKEN="", VOICE_RELAY_REQUIRE_TOKEN=True, CHANNEL_LAYERS=LAYERS)
    def test_unset_token_refuses_connection_in_production(self):
        async def inner():
            comm = WebsocketCommunicator(ConversationRelayConsumer.as_asgi(), "/ws/voice-relay/")
            return await comm.connect()
        loop = asyncio.new_event_loop()
        try:
            ok, code = loop.run_until_complete(inner())
        finally:
            loop.close()
        self.assertFalse(ok)
        self.assertEqual(code, 4001)


class RecordingCallbackTests(APITestCase):
    def setUp(self):
        cache.clear()
        VoiceSession.objects.create(call_sid=SID)

    def _post(self, url):
        with patch("twilio.request_validator.RequestValidator.validate", return_value=True):
            return self.client.post(
                "/api/v1/realtime/voice/recording/", {"CallSid": SID, "RecordingUrl": url},
            )

    def test_twilio_host_is_stored(self):
        self._post("https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1")
        self.assertTrue(VoiceSession.objects.get(call_sid=SID).recording_url.endswith(".mp3"))

    def test_foreign_host_is_ignored(self):
        self._post("https://evil.example.com/x")
        self.assertEqual(VoiceSession.objects.get(call_sid=SID).recording_url, "")

    def test_unsigned_request_rejected(self):
        r = self.client.post("/api/v1/realtime/voice/recording/", {"CallSid": SID, "RecordingUrl": "https://api.twilio.com/x"})
        self.assertIn(r.status_code, (403, 503))

    def test_bad_duration_does_not_500(self):
        with patch("twilio.request_validator.RequestValidator.validate", return_value=True):
            r = self.client.post("/api/v1/realtime/voice/status/", {"CallSid": SID, "CallStatus": "completed", "CallDuration": "abc"})
        self.assertEqual(r.status_code, 204)
