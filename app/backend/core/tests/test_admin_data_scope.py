"""`?scope=all` — the Admin Data page's unscoped read of shared tables (Admins only)."""

from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APITestCase

from realtime.models import VoiceSession
from salesforce_sync.models import SalesforceAccount
from team.models import Team, TeamMembership, UserProfile

User = get_user_model()


class AdminDataScopeTest(APITestCase):
    def setUp(self):
        cache.clear()
        self.admin = User.objects.create_user("scope_admin", password="{PASSWORD}", is_staff=True)
        UserProfile.objects.create(user=self.admin, staff_view_override=False)  # override off: still sees all with scope=all
        self.basic = User.objects.create_user("scope_basic", password="{PASSWORD}")
        UserProfile.objects.create(user=self.basic)
        other = User.objects.create_user("scope_other", password="{PASSWORD}")
        team = Team.objects.create(name="Remote")
        TeamMembership.objects.create(user=other, team=team, role="member")
        VoiceSession.objects.create(call_sid="CA1", user=None)
        SalesforceAccount.objects.create(sf_id="001A", name="Acme SF")

    def _count(self, user, url, scope=True):
        self.client.force_authenticate(user=user)
        resp = self.client.get(url, {"scope": "all"} if scope else {})
        self.assertEqual(resp.status_code, 200, resp.data)
        return resp.data["count"]

    def test_admin_sees_all_rows_with_scope_all(self):
        for url in ("/api/v1/team/teams/", "/api/v1/team/memberships/",
                    "/api/v1/realtime/voice-sessions/", "/api/v1/salesforce/accounts/"):
            self.assertEqual(self._count(self.admin, url), 1, url)

    def test_scope_all_is_ignored_for_non_admins(self):
        for url in ("/api/v1/team/teams/", "/api/v1/team/memberships/",
                    "/api/v1/realtime/voice-sessions/", "/api/v1/salesforce/accounts/"):
            self.assertEqual(self._count(self.basic, url), 0, url)

    def test_admin_without_scope_keeps_normal_scoping(self):
        self.assertEqual(self._count(self.admin, "/api/v1/team/memberships/", scope=False), 0)

    def test_membership_rows_carry_team_name(self):
        self.client.force_authenticate(user=self.admin)
        row = self.client.get("/api/v1/team/memberships/", {"scope": "all"}).data["results"][0]
        self.assertEqual(row["team_name"], "Remote")
