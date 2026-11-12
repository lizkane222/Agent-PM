"""AccountTicket REST API, link parsing, and comment visibility."""

from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APITestCase

from accounts.models import Account, AccountTicket
from accounts.ticket_links import find_ticket_url, parse_ticket_url
from comments.models import Comment
from team.models import TeamMember

User = get_user_model()
URL = "/api/v1/accounts/tickets/"


def _member(account, user):
    account.team_members.add(TeamMember.objects.create(user=user, full_name=user.username, email=f"{user.username}@example.com"))


class TicketLinksTest(APITestCase):
    def test_jira_urls(self):
        self.assertEqual(parse_ticket_url("https://acme.atlassian.net/browse/ENG-1234"), {"kind": "jira", "external_key": "ENG-1234"})
        self.assertEqual(parse_ticket_url("https://acme.atlassian.net/jira/software/projects/ENG/boards/1?selectedIssue=ENG-77")["external_key"], "ENG-77")

    def test_zendesk_urls(self):
        self.assertEqual(parse_ticket_url("https://acme.zendesk.com/agent/tickets/48213"), {"kind": "zendesk", "external_key": "#48213"})
        self.assertEqual(parse_ticket_url("https://acme.zendesk.com/hc/en-us/articles/1")["kind"], "zendesk")

    def test_unknown_and_unsafe(self):
        self.assertEqual(parse_ticket_url("https://example.com/x")["kind"], "")
        self.assertEqual(parse_ticket_url("javascript:alert(1)")["kind"], "")

    def test_find_in_text(self):
        text = "see https://example.com and https://acme.atlassian.net/browse/ENG-5."
        self.assertEqual(find_ticket_url(text, "jira"), "https://acme.atlassian.net/browse/ENG-5")


