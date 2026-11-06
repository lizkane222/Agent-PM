"""Per-account Activity Log endpoint: categories, counts, and cross-user refusal."""
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import Account
from agents.models import AgentMessage, AgentSession
from comments.models import Comment
from feedback.models import Feedback
from realtime.models import AgentActivityEvent
from scheduler.models import CalendarEvent, Reminder
from team.models import Notification
from team.notifications import account_for_resource, record_notification

User = get_user_model()


def url(a):
    return f"/api/v1/accounts/accounts/{a.pk}/activity-log/"


class AccountActivityLogTest(APITestCase):
    def setUp(self):
        self.u1 = User.objects.create_user("al1", "al1@example.com", "pw")
        self.u2 = User.objects.create_user("al2", "al2@example.com", "pw")
        self.acct = Account.objects.create(company_name="Acme Widgets", admin_owner=self.u1)
        self.other = Account.objects.create(company_name="Other Co", admin_owner=self.u2)
        now = timezone.now()
        AgentActivityEvent.objects.create(user=self.u1, event_type="account", title="Renamed",
                                          metadata={"resource": {"type": "account", "id": self.acct.pk}})
        CalendarEvent.objects.create(owner=self.u1, account=self.acct, title="QBR",
                                     start_datetime=now, end_datetime=now + timedelta(hours=1))
        Comment.objects.create(author=self.u1, resource_type="account", resource_id=self.acct.pk,
                               resource_label="Acme", content="hello")
        record_notification(self.u1, "in_app", "meeting_notes", "Notes in", account=self.acct)
        record_notification(self.u1, "in_app", "reminder", "Unrelated")
        Reminder.objects.create(created_by=self.u1, title="Call them", due_at=now,
                                resource_type="account", resource_id=self.acct.pk)
        Feedback.objects.create(author=self.u1, description="bug", page_url=f"http://x/accounts/{self.acct.pk}")
        Feedback.objects.create(author=self.u1, description="other page",
                                page_url=f"http://x/accounts/{self.acct.pk}9")
        s = AgentSession.objects.create(user=self.u1, title="Plan Acme Widgets renewal")
        AgentMessage.objects.create(session=s, role="user", content="x", input_tokens=10, output_tokens=5)

    def test_requires_auth(self):
        self.assertEqual(self.client.get(url(self.acct)).status_code, 401)

    def test_counts_cover_every_category(self):
        self.client.force_authenticate(self.u1)
        d = self.client.get(url(self.acct)).json()
        self.assertEqual(d["counts"], {
            "activity": 1, "events": 1, "comments": 1, "notifications": 1,
            "reminders": 1, "feedback": 1, "tokens": 1,
        })
        self.assertEqual(len(d["results"]), 7)
        tokens = [r for r in d["results"] if r["category"] == "tokens"][0]
        self.assertIn("10 input / 5 output", tokens["body"])

    def test_category_filter(self):
        self.client.force_authenticate(self.u1)
        d = self.client.get(url(self.acct) + "?category=notifications").json()
        self.assertEqual([r["title"] for r in d["results"]], ["Notes in"])
        self.assertEqual(d["counts"]["events"], 1)

    def test_other_user_cannot_read_account(self):
        self.client.force_authenticate(self.u2)
        self.assertEqual(self.client.get(url(self.acct)).status_code, 404)

    def test_personal_categories_never_leak_to_a_teammate(self):
        self.acct.team_members.add(self._member(self.u2))
        self.client.force_authenticate(self.u2)
        d = self.client.get(url(self.acct)).json()
        for c in ("events", "notifications", "reminders", "feedback", "tokens"):
            self.assertEqual(d["counts"][c], 0, c)
        # shared categories are visible to someone who can see the account
        self.assertEqual(d["counts"]["comments"], 1)
        self.assertEqual(d["counts"]["activity"], 1)

    def test_staff_do_not_see_other_users_personal_rows(self):
        staff = User.objects.create_user("al3", "al3@example.com", "pw", is_staff=True)
        self.client.force_authenticate(staff)
        r = self.client.get(url(self.acct))
        if r.status_code == 200:
            d = r.json()
            for c in ("events", "notifications", "reminders", "feedback", "tokens"):
                self.assertEqual(d["counts"][c], 0, c)

    def test_other_accounts_rows_are_excluded(self):
        record_notification(self.u1, "in_app", "x", "For other", account=self.other)
        self.client.force_authenticate(self.u1)
        d = self.client.get(url(self.acct) + "?category=notifications").json()
        self.assertEqual([r["title"] for r in d["results"]], ["Notes in"])

    def test_account_for_resource_and_backfill_helpers(self):
        self.assertEqual(account_for_resource("account", self.acct.pk), self.acct)
        self.assertIsNone(account_for_resource("account", "abc"))
        self.assertEqual(Notification.objects.get(title="Notes in").account, self.acct)

    def _member(self, user):
        from team.models import TeamMember
        return TeamMember.objects.create(full_name=user.username, email=user.email, user=user)
