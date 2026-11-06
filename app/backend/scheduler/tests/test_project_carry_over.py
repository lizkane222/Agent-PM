"""A calendar block inherits the account-page project of the item it schedules."""
from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APITestCase

from accounts.models import Account, AccountProject
from scheduler.models import CalendarEvent
from team.models import TeamMember

User = get_user_model()
URL = "/api/v1/scheduler/events/"


def _user(name):
    return User.objects.create_user(username=name, email=f"{name}@example.com", password="pass")


def _member(user):
    return TeamMember.objects.create(user=user, full_name=user.username, email=user.email)


class ProjectCarryOverTest(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = _user("carry_user")
        self.account = Account.objects.create(company_name="Acme", airtable_id="recAcme")
        self.account.team_members.add(_member(self.user))
        self.client.force_authenticate(user=self.user)

    def _post(self, **extra):
        payload = {
            "title": "Work session",
            "start_datetime": "2026-12-01T10:00:00Z",
            "end_datetime": "2026-12-01T10:15:00Z",
            "calendar_id": "work_tracking",
            "is_synced": False,
        }
        payload.update(extra)
        return self.client.post(URL, payload, format="json")

    def test_item_filed_under_project_carries_project(self):
        p = AccountProject.objects.create(account=self.account, name="Rollout", action_ids=["recA"])
        resp = self._post(agentpm_airtable_id="recA")
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["project"], p.pk)
        self.assertEqual(resp.data["project_name"], "Rollout")
        self.assertEqual(CalendarEvent.objects.get(pk=resp.data["id"]).project_id, p.pk)

    def test_item_filed_under_goal_carries_parent_project(self):
        goal = AccountProject.objects.create(account=self.account, name="G", kind="goal", action_ids=["recB"])
        proj = AccountProject.objects.create(
            account=self.account, name="Parent", goal_ids=[str(goal.pk)]
        )
        resp = self._post(agentpm_airtable_id="recB")
        self.assertEqual(resp.data["project"], proj.pk)

    def test_goal_without_parent_project_carries_nothing(self):
        AccountProject.objects.create(account=self.account, name="G", kind="goal", action_ids=["recC"])
        resp = self._post(agentpm_airtable_id="recC")
        self.assertIsNone(resp.data["project"])

    def test_unfiled_item_has_no_project(self):
        AccountProject.objects.create(account=self.account, name="P", action_ids=["other"])
        self.assertIsNone(self._post(agentpm_airtable_id="recZ").data["project"])

    def test_meeting_filed_under_project_carries_project(self):
        p = AccountProject.objects.create(account=self.account, name="P", meeting_ids=["recM"])
        resp = self._post(calendar_id="primary", agentpm_airtable_id="recM", is_synced=False)
        self.assertEqual(resp.data["project"], p.pk)

    def test_other_users_project_is_never_attached(self):
        other_account = Account.objects.create(company_name="Other", airtable_id="recOther")
        other_account.team_members.add(_member(_user("carry_other")))
        secret = AccountProject.objects.create(account=other_account, name="Secret", action_ids=["recS"])
        resp = self._post(agentpm_airtable_id="recS")
        self.assertIsNone(resp.data["project"])
        resp = self._post(project=secret.pk)
        self.assertIsNone(resp.data["project"])

    def test_explicit_visible_project_is_honoured(self):
        p = AccountProject.objects.create(account=self.account, name="P")
        self.assertEqual(self._post(project=p.pk).data["project"], p.pk)

    def test_project_is_read_only_on_update(self):
        p = AccountProject.objects.create(account=self.account, name="P")
        ev = CalendarEvent.objects.create(
            owner=self.user, title="x", start_datetime="2026-12-01T10:00:00Z",
            end_datetime="2026-12-01T11:00:00Z", calendar_id="work_tracking",
        )
        self.client.patch(f"{URL}{ev.pk}/details/", {"project": p.pk, "title": "y"}, format="json")
        ev.refresh_from_db()
        self.assertIsNone(ev.project_id)

    def test_requires_auth(self):
        self.client.force_authenticate(user=None)
        self.assertEqual(self._post().status_code, 401)
