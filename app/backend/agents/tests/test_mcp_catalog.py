"""
Tests for the MCP registry's grouping / skill-eligibility metadata.

These exist because three places used to hold their own copy of "the tool list":
the agent system prompt, skills.views._PLATFORM_TOOL_CATALOG, and the registry
itself. The prompt had already drifted — get_meeting_notes_from_email was missing
from it. The metadata now lives on the @mcp_server.tool() decorator and both
downstream lists are derived, so these tests lock the derivation rather than
enumerating tools by hand (an enumeration would itself be a fourth copy).

The one deliberate exception is test_skill_safe_tools_is_exactly_todays_catalog,
which *does* enumerate: skill-eligibility is a security policy, so adding a tool
to it must be a conscious edit that fails this test first.
"""

from django.test import SimpleTestCase

from agents.mcp_server import GROUP_LABELS, GROUP_ORDER, MCPServer, mcp_server

# The curated 13 that skills/views.py has always allowed. Deliberately NOT all
# registered tools: deriving "everything" would silently let a skill author wire up
# outbound SMS or phone calls, which is a policy change, not a refactor.
EXPECTED_SKILL_SAFE = {
    "add_account_note",
    "create_action_item",
    "create_calendar_event",
    "delete_action_item",
    "delete_calendar_event",
    "delete_meeting",
    "get_airtable_records",
    "get_meeting_notes_from_email",
    "search_records",
    "update_account",
    "update_action_item",
    "update_calendar_event",
    "update_meeting",
}


class GroupedCatalogTests(SimpleTestCase):
    def test_every_registered_tool_has_a_known_group(self):
        for name in mcp_server.list_tools():
            group = mcp_server._meta[name]["group"]
            self.assertIn(group, GROUP_ORDER, f"{name} declares unknown group {group!r}")

    def test_catalog_covers_every_tool_exactly_once(self):
        listed = [name for entries in mcp_server.grouped_catalog().values() for name, _ in entries]
        self.assertCountEqual(listed, mcp_server.list_tools())

    def test_catalog_is_ordered_by_group_order(self):
        keys = list(mcp_server.grouped_catalog())
        self.assertEqual(keys, [g for g in GROUP_ORDER if g in keys])

    def test_every_group_has_a_label(self):
        for group in GROUP_ORDER:
            self.assertIn(group, GROUP_LABELS)

    def test_descriptions_match_the_schemas_sent_to_claude(self):
        """The prompt and the tool schemas must never be able to disagree."""
        schema_descriptions = {s["name"]: s["description"] for s in mcp_server.tool_schemas()}
        for entries in mcp_server.grouped_catalog().values():
            for name, description in entries:
                self.assertEqual(description, schema_descriptions[name], name)

    def test_no_description_is_empty(self):
        for entries in mcp_server.grouped_catalog().values():
            for name, description in entries:
                self.assertTrue(description.strip(), f"{name} has no docstring first line")

    def test_empty_groups_are_omitted(self):
        # "other" is a real group but nothing declares it; it must not appear as [].
        self.assertNotIn([], list(mcp_server.grouped_catalog().values()))


class SkillSafeToolsTests(SimpleTestCase):
    def test_skill_safe_tools_is_exactly_todays_catalog(self):
        self.assertEqual(set(mcp_server.skill_safe_tools()), EXPECTED_SKILL_SAFE)

    def test_outbound_communication_tools_are_not_skill_safe(self):
        safe = set(mcp_server.skill_safe_tools())
        self.assertNotIn("send_sms", safe)
        self.assertNotIn("make_phone_call", safe)

    def test_skill_tools_are_not_skill_safe(self):
        """A skill referencing load_skill would recurse into itself."""
        safe = set(mcp_server.skill_safe_tools())
        self.assertNotIn("list_skills", safe)
        self.assertNotIn("load_skill", safe)

    def test_every_skill_safe_tool_is_registered(self):
        for name in mcp_server.skill_safe_tools():
            self.assertIn(name, mcp_server.list_tools())


class RegistrationTests(SimpleTestCase):
    """Registration-time behaviour, exercised on a throwaway server instance."""

    def test_duplicate_name_still_raises(self):
        server = MCPServer()

        @server.tool(group="read")
        async def thing() -> None:
            """Doc."""

        with self.assertRaises(ValueError):
            @server.tool(name="thing", group="read")
            async def other() -> None:
                """Doc."""

    def test_unknown_group_raises_at_registration(self):
        server = MCPServer()
        with self.assertRaises(ValueError):
            @server.tool(group="not-a-group")
            async def thing() -> None:
                """Doc."""

    def test_group_defaults_to_other_and_skill_safe_defaults_to_false(self):
        server = MCPServer()

        @server.tool()
        async def thing() -> None:
            """Doc."""

        self.assertEqual(server._meta["thing"], {"group": "other", "skill_safe": False})
        self.assertEqual(server.skill_safe_tools(), [])
        self.assertEqual(server.grouped_catalog(), {"other": [("thing", "Doc.")]})
