"""Tests for realtime app ViewSets."""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APITestCase

from realtime.models import AgentActivityEvent, VoiceSession

User = get_user_model()

CALL_SID_ALICE = "CA" + "a" * 32
CALL_SID_BOB = "CA" + "b" * 32
CONV_SID = "CH" + "c" * 32


class VoiceSessionViewSetTests(APITestCase):
    """
    VoiceSessionViewSet — unauthenticated returns 401, owner scoping,
    conversation_sid exposed in responses.
    """

    def setUp(self):
        self.alice = User.objects.create_user(username="alice_vs", password="pass")
        self.bob = User.objects.create_user(username="bob_vs", password="pass")
        self.alice_session = VoiceSession.objects.create(
            user=self.alice,
            call_sid=CALL_SID_ALICE,
            from_number="+15550001111",
            to_number="+15550002222",
            status="completed",
            conversation_sid=CONV_SID,
        )
        self.bob_session = VoiceSession.objects.create(
            user=self.bob,
            call_sid=CALL_SID_BOB,
            from_number="+15550003333",
            to_number="+15550004444",
            status="completed",
        )

    # ------------------------------------------------------------------
    # Auth
    # ------------------------------------------------------------------

    def test_list_unauthenticated_returns_401(self):
        response = self.client.get("/api/v1/realtime/voice-sessions/")
        self.assertEqual(response.status_code, 401)

    def test_detail_unauthenticated_returns_401(self):
        response = self.client.get(f"/api/v1/realtime/voice-sessions/{self.alice_session.pk}/")
        self.assertEqual(response.status_code, 401)

    # ------------------------------------------------------------------
    # Owner scoping
    # ------------------------------------------------------------------

    def test_list_returns_only_own_sessions(self):
        self.client.force_authenticate(user=self.alice)
        response = self.client.get("/api/v1/realtime/voice-sessions/")
        self.assertEqual(response.status_code, 200)
        results = response.data.get("results", response.data)
        sids = [s["call_sid"] for s in results]
        self.assertIn(CALL_SID_ALICE, sids)
        self.assertNotIn(CALL_SID_BOB, sids)

    def test_other_users_session_returns_404(self):
        self.client.force_authenticate(user=self.alice)
        response = self.client.get(f"/api/v1/realtime/voice-sessions/{self.bob_session.pk}/")
        self.assertEqual(response.status_code, 404)

    # ------------------------------------------------------------------
    # conversation_sid in response
    # ------------------------------------------------------------------

    def test_detail_includes_conversation_sid(self):
        self.client.force_authenticate(user=self.alice)
        response = self.client.get(f"/api/v1/realtime/voice-sessions/{self.alice_session.pk}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["conversation_sid"], CONV_SID)

    def test_detail_conversation_sid_blank_when_not_set(self):
        self.client.force_authenticate(user=self.bob)
        response = self.client.get(f"/api/v1/realtime/voice-sessions/{self.bob_session.pk}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["conversation_sid"], "")

    def test_list_includes_conversation_sid_field(self):
        self.client.force_authenticate(user=self.alice)
        response = self.client.get("/api/v1/realtime/voice-sessions/")
        self.assertEqual(response.status_code, 200)
        results = response.data.get("results", response.data)
        self.assertIn("conversation_sid", results[0])

    # ------------------------------------------------------------------
    # Read-only (no write operations allowed)
    # ------------------------------------------------------------------

    def test_create_not_allowed(self):
        self.client.force_authenticate(user=self.alice)
        response = self.client.post("/api/v1/realtime/voice-sessions/", {"call_sid": "CAxxx"})
        self.assertEqual(response.status_code, 405)


class VoiceTwiMLViewTests(APITestCase):
    """
    VoiceTwiMLView — returns ConversationRelay TwiML pointing to /ws/voice-relay/.
    """

    def setUp(self):
        # This endpoint is unauthenticated, so it draws on DRF's anon throttle bucket
        # (20/min) which is shared process-wide via LocMemCache. In a full-suite run
        # earlier tests exhaust it and these assertions see a 429 body instead of TwiML.
        cache.clear()

    def _post(self, **kwargs):
        """POST to /api/v1/realtime/voice/twiml/ with Twilio signature bypassed."""
        with patch("twilio.request_validator.RequestValidator.validate", return_value=True):
            return self.client.post(
                "/api/v1/realtime/voice/twiml/",
                content_type="application/x-www-form-urlencoded",
                **kwargs,
            )

    def test_returns_xml_content_type(self):
        response = self._post()
        self.assertEqual(response.status_code, 200)
        self.assertIn("application/xml", response.get("Content-Type", ""))

    def test_twiml_contains_conversation_relay(self):
        response = self._post()
        body = response.content.decode()
        self.assertIn("<ConversationRelay", body)
        self.assertIn("/ws/voice-relay/", body)

    def test_twiml_contains_connect_verb(self):
        response = self._post()
        body = response.content.decode()
        self.assertIn("<Connect>", body)

    def test_twiml_contains_welcome_greeting(self):
        response = self._post()
        body = response.content.decode()
        self.assertIn("welcomeGreeting", body)

    def test_invalid_twilio_signature_returns_403(self):
        response = self.client.post(
            "/api/v1/realtime/voice/twiml/",
            content_type="application/x-www-form-urlencoded",
        )
        self.assertIn(response.status_code, (403, 503))


class AgentActivityEventViewSetTests(APITestCase):
    """
    AgentActivityEventViewSet — auth, owner scoping, ?page_size= widening (so the
    activity-log restore can pull the full window in one request), and the
    comment_reply event type validating as a choice.
    """

    URL = "/api/v1/realtime/activity/"

    def setUp(self):
        self.alice = User.objects.create_user(username="alice_act", password="pass")
        self.bob = User.objects.create_user(username="bob_act", password="pass")

    def test_list_unauthenticated_returns_401(self):
        self.assertEqual(self.client.get(self.URL).status_code, 401)

    def test_list_returns_only_own_events(self):
        AgentActivityEvent.objects.create(user=self.alice, event_type="action_item", title="mine")
        AgentActivityEvent.objects.create(user=self.bob, event_type="action_item", title="theirs")
        self.client.force_authenticate(user=self.alice)
        response = self.client.get(self.URL)
        self.assertEqual(response.status_code, 200)
        titles = [e["title"] for e in response.data["results"]]
        self.assertIn("mine", titles)
        self.assertNotIn("theirs", titles)

    def test_default_page_size_is_capped_at_50(self):
        for i in range(60):
            AgentActivityEvent.objects.create(user=self.alice, event_type="action_item", title=f"e{i}")
        self.client.force_authenticate(user=self.alice)
        response = self.client.get(self.URL)
        self.assertEqual(response.status_code, 200)
        # The global default pagination ignores ?page_size and caps the page at 50.
        self.assertEqual(len(response.data["results"]), 50)

    def test_page_size_param_widens_the_page(self):
        for i in range(60):
            AgentActivityEvent.objects.create(user=self.alice, event_type="action_item", title=f"e{i}")
        self.client.force_authenticate(user=self.alice)
        response = self.client.get(self.URL, {"page_size": 500})
        self.assertEqual(response.status_code, 200)
        # ClientPageSizePagination honours ?page_size= so the whole window comes back at once.
        self.assertEqual(len(response.data["results"]), 60)

    def test_comment_reply_event_type_is_a_valid_choice(self):
        self.client.force_authenticate(user=self.alice)
        response = self.client.post(
            self.URL,
            {
                "event_type": "comment_reply",
                "title": "New reply on your comment",
                "client_id": "reply-xyz",
                "client_ts": 1000,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(
            AgentActivityEvent.objects.filter(user=self.alice, event_type="comment_reply").exists()
        )
