from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

User = get_user_model()


def _gmail():
    g = MagicMock()
    g.users().threads().list().execute.return_value = {"threads": [{"id": "t1"}]}
    g.users().threads().get().execute.return_value = {"messages": [{
        "id": "m1", "snippet": "hi",
        "payload": {"headers": [{"name": "From", "value": "A <a@x.com>"},
                                {"name": "Subject", "value": "S"},
                                {"name": "Date", "value": "d"}]},
    }]}
    return g


def _client():
    c = MagicMock()
    c.messages.create.return_value = SimpleNamespace(
        content=[SimpleNamespace(type="text", text='{"summary":"s","status":"Open","status_color":"gray","next_action":""}')],
        usage=SimpleNamespace(input_tokens=100, output_tokens=20),
    )
    return c


class GmailThreadsUsageTest(APITestCase):
    def setUp(self):
        self.a = User.objects.create_user("usage_a", password="x")
        self.b = User.objects.create_user("usage_b", password="x")

    def _run(self, user):
        self.client.force_authenticate(user)
        with patch("integrations.views.build_gmail_service", return_value=_gmail()), \
             patch("integrations.views.get_or_create_gmail_label", create=True, return_value=None), \
             patch("integrations.gmail_watch_utils.get_or_create_gmail_label", return_value=None), \
             patch("core.llm.build_sync_client", return_value=_client()), \
             patch("core.llm.model_for_tier", return_value="claude-haiku-4-5"):
            r = self.client.get("/api/v1/integrations/gmail/threads/", {"account_name": "Acme"})
        self.assertEqual(r.status_code, 200, r.content)

    def _stats(self, user):
        self.client.force_authenticate(user)
        return self.client.get("/api/v1/agents/sessions/token-stats/").json()

    def test_usage_counts_for_caller_only(self):
        self._run(self.a)
        a = self._stats(self.a)["all_time"]
        self.assertEqual((a["input_tokens"], a["output_tokens"], a["total_tokens"]), (100, 20, 120))
        self.assertEqual(self._stats(self.b)["all_time"]["total_tokens"], 0)

    def test_second_call_reuses_one_session(self):
        self._run(self.a)
        self._run(self.a)
        s = self._stats(self.a)
        self.assertEqual(s["all_time"]["total_tokens"], 240)
        self.assertEqual(len(s["by_session"]), 1)

    def test_recorder_never_raises(self):
        from agents.usage import record_llm_usage
        record_llm_usage(None, "x", SimpleNamespace(usage=None))
        record_llm_usage(self.a, "x", object())
