"""
Tests for realtime.voice_policy — the spoken confirmation gate's pure logic.

No I/O here; the wiring into the agent loop and the consumer is covered by
test_voice_agent.py and test_consumers.py.
"""

from django.test import SimpleTestCase, override_settings

from realtime.voice_policy import (
    AFFIRM_RE,
    CONFIRMATION_SENTINEL,
    DENY_RE,
    MAX_UNCLEAR_ASKS,
    VOICE_BLOCKED_TOOLS,
    VOICE_CONFIRM_TOOLS,
    PendingConfirmation,
    VoiceTurnState,
    _digits,
    _trim,
    classify_dtmf,
    classify_reply,
    confirmation_result_content,
    gate_for,
    spoken_summary,
)


class ClassifyReplyTests(SimpleTestCase):
    def test_affirmative_tokens(self):
        for word in [
            "yes", "Yes.", "yeah", "yep", "yup", "confirm", "confirmed",
            "do it", "go ahead", "please do", "correct", "affirmative",
            "that's right", "thats right", "sounds good",
        ]:
            self.assertEqual(classify_reply(word), "affirm", word)

    def test_negative_tokens(self):
        for word in [
            "no", "Nope", "nah", "cancel", "stop", "don't", "dont",
            "do not", "nevermind", "never mind", "abort", "forget it", "negative",
        ]:
            self.assertEqual(classify_reply(word), "deny", word)

    def test_deny_wins_on_a_mixed_reply(self):
        """"yes, no wait, cancel" must never delete anything."""
        self.assertEqual(classify_reply("yes, no wait, cancel"), "deny")
        self.assertEqual(classify_reply("go ahead — actually no"), "deny")

    def test_unclear_replies(self):
        for word in ["maybe", "", "hmm", "what did you say", "delete the thing"]:
            self.assertEqual(classify_reply(word), "unclear", word)

    def test_yeah_is_affirmative_which_is_why_ignorebackchannel_stays_off(self):
        self.assertEqual(classify_reply("yeah"), "affirm")

    def test_matching_is_word_bounded(self):
        """"nostalgia" contains "no"; it must not read as a denial."""
        self.assertEqual(classify_reply("nostalgia"), "unclear")
        self.assertEqual(classify_reply("yesterday"), "unclear")

    def test_regexes_are_case_insensitive(self):
        self.assertTrue(AFFIRM_RE.search("YES"))
        self.assertTrue(DENY_RE.search("CANCEL"))


class ClassifyDtmfTests(SimpleTestCase):
    def test_one_confirms(self):
        self.assertEqual(classify_dtmf("1"), "affirm")

    def test_two_and_star_deny(self):
        self.assertEqual(classify_dtmf("2"), "deny")
        self.assertEqual(classify_dtmf("*"), "deny")

    def test_other_digits_are_ignored(self):
        for digit in ["0", "3", "7", "9", "#", ""]:
            self.assertEqual(classify_dtmf(digit), "unclear", digit)


class DigitsTests(SimpleTestCase):
    def test_north_american_number_is_grouped_and_says_plus(self):
        spoken = _digits("+15551234567")
        self.assertEqual(spoken, "plus 1, 555, 123, 4567")

    def test_ten_digit_number_is_grouped(self):
        self.assertEqual(_digits("5551234567"), "555, 123, 4567")

    def test_formatting_characters_are_stripped(self):
        self.assertEqual(_digits("(555) 123-4567"), "555, 123, 4567")

    def test_international_number_falls_back_to_three_digit_groups(self):
        spoken = _digits("+442071234567")
        self.assertTrue(spoken.startswith("plus, 442"))
        self.assertIn(",", spoken)

    def test_empty_and_garbage_degrade_gracefully(self):
        self.assertEqual(_digits(""), "that number")
        self.assertEqual(_digits("not a number"), "that number")


class TrimTests(SimpleTestCase):
    def test_short_text_is_unchanged(self):
        self.assertEqual(_trim("hello there"), "hello there")

    def test_whitespace_is_collapsed(self):
        self.assertEqual(_trim("a   b\n c"), "a b c")

    def test_long_text_is_bounded(self):
        result = _trim("x" * 500)
        self.assertLess(len(result), 200)
        self.assertTrue(result.endswith("and so on"))


