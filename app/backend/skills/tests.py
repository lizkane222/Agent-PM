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


class PlatformToolCatalogTests(APITestCase):
    """The catalog is derived from the MCP registry; the policy it encodes is not."""

    def test_catalog_is_the_registry_derivation(self):
        from agents.mcp_server import mcp_server
        self.assertEqual(_PLATFORM_TOOL_CATALOG, mcp_server.skill_safe_tools())

    def test_catalog_still_excludes_outbound_communication(self):
        self.assertNotIn("send_sms", _PLATFORM_TOOL_CATALOG)
        self.assertNotIn("make_phone_call", _PLATFORM_TOOL_CATALOG)

    def test_catalog_excludes_the_skill_tools_themselves(self):
        self.assertNotIn("list_skills", _PLATFORM_TOOL_CATALOG)
        self.assertNotIn("load_skill", _PLATFORM_TOOL_CATALOG)

    def test_creating_a_skill_that_wants_send_sms_is_still_rejected(self):
        """Policy regression guard: deriving the catalog must not widen it."""
        user = User.objects.create_user("author2", password="pass")
        self.client.force_authenticate(user=user)
        resp = self.client.post(LIST_URL, {
            "name": "texter", "description": "d", "instructions": "i",
            "allowed_tools": ["send_sms"],
        }, format="json")
        self.assertEqual(resp.status_code, 400)


class SkillToolVisibilityTests(APITestCase):
    """
    list_skills / load_skill scoping — the authorization surface of the two tools
    that make saved workflows reachable from voice.

    These call the sync helpers directly. The async tools are thin
    sync_to_async(thread_sensitive=True) wrappers around exactly these, and calling
    the async form from a TestCase would need its own event loop for no added
    coverage of the scoping logic, which is what matters here.
    """

    def setUp(self):
        from agents.mcp_server import _list_skills_sync, _load_skill_sync
        self._list = _list_skills_sync
        self._load = _load_skill_sync

        self.author = User.objects.create_user("skill-author", password="pass")
        self.other = User.objects.create_user("skill-other", password="pass")
        self.staff = User.objects.create_user("skill-staff", password="pass", is_staff=True)

        AgentSkill.objects.create(
            name="own-approved-private", description="mine, approved, private",
            instructions="step 1", created_by=self.author,
            status="approved", visibility="private",
        )
        AgentSkill.objects.create(
            name="org-published", description="everyone can run this",
            instructions="do the thing", created_by=self.author,
            status="approved", visibility="public", allowed_tools=["search_records"],
        )
        AgentSkill.objects.create(
            name="draft-public", description="not reviewed yet",
            instructions="unsafe", created_by=self.author,
            status="draft", visibility="public",
        )
        AgentSkill.objects.create(
            name="others-private", description="not yours",
            instructions="secret", created_by=self.other,
            status="approved", visibility="private",
        )

    def _names(self, user, query=""):
        return [s["name"] for s in self._list(user, query)]

    # ── list_skills ───────────────────────────────────────────────────────────

    def test_author_sees_own_approved_private_plus_published(self):
        names = self._names(self.author)
        self.assertIn("own-approved-private", names)
        self.assertIn("org-published", names)
        self.assertNotIn("others-private", names)

    def test_non_owner_sees_only_published(self):
        names = self._names(self.other)
        self.assertIn("org-published", names)
        self.assertNotIn("own-approved-private", names)

    def test_drafts_never_appear_even_to_their_author(self):
        """Drafts have not passed security review, so the agent must not run them."""
        self.assertNotIn("draft-public", self._names(self.author))
        self.assertNotIn("draft-public", self._names(self.staff))

    def test_staff_sees_all_approved(self):
        names = self._names(self.staff)
        self.assertIn("own-approved-private", names)
        self.assertIn("others-private", names)
        self.assertIn("org-published", names)

    def test_anonymous_caller_sees_nothing(self):
        self.assertEqual(self._list(None, ""), [])

    def test_query_filters_on_name(self):
        self.assertEqual(self._names(self.author, "published"), ["org-published"])

    def test_query_filters_on_description(self):
        self.assertEqual(self._names(self.author, "everyone can run"), ["org-published"])

    def test_query_matching_nothing_returns_empty(self):
        self.assertEqual(self._names(self.author, "zzzz"), [])

    def test_entries_carry_the_trigger_description(self):
        entry = next(s for s in self._list(self.other, "") if s["name"] == "org-published")
        self.assertEqual(entry["description"], "everyone can run this")
        self.assertEqual(entry["allowed_tools"], ["search_records"])

    # ── load_skill ────────────────────────────────────────────────────────────

    def test_load_returns_instructions_for_a_published_skill(self):
        result = self._load(self.other, "org-published")
        self.assertEqual(result["instructions"], "do the thing")
        self.assertNotIn("error", result)

    def test_load_returns_own_private_approved_skill(self):
        self.assertEqual(
            self._load(self.author, "own-approved-private")["instructions"], "step 1"
        )

    def test_load_someone_elses_private_skill_is_refused(self):
        # "others-private" belongs to self.other, so self.author is the outsider here.
        result = self._load(self.author, "others-private")
        self.assertIn("error", result)
        self.assertNotIn("instructions", result)

    def test_load_a_draft_is_refused(self):
        result = self._load(self.author, "draft-public")
        self.assertIn("error", result)
        self.assertNotIn("instructions", result)

    def test_load_an_unknown_name_returns_an_error_and_does_not_raise(self):
        result = self._load(self.author, "no-such-skill")
        self.assertIn("error", result)

    def test_refusals_are_indistinguishable_so_existence_cannot_be_probed(self):
        hidden = self._load(self.author, "others-private")["error"]
        missing = self._load(self.author, "no-such-skill-at-all")["error"]
        self.assertEqual(
            hidden.replace("others-private", "X"),
            missing.replace("no-such-skill-at-all", "X"),
        )

    def test_error_lists_what_is_available_so_the_agent_can_recover(self):
        result = self._load(self.other, "typo-name")
        self.assertIn("org-published", result["available"])

    def test_load_for_an_anonymous_caller_is_refused(self):
        self.assertIn("error", self._load(None, "org-published"))
