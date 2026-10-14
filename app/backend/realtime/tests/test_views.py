"""Tests for realtime app ViewSets."""

import re
from unittest.mock import patch
from urllib.parse import urlencode

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APITestCase

from accounts.models import Account
from realtime.models import AgentActivityEvent, VoiceSession
from realtime.views import _FIXED_HINTS
from realtime.voice_identity import IdentityError, read_identity_token
from team.models import TeamMember

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

    # ------------------------------------------------------------------
    # relay_token in the ConversationRelay URL (Bug 2 guard)
    #
    # ConversationRelayConsumer.connect() closes with code 4001 whenever
    # VOICE_RELAY_TOKEN is set and the token is missing/wrong, so the TwiML must
    # carry it as a query param or every production call's socket is rejected.
    # ------------------------------------------------------------------

    @override_settings(VOICE_RELAY_TOKEN="tok-123")
    def test_twiml_includes_relay_token_when_set(self):
        body = self._post().content.decode()
        self.assertIn("relay_token=tok-123", body)

    @override_settings(VOICE_RELAY_TOKEN="")
    def test_twiml_omits_relay_token_when_unset(self):
        body = self._post().content.decode()
        self.assertNotIn("relay_token", body)

    @override_settings(VOICE_RELAY_TOKEN="a b/c")
    def test_twiml_url_encodes_relay_token(self):
        # quote(token, safe="") → space becomes %20, "/" becomes %2F.
        body = self._post().content.decode()
        self.assertIn("relay_token=a%20b%2Fc", body)


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