class TicketApiTest(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user("tk_u", "tk_u@example.com", "x")
        self.other = User.objects.create_user("tk_o", "tk_o@example.com", "x")
        self.account = Account.objects.create(company_name="Ticket Co")
        _member(self.account, self.user)
        self.client.force_authenticate(user=self.user)

    def _mk(self, **kw):
        base = dict(account=self.account, kind="jira", external_key="ENG-1", title="t", created_by=self.user)
        base.update(kw)
        return AccountTicket.objects.create(**base)

    def test_unauthenticated(self):
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get(URL).status_code, 401)

    def test_member_crud(self):
        r = self.client.post(URL, {"account": self.account.id, "url": "https://acme.atlassian.net/browse/ENG-9", "notes": "<script>x</script><p>ok</p>"}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual((r.data["kind"], r.data["external_key"], r.data["status"]), ("jira", "ENG-9", "open"))
        self.assertNotIn("<script", r.data["notes"])
        self.assertEqual(r.data["account_name"], "Ticket Co")
        self.assertEqual(r.data["created_by_username"], "tk_u")
        tid = r.data["id"]
        self.assertEqual(len(self.client.get(f"{URL}?account={self.account.id}&kind=jira").data["results"]), 1)
        self.assertEqual(self.client.get(f"{URL}?kind=zendesk").data["results"], [])
        self.assertEqual(self.client.patch(f"{URL}{tid}/", {"title": "New"}, format="json").status_code, 200)
        self.assertEqual(self.client.delete(f"{URL}{tid}/").status_code, 204)

    def test_create_requires_kind_or_known_link(self):
        r = self.client.post(URL, {"account": self.account.id, "title": "x"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_rejects_non_http_url(self):
        r = self.client.post(URL, {"account": self.account.id, "kind": "jira", "url": "javascript:alert(1)"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_non_member_cannot_create_or_see(self):
        t = self._mk()
        self.client.force_authenticate(user=self.other)
        self.assertEqual(self.client.post(URL, {"account": self.account.id, "kind": "jira"}, format="json").status_code, 403)
        self.assertEqual(self.client.get(f"{URL}{t.id}/").status_code, 404)
        self.assertEqual(self.client.patch(f"{URL}{t.id}/", {"title": "x"}, format="json").status_code, 404)
        self.assertEqual(self.client.delete(f"{URL}{t.id}/").status_code, 404)
        self.assertEqual(self.client.get(URL).data["results"], [])

    def test_resolved_at_automation(self):
        t = self._mk()
        r = self.client.patch(f"{URL}{t.id}/", {"status": "resolved"}, format="json")
        self.assertIsNotNone(r.data["resolved_at"])
        r = self.client.patch(f"{URL}{t.id}/", {"status": "open"}, format="json")
        self.assertIsNone(r.data["resolved_at"])
        r = self.client.patch(f"{URL}{t.id}/", {"status": "closed", "resolved_at": "2026-01-02T03:04:05Z"}, format="json")
        self.assertTrue(r.data["resolved_at"].startswith("2026-01-02T03:04:05"))

    def test_needs_review_visible_only_to_finder_and_assignable(self):
        t = AccountTicket.objects.create(account=None, kind="jira", external_key="ENG-3", review_state="needs_review", found_by=self.user)
        self.assertEqual(self.client.get(URL).data["results"], [])  # default list is confirmed only
        self.assertEqual([x["id"] for x in self.client.get(f"{URL}?review=needs_review").data["results"]], [t.id])
        self.client.force_authenticate(user=self.other)
        self.assertEqual(self.client.get(f"{URL}?review=needs_review").data["results"], [])
        self.assertEqual(self.client.post(f"{URL}{t.id}/assign/", {"account": self.account.id}, format="json").status_code, 404)
        staff = User.objects.create_user("tk_s", "s@example.com", "x", is_staff=True)
        self.client.force_authenticate(user=staff)
        self.assertEqual(self.client.get(f"{URL}{t.id}/").status_code, 404)
        self.client.force_authenticate(user=self.user)
        r = self.client.post(f"{URL}{t.id}/assign/", {"account": self.account.id, "kind": "zendesk", "title": "Hi"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((r.data["review_state"], r.data["kind"], r.data["title"]), ("confirmed", "zendesk", "Hi"))
        self.assertEqual(self.client.post(f"{URL}{t.id}/assign/", {"account": self.account.id}, format="json").status_code, 404)

    def test_assign_to_foreign_account_refused(self):
        t = AccountTicket.objects.create(account=None, kind="jira", review_state="needs_review", found_by=self.user)
        foreign = Account.objects.create(company_name="Foreign")
        self.assertEqual(self.client.post(f"{URL}{t.id}/assign/", {"account": foreign.id}, format="json").status_code, 403)

    def test_finder_can_dismiss(self):
        t = AccountTicket.objects.create(account=None, kind="jira", review_state="needs_review", found_by=self.user)
        self.assertEqual(self.client.delete(f"{URL}{t.id}/").status_code, 204)

    def test_comment_visibility(self):
        t = self._mk()
        review = AccountTicket.objects.create(account=None, kind="jira", review_state="needs_review", found_by=self.user)
        Comment.objects.create(author=self.user, resource_type="account_ticket", resource_id=t.id, content="hi")
        c = "/api/v1/comments/comments/"
        r = self.client.get(f"{c}?resource_type=account_ticket&resource_id={t.id}")
        self.assertEqual(len(r.data["results"]), 1)
        s = self.client.get(f"{c}summary/?resource_type=account_ticket&resource_ids={t.id}")
        self.assertEqual(s.data["results"][str(t.id)]["count"], 1)
        staff = User.objects.create_user("tk_s2", "s2@example.com", "x", is_staff=True)
        self.client.force_authenticate(user=self.other)
        self.assertEqual(self.client.get(f"{c}?resource_type=account_ticket&resource_id={t.id}").data["results"], [])
        self.client.force_authenticate(user=staff)
        self.assertEqual(self.client.get(f"{c}?resource_type=account_ticket&resource_id={review.id}").data["results"], [])
