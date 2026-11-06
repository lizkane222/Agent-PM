"""
The agent tool policy layer: every rule `MCPServer.dispatch` enforces before a tool runs.

These run against a throwaway `MCPServer` with trivial tools, so they pin the rules and not
any one tool's body. A handful at the end go through the real registry to prove the rules
are wired into the production dispatcher.
"""

import asyncio
from types import SimpleNamespace
from unittest import mock

from asgiref.sync import async_to_sync
from django.core.cache import cache
from django.test import SimpleTestCase, TestCase, override_settings

from agents import tool_policy as policy
from agents.mcp_server import MCPServer, mcp_server


def _user(pk=1, active=True):
    return SimpleNamespace(pk=pk, is_authenticated=True, is_active=active, is_staff=False)


def _server():
    server = MCPServer()
    calls = []

    @server.tool(group="read", skill_safe=True, schema={"input_schema": {
        "type": "object",
        "properties": {
            "q": {"type": "string", "maxLength": 10},
            "n": {"type": "integer", "minimum": 1, "maximum": 5},
            "kind": {"type": "string", "enum": ["a", "b"]},
            "ids": {"type": "array", "items": {"type": "integer"}},
            "flag": {"type": "boolean"},
        },
        "required": ["q"],
    }})
    async def lookup(q, n=None, kind=None, ids=None, flag=None):
        """Read something."""
        calls.append(("lookup", q, n, kind, ids, flag))
        return {"status": "ok", "q": q, "n": n}

    @server.tool(group="delete", skill_safe=True, schema={"input_schema": {
        "type": "object", "properties": {"record_id": {"type": "string"}}, "required": ["record_id"],
    }}, name="delete_action_item")
    async def delete(record_id):
        """Delete a thing."""
        calls.append(("delete", record_id))
        return {"status": "deleted", "record_id": record_id}

    @server.tool(group="create", skill_safe=True, schema={"input_schema": {
        "type": "object", "properties": {}, }})
    async def explode():
        """Always fails."""
        raise RuntimeError("Unable to create record: https://api.twilio.com/2010-04-01/Accounts/AC123SECRET/Messages.json")

    @server.tool(group="create", skill_safe=True)
    async def sleepy():
        """Never returns in time."""
        await asyncio.sleep(5)

    @server.tool(group="update", skill_safe=False)
    async def private_update():
        """Not usable from skills."""
        calls.append(("private_update",))
        return {"status": "updated"}

    return server, calls


def run(server, tool, args=None, user=None, **kw):
    return async_to_sync(server.dispatch)(tool, args or {}, user=user, **kw)


class _CacheIsolated(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)


class AuthenticationTests(_CacheIsolated):
    def test_no_user_is_refused_before_the_tool_runs(self):
        server, calls = _server()
        result = run(server, "lookup", {"q": "x"}, user=None)
        self.assertEqual(result["error_code"], "not_authenticated")
        self.assertEqual(calls, [])

    def test_anonymous_style_user_is_refused(self):
        server, calls = _server()
        anon = SimpleNamespace(pk=None, is_authenticated=False, is_active=True)
        self.assertEqual(run(server, "lookup", {"q": "x"}, user=anon)["error_code"], "not_authenticated")
        self.assertEqual(calls, [])

    def test_deactivated_user_is_refused(self):
        server, calls = _server()
        self.assertEqual(run(server, "lookup", {"q": "x"}, user=_user(active=False))["error_code"],
                         "not_authenticated")
        self.assertEqual(calls, [])

    def test_authenticated_user_runs(self):
        server, calls = _server()
        self.assertEqual(run(server, "lookup", {"q": "x"}, user=_user())["status"], "ok")
        self.assertEqual(len(calls), 1)

    def test_unknown_tool_does_not_leak_the_tool_list(self):
        server, _ = _server()
        result = run(server, "nope", user=_user())
        self.assertEqual(result["error_code"], "unknown_tool")
        self.assertNotIn("lookup", result["message"])


