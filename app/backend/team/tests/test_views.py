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


# ── Calendar color preferences ────────────────────────────────────────────────

PROFILE_ME_URL = "/api/v1/team/profiles/me/"


class CalendarColorsTest(APITestCase):
    """`UserProfile.calendar_colors` — per-user calendar appearance.

    Holds both the color chosen per event type and the per-event "important"
    overrides set from the calendar's right-click menu. Colors are validated by
    format rather than against a fixed palette, so the UI can offer new palettes
    without a backend change; event *type* names are validated, because a typo
    there would silently never apply.
    """

    def setUp(self):
        self.user = _make_user("colors_user")
        self.client.force_authenticate(user=self.user)

    def _patch(self, colors):
        return self.client.patch(PROFILE_ME_URL, {"calendar_colors": colors}, format="json")

    def test_requires_auth(self):
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get(PROFILE_ME_URL).status_code, 401)

    def test_defaults_to_empty_dict(self):
        resp = self.client.get(PROFILE_ME_URL)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["calendar_colors"], {})

    def test_patch_stores_category_colors(self):
        resp = self._patch({"categories": {"meeting": "#C3D3E0", "task": "#F2A2BD"}})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            resp.data["calendar_colors"]["categories"],
            {"meeting": "#C3D3E0", "task": "#F2A2BD"},
        )

    def test_patch_round_trips_on_get(self):
        self._patch({"categories": {"focus_time": "#82BFB7"}})
        resp = self.client.get(PROFILE_ME_URL)
        self.assertEqual(resp.data["calendar_colors"], {"categories": {"focus_time": "#82BFB7"}})

    def test_action_item_is_a_valid_type(self):
        """Action items are not an event_category but are still colorable."""
        self.assertEqual(self._patch({"categories": {"action_item": "#CFC1D8"}}).status_code, 200)

    def test_patch_stores_important_overrides(self):
        resp = self._patch({"important": {"gcal-event-123": "#842D78"}})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["calendar_colors"]["important"], {"gcal-event-123": "#842D78"})

    def test_both_sections_together(self):
        resp = self._patch({
            "categories": {"meeting": "#C3D3E0"},
            "important": {"scheduled-recABC": "#E5A836"},
        })
        self.assertEqual(resp.status_code, 200)

    def test_rejects_unknown_top_level_key(self):
        resp = self._patch({"categories": {}, "themes": {"a": "#000000"}})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("themes", str(resp.data))

    def test_rejects_unknown_event_type(self):
        resp = self._patch({"categories": {"brunch": "#F2A2BD"}})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("brunch", str(resp.data))

    def test_rejects_malformed_hex(self):
        for bad in ["F2A2BD", "#F2A2B", "#GGGGGG", "red", "#f2a2bd88"]:
            with self.subTest(color=bad):
                self.assertEqual(self._patch({"categories": {"task": bad}}).status_code, 400)

    def test_accepts_lowercase_hex(self):
        self.assertEqual(self._patch({"categories": {"task": "#f2a2bd"}}).status_code, 200)

    def test_rejects_non_string_color(self):
        self.assertEqual(self._patch({"categories": {"task": 123}}).status_code, 400)

    def test_rejects_non_dict_payload(self):
        self.assertEqual(self._patch(["#F2A2BD"]).status_code, 400)

    def test_rejects_non_dict_section(self):
        self.assertEqual(self._patch({"categories": "#F2A2BD"}).status_code, 400)

    def test_rejects_oversized_important_map(self):
        from team.serializers import UserProfileSerializer

        over = {f"uid-{i}": "#842D78" for i in range(UserProfileSerializer.IMPORTANT_COLOR_LIMIT + 1)}
        self.assertEqual(self._patch({"important": over}).status_code, 400)

    def test_accepts_important_map_at_the_limit(self):
        from team.serializers import UserProfileSerializer

        at_limit = {f"uid-{i}": "#842D78" for i in range(UserProfileSerializer.IMPORTANT_COLOR_LIMIT)}
        self.assertEqual(self._patch({"important": at_limit}).status_code, 200)

    def test_does_not_leak_to_other_users(self):
        self._patch({"categories": {"meeting": "#842D78"}})
        other = _make_user("colors_other")
        self.client.force_authenticate(user=other)
        self.assertEqual(self.client.get(PROFILE_ME_URL).data["calendar_colors"], {})

    def test_patching_colors_leaves_other_profile_fields_alone(self):
        self.client.patch(PROFILE_ME_URL, {"display_name": "Liz"}, format="json")
        self._patch({"categories": {"meeting": "#C3D3E0"}})
        resp = self.client.get(PROFILE_ME_URL)
        self.assertEqual(resp.data["display_name"], "Liz")
        self.assertEqual(resp.data["calendar_colors"]["categories"]["meeting"], "#C3D3E0")