class VoiceTwiMLIdentityTests(APITestCase):
    """
    The <Parameter name="identity_token"> that carries the caller's Django user to
    the relay consumer, and the ConversationRelay quality attributes.

    Same anon-throttle caveat as VoiceTwiMLViewTests — cache.clear() in setUp.
    """

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username="twiml_caller", password="pass")
        self.other = User.objects.create_user(username="twiml_other", password="pass")

    def _post(self, **form):
        body = urlencode(form)
        with patch("twilio.request_validator.RequestValidator.validate", return_value=True):
            return self.client.post(
                "/api/v1/realtime/voice/twiml/",
                data=body,
                content_type="application/x-www-form-urlencoded",
            )

    def _member(self, user):
        """A TeamMember row for `user` — Account.team_members is an M2M to team.TeamMember."""
        return TeamMember.objects.create(
            user=user, full_name=user.username, email=f"{user.username}@example.com"
        )

    def _param_value(self, body):
        match = re.search(r'<Parameter name="identity_token" value="([^"]+)"', body)
        return match.group(1) if match else None

    # ── identity parameter ────────────────────────────────────────────────────

    def test_client_identity_mints_a_readable_token(self):
        body = self._post(**{"From": f"client:{self.user.pk}", "CallSid": CALL_SID_ALICE}).content.decode()
        token = self._param_value(body)
        self.assertIsNotNone(token, body)
        self.assertEqual(read_identity_token(token, CALL_SID_ALICE), self.user.pk)

    def test_minted_token_is_bound_to_this_call_only(self):
        body = self._post(**{"From": f"client:{self.user.pk}", "CallSid": CALL_SID_ALICE}).content.decode()
        with self.assertRaises(IdentityError):
            read_identity_token(self._param_value(body), CALL_SID_BOB)

    def test_pstn_caller_gets_no_parameter_but_still_valid_twiml(self):
        response = self._post(**{"From": "+15551234567", "CallSid": CALL_SID_ALICE})
        body = response.content.decode()
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("<Parameter", body)
        self.assertIn("<ConversationRelay", body)

    def test_unknown_pk_gets_no_parameter_and_still_200(self):
        response = self._post(**{"From": f"client:{self.user.pk + 9999}", "CallSid": CALL_SID_ALICE})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("<Parameter", response.content.decode())

    def test_inactive_user_gets_no_parameter(self):
        self.user.is_active = False
        self.user.save(update_fields=["is_active"])
        response = self._post(**{"From": f"client:{self.user.pk}", "CallSid": CALL_SID_ALICE})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("<Parameter", response.content.decode())

    def test_missing_call_sid_gets_no_parameter(self):
        """A token with nothing to bind to would be replayable on any call."""
        response = self._post(**{"From": f"client:{self.user.pk}"})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("<Parameter", response.content.decode())

    # ── relay quality attributes ──────────────────────────────────────────────

    def test_relay_enables_dtmf_detection(self):
        """Required by the confirmation gate's "press 1" path."""
        body = self._post(**{"From": f"client:{self.user.pk}", "CallSid": CALL_SID_ALICE}).content.decode()
        self.assertIn('dtmfDetection="true"', body)

    def test_relay_is_interruptible_and_preemptible(self):
        body = self._post().content.decode()
        self.assertIn('interruptible="speech"', body)
        self.assertIn('preemptible="true"', body)
        self.assertIn('interruptSensitivity="medium"', body)

    def test_relay_reports_input_during_agent_speech(self):
        body = self._post().content.decode()
        self.assertIn('reportInputDuringAgentSpeech="true"', body)

    def test_relay_does_not_ignore_backchannel(self):
        """
        ignoreBackchannel would suppress "yeah" — the primary affirmative token the
        confirmation gate matches on. Asserted so nobody "optimizes" it back in.
        """
        self.assertNotIn("ignoreBackchannel", self._post().content.decode())

    def test_relay_does_not_enable_partial_prompts_or_profanity_filter(self):
        body = self._post().content.decode()
        self.assertNotIn("partialPrompts", body)
        self.assertNotIn("profanityFilter", body)

    def test_welcome_greeting_is_interruptible(self):
        self.assertIn('welcomeGreetingInterruptible="speech"', self._post().content.decode())

    @override_settings(VOICE_TTS_PROVIDER="", VOICE_STT_PROVIDER="")
    def test_vendor_providers_are_omitted_by_default(self):
        """No env change must mean no audible change."""
        body = self._post().content.decode()
        self.assertNotIn("ttsProvider", body)
        self.assertNotIn("transcriptionProvider", body)

    @override_settings(
        VOICE_TTS_PROVIDER="ElevenLabs",
        VOICE_TTS_VOICE="some-voice-id",
        VOICE_STT_PROVIDER="Deepgram",
        VOICE_STT_MODEL="nova-3-general",
    )
    def test_vendor_providers_are_emitted_when_configured(self):
        body = self._post().content.decode()
        self.assertIn('ttsProvider="ElevenLabs"', body)
        self.assertIn('voice="some-voice-id"', body)
        self.assertIn('transcriptionProvider="Deepgram"', body)
        self.assertIn('speechModel="nova-3-general"', body)

    # ── hints ─────────────────────────────────────────────────────────────────

    def test_hints_include_fixed_domain_vocabulary(self):
        body = self._post().content.decode()
        self.assertIn("hints=", body)
        self.assertIn("Agent PM", body)

    def test_hints_include_the_callers_accounts_and_not_another_users(self):
        mine = Account.objects.create(company_name="Zylotech Industries")
        theirs = Account.objects.create(company_name="Nobody Elses Corp")
        mine.team_members.add(self._member(self.user))
        theirs.team_members.add(self._member(self.other))

        body = self._post(**{"From": f"client:{self.user.pk}", "CallSid": CALL_SID_ALICE}).content.decode()
        self.assertIn("Zylotech Industries", body)
        self.assertNotIn("Nobody Elses Corp", body)

    @override_settings(VOICE_HINTS_MAX_CHARS=60)
    def test_hints_truncate_on_a_comma_boundary(self):
        body = self._post().content.decode()
        hints = re.search(r'hints="([^"]*)"', body).group(1)
        self.assertLessEqual(len(hints), 60)
        # No hint was cut mid-word: every emitted hint is a whole fixed hint.
        for hint in hints.split(","):
            self.assertIn(hint, _FIXED_HINTS)

    def test_hints_are_deduplicated_case_insensitively(self):
        account = Account.objects.create(company_name="airtable")
        account.team_members.add(self._member(self.user))
        body = self._post(**{"From": f"client:{self.user.pk}", "CallSid": CALL_SID_ALICE}).content.decode()
        hints = re.search(r'hints="([^"]*)"', body).group(1).split(",")
        lowered = [h.lower() for h in hints]
        self.assertEqual(len(lowered), len(set(lowered)))

    def test_account_names_containing_a_comma_do_not_split_into_two_hints(self):
        """Commas are the separator, so one would become two bogus hints."""
        account = Account.objects.create(company_name="Acme, Inc")
        account.team_members.add(self._member(self.user))
        body = self._post(**{"From": f"client:{self.user.pk}", "CallSid": CALL_SID_ALICE}).content.decode()
        hints = re.search(r'hints="([^"]*)"', body).group(1).split(",")
        self.assertIn("Acme Inc", hints)