class ArgumentValidationTests(_CacheIsolated):
    def assertRefused(self, args, needle):
        server, calls = _server()
        result = run(server, "lookup", args, user=_user())
        self.assertEqual(result["error_code"], "invalid_arguments", result)
        self.assertIn(needle, result["message"])
        self.assertEqual(calls, [])

    def test_unknown_key_is_refused_by_name(self):
        self.assertRefused({"q": "x", "evil": 1}, "evil")

    def test_missing_required_key(self):
        self.assertRefused({}, "q")

    def test_enum_is_enforced(self):
        self.assertRefused({"q": "x", "kind": "c"}, "kind")

    def test_type_is_enforced(self):
        self.assertRefused({"q": 5}, "q")

    def test_bool_never_satisfies_integer(self):
        # Python treats True == 1; the attendance endpoint was bitten by this once.
        self.assertRefused({"q": "x", "n": True}, "n")

    def test_bounds_are_enforced(self):
        self.assertRefused({"q": "x", "n": 9}, "at most 5")
        self.assertRefused({"q": "x", "n": 0}, "at least 1")

    def test_max_length_is_enforced(self):
        self.assertRefused({"q": "x" * 11}, "longer than 10")

    def test_array_item_type_is_enforced(self):
        self.assertRefused({"q": "x", "ids": [1, "two"]}, "ids")

    def test_a_quoted_integer_is_coerced(self):
        server, calls = _server()
        result = run(server, "lookup", {"q": "x", "n": "3"}, user=_user())
        self.assertEqual(result["n"], 3)

    def test_non_object_arguments_are_refused(self):
        with self.assertRaises(policy.ToolPolicyError):
            policy.validate_arguments("lookup", {"properties": {}}, ["not", "a", "dict"])


class ErrorShapeTests(_CacheIsolated):
    def test_exception_text_never_reaches_the_model(self):
        server, _ = _server()
        result = run(server, "explode", user=_user())
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["error_code"], "internal_error")
        self.assertNotIn("AC123SECRET", str(result))
        self.assertNotIn("twilio.com", str(result))
        self.assertIn("ref", result)

    @override_settings(AGENT_TOOL_TIMEOUTS={"sleepy": 0.05})
    def test_a_hung_tool_times_out_as_retryable(self):
        server, _ = _server()
        result = run(server, "sleepy", user=_user())
        self.assertEqual(result["error_code"], "timeout")
        self.assertTrue(result["retryable"])

    def test_an_upstream_429_is_classified_with_retry_after(self):
        exc = RuntimeError("x")
        exc.status_code = 429
        exc.response = SimpleNamespace(headers={"Retry-After": "12"})
        result = policy.classify_exception(exc, "t", "ref1")
        self.assertEqual((result["error_code"], result["retryable"], result["retry_after"]),
                         ("upstream_rate_limited", True, 12))

    def test_google_403_rate_limit_and_twilio_20429_are_rate_limits(self):
        twilio = RuntimeError("x")
        twilio.code = 20429
        self.assertEqual(policy.classify_exception(twilio, "t", "r")["error_code"], "upstream_rate_limited")

    def test_upstream_5xx_is_retryable(self):
        exc = RuntimeError("x")
        exc.status_code = 503
        result = policy.classify_exception(exc, "t", "r")
        self.assertEqual((result["error_code"], result["retryable"]), ("upstream_unavailable", True))

    def test_upstream_401_tells_the_user_to_reconnect(self):
        exc = RuntimeError("x")
        exc.status_code = 401
        self.assertEqual(policy.classify_exception(exc, "t", "r")["error_code"], "upstream_unauthorized")


