"""Tests for AgentSkill visibility and the shipped meeting-notes capability."""

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from .models import AgentSkill
from .views import _PLATFORM_TOOL_CATALOG

User = get_user_model()

LIST_URL = "/api/v1/skills/agent-skills/"


class AgentSkillVisibilityTests(APITestCase):
    """Non-staff must see published capabilities, not just their own drafts."""

    def setUp(self):
        self.author = User.objects.create_user("author", password="pass")
        self.other = User.objects.create_user("other", password="pass")
        self.staff = User.objects.create_user("boss", password="pass", is_staff=True)

        self.own = AgentSkill.objects.create(
            name="my-own-draft", description="d", instructions="i",
            created_by=self.other, status="draft", visibility="private",
        )
        self.someone_elses_private = AgentSkill.objects.create(
            name="someone-elses", description="d", instructions="i",
            created_by=self.author, status="approved", visibility="private",
        )
        self.published = AgentSkill.objects.create(
            name="published-capability", description="d", instructions="i",
            created_by=self.author, status="approved", visibility="public",
        )
        self.unapproved_public = AgentSkill.objects.create(
            name="public-but-draft", description="d", instructions="i",
            created_by=self.author, status="draft", visibility="public",
        )

    def _names(self, user):
        self.client.force_authenticate(user=user)
        resp = self.client.get(LIST_URL)
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        results = body["results"] if isinstance(body, dict) else body
        return {s["name"] for s in results}

    def test_unauthenticated_returns_401(self):
        resp = self.client.get(LIST_URL)
        self.assertEqual(resp.status_code, 401)

    def test_non_staff_sees_own_plus_published(self):
        names = self._names(self.other)
        self.assertIn("my-own-draft", names)
        self.assertIn("published-capability", names)

    def test_non_staff_does_not_see_someone_elses_private_skill(self):
        self.assertNotIn("someone-elses", self._names(self.other))

    def test_public_but_unapproved_stays_hidden(self):
        """Only approved skills are safe to run, so draft+public is not published."""
        self.assertNotIn("public-but-draft", self._names(self.other))

    def test_staff_sees_everything(self):
        names = self._names(self.staff)
        for name in ("my-own-draft", "someone-elses", "published-capability", "public-but-draft"):
            self.assertIn(name, names)

    def test_non_staff_can_pin_a_published_capability(self):
        self.client.force_authenticate(user=self.other)
        resp = self.client.post(f"{LIST_URL}{self.published.pk}/pin/")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(self.published.pinned_to_users.filter(pk=self.other.pk).exists())

    def test_non_staff_can_unpin_a_published_capability(self):
        self.published.pinned_to_users.add(self.other)
        self.client.force_authenticate(user=self.other)
        resp = self.client.post(f"{LIST_URL}{self.published.pk}/unpin/")
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(self.published.pinned_to_users.filter(pk=self.other.pk).exists())

    def test_non_staff_cannot_edit_a_published_capability_they_did_not_create(self):
        self.client.force_authenticate(user=self.other)
        resp = self.client.patch(
            f"{LIST_URL}{self.published.pk}/", {"instructions": "hacked"}, format="json"
        )
        self.assertEqual(resp.status_code, 403)
        self.published.refresh_from_db()
        self.assertEqual(self.published.instructions, "i")


class MeetingNotesCapabilityTests(APITestCase):
    """The seeded get-meeting-notes capability must be usable out of the box."""

    NAME = "get-meeting-notes"

    def test_seed_migration_created_an_approved_public_skill(self):
        skill = AgentSkill.objects.get(name=self.NAME)
        self.assertEqual(skill.status, "approved")
        self.assertEqual(skill.visibility, "public")

    def test_it_allows_only_the_meeting_notes_tool(self):
        skill = AgentSkill.objects.get(name=self.NAME)
        self.assertEqual(skill.allowed_tools, ["get_meeting_notes_from_email"])

    def test_the_allowed_tool_is_in_the_platform_catalog(self):
        """An allowed_tools entry outside the catalog is rejected on any later edit."""
        self.assertIn("get_meeting_notes_from_email", _PLATFORM_TOOL_CATALOG)

    def test_the_allowed_tool_is_registered_on_the_mcp_server(self):
        from agents.mcp_server import mcp_server
        self.assertIn("get_meeting_notes_from_email", mcp_server.list_tools())

    def test_a_non_staff_user_can_see_and_run_it(self):
        user = User.objects.create_user("regular", password="pass")
        self.client.force_authenticate(user=user)
        skill = AgentSkill.objects.get(name=self.NAME)

        resp = self.client.post(f"{LIST_URL}{skill.pk}/run/", {}, format="json")

        self.assertEqual(resp.status_code, 200)
        prompt = resp.json()["prompt"]
        self.assertIn(f"/{self.NAME}", prompt)
        self.assertIn("get_meeting_notes_from_email", prompt)

    def test_it_is_not_pinned_to_any_role_by_default(self):
        """Pinning is the user's call — shipping it pre-pinned would clutter role pages."""
        skill = AgentSkill.objects.get(name=self.NAME)
        self.assertEqual(skill.pinned_to_roles, [])
        self.assertEqual(skill.pinned_to_users.count(), 0)
