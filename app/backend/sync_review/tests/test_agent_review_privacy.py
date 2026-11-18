import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from accounts.models import Account
from sync_review import tasks
from sync_review.models import SyncReviewItem

User = get_user_model()


class AgentReviewPrivacyTest(TestCase):
    def setUp(self):
        User.objects.create_superuser("root", "root@twilio.com", "pw")
        self.acct = Account.objects.create(company_name="Acme")

    def _item(self, source):
        return SyncReviewItem.objects.create(
            source=source, source_id="1", content_type="email" if source == "gmail" else "ticket",
            raw_content={"subject": "Acme renewal", "snippet": "Acme"}, status="pending_agent")

    def _run(self, item):
        reply = json.dumps({"account_id": self.acct.pk, "confidence": 0.99, "reasoning": "Acme"})
        with patch.object(tasks, "_call_claude", return_value=reply), \
             patch("sync_review.views._write_local_record") as write:
            tasks.run_agent_review()
        item.refresh_from_db()
        return write

    def test_gmail_is_never_auto_filed(self):
        item = self._item("gmail")
        write = self._run(item)
        self.assertEqual(item.status, "pending_human")
        write.assert_not_called()

    def test_non_gmail_can_still_auto_file(self):
        item = self._item("zendesk")
        self._run(item)
        self.assertEqual(item.status, "accepted")

    def test_admin_workspaces_are_not_offered(self):
        Account.objects.create(company_name="Admin", is_admin_account=True)
        item = self._item("zendesk")
        captured = {}
        def fake(prompt):
            captured["p"] = prompt
            return json.dumps({"account_id": None, "confidence": 0})
        with patch.object(tasks, "_call_claude", side_effect=fake):
            tasks.run_agent_review()
        self.assertNotIn('"company_name": "Admin"', captured["p"])
