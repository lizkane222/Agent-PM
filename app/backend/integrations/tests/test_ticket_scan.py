"""Gmail ticket scanner: read-only, new-records-only, per-user."""

import base64
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from accounts.models import Account, AccountTicket
from integrations import ticket_scan
from integrations.models import SyncState
from team.models import Notification, TeamMember

User = get_user_model()


def _b64(s):
    return base64.urlsafe_b64encode(s.encode()).decode()


def make_msg(mid, sender, subject, body, thread=None, age_minutes=0):
    date = (timezone.now() - timedelta(minutes=age_minutes)).strftime("%a, %d %b %Y %H:%M:%S +0000")
    return {
        "internalDate": str(int((timezone.now() - timedelta(minutes=age_minutes)).timestamp() * 1000)),
        "id": mid, "threadId": thread or f"t-{mid}", "snippet": "snip",
        "payload": {
            "headers": [{"name": "From", "value": sender}, {"name": "Subject", "value": subject}, {"name": "Date", "value": date}],
            "mimeType": "text/plain", "body": {"data": _b64(body)},
        },
    }


class FakeGmail:
    """Only list/get exist: any send/modify/draft call raises AttributeError."""

    def __init__(self, msgs):
        self.msgs = {m["id"]: m for m in msgs}
        self.calls = []

    def users(self):
        return self

    def messages(self):
        return self

    def list(self, **kw):
        self.calls.append(("list", kw))
        import re as _re
        after = int(_re.search(r"after:(\d+)", kw["q"]).group(1))
        ids = [i for i, m in self.msgs.items() if int(m["internalDate"]) // 1000 >= after]
        return _Exec({"messages": [{"id": i} for i in reversed(ids)]})

    def get(self, **kw):
        self.calls.append(("get", kw["id"]))
        return _Exec(self.msgs[kw["id"]])


class _Exec:
    def __init__(self, v):
        self.v = v

    def execute(self):
        return self.v


JIRA_SENDER = "Jira <jira@acme.atlassian.net>"


class TicketScanTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("ts_u", "ts_u@example.com", "x")
        self.other = User.objects.create_user("ts_o", "ts_o@example.com", "x")
        self.acct = Account.objects.create(company_name="Globex Corporation")
        self.acct.team_members.add(TeamMember.objects.create(user=self.user, full_name="U", email="ts_u@example.com"))

    def run_scan(self, msgs, user=None):
        fake = FakeGmail(msgs)
        with patch("integrations.ticket_scan.build_gmail_service", return_value=fake):
            counts = ticket_scan.scan_user_tickets(user or self.user)
        return counts, fake

    def test_classify(self):
        c = ticket_scan.classify
        self.assertEqual(c(JIRA_SENDER, "hello"), "jira")
        self.assertEqual(c("a@b.com", "[JIRA] (ENG-123) Foo"), "jira")
        self.assertEqual(c("support@x.zendesk.com", "[Request #123] Hi"), "zendesk")
        self.assertEqual(c("a@b.com", "Product Gap: SSO"), "product_gap")
        self.assertEqual(c("a@b.com", "lunch?"), "")

    def test_matched_account_creates_confirmed(self):
        body = "Globex Corporation reported. https://acme.atlassian.net/browse/ENG-123 was created"
        counts, _ = self.run_scan([make_msg("m1", JIRA_SENDER, "[JIRA] (ENG-123) Globex login broken", body)])
        self.assertEqual(counts["created"], 1)
        t = AccountTicket.objects.get()
        self.assertEqual((t.account, t.kind, t.external_key, t.review_state), (self.acct, "jira", "ENG-123", "confirmed"))
        self.assertEqual(t.url, "https://acme.atlassian.net/browse/ENG-123")
        self.assertEqual(t.found_by, self.user)
        self.assertEqual(Notification.objects.count(), 0)

    def test_resolved_subject_sets_resolved(self):
        self.run_scan([make_msg("m1", JIRA_SENDER, "[JIRA] (ENG-5) Globex Corporation issue resolved", "x")])
        t = AccountTicket.objects.get()
        self.assertEqual(t.status, "resolved")
        self.assertIsNotNone(t.resolved_at)

    def test_unmatched_needs_review_with_single_notification(self):
        msgs = [make_msg("m1", "support@zd.zendesk.com", "[Request #555] Printer", "https://zd.zendesk.com/agent/tickets/555")]
        counts, _ = self.run_scan(msgs)
        self.assertEqual(counts["needs_review"], 1)
        t = AccountTicket.objects.get()
        self.assertIsNone(t.account)
        self.assertEqual((t.review_state, t.external_key, t.found_by), ("needs_review", "#555", self.user))
        n = Notification.objects.get()
        self.assertEqual((n.user, n.kind, n.link, n.title), (self.user, "ticket_review", "/profile#ticket-review", "New Zendesk ticket needs review"))
        self.run_scan(msgs)  # re-run: nothing new, no second notification
        self.assertEqual(Notification.objects.count(), 1)
        self.assertEqual(AccountTicket.objects.count(), 1)

    def test_update_email_for_existing_ticket_creates_nothing(self):
        AccountTicket.objects.create(account=self.acct, kind="jira", external_key="ENG-9", created_by=self.user)
        counts, _ = self.run_scan([make_msg("m2", JIRA_SENDER, "[JIRA] (ENG-9) Unknown co updated", "no account here")])
        self.assertEqual(counts["existing"], 1)
        self.assertEqual(AccountTicket.objects.count(), 1)
        self.assertEqual(Notification.objects.count(), 0)

    def test_rerun_dedupes_and_does_not_overwrite_edits(self):
        msgs = [make_msg("m1", JIRA_SENDER, "[JIRA] (ENG-1) Globex Corporation", "x")]
        self.run_scan(msgs)
        AccountTicket.objects.update(title="Edited by user", status="waiting")
        self.run_scan(msgs)
        t = AccountTicket.objects.get()
        self.assertEqual((t.title, t.status), ("Edited by user", "waiting"))

    def test_product_gap_thread_dedupe(self):
        self.run_scan([make_msg("a", "pm@x.com", "Product Gap: SSO for Globex Corporation", "x", thread="T1")])
        self.run_scan([make_msg("b", "pm@x.com", "Re: Product Gap: SSO for Globex Corporation", "x", thread="T1")])
        self.assertEqual(AccountTicket.objects.filter(kind="product_gap").count(), 1)

    def test_one_bad_message_does_not_stop_run(self):
        bad = make_msg("bad", JIRA_SENDER, "[JIRA] (ENG-2) Globex Corporation", "x")
        good = make_msg("good", JIRA_SENDER, "[JIRA] (ENG-3) Globex Corporation", "x")
        real = ticket_scan._handle_message

        def flaky(user, accounts, msg, counts):
            if msg["id"] == "bad":
                raise RuntimeError("secret email text")
            return real(user, accounts, msg, counts)

        with patch("integrations.ticket_scan._handle_message", side_effect=flaky):
            counts, _ = self.run_scan([bad, good])
        self.assertEqual((counts["failed"], counts["created"]), (1, 1))

    def test_per_user_isolation(self):
        # other user is not a member of Globex: same email becomes their own needs_review row
        msgs = [make_msg("m1", JIRA_SENDER, "[JIRA] (ENG-1) Globex Corporation", "x")]
        self.run_scan(msgs)
        self.run_scan(msgs, user=self.other)
        mine = AccountTicket.objects.get(found_by=self.user)
        theirs = AccountTicket.objects.get(found_by=self.other)
        self.assertEqual((mine.review_state, theirs.review_state, theirs.account), ("confirmed", "needs_review", None))
        self.assertEqual(Notification.objects.filter(user=self.other).count(), 1)
        self.assertEqual(Notification.objects.filter(user=self.user).count(), 0)

    def test_gmail_only_read_calls_and_watermark(self):
        _, fake = self.run_scan([make_msg("m1", JIRA_SENDER, "[JIRA] (ENG-1) Globex Corporation", "x")])
        self.assertEqual({c[0] for c in fake.calls}, {"list", "get"})
        state = SyncState.objects.get(user=self.user, resource="ticket_scan")
        self.assertIsNotNone(state.last_synced_at)
        self.assertIn("after:", fake.calls[0][1]["q"])

    def test_not_connected(self):
        with patch("integrations.ticket_scan.build_gmail_service", return_value=None):
            self.assertFalse(ticket_scan.scan_user_tickets(self.user)["connected"])

    def test_cap_resumes_without_loss(self):
        msgs = [make_msg(f"m{i:03d}", JIRA_SENDER, f"[JIRA] (ENG-{i + 1}) Globex Corporation", "x", age_minutes=(130 - i) * 10) for i in range(130)]
        counts, _ = self.run_scan(msgs)
        self.assertEqual(counts["created"], 100)
        counts, _ = self.run_scan(msgs)
        self.assertEqual(AccountTicket.objects.count(), 130)
