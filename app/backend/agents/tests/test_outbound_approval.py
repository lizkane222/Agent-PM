"""
Standing invariants: nothing in AgentPM communicates with another person without the user's
explicit approval — on chat, on voice, and from a saved skill.

Added after a customer received 2,000+ calendar invitation emails. Product rule (owner): an
approval is required "whether that occurs from creating a new meeting from the calendar, from
chat, from voice session, or from an AgentPM/Claude skill — anywhere within this app if
communication is occurring via email".

These are structural, not per-tool: they iterate the live registry, so a NEW outbound tool added
tomorrow fails here until it is gated. That is the point — governance that depends on a reviewer
remembering is not governance.
"""

from django.test import SimpleTestCase

from agents import tool_policy as policy
from agents.mcp_server import mcp_server
from realtime.voice_policy import VOICE_CONFIRM_TOOLS


def _outbound_tools() -> set[str]:
    """Every tool that reaches another person: declared outbound, or in the communicate group."""
    meta = getattr(mcp_server, "_meta", {})
    by_group = {n for n in mcp_server.list_tools() if meta.get(n, {}).get("group") == "communicate"}
    return set(policy.OUTBOUND_TOOLS) | by_group


class OutboundToolsNeedApprovalTests(SimpleTestCase):
    def test_the_outbound_set_is_not_empty(self):
        # A guard that scans an empty set proves nothing.
        out = _outbound_tools()
        for name in ("send_sms", "make_phone_call", "invite_to_meeting"):
            self.assertIn(name, out)

    def test_every_outbound_tool_requires_approval_on_chat(self):
        missing = _outbound_tools() - set(policy.CONFIRM_REQUIRED)
        self.assertFalse(
            missing,
            f"Outbound tools that chat can run with no user approval: {sorted(missing)}. "
            f"Add them to agents.tool_policy.CONFIRM_REQUIRED.",
        )

    def test_every_outbound_tool_requires_approval_on_voice(self):
        missing = _outbound_tools() - set(VOICE_CONFIRM_TOOLS)
        self.assertFalse(
            missing,
            f"Outbound tools voice can run with no spoken yes: {sorted(missing)}. "
            f"Add them to realtime.voice_policy.VOICE_CONFIRM_TOOLS.",
        )

    def test_no_outbound_tool_can_be_called_from_a_saved_skill(self):
        # A skill is a stored recipe: it cannot give an approval, so it must never reach an
        # outbound tool, whatever its allowed_tools says.
        unsafe = _outbound_tools() & set(mcp_server.skill_safe_tools())
        self.assertFalse(unsafe, f"skill-callable outbound tools: {sorted(unsafe)}")

    def test_the_skill_ban_is_enforced_by_policy_not_only_by_the_flag(self):
        self.assertTrue(_outbound_tools() <= set(policy.NEVER_SKILL_SAFE))

    def test_an_unconfirmed_chat_call_is_refused_and_the_tool_never_runs(self):
        # The behaviour, not just the set membership: dispatch must hand back a confirmation
        # request and must NOT execute the tool body.
        from unittest.mock import MagicMock, patch

        from asgiref.sync import async_to_sync

        user = MagicMock(is_authenticated=True, is_active=True, pk=1)
        args = {
            "invite_to_meeting": {"event_id": 1, "attendee_names": ["Ana Diaz"]},
            "send_sms": {"to": "+15551230000", "body": "hi"},
            "make_phone_call": {"to": "+15551230000", "message": "hi"},
            "log_time_week": {},
            "leave_note_for": {"person": "Ana Diaz", "note": "hi"},
        }
        for name in sorted(_outbound_tools() & set(args)):
            with self.subTest(tool=name):
                ran = []
                original = mcp_server._registry[name]

                async def spy(**kw):
                    ran.append(kw)
                    return {"status": "ran"}

                with patch.dict(mcp_server._registry, {name: spy}):
                    result = async_to_sync(mcp_server.dispatch)(name, args[name], user=user)
                self.assertEqual(ran, [], f"{name} executed without approval")
                self.assertEqual(result.get("error_code"), "confirmation_required", result)
                self.assertTrue(result.get("confirmation_token"))
                del original

    def test_a_confirmed_call_does_run_the_tool(self):
        # The gate must open when the user really approves, or it would be a wall, not a gate.
        from unittest.mock import MagicMock, patch

        from asgiref.sync import async_to_sync

        user = MagicMock(is_authenticated=True, is_active=True, pk=1)
        ran = []

        async def spy(**kw):
            ran.append(kw)
            return {"status": "ran"}

        with patch.dict(mcp_server._registry, {"invite_to_meeting": spy}):
            result = async_to_sync(mcp_server.dispatch)(
                "invite_to_meeting", {"event_id": 1, "attendee_names": ["Ana Diaz"]}, user=user, confirmed=True,
            )
        self.assertEqual(len(ran), 1)
        self.assertEqual(result, {"status": "ran"})