@override_settings(AGENT_TOOL_RATE_LIMITS_ENABLED=True, AGENT_TOOL_RATE_LIMITS={"read": (3, 60)})
class RateLimitTests(_CacheIsolated):
    def test_over_budget_is_refused_with_retry_after(self):
        server, calls = _server()
        for _ in range(3):
            self.assertEqual(run(server, "lookup", {"q": "x"}, user=_user())["status"], "ok")
        result = run(server, "lookup", {"q": "x"}, user=_user())
        self.assertEqual(result["error_code"], "rate_limited")
        self.assertTrue(result["retryable"])
        self.assertGreater(result["retry_after"], 0)
        self.assertEqual(len(calls), 3)

    def test_budgets_are_per_user(self):
        server, _ = _server()
        for _ in range(3):
            run(server, "lookup", {"q": "x"}, user=_user(pk=1))
        self.assertEqual(run(server, "lookup", {"q": "x"}, user=_user(pk=2))["status"], "ok")

    def test_window_rolls_over(self):
        with mock.patch("agents.tool_policy.time.time", return_value=1_000_000.0):
            for _ in range(3):
                policy.check_rate_limit(7, "read")
            with self.assertRaises(policy.ToolPolicyError):
                policy.check_rate_limit(7, "read")
        with mock.patch("agents.tool_policy.time.time", return_value=1_000_061.0):
            policy.check_rate_limit(7, "read")  # new window

    def test_outbound_tools_share_the_outbound_bucket(self):
        self.assertEqual(policy.category_for("send_sms", "communicate"), "outbound")
        self.assertEqual(policy.category_for("log_time_week", "create"), "outbound")
        self.assertEqual(policy.category_for("delete_action_item", "delete"), "delete")


class ConfirmationTests(_CacheIsolated):
    def test_first_call_returns_a_token_and_runs_nothing(self):
        server, calls = _server()
        result = run(server, "delete_action_item", {"record_id": "rec1"}, user=_user())
        self.assertEqual(result["error_code"], "confirmation_required")
        self.assertTrue(result["confirmation_token"])
        self.assertEqual(result["pending_arguments"], {"record_id": "rec1"})
        self.assertEqual(calls, [])

    def test_token_with_identical_arguments_runs_once(self):
        server, calls = _server()
        token = run(server, "delete_action_item", {"record_id": "rec1"}, user=_user())["confirmation_token"]
        ok = run(server, "delete_action_item", {"record_id": "rec1", "confirmation_token": token}, user=_user())
        self.assertEqual(ok["status"], "deleted")
        self.assertEqual(calls, [("delete", "rec1")])
        # Single use: replaying it is refused (and mints a fresh one).
        again = run(server, "delete_action_item", {"record_id": "rec1", "confirmation_token": token}, user=_user())
        self.assertEqual(again["error_code"], "confirmation_required")
        self.assertEqual(len(calls), 1)

    def test_token_is_bound_to_the_arguments(self):
        server, calls = _server()
        token = run(server, "delete_action_item", {"record_id": "rec1"}, user=_user())["confirmation_token"]
        swapped = run(server, "delete_action_item", {"record_id": "recOTHER", "confirmation_token": token}, user=_user())
        self.assertEqual(swapped["error_code"], "confirmation_required")
        self.assertEqual(calls, [])

    def test_token_is_bound_to_the_user(self):
        server, calls = _server()
        token = run(server, "delete_action_item", {"record_id": "rec1"}, user=_user(pk=1))["confirmation_token"]
        stolen = run(server, "delete_action_item", {"record_id": "rec1", "confirmation_token": token}, user=_user(pk=2))
        self.assertEqual(stolen["error_code"], "confirmation_required")
        self.assertEqual(calls, [])

    def test_a_made_up_token_is_refused(self):
        server, calls = _server()
        result = run(server, "delete_action_item", {"record_id": "rec1", "confirmation_token": "guess"}, user=_user())
        self.assertEqual(result["error_code"], "confirmation_required")
        self.assertEqual(calls, [])

    def test_voice_spoken_confirmation_bypasses_the_token(self):
        server, calls = _server()
        result = run(server, "delete_action_item", {"record_id": "rec1"}, user=_user(), confirmed=True)
        self.assertEqual(result["status"], "deleted")

    def test_token_expires(self):
        token = policy.issue_confirmation(1, "delete_action_item", {"record_id": "r"})
        cache.delete(f"agent-tool-confirm:{token}")  # what the TTL does
        self.assertFalse(policy.redeem_confirmation(token, 1, "delete_action_item", {"record_id": "r"}))

    def test_revoke_only_works_for_the_owner(self):
        token = policy.issue_confirmation(1, "delete_action_item", {"record_id": "r"})
        self.assertFalse(policy.revoke_confirmation(token, 2))
        self.assertTrue(policy.revoke_confirmation(token, 1))
        self.assertIsNone(policy.peek_confirmation(token))


