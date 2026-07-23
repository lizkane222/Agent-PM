"""Tests for team.TeamMemberViewSet — _staff_sees_all scoping and CRUD."""

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from team.models import Team, TeamMember, TeamMembership, UserProfile

User = get_user_model()

MEMBERS_URL = "/api/v1/team/members/"


def member_detail_url(pk):
    return f"/api/v1/team/members/{pk}/"


def _make_user(username, is_staff=False):
    user = User.objects.create_user(
        username=username, email=f"{username}@example.com", password="pass"
    )
    user.is_staff = is_staff
    user.save()
    if is_staff:
        UserProfile.objects.create(user=user, staff_view_override=True)
    return user


def _make_member(full_name="Test User", email=None):
    email = email or f"{full_name.lower().replace(' ', '.')}@example.com"
    return TeamMember.objects.create(full_name=full_name, email=email)


class TeamMemberListTest(APITestCase):
    """List endpoint — scoping and filters."""

    def setUp(self):
        self.staff = _make_user("staffuser", is_staff=True)
        self.user = _make_user("regularuser")

        # Create a shared team
        self.team = Team.objects.create(name="Alpha")
        TeamMembership.objects.create(user=self.staff, team=self.team)
        TeamMembership.objects.create(user=self.user, team=self.team)

        # Team members: one linked to user, one unlinked
        self.m1 = TeamMember.objects.create(
            full_name="Alice Smith", email="alice@example.com", user=self.user
        )
        self.m2 = TeamMember.objects.create(
            full_name="Bob Jones", email="bob@example.com"
        )
        self.m3 = TeamMember.objects.create(
            full_name="Carol White", email="carol@example.com"
        )

    def test_unauthenticated_returns_401(self):
        resp = self.client.get(MEMBERS_URL)
        self.assertEqual(resp.status_code, 401)

    def test_staff_sees_all_members(self):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.get(MEMBERS_URL)
        self.assertEqual(resp.status_code, 200)
        ids = [m["id"] for m in resp.data["results"]]
        self.assertIn(self.m1.id, ids)
        self.assertIn(self.m2.id, ids)
        self.assertIn(self.m3.id, ids)

    def test_non_staff_sees_own_and_shared_and_unlinked(self):
        self.client.force_authenticate(user=self.user)
        resp = self.client.get(MEMBERS_URL)
        self.assertEqual(resp.status_code, 200)
        ids = [m["id"] for m in resp.data["results"]]
        self.assertIn(self.m1.id, ids)   # own record
        self.assertIn(self.m2.id, ids)   # unlinked
        # m3 is a different unlinked member — also visible (unlinked members are shared)
        self.assertIn(self.m3.id, ids)

    def test_search_filter_by_name(self):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.get(MEMBERS_URL, {"search": "Alice"})
        self.assertEqual(resp.status_code, 200)
        names = [m["full_name"] for m in resp.data["results"]]
        self.assertIn("Alice Smith", names)
        self.assertNotIn("Bob Jones", names)


class TeamMemberWriteTest(APITestCase):
    """Create / update / delete — staff-only writes."""

    def setUp(self):
        self.staff = _make_user("staffwriter", is_staff=True)
        self.regular = _make_user("regularwriter")
        self.member = TeamMember.objects.create(
            full_name="Existing User", email="existing@example.com"
        )

    def test_non_staff_create_returns_403(self):
        self.client.force_authenticate(user=self.regular)
        resp = self.client.post(MEMBERS_URL, {
            "full_name": "New Person",
            "email": "new@example.com",
        }, format="json")
        self.assertEqual(resp.status_code, 403)

    def test_staff_can_create_member(self):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.post(MEMBERS_URL, {
            "full_name": "New Person",
            "email": "newperson@example.com",
        }, format="json")
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(TeamMember.objects.filter(email="newperson@example.com").exists())

    def test_non_staff_update_returns_403(self):
        self.client.force_authenticate(user=self.regular)
        resp = self.client.patch(member_detail_url(self.member.id), {"title": "Hack"}, format="json")
        self.assertEqual(resp.status_code, 403)

    def test_staff_can_update_member(self):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.patch(
            member_detail_url(self.member.id), {"title": "Senior Engineer"}, format="json"
        )
        self.assertEqual(resp.status_code, 200)
        self.member.refresh_from_db()
        self.assertEqual(self.member.title, "Senior Engineer")

    def test_non_staff_delete_returns_403(self):
        self.client.force_authenticate(user=self.regular)
        resp = self.client.delete(member_detail_url(self.member.id))
        self.assertEqual(resp.status_code, 403)

    def test_staff_can_delete_member(self):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.delete(member_detail_url(self.member.id))
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(TeamMember.objects.filter(pk=self.member.id).exists())