class ConfirmToolsTests(SimpleTestCase):
    EXPECTED = {
        "delete_action_item",
        "delete_meeting",
        "delete_calendar_event",
        "send_sms",
        "make_phone_call",
        # Writes timesheet rows into Salesforce Cloud Coach on the user's behalf.
        "log_time_week",
    }

    def test_gate_covers_exactly_the_expected_tools(self):
        self.assertEqual(set(VOICE_CONFIRM_TOOLS), self.EXPECTED)

    def test_log_time_week_is_gated_as_outbound_not_destructive(self):
        # It writes to a third party on the user's behalf — the same trust level as
        # send_sms. Nothing local is destroyed, so "destructive" would overstate it.
        self.assertEqual(VOICE_CONFIRM_TOOLS["log_time_week"].category, "outbound")

    def test_log_time_week_summary_survives_missing_arguments(self):
        # Both arguments are optional on the tool, so the spoken sentence must still read
        # naturally when the model calls it bare.
        spoken = spoken_summary("log_time_week", {})
        self.assertIn("this week", spoken)
        self.assertIn("Cloud Coach", spoken)

    def test_log_time_week_summary_names_the_week_and_account(self):
        spoken = spoken_summary(
            "log_time_week", {"week_start": "2026-08-31", "account_name": "Acme"}
        )
        self.assertIn("2026-08-31", spoken)
        self.assertIn("Acme", spoken)

    def test_the_salesforce_write_tool_takes_no_confirm_argument(self):
        """
        The interim `confirm=` gate (salesforce_sync/voice_gate.py, now deleted) is
        replaced by this spoken gate. Both would make voice ask twice.
        """
        import inspect
        from agents.mcp_server import mcp_server
        params = inspect.signature(mcp_server._registry["log_time_week"]).parameters
        self.assertNotIn("confirm", params)

    def test_every_gated_name_is_a_real_registered_tool(self):
        """A rename in mcp_server.py must not silently disarm a gate."""
        from agents.mcp_server import mcp_server
        registered = set(mcp_server.list_tools())
        for name in VOICE_CONFIRM_TOOLS:
            self.assertIn(name, registered, f"{name} is gated but not registered")

    def test_every_delete_tool_is_gated(self):
        """The gate must not fall behind the registry as delete tools are added."""
        from agents.mcp_server import mcp_server
        deletes = [n for n in mcp_server.list_tools() if n.startswith("delete_")]
        for name in deletes:
            self.assertIn(name, VOICE_CONFIRM_TOOLS, f"{name} is ungated")

    def test_every_outbound_communication_tool_is_gated(self):
        from agents.mcp_server import mcp_server
        for name in mcp_server.grouped_catalog().get("communicate", []):
            self.assertIn(name[0], VOICE_CONFIRM_TOOLS)

    def test_categories_are_valid(self):
        for name, spec in VOICE_CONFIRM_TOOLS.items():
            self.assertIn(spec.category, ("destructive", "outbound"), name)

    def test_every_summarizer_handles_missing_arguments(self):
        """A KeyError here would break the gate open on a malformed tool call."""
        for name in VOICE_CONFIRM_TOOLS:
            spoken = spoken_summary(name, {})
            self.assertTrue(spoken.strip(), name)

    def test_summaries_read_as_spoken_sentences(self):
        self.assertEqual(
            spoken_summary("send_sms", {"to": "+15005550006", "body": "test"}),
            "text plus 1, 500, 555, 0006 saying: test",
        )
        self.assertEqual(
            spoken_summary("delete_action_item", {"airtable_id": "recABC"}),
            "permanently delete the action item recABC",
        )

    def test_a_raising_summarizer_does_not_break_the_gate(self):
        class Boom(dict):
            def get(self, *a, **k):
                raise RuntimeError("boom")

        # Must be non-empty: spoken_summary's `arguments or {}` guard would otherwise
        # substitute a plain dict and the summariser would never raise at all.
        boom = Boom(to="+15551234567")
        self.assertIn("send sms", spoken_summary("send_sms", boom))

    def test_none_arguments_do_not_raise(self):
        self.assertTrue(spoken_summary("send_sms", None).strip())

    def test_gate_for_returns_none_for_ungated_tools(self):
        self.assertIsNone(gate_for("search_records"))
        self.assertIsNotNone(gate_for("send_sms"))

    def test_blocked_tools_is_empty_by_default(self):
        self.assertEqual(VOICE_BLOCKED_TOOLS, frozenset())


class ConfirmationResultContentTests(SimpleTestCase):
    def test_content_carries_the_sentinel_and_forbids_recalling(self):
        content = confirmation_result_content("delete the thing")
        self.assertIn(CONFIRMATION_SENTINEL, content)
        self.assertIn("Do not call this tool again", content)

    def test_content_offers_both_speech_and_keypad(self):
        content = confirmation_result_content("delete the thing")
        self.assertIn("Say yes", content)
        self.assertIn("press 1", content)


class VoiceTurnStateTests(SimpleTestCase):
    def test_arm_then_clear(self):
        state = VoiceTurnState()
        self.assertIsNone(state.pending)
        state.arm("send_sms", {"to": "+15551234567"}, "text someone", now=100.0)
        self.assertEqual(state.pending.tool_name, "send_sms")
        state.clear()
        self.assertIsNone(state.pending)

    def test_arm_copies_the_arguments(self):
        """The model must not be able to mutate the args between ask and execute."""
        state = VoiceTurnState()
        args = {"to": "+15551234567"}
        state.arm("send_sms", args, "text someone", now=0.0)
        args["to"] = "+19995550000"
        self.assertEqual(state.pending.arguments["to"], "+15551234567")

    @override_settings(VOICE_CONFIRM_TTL_SECONDS=90)
    def test_expire_keeps_a_fresh_pending(self):
        state = VoiceTurnState()
        state.arm("send_sms", {}, "text someone", now=100.0)
        self.assertFalse(state.expire(now=150.0))
        self.assertIsNotNone(state.pending)

    @override_settings(VOICE_CONFIRM_TTL_SECONDS=90)
    def test_expire_clears_a_stale_pending(self):
        state = VoiceTurnState()
        state.arm("send_sms", {}, "text someone", now=100.0)
        self.assertTrue(state.expire(now=200.0))
        self.assertIsNone(state.pending)

    def test_expire_on_empty_state_is_a_noop(self):
        self.assertFalse(VoiceTurnState().expire(now=1.0))

    def test_question_is_one_spoken_sentence(self):
        pending = PendingConfirmation("send_sms", {}, "text someone", created_at=0.0)
        question = pending.question()
        self.assertTrue(question.startswith("Just to confirm"))
        self.assertIn("press 1", question)

    def test_two_strike_escape_is_configured(self):
        self.assertEqual(MAX_UNCLEAR_ASKS, 2)