class SkillScopeTests(_CacheIsolated):
    def _in_skill(self, allowed, fn):
        token = policy.active_skill.set(policy.SkillScope("weekly-review", frozenset(allowed)))
        try:
            return fn()
        finally:
            policy.active_skill.reset(token)

    def test_a_tool_outside_allowed_tools_is_refused(self):
        server, calls = _server()
        result = self._in_skill(["explode"], lambda: run(server, "lookup", {"q": "x"}, user=_user()))
        self.assertEqual(result["error_code"], "not_allowed_in_skill")
        self.assertIn("weekly-review", result["message"])
        self.assertEqual(calls, [])

    def test_a_declared_tool_runs(self):
        server, calls = _server()
        result = self._in_skill(["lookup"], lambda: run(server, "lookup", {"q": "x"}, user=_user()))
        self.assertEqual(result["status"], "ok")

    def test_a_non_skill_safe_tool_is_refused_even_if_declared(self):
        server, calls = _server()
        result = self._in_skill(["private_update"], lambda: run(server, "private_update", user=_user()))
        self.assertEqual(result["error_code"], "not_allowed_in_skill")
        self.assertEqual(calls, [])

    def test_deletes_and_outbound_are_never_skill_usable(self):
        server, calls = _server()
        result = self._in_skill(
            ["delete_action_item"],
            lambda: run(server, "delete_action_item", {"record_id": "r"}, user=_user(), confirmed=True),
        )
        self.assertEqual(result["error_code"], "not_allowed_in_skill")
        self.assertEqual(calls, [])

    def test_no_active_skill_means_no_scope(self):
        server, _ = _server()
        self.assertEqual(run(server, "private_update", user=_user())["status"], "updated")


class ProductionRegistryWiringTests(_CacheIsolated):
    """The rules above, proven on the real registry rather than the throwaway server."""

    def test_every_real_tool_refuses_an_anonymous_call(self):
        for name in mcp_server.list_tools():
            with self.subTest(tool=name):
                result = async_to_sync(mcp_server.dispatch)(name, {}, user=None)
                self.assertEqual(result["error_code"], "not_authenticated")

    def test_confirm_required_tools_advertise_the_token_in_their_schema(self):
        schemas = {s["name"]: s for s in mcp_server.tool_schemas()}
        for name in policy.CONFIRM_REQUIRED:
            with self.subTest(tool=name):
                self.assertIn(name, schemas)
                self.assertIn("confirmation_token", schemas[name]["input_schema"]["properties"])

    def test_no_confirm_or_outbound_tool_is_skill_safe(self):
        unsafe = (policy.CONFIRM_REQUIRED | policy.OUTBOUND_TOOLS) & set(mcp_server.skill_safe_tools())
        self.assertFalse(unsafe, f"must not be skill_safe: {sorted(unsafe)}")

    def test_every_voice_gated_tool_is_also_server_gated_or_outbound(self):
        from realtime.voice_policy import VOICE_CONFIRM_TOOLS

        loose = set(VOICE_CONFIRM_TOOLS) - (policy.CONFIRM_REQUIRED | policy.OUTBOUND_TOOLS)
        self.assertFalse(loose, f"gated by voice only: {sorted(loose)}")