class ResourceActivityFeedTests(APITestCase):
    """GET /realtime/activity/for-resource/ — every user's activity on one action item."""

    URL = "/api/v1/realtime/activity/for-resource/"

    def setUp(self):
        from airtable_sync.models import AirtableAccount, AirtableActionItem
        self.alice = User.objects.create_user(username="alice_feed", password="{PASSWORD}")
        self.bob = User.objects.create_user(username="bob_feed", password="{PASSWORD}", first_name="Bob", last_name="B")
        acct = AirtableAccount.objects.create(airtable_id="recFEED", name="Acme Corp")
        self.item = AirtableActionItem.objects.create(airtable_id="recItem1", account=acct, task="Fix it")
        admin = AirtableAccount.objects.create(airtable_id="recADM", name="Admin")
        self.private = AirtableActionItem.objects.create(
            airtable_id="recPriv", account=admin, task="Mine", assignee_airtable_id="usrBOB",
        )

    def _event(self, user, rid, title):
        return AgentActivityEvent.objects.create(
            user=user, event_type="action_item", title=title,
            metadata={"resource": {"type": "action_item", "id": rid}},
        )

    def test_unauthenticated_returns_401(self):
        self.assertEqual(self.client.get(self.URL, {"type": "action_item", "id": "recItem1"}).status_code, 401)

    def test_includes_other_users_events_with_actor(self):
        self._event(self.alice, "recItem1", "alice edit")
        self._event(self.bob, "recItem1", "bob reassigned")
        self._event(self.bob, "recOther", "unrelated")
        self.client.force_authenticate(user=self.alice)
        resp = self.client.get(self.URL, {"type": "action_item", "id": "recItem1"})
        self.assertEqual(resp.status_code, 200)
        by_title = {r["title"]: r for r in resp.data["results"]}
        self.assertEqual(set(by_title), {"alice edit", "bob reassigned"})
        self.assertEqual(by_title["bob reassigned"]["actor_display"], "Bob B")
        self.assertEqual(by_title["bob reassigned"]["actor_id"], self.bob.pk)

    def test_hidden_item_returns_empty(self):
        self._event(self.bob, "recPriv", "bob private")
        self.client.force_authenticate(user=self.alice)
        resp = self.client.get(self.URL, {"type": "action_item", "id": "recPriv"})
        self.assertEqual(resp.data["results"], [])

    def test_unknown_item_and_unsupported_type_return_empty(self):
        self._event(self.bob, "recNope", "ghost")
        self.client.force_authenticate(user=self.alice)
        self.assertEqual(self.client.get(self.URL, {"type": "action_item", "id": "recNope"}).data["results"], [])
        self.assertEqual(self.client.get(self.URL, {"type": "account", "id": "1"}).data["results"], [])
        self.assertEqual(self.client.get(self.URL).data["results"], [])

    def test_owner_scoped_list_is_unchanged(self):
        self._event(self.bob, "recItem1", "bob reassigned")
        self.client.force_authenticate(user=self.alice)
        titles = [e["title"] for e in self.client.get("/api/v1/realtime/activity/").data["results"]]
        self.assertNotIn("bob reassigned", titles)
