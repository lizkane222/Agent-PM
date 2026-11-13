"""
Generating a skill with Claude.

Regression: instructions that contained a code block made the reply unparseable (the old code
split the reply on every triple-backtick), and the repair routine then dropped `instructions`
and returned HTTP 200 — so the form showed "Designing instructions…" and then nothing.
"""

import json
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from skills import views as v

User = get_user_model()
URL = "/api/v1/skills/agent-skills/generate/"

INSTRUCTIONS_WITH_CODE = (
    "## Weekly update\n\n1. Look up the accounts.\n2. Write it in this shape:\n\n"
    '```\n## [Account Name] — Weekly Update\n**Status:** "On track"\n* Key initiative\n```\n\n3. Done.'
)
SKILL = {"name": "weekly-update", "description": "Use for weekly updates.", "instructions": INSTRUCTIONS_WITH_CODE,
         "allowed_tools": ["search_records"], "needs_script": False, "script": ""}


def tool_reply(payload, stop="tool_use"):
    block = SimpleNamespace(type="tool_use", name="define_skill", input=payload)
    return SimpleNamespace(content=[block], stop_reason=stop, usage=SimpleNamespace(input_tokens=1, output_tokens=1))


def text_reply(text, stop="end_turn"):
    return SimpleNamespace(content=[SimpleNamespace(type="text", text=text)], stop_reason=stop,
                           usage=SimpleNamespace(input_tokens=1, output_tokens=1))


class FakeClient:
    def __init__(self, reply):
        self.calls = []
        outer = self

        class _M:
            def create(self, **kw):
                outer.calls.append(kw)
                if isinstance(reply, Exception):
                    raise reply
                return reply

        self.messages = _M()


class SkillFromResponseTests(APITestCase):
    def test_tool_call_returns_the_whole_skill_code_blocks_included(self):
        out = v._skill_from_response(tool_reply(SKILL))
        self.assertEqual(out["instructions"], INSTRUCTIONS_WITH_CODE)
        self.assertEqual(out["allowed_tools"], ["search_records"])

    def test_text_reply_in_a_json_fence_with_a_code_block_inside_is_read_in_full(self):
        """The reported bug: the first inner ``` used to end the JSON early."""
        text = "```json\n" + json.dumps(SKILL, indent=2) + "\n```"
        self.assertEqual(text.count("```"), 4)               # outer pair + the pair inside the instructions
        out = v._skill_from_response(text_reply(text))
        self.assertEqual(out["instructions"], INSTRUCTIONS_WITH_CODE)

    def test_plain_and_chatty_text_replies(self):
        self.assertEqual(v._skill_from_response(text_reply(json.dumps(SKILL)))["name"], "weekly-update")
        chatty = "Here you go:\n" + json.dumps(SKILL) + "\nHope that helps!"
        self.assertEqual(v._skill_from_response(text_reply(chatty))["name"], "weekly-update")

    def test_a_reply_cut_off_at_the_token_limit_is_an_error_not_a_partial_skill(self):
        with self.assertRaisesRegex(v.GenerationIncomplete, "ran out of room"):
            v._skill_from_response(tool_reply(SKILL, stop="max_tokens"))

    def test_missing_or_blank_required_fields_are_errors(self):
        for field in ("name", "description", "instructions"):
            for bad in (None, "", "   ", 5):
                payload = {**SKILL, field: bad}
                with self.assertRaises(v.GenerationIncomplete, msg=f"{field}={bad!r}"):
                    v._skill_from_response(tool_reply(payload))
        no_instructions = {k: x for k, x in SKILL.items() if k != "instructions"}
        with self.assertRaises(v.GenerationIncomplete):
            v._skill_from_response(tool_reply(no_instructions))

    def test_unreadable_text_is_an_error(self):
        for bad in ("", "I couldn't do that.", "{not json", "[1, 2]"):
            with self.assertRaises(v.GenerationIncomplete, msg=bad):
                v._skill_from_response(text_reply(bad))

    def test_odd_optional_fields_are_normalised(self):
        out = v._skill_from_response(tool_reply({**SKILL, "allowed_tools": "search_records", "needs_script": "yes", "script": None}))
        self.assertEqual((out["allowed_tools"], out["needs_script"], out["script"]), ([], True, ""))
        out = v._skill_from_response(tool_reply({**SKILL, "allowed_tools": ["a", 7, None, "b"]}))
        self.assertEqual(out["allowed_tools"], ["a", "b"])


class GenerateEndpointTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("gen_user", password="x")
        self.client.force_authenticate(self.user)

    def post(self, reply, body=None):
        client = FakeClient(reply)
        with patch("skills.views._llm_client", return_value=client), patch("skills.views._record_usage") as usage:
            r = self.client.post(URL, body or {"description": "Weekly updates"}, format="json")
        return r, client, usage

    def test_requires_login_and_a_description(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.post(URL, {"description": "x"}, format="json").status_code, 401)
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.post(URL, {"description": " "}, format="json").status_code, 400)

    def test_success_returns_every_field_the_form_fills(self):
        r, _, _ = self.post(tool_reply(SKILL))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(set(r.data), {"name", "description", "instructions", "allowed_tools", "needs_script", "script"})
        self.assertEqual(r.data["instructions"], INSTRUCTIONS_WITH_CODE)

    def test_it_asks_for_a_forced_tool_call_and_passes_the_authors_choices(self):
        _, client, usage = self.post(tool_reply(SKILL), {
            "description": "Weekly updates", "context": {"capabilities": ["search_records"], "needs_accounts": True}})
        call = client.calls[0]
        self.assertEqual(call["tool_choice"], {"type": "tool", "name": "define_skill"})
        self.assertEqual(call["tools"][0]["name"], "define_skill")
        self.assertIn("search_records", call["messages"][0]["content"])
        self.assertIn("choose one or more accounts", call["messages"][0]["content"])
        usage.assert_called_once()

    def test_an_incomplete_reply_is_a_clear_502_never_a_200_without_instructions(self):
        """This is the reported symptom: success status, no instructions, no error."""
        no_instructions = {k: x for k, x in SKILL.items() if k != "instructions"}
        for reply in (tool_reply(no_instructions), tool_reply(SKILL, stop="max_tokens"), text_reply("nope")):
            r, _, _ = self.post(reply)
            self.assertEqual(r.status_code, 502)
            self.assertTrue(r.data["detail"])
            self.assertNotIn("name", r.data)

    def test_other_failures_are_a_fixed_message_without_the_exception_text(self):
        r, _, _ = self.post(RuntimeError("secret-token-123"))
        self.assertEqual(r.status_code, 502)
        self.assertNotIn("secret-token-123", json.dumps(r.data))