class OutboundRecipientTests(TestCase):
    """send_sms / make_phone_call reach only numbers on file for the user or a teammate."""

    def setUp(self):
        from django.contrib.auth import get_user_model
        from accounts.models import Account
        from team.models import TeamMember, UserProfile

        cache.clear()
        self.addCleanup(cache.clear)
        User = get_user_model()
        self.me = User.objects.create_user("sms-me", password="x")
        UserProfile.objects.create(user=self.me, phone_number="+14155550100")
        mate = User.objects.create_user("sms-mate", password="x")
        UserProfile.objects.create(user=mate, phone_number="+1 (415) 555-0111", display_name="Mate")
        stranger = User.objects.create_user("sms-stranger", password="x")
        UserProfile.objects.create(user=stranger, phone_number="+14155550199")
        acct = Account.objects.create(company_name="Shared Co")
        acct.team_members.add(
            TeamMember.objects.create(user=self.me, full_name="Me", email="me@x.test"),
            TeamMember.objects.create(user=mate, full_name="Mate", email="mate@x.test"),
        )
        TeamMember.objects.create(user=stranger, full_name="Stranger", email="s@x.test")

    def _send(self, to, confirmed=True):
        from django.test import override_settings as ov
        with ov(TWILIO_ACCOUNT_SID="AC1", TWILIO_AUTH_TOKEN="t", TWILIO_PHONE_NUMBER="+15550000000"), \
             mock.patch("twilio.rest.Client") as client:
            client.return_value.messages.create.return_value = SimpleNamespace(sid="SM1", status="queued")
            result = async_to_sync(mcp_server.dispatch)("send_sms", {"to": to, "body": "hi"},
                                                        user=self.me, confirmed=confirmed)
            return result, client

    def test_own_and_teammate_numbers_are_allowed(self):
        from agents.mcp_server import _allowed_phone_numbers
        allowed = _allowed_phone_numbers(self.me)
        self.assertEqual(set(allowed), {"+14155550100", "+14155550111"})
        self.assertEqual(allowed["+14155550100"], "you")

    def test_a_teammate_number_is_sent_with_formatting_stripped(self):
        result, client = self._send("+1 415 555 0111")
        self.assertEqual(result["status"], "sent", result)
        self.assertEqual(client.return_value.messages.create.call_args.kwargs["to"], "+14155550111")
        self.assertEqual(result["to"], "Mate")

    def test_an_unrelated_number_is_refused_and_nothing_is_sent(self):
        result, client = self._send("+14155550199")
        self.assertEqual(result["error_code"], "recipient_not_allowed")
        client.return_value.messages.create.assert_not_called()

    def test_an_arbitrary_number_is_refused(self):
        result, client = self._send("+19995551234")
        self.assertEqual(result["error_code"], "recipient_not_allowed")

    def test_unconfirmed_sms_never_reaches_twilio(self):
        result, client = self._send("+14155550111", confirmed=False)
        self.assertEqual(result["error_code"], "confirmation_required")
        client.return_value.messages.create.assert_not_called()

    @override_settings(AGENT_TOOL_RATE_LIMITS_ENABLED=True)
    def test_one_recipient_is_capped_per_hour(self):
        for _ in range(3):
            self.assertEqual(self._send("+14155550111")[0]["status"], "sent")
        # Fourth to the same person is refused, even though the overall budget (5) remains.
        refused = self._send("+14155550111")[0]
        self.assertEqual(refused["error_code"], "rate_limited")
        self.assertNotIn("5550111", refused["message"])  # the number is not echoed back

    def test_a_twilio_error_does_not_leak_the_account_sid(self):
        from django.test import override_settings as ov
        with ov(TWILIO_ACCOUNT_SID="AC1", TWILIO_AUTH_TOKEN="t", TWILIO_PHONE_NUMBER="+15550000000"), \
             mock.patch("twilio.rest.Client") as client:
            boom = RuntimeError("HTTP 429 error: Unable to create record: /Accounts/ACSECRET123/Messages.json")
            boom.code = 20429
            client.return_value.messages.create.side_effect = boom
            result = async_to_sync(mcp_server.dispatch)("send_sms", {"to": "+14155550111", "body": "hi"},
                                                        user=self.me, confirmed=True)
        self.assertEqual(result["error_code"], "upstream_rate_limited")
        self.assertNotIn("ACSECRET123", str(result))