class ChatApprovalReachesTheToolTests(SimpleTestCase):
    """
    Voice approves with ``confirmed=True``; chat approves by redeeming a single-use token. Both
    must put the tool in the "approved" state, or a user who really said yes on chat would be
    told the invitation was sent when the tool (correctly failing closed) sent nothing.
    """

    def _user(self):
        from unittest.mock import MagicMock
        return MagicMock(is_authenticated=True, is_active=True, pk=77)

    def _run(self, **kw):
        from unittest.mock import patch

        from asgiref.sync import async_to_sync

        from agents.mcp_server import _current_approved

        seen = []

        async def spy(**args):
            seen.append(_current_approved.get())
            return {"status": "ran"}

        with patch.dict(mcp_server._registry, {"invite_to_meeting": spy}):
            first = async_to_sync(mcp_server.dispatch)(
                "invite_to_meeting", {"event_id": 1, "attendee_names": ["Ana Diaz"]}, user=self._user(), **kw)
            return first, seen

    def test_a_voice_confirmed_call_runs_in_the_approved_state(self):
        _, seen = self._run(confirmed=True)
        self.assertEqual(seen, [True])

    def test_a_redeemed_chat_token_runs_in_the_approved_state(self):
        from unittest.mock import patch

        from asgiref.sync import async_to_sync

        from agents.mcp_server import _current_approved

        user, seen = self._user(), []

        async def spy(**args):
            seen.append(_current_approved.get())
            return {"status": "ran"}

        args = {"event_id": 1, "attendee_names": ["Ana Diaz"]}
        with patch.dict(mcp_server._registry, {"invite_to_meeting": spy}):
            refusal = async_to_sync(mcp_server.dispatch)("invite_to_meeting", args, user=user)
            token = refusal["confirmation_token"]
            async_to_sync(mcp_server.dispatch)("invite_to_meeting", {**args, "confirmation_token": token}, user=user)
        self.assertEqual(seen, [True])

    def test_the_token_is_single_use(self):
        from unittest.mock import patch

        from asgiref.sync import async_to_sync

        user, seen = self._user(), []

        async def spy(**args):
            seen.append(1)
            return {"status": "ran"}

        args = {"event_id": 1, "attendee_names": ["Ana Diaz"]}
        with patch.dict(mcp_server._registry, {"invite_to_meeting": spy}):
            token = async_to_sync(mcp_server.dispatch)("invite_to_meeting", args, user=user)["confirmation_token"]
            async_to_sync(mcp_server.dispatch)("invite_to_meeting", {**args, "confirmation_token": token}, user=user)
            again = async_to_sync(mcp_server.dispatch)("invite_to_meeting", {**args, "confirmation_token": token}, user=user)
        self.assertEqual(len(seen), 1)
        self.assertEqual(again.get("error_code"), "confirmation_required")

    def test_a_token_for_one_set_of_arguments_cannot_approve_different_ones(self):
        # The model cannot talk the user into yes for Ana and then email Ben.
        from unittest.mock import patch

        from asgiref.sync import async_to_sync

        user, seen = self._user(), []

        async def spy(**args):
            seen.append(args)
            return {"status": "ran"}

        with patch.dict(mcp_server._registry, {"invite_to_meeting": spy}):
            token = async_to_sync(mcp_server.dispatch)(
                "invite_to_meeting", {"event_id": 1, "attendee_names": ["Ana Diaz"]}, user=user)["confirmation_token"]
            swapped = async_to_sync(mcp_server.dispatch)(
                "invite_to_meeting", {"event_id": 1, "attendee_names": ["Ben Cole"], "confirmation_token": token}, user=user)
        self.assertEqual(seen, [])
        self.assertEqual(swapped.get("error_code"), "confirmation_required")


