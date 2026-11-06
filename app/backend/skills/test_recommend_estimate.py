"""Claude recommended tools, and Claude's per-skill token estimate (admin)."""

import json
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase
from rest_framework.test import APITestCase

from agents.mcp_server import mcp_server
from skills import token_estimate as te
from skills.claude_json import loads_object
from skills.models import AgentSkill, AgentSkillAttachment
from team.models import UserProfile

User = get_user_model()
URL = "/api/v1/skills/agent-skills/"


def fake_client(reply):
    """A stand-in for the Anthropic client returning `reply` (str or dict) as the model's text."""
    text = reply if isinstance(reply, (str, Exception)) else json.dumps(reply)
    calls = []

    class _Messages:
        def create(self, **kw):
            calls.append(kw)
            if isinstance(reply, Exception):
                raise reply
            return SimpleNamespace(content=[SimpleNamespace(text=text)])  # type: ignore[arg-type]

    return SimpleNamespace(messages=_Messages(), calls=calls)


def patch_llm(client):
    return patch("skills.views._llm_client", return_value=client)


class LoadsObjectTests(SimpleTestCase):
    def test_plain_fenced_and_chatty_replies(self):
        self.assertEqual(loads_object('{"a": 1}'), {"a": 1})
        self.assertEqual(loads_object('```json\n{"a": 1}\n```'), {"a": 1})
        self.assertEqual(loads_object('Sure! {"a": 1} hope that helps'), {"a": 1})

    def test_garbage_raises(self):
        for bad in ("", "no json here", "[1, 2]", "{broken"):
            with self.assertRaises(Exception):
                loads_object(bad)


