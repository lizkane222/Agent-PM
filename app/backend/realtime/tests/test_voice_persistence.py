"""
Tests for realtime.voice_persistence.

The load-bearing one is test_attach_does_not_clobber_status_callback_fields: the
status callback and the relay setup frame both update_or_create the same VoiceSession
row and race in both directions, so each side must write only its own fields.
"""

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from agents.models import AgentMessage, AgentSession, ToolCall
from realtime.models import VoiceSession
from realtime.voice_persistence import (
    VOICE_SESSION_TITLE_PREFIX,
    ToolCallRecord,
    append_transcript,
    attach_user_to_voice_session,
    close_agent_session,
    load_skill_inventory,
    open_agent_session,
    record_message,
    record_tool_calls,
)
from skills.models import AgentSkill

User = get_user_model()

CALL_SID = "CA" + "9" * 32


class AttachUserToVoiceSessionTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("voice-persist", password="pass")

    async def test_creates_the_row_when_the_relay_wins_the_race(self):
        await attach_user_to_voice_session(CALL_SID, self.user)
        session = await VoiceSession.objects.aget(call_sid=CALL_SID)
        self.assertEqual(session.user_id, self.user.pk)

    async def test_sets_user_on_an_existing_row(self):
        await VoiceSession.objects.acreate(call_sid=CALL_SID, from_number="+1", to_number="+2")
        await attach_user_to_voice_session(CALL_SID, self.user)
        session = await VoiceSession.objects.aget(call_sid=CALL_SID)
        self.assertEqual(session.user_id, self.user.pk)

    async def test_attach_does_not_clobber_status_callback_fields(self):
        """
        The status callback owns from_number/to_number/status/duration. Passing them
        here would blank whatever it had already written, in whichever order the two
        arrive.
        """
        await VoiceSession.objects.acreate(
            call_sid=CALL_SID,
            from_number="client:7",
            to_number="+15551234567",
            status="in_progress",
            duration_seconds=42,
        )
        await attach_user_to_voice_session(CALL_SID, self.user)
        session = await VoiceSession.objects.aget(call_sid=CALL_SID)
        self.assertEqual(session.from_number, "client:7")
        self.assertEqual(session.to_number, "+15551234567")
        self.assertEqual(session.status, "in_progress")
        self.assertEqual(session.duration_seconds, 42)

    async def test_blank_call_sid_is_a_noop(self):
        await attach_user_to_voice_session("", self.user)
        self.assertEqual(await VoiceSession.objects.acount(), 0)

    async def test_is_idempotent(self):
        await attach_user_to_voice_session(CALL_SID, self.user)
        await attach_user_to_voice_session(CALL_SID, self.user)
        self.assertEqual(await VoiceSession.objects.filter(call_sid=CALL_SID).acount(), 1)


class VoiceSessionBecomesVisibleTests(APITestCase):
    """Setting `user` is what makes VoiceSessionViewSet.get_queryset return anything."""

    URL = "/api/v1/realtime/voice-sessions/"

    def setUp(self):
        self.user = User.objects.create_user("visible-owner", password="pass")
        self.other = User.objects.create_user("visible-other", password="pass")
        VoiceSession.objects.create(call_sid=CALL_SID, from_number="c", to_number="t")

    def _count_for(self, user):
        self.client.force_authenticate(user=user)
        response = self.client.get(self.URL)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        return data["count"] if isinstance(data, dict) and "count" in data else len(data)

    def test_row_is_invisible_before_the_user_is_attached(self):
        self.assertEqual(self._count_for(self.user), 0)

    def test_row_is_visible_to_its_owner_after_attach(self):
        VoiceSession.objects.filter(call_sid=CALL_SID).update(user=self.user)
        self.assertEqual(self._count_for(self.user), 1)

    def test_row_stays_invisible_to_another_user(self):
        VoiceSession.objects.filter(call_sid=CALL_SID).update(user=self.user)
        self.assertEqual(self._count_for(self.other), 0)


class AgentSessionTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("voice-session", password="pass")

    async def test_open_creates_a_session_with_the_voice_title_prefix(self):
        session_id = await open_agent_session(self.user, CALL_SID)
        session = await AgentSession.objects.aget(pk=session_id)
        self.assertTrue(session.title.startswith(VOICE_SESSION_TITLE_PREFIX))
        self.assertIn(CALL_SID[-8:], session.title)
        self.assertEqual(session.status, "active")

    async def test_open_returns_none_without_a_user(self):
        self.assertIsNone(await open_agent_session(None, CALL_SID))
        self.assertEqual(await AgentSession.objects.acount(), 0)

    async def test_close_marks_completed_and_stamps_ended_at(self):
        session_id = await open_agent_session(self.user, CALL_SID)
        await close_agent_session(session_id)
        session = await AgentSession.objects.aget(pk=session_id)
        self.assertEqual(session.status, "completed")
        self.assertIsNotNone(session.ended_at)

    async def test_close_with_no_session_is_a_noop(self):
        await close_agent_session(None)


class RecordMessageTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("voice-msg", password="pass")
        self.session = AgentSession.objects.create(user=self.user, title="Voice: test")

    async def test_returns_a_pk_and_persists_token_counts(self):
        message_id = await record_message(self.session.pk, "assistant", "hello", 11, 7)
        message = await AgentMessage.objects.aget(pk=message_id)
        self.assertEqual(message.role, "assistant")
        self.assertEqual(message.content, "hello")
        self.assertEqual(message.input_tokens, 11)
        self.assertEqual(message.output_tokens, 7)

    async def test_returns_none_without_a_session(self):
        self.assertIsNone(await record_message(None, "user", "hi"))
        self.assertEqual(await AgentMessage.objects.acount(), 0)


class VoiceTokensReachTokenStatsTests(APITestCase):
    """
    Voice AgentMessages must roll up in AgentSessionViewSet.token_stats — that is
    what makes the per-user token accounting stay accurate once calls write messages.
    """

    URL = "/api/v1/agents/sessions/token-stats/"

    def setUp(self):
        self.user = User.objects.create_user("voice-tokens", password="pass")
        self.session = AgentSession.objects.create(
            user=self.user, title=f"{VOICE_SESSION_TITLE_PREFIX}abcd1234"
        )

    def test_voice_tokens_are_counted(self):
        self.client.force_authenticate(user=self.user)
        before = self.client.get(self.URL)
        self.assertEqual(before.status_code, 200)

        AgentMessage.objects.create(
            session=self.session, role="assistant", content="x",
            input_tokens=100, output_tokens=50,
        )
        after = self.client.get(self.URL)
        self.assertEqual(after.status_code, 200)
        self.assertNotEqual(before.json(), after.json())

    def test_route_exists_and_requires_auth(self):
        self.assertEqual(self.client.get(self.URL).status_code, 401)