class SkillsCannotCommunicateTests(SimpleTestCase):
    """
    "From an AgentPM/Claude skill — anywhere within this app if communication is occurring via
    email should require explicit user approval." A skill is a stored recipe: it cannot give an
    approval, so it must be unable to reach an outbound tool AT ALL — even one it lists in
    ``allowed_tools``, and even if it carries a (forged) confirmation token or ``confirmed``.
    """

    def _as_skill(self, tool, args, **kw):
        from unittest.mock import MagicMock, patch

        from asgiref.sync import async_to_sync

        user = MagicMock(is_authenticated=True, is_active=True, pk=5)
        ran = []

        async def spy(**a):
            ran.append(a)
            return {"status": "ran"}

        scope = policy.SkillScope("weekly-review", frozenset({tool}))  # the skill lists the tool itself
        token = policy.active_skill.set(scope)
        try:
            with patch.dict(mcp_server._registry, {tool: spy}):
                result = async_to_sync(mcp_server.dispatch)(tool, args, user=user, **kw)
        finally:
            policy.active_skill.reset(token)
        return result, ran

    ARGS = {
        "invite_to_meeting": {"event_id": 1, "attendee_names": ["Ana Diaz"]},
        "send_sms": {"to": "+15551230000", "body": "hi"},
        "make_phone_call": {"to": "+15551230000", "message": "hi"},
        "log_time_week": {},
        "leave_note_for": {"person": "Ana Diaz", "note": "hi"},
    }

    def test_a_skill_cannot_run_any_outbound_tool_even_if_it_lists_it(self):
        for tool, args in self.ARGS.items():
            with self.subTest(tool=tool):
                result, ran = self._as_skill(tool, args)
                self.assertEqual(ran, [], f"{tool} ran from inside a skill")
                self.assertEqual(result.get("error_code"), "not_allowed_in_skill")

    def test_a_skill_cannot_bypass_the_gate_by_claiming_it_was_confirmed(self):
        for tool, args in self.ARGS.items():
            with self.subTest(tool=tool):
                result, ran = self._as_skill(tool, args, confirmed=True)
                self.assertEqual(ran, [], f"{tool} ran from a skill with confirmed=True")
                self.assertEqual(result.get("error_code"), "not_allowed_in_skill")

    def test_a_skill_cannot_bypass_the_gate_with_a_made_up_token(self):
        for tool, args in self.ARGS.items():
            with self.subTest(tool=tool):
                result, ran = self._as_skill(tool, {**args, "confirmation_token": "forged"})
                self.assertEqual(ran, [])
                self.assertEqual(result.get("error_code"), "not_allowed_in_skill")

    def test_every_outbound_tool_in_the_registry_is_covered_by_these_skill_tests(self):
        # If someone adds a new outbound tool, this fails until it has a case above.
        missing = _outbound_tools() - set(self.ARGS)
        self.assertFalse(missing, f"add a skill-bypass case for: {sorted(missing)}")
