"""Token usage from meeting-notes and skill LLM calls lands on the right user."""
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from airtable_sync.models import AirtableMeeting
from integrations import meeting_notes
from integrations.models import OAuthCredential
from integrations.tests.test_meeting_notes import (
    GONG_FROM, RECAP_BODY, FakeGmail, gmail_message, rfc2822,
)

User = get_user_model()


def _client(text="Recap\n- Talked pricing", i=100, o=20):
    c = MagicMock()
    c.messages.create.return_value = SimpleNamespace(
        content=[SimpleNamespace(type="text", text=text)],
        usage=SimpleNamespace(input_tokens=i, output_tokens=o),
    )
    return c


def _stats(client, user):
    client.force_authenticate(user)
    return client.get("/api/v1/agents/sessions/token-stats/").json()


class MeetingNotesUsageTest(TestCase):
    def setUp(self):
        p = patch("airtable_sync.write_back.get_table")
        p.start()
        self.addCleanup(p.stop)
        self.a = User.objects.create_user("mn_a", password="x", is_staff=True)
        self.b = User.objects.create_user("mn_b", password="x", is_staff=True)
        self.at = timezone.now() - timedelta(hours=3)
        AirtableMeeting.objects.create(airtable_id="recU1", name="Acme Q3 Planning", date=self.at)

    def _msgs(self):
        return [gmail_message(
            "m1", "Acme Q3 Planning: Call recording and analysis is ready", GONG_FROM,
            rfc2822(self.at + timedelta(hours=1)), RECAP_BODY)]

    def _scan(self, user, client):
        with patch("core.llm.build_sync_client", return_value=client), \
             patch("core.llm.model_for_tier", return_value="claude-sonnet-4-6"):
            return meeting_notes.sync_meeting_notes_from_email(user, gmail=FakeGmail(self._msgs()))

    def _total(self, user):
        from agents.models import AgentMessage
        return sum(m.input_tokens + m.output_tokens for m in
                   AgentMessage.objects.filter(session__user=user, role="assistant"))

    def test_scan_records_for_scanned_user_only(self):
        self._scan(self.a, _client())
        self.assertEqual(self._total(self.a), 120)
        self.assertEqual(self._total(self.b), 0)

    def test_repeat_calls_reuse_one_session(self):
        from agents.models import AgentSession
        with patch("core.llm.build_sync_client", return_value=_client()), \
             patch("core.llm.model_for_tier", return_value="m"):
            meeting_notes.summarize_email("Body text " * 10, "M", "gong", user=self.a)
            meeting_notes.summarize_email("Body text " * 10, "M", "gong", user=self.a)
        self.assertEqual(self._total(self.a), 240)
        sessions = AgentSession.objects.filter(user=self.a)
        self.assertEqual(sessions.count(), 1)
        self.assertEqual(sessions.first().title, "AI usage: Meeting notes")

    def test_llm_failure_records_nothing_and_falls_back(self):
        c = MagicMock()
        c.messages.create.side_effect = RuntimeError("down")
        with patch("core.llm.build_sync_client", return_value=c), \
             patch("core.llm.model_for_tier", return_value="m"):
            out = meeting_notes.summarize_email(RECAP_BODY, "M", "gong", user=self.a)
        self.assertTrue(out)
        self.assertEqual(self._total(self.a), 0)

    def test_celery_task_attributes_per_user(self):
        from integrations import tasks
        for u in (self.a, self.b):
            OAuthCredential.objects.create(user=u, provider="google", is_active=True)

        def fake_sync(user, **kw):
            meeting_notes.summarize_email("Body text " * 10, "M", "gong", user=user)
            return {"updated": []}

        with patch("core.llm.build_sync_client", return_value=_client()), \
             patch("core.llm.model_for_tier", return_value="m"), \
             patch("integrations.meeting_notes.sync_meeting_notes_from_email", side_effect=fake_sync), \
             patch("integrations.meeting_notes.notify_notes_added"):
            tasks.check_meeting_notes_all_users()
        self.assertEqual(self._total(self.a), 120)
        self.assertEqual(self._total(self.b), 120)


class SkillUsageTest(APITestCase):
    def setUp(self):
        self.a = User.objects.create_user("sk_a", password="x")
        self.b = User.objects.create_user("sk_b", password="x")

    def test_generate_records_for_caller_only_and_stats_shape(self):
        text = '{"name":"n","description":"d","instructions":"i","allowed_tools":[]}'
        self.client.force_authenticate(self.a)
        with patch("skills.views.build_sync_client", return_value=_client(text)), \
             patch("skills.views.model_for_tier", return_value="m"):
            for _ in range(2):
                r = self.client.post("/api/v1/skills/agent-skills/generate/", {"description": "do x"}, format="json")
                self.assertEqual(r.status_code, 200, r.content)
        s = _stats(self.client, self.a)
        self.assertEqual(s["all_time"]["total_tokens"], 240)
        self.assertEqual(len(s["by_session"]), 1)
        self.assertEqual(_stats(self.client, self.b)["all_time"]["total_tokens"], 0)
        self.assertTrue({"input_tokens", "output_tokens", "total_tokens"} <= set(s["all_time"]))

    def test_failed_generate_records_nothing(self):
        c = MagicMock()
        c.messages.create.side_effect = RuntimeError("x")
        self.client.force_authenticate(self.a)
        with patch("skills.views.build_sync_client", return_value=c), \
             patch("skills.views.model_for_tier", return_value="m"):
            r = self.client.post("/api/v1/skills/agent-skills/generate/", {"description": "do x"}, format="json")
        self.assertEqual(r.status_code, 502)
        self.assertEqual(_stats(self.client, self.a)["all_time"]["total_tokens"], 0)