class RecordToolCallsTests(TestCase):
    """ToolCall's first writer anywhere in the codebase."""

    def setUp(self):
        self.user = User.objects.create_user("voice-tools", password="pass")
        self.session = AgentSession.objects.create(user=self.user, title="Voice: test")
        self.message = AgentMessage.objects.create(
            session=self.session, role="assistant", content="x"
        )

    async def test_writes_rows_linked_to_the_message(self):
        written = await record_tool_calls(self.message.pk, [
            ToolCallRecord("search_records", {"query": "acme"}, result=[{"id": 1}], duration_ms=12),
            ToolCallRecord("get_airtable_records", {"table": "accounts"}, result=[], duration_ms=5),
        ])
        self.assertEqual(written, 2)
        rows = [row async for row in ToolCall.objects.filter(message=self.message)]
        self.assertEqual(len(rows), 2)
        self.assertEqual({r.tool_name for r in rows}, {"search_records", "get_airtable_records"})

    async def test_carries_status_arguments_and_duration(self):
        await record_tool_calls(self.message.pk, [
            ToolCallRecord("send_sms", {"to": "+1"}, status="error",
                           error_message="boom", duration_ms=7),
        ])
        row = await ToolCall.objects.aget(tool_name="send_sms")
        self.assertEqual(row.status, "error")
        self.assertEqual(row.error_message, "boom")
        self.assertEqual(row.arguments, {"to": "+1"})
        self.assertEqual(row.duration_ms, 7)

    async def test_writes_unlinked_rows_when_the_turn_raised(self):
        """A tool that already ran must be recorded even with no assistant message."""
        await record_tool_calls(None, [ToolCallRecord("search_records", {})])
        row = await ToolCall.objects.aget(tool_name="search_records")
        self.assertIsNone(row.message_id)

    async def test_empty_list_writes_nothing(self):
        self.assertEqual(await record_tool_calls(self.message.pk, []), 0)
        self.assertEqual(await ToolCall.objects.acount(), 0)

    async def test_non_json_serialisable_results_are_coerced(self):
        """Tool results contain datetimes; a raw one would break the JSONField write."""
        await record_tool_calls(self.message.pk, [
            ToolCallRecord("get_calendar_events", {}, result={"when": timezone.now()}),
        ])
        row = await ToolCall.objects.aget(tool_name="get_calendar_events")
        self.assertIsInstance(row.result["when"], str)

    async def test_negative_duration_is_clamped(self):
        await record_tool_calls(self.message.pk, [
            ToolCallRecord("search_records", {}, duration_ms=-5),
        ])
        row = await ToolCall.objects.aget(tool_name="search_records")
        self.assertEqual(row.duration_ms, 0)


class AppendTranscriptTests(TestCase):
    def setUp(self):
        self.session = VoiceSession.objects.create(
            call_sid=CALL_SID, from_number="c", to_number="t"
        )

    async def test_appends_in_order_across_calls(self):
        await append_transcript(CALL_SID, "user", "first")
        await append_transcript(CALL_SID, "assistant", "second")
        session = await VoiceSession.objects.aget(call_sid=CALL_SID)
        self.assertEqual(session.transcript, "user: first\nassistant: second")

    async def test_blank_content_is_skipped(self):
        await append_transcript(CALL_SID, "user", "")
        session = await VoiceSession.objects.aget(call_sid=CALL_SID)
        self.assertEqual(session.transcript, "")

    async def test_missing_session_is_a_noop(self):
        await append_transcript("CAnope", "user", "hi")


class LoadSkillInventoryTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("voice-skills", password="pass")
        AgentSkill.objects.create(
            name="get-notes", description="Pull the meeting notes for an account.",
            instructions="i", created_by=self.user,
            status="approved", visibility="public",
        )
        AgentSkill.objects.create(
            name="unreviewed", description="not approved",
            instructions="i", created_by=self.user,
            status="draft", visibility="public",
        )

    async def test_inventory_lists_approved_skills_with_descriptions(self):
        inventory = await load_skill_inventory(self.user)
        self.assertIn("get-notes", inventory)
        self.assertIn("Pull the meeting notes", inventory)

    async def test_inventory_excludes_unapproved_skills(self):
        self.assertNotIn("unreviewed", await load_skill_inventory(self.user))

    async def test_inventory_is_empty_without_a_user(self):
        self.assertEqual(await load_skill_inventory(None), "")

    @override_settings(VOICE_SKILL_INVENTORY_LIMIT=1)
    async def test_inventory_is_capped(self):
        await AgentSkill.objects.acreate(
            name="another", description="d", instructions="i",
            created_by=self.user, status="approved", visibility="public",
        )
        inventory = await load_skill_inventory(self.user)
        self.assertEqual(len(inventory.splitlines()), 1)

    @override_settings(VOICE_SKILL_DESCRIPTION_CHARS=10)
    async def test_descriptions_are_truncated(self):
        inventory = await load_skill_inventory(self.user)
        # Note the seeded get-meeting-notes skill (skills/migrations/0008) is public
        # and approved, so it is legitimately in here too — assert the per-line
        # property rather than a total length.
        self.assertGreaterEqual(len(inventory.splitlines()), 2)
        for line in inventory.splitlines():
            description = line.split("—", 1)[1].strip()
            self.assertLessEqual(len(description), 10, line)
