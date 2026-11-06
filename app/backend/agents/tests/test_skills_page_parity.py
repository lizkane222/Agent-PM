"""
The Claude Skills page (Agent Capabilities tab) documents agent tools by hand.

Nothing ties that list to the MCP registry, so a rename or removal would leave the page
describing a tool that no longer exists. This test reads the page source and fails if any
tool it names is not registered.
"""

import re
from pathlib import Path

from django.test import SimpleTestCase

from agents.mcp_server import mcp_server

PAGE = Path(__file__).resolve().parents[3] / "frontend" / "src" / "pages" / "ClaudeSkillsPage.tsx"


def _documented_tool_names() -> set[str]:
    """Every `label: "tool_name"` inside AGENT_SKILL_DEFS ops (a '/' lists several tools)."""
    source = PAGE.read_text()
    start = source.index("const AGENT_SKILL_DEFS")
    end = source.index("const OP_COLORS", start)
    names: set[str] = set()
    for label in re.findall(r'op: "(?:Create|Read|Update|Delete)",\s*label: "([^"]+)"', source[start:end]):
        names.update(part.strip() for part in label.split("/"))
    return names


class SkillsPageParityTests(SimpleTestCase):
    def test_page_source_is_where_the_test_expects_it(self):
        self.assertTrue(PAGE.exists(), PAGE)

    def test_every_documented_tool_is_a_registered_tool(self):
        documented = _documented_tool_names()
        self.assertGreater(len(documented), 10, "parsing found too few tools; the page layout changed")
        unknown = documented - set(mcp_server.list_tools())
        self.assertFalse(unknown, f"Agent Capabilities documents tools that do not exist: {sorted(unknown)}")

    def test_the_voice_confirmation_tools_are_all_documented(self):
        from realtime.voice_policy import VOICE_CONFIRM_TOOLS

        documented = _documented_tool_names()
        # Gated tools carry the "confirm first" warning on the page, so none may be missing.
        missing = set(VOICE_CONFIRM_TOOLS) - documented
        self.assertFalse(missing, f"gated tools not documented on the page: {sorted(missing)}")