class RecommendToolsTests(APITestCase):
    URL = URL + "recommend-tools/"

    def setUp(self):
        self.user = User.objects.create_user("author", password="x")
        self.client.force_authenticate(self.user)
        self.safe = mcp_server.skill_safe_tools()

    def test_requires_login_and_a_description(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.post(self.URL, {"description": "x"}, format="json").status_code, 401)
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.post(self.URL, {"description": "  "}, format="json").status_code, 400)
        self.assertEqual(self.client.post(self.URL, {"description": "x" * 4001}, format="json").status_code, 400)

    def test_returns_valid_tools_with_reasons(self):
        name = self.safe[0]
        client = fake_client({"tools": [{"name": name, "reason": "to look things up"}], "limitations": []})
        with patch_llm(client):
            r = self.client.post(self.URL, {"description": "Summarise my accounts weekly"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["tools"], [{"name": name, "reason": "to look things up"}])

    def test_invented_unsafe_and_duplicate_tools_never_reach_the_user(self):
        reply = {"tools": [
            {"name": self.safe[0], "reason": "ok"},
            {"name": self.safe[0], "reason": "dup"},
            {"name": "totally_made_up", "reason": "x"},
            {"name": "delete_action_item", "reason": "forbidden for skills"},
            {"name": "send_sms", "reason": "outbound"},
            "not-a-dict",
        ], "limitations": ["Sending texts isn't available to skills", 7]}
        with patch_llm(fake_client(reply)):
            r = self.client.post(self.URL, {"description": "Text my team"}, format="json")
        self.assertEqual([t["name"] for t in r.data["tools"]], [self.safe[0]])
        self.assertEqual(r.data["limitations"], ["Sending texts isn't available to skills"])

    def test_result_is_capped(self):
        reply = {"tools": [{"name": n, "reason": "r"} for n in self.safe], "limitations": []}
        with patch_llm(fake_client(reply)):
            r = self.client.post(self.URL, {"description": "do everything"}, format="json")
        self.assertLessEqual(len(r.data["tools"]), 15)

    def test_the_model_is_shown_only_the_skill_safe_catalog(self):
        client = fake_client({"tools": [], "limitations": []})
        with patch_llm(client):
            self.client.post(self.URL, {"description": "d", "instructions": "step one"}, format="json")
        prompt = client.calls[0]["messages"][0]["content"]
        self.assertIn(self.safe[0], prompt)
        self.assertNotIn("delete_action_item", prompt)
        self.assertNotIn("send_sms", prompt)
        self.assertIn("step one", prompt)

    def test_nothing_is_saved(self):
        before = AgentSkill.objects.count()      # a migration seeds one skill into every test DB
        with patch_llm(fake_client({"tools": [{"name": self.safe[0], "reason": "r"}], "limitations": []})):
            self.client.post(self.URL, {"description": "d"}, format="json")
        self.assertEqual(AgentSkill.objects.count(), before)

    def test_failure_returns_a_fixed_message_without_the_exception_text(self):
        with patch_llm(fake_client(RuntimeError("secret-token-abc"))):
            r = self.client.post(self.URL, {"description": "d"}, format="json")
        self.assertEqual(r.status_code, 502)
        self.assertNotIn("secret-token-abc", json.dumps(r.data))

    def test_unparseable_reply_is_a_clean_failure(self):
        with patch_llm(fake_client("I could not decide.")):
            r = self.client.post(self.URL, {"description": "d"}, format="json")
        self.assertEqual(r.status_code, 502)


class TotalsArithmeticTests(SimpleTestCase):
    def test_one_round_has_no_carried_context(self):
        self.assertEqual(te.totals(1, base=10_000, prompt=500, tool_result=2000, out_per_round=300),
                         {"rounds": 1, "input": 10_500, "output": 300, "total": 10_800})

    def test_later_rounds_resend_everything_that_came_before(self):
        # 3 rounds: inputs are 10500, 10500+2300, 10500+2*2300 = 10500+12800+15100 = 38400
        t = te.totals(3, base=10_000, prompt=500, tool_result=2000, out_per_round=300)
        self.assertEqual((t["input"], t["output"], t["total"]), (38_400, 900, 39_300))


def admin_user():
    u = User.objects.create_user("admin2", password="x", is_staff=True)
    UserProfile.objects.get_or_create(user=u)
    return u


class TokenEstimateTests(APITestCase):
    URL = URL + "token-estimates/"
    REPLY = {"rounds_expected": 3, "rounds_low": 2, "rounds_high": 6,
             "tool_result_tokens_per_round": 1500, "output_tokens_per_round": 400, "rationale": "Looks up then summarises."}

    def setUp(self):
        self.admin = admin_user()
        self.basic = User.objects.create_user("basic2", password="x")
        self.skill = AgentSkill.objects.create(name="weekly", description="d", instructions="Summarise accounts.",
                                               status="approved", created_by=self.basic, allowed_tools=["search_records"])
        # `get-meeting-notes` is seeded by a migration into every test DB; keep it out of the way.
        AgentSkill.objects.filter(name="get-meeting-notes").delete()
        self.client.force_authenticate(self.admin)

    def test_admin_only(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(self.URL).status_code, 401)
        self.client.force_authenticate(self.basic)
        self.assertEqual(self.client.get(self.URL).status_code, 403)
        self.assertEqual(self.client.post(self.URL, {"skill_id": self.skill.pk}, format="json").status_code, 403)

    def test_unestimated_skills_are_listed_as_stale_with_no_estimate(self):
        r = self.client.get(self.URL)
        row = r.data["results"][0]
        self.assertEqual((row["name"], row["estimate"], row["stale"]), ("weekly", None, True))

    def test_estimate_uses_claudes_judgement_but_computes_the_totals_itself(self):
        with patch_llm(fake_client(self.REPLY)):
            r = self.client.post(self.URL, {"skill_id": self.skill.pk}, format="json")
        self.assertEqual(r.status_code, 200)
        row = r.data["results"][0]
        base, prompt = row["estimate"]["facts"]["base_round_input_tokens"], row["estimate"]["facts"]["skill_prompt_tokens"]
        self.assertEqual(row["estimate"]["expected"], te.totals(3, base, prompt, 1500, 400))
        self.assertEqual(row["estimate"]["low"]["rounds"], 2)
        self.assertEqual(row["estimate"]["high"]["rounds"], 6)
        self.assertGreater(base, 1000)       # the measured per-round fixed input is real, not zero
        self.assertFalse(row["stale"])
        self.assertIn("expected_usd", row)
        self.skill.refresh_from_db()
        self.assertTrue(self.skill.token_estimate)

    def test_absurd_numbers_are_clamped(self):
        wild = dict(self.REPLY, rounds_expected=500, rounds_low=900, rounds_high=-4,
                    tool_result_tokens_per_round=10**9, output_tokens_per_round=10**9)
        with patch_llm(fake_client(wild)):
            r = self.client.post(self.URL, {"skill_id": self.skill.pk}, format="json")
        est = r.data["results"][0]["estimate"]
        self.assertEqual(est["expected"]["rounds"], te.MAX_ROUNDS)
        self.assertLessEqual(est["low"]["rounds"], est["expected"]["rounds"])
        self.assertGreaterEqual(est["high"]["rounds"], est["expected"]["rounds"])
        self.assertEqual(est["params"]["tool_result_tokens_per_round"], te.MAX_TOOL_RESULT_TOKENS)
        self.assertEqual(est["params"]["output_tokens_per_round"], te.MAX_OUTPUT_TOKENS)

    def test_missing_fields_fall_back_to_defaults(self):
        with patch_llm(fake_client({"rationale": "?"})):
            r = self.client.post(self.URL, {"skill_id": self.skill.pk}, format="json")
        self.assertEqual(r.data["results"][0]["estimate"]["expected"]["rounds"], 3)

    def test_editing_the_skill_makes_its_estimate_stale(self):
        with patch_llm(fake_client(self.REPLY)):
            self.client.post(self.URL, {"skill_id": self.skill.pk}, format="json")
        self.skill.instructions = "Now much longer instructions."
        self.skill.save()
        self.assertTrue(self.client.get(self.URL).data["results"][0]["stale"])

    def test_attachments_and_instructions_raise_the_measured_prompt_size(self):
        small = te.skill_facts(self.skill)["skill_prompt_tokens"]
        AgentSkillAttachment.objects.create(skill=self.skill, name="big.md", text="word " * 20_000)
        big = te.skill_facts(AgentSkill.objects.get(pk=self.skill.pk))["skill_prompt_tokens"]
        self.assertGreater(big, small + 5_000)
        self.assertLessEqual(big - small, te.ATTACHMENT_CHAR_CAP // te.CHARS_PER_TOKEN + 10)   # capped

    def test_batch_estimates_only_stale_skills_and_reports_failures(self):
        AgentSkill.objects.create(name="second", description="d", instructions="i", created_by=self.basic)
        bad = fake_client("not json")
        with patch_llm(bad):
            r = self.client.post(self.URL, {}, format="json")
        self.assertEqual(sorted(r.data["failed"]), ["second", "weekly"])
        with patch_llm(fake_client(self.REPLY)):
            self.client.post(self.URL, {}, format="json")
            again = fake_client(self.REPLY)
        with patch_llm(again):
            self.client.post(self.URL, {}, format="json")
        self.assertEqual(again.calls, [])      # nothing left to do: no wasted model calls

    def test_batch_is_capped_per_request(self):
        for i in range(12):
            AgentSkill.objects.create(name=f"bulk-{i}", description="d", instructions="i", created_by=self.basic)
        client = fake_client(self.REPLY)
        with patch_llm(client):
            r = self.client.post(self.URL, {}, format="json")
        self.assertEqual(len(client.calls), 10)
        self.assertEqual(r.data["remaining"], 3)

    def test_unknown_skill_is_404_and_failure_text_is_not_leaked(self):
        with patch_llm(fake_client(self.REPLY)):
            self.assertEqual(self.client.post(self.URL, {"skill_id": 99999}, format="json").status_code, 404)
        with patch_llm(fake_client(RuntimeError("secret-key-xyz"))):
            r = self.client.post(self.URL, {"skill_id": self.skill.pk}, format="json")
        self.assertNotIn("secret-key-xyz", json.dumps(r.data, default=str))
