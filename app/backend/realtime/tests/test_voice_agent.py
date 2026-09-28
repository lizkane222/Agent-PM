"""
Tests for realtime.voice_agent — the voice agentic loop.

Replaces test_llm.py, whose six tests all targeted the deleted bedrock_stream.

The Anthropic client is always a fake, so nothing reaches Bedrock. The fakes are
modelled on the _FakeStream / _FakeMessages / FakeClient trio in
agents/tests/test_agent.py, extended so a scripted sequence can drive
tool_use → tool_use → end_turn and so each round's stream kwargs are inspectable.

SimpleTestCase throughout: mcp_server.dispatch is patched in every test, so no test
touches the database.
"""

from unittest.mock import AsyncMock, patch

from django.test import SimpleTestCase, override_settings

from realtime.voice_agent import (
    FILLERS,
    TOOL_ERROR_MESSAGE,
    TOOL_TIMEOUT_MESSAGE,
    WRAP_UP_NUDGE,
    VoiceAgent,
    build_voice_system_prompt,
    dispatch_confirmed,
)
from realtime.voice_policy import CONFIRMATION_SENTINEL, VoiceTurnState

TIERS = {
    "bedrock": {"default": "claude-b-sonnet", "strong": "claude-b-sonnet5", "voice": "claude-b-haiku"},
    "gateway": {"default": "claude-g-sonnet", "strong": "claude-g-sonnet5", "voice": "claude-g-haiku"},
}

VOICE_SETTINGS = dict(
    AGENT_MODEL_TIERS=TIERS,
    AGENT_MODEL_OVERRIDE="",
    AGENT_BACKEND="bedrock",
    VOICE_MAX_TOKENS=512,
    VOICE_MAX_TOOL_ROUNDS=3,
    VOICE_TURN_BUDGET_SECONDS=20,
    VOICE_TOOL_TIMEOUT_SECONDS=8,
    VOICE_CONFIRM_TTL_SECONDS=90,
)


class _User:
    """Stands in for a Django User; only identity matters to these tests."""

    pk = 7

    def __repr__(self):
        return "<User 7>"


class _Usage:
    def __init__(self, input_tokens=0, output_tokens=0):
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens


class _Block:
    def __init__(self, type, *, name=None, id=None, input=None, text=None):
        self.type = type
        self.name = name
        self.id = id
        self.input = input
        self.text = text


def _tool_use(name, id="tu_1", **inp):
    return _Block("tool_use", name=name, id=id, input=inp)


class _Final:
    def __init__(self, content, usage=None, stop_reason="end_turn"):
        self.content = content
        self.usage = usage or _Usage(1, 1)
        self.stop_reason = stop_reason


class _Round:
    """One scripted model round: the text it streams and the message it finishes with."""

    def __init__(self, chunks=(), blocks=(), usage=None):
        self.chunks = list(chunks)
        tool_blocks = list(blocks)
        text_blocks = [_Block("text", text=c) for c in self.chunks]
        self.final = _Final(
            text_blocks + tool_blocks,
            usage=usage,
            stop_reason="tool_use" if tool_blocks else "end_turn",
        )


class _FakeStream:
    def __init__(self, round_):
        self._round = round_

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    @property
    def text_stream(self):
        async def _gen():
            for chunk in self._round.chunks:
                yield chunk

        return _gen()

    async def get_final_message(self):
        return self._round.final


class _FakeMessages:
    def __init__(self, rounds):
        self._rounds = list(rounds)
        self.stream_calls: list[dict] = []

    def stream(self, **kwargs):
        self.stream_calls.append(kwargs)
        if not self._rounds:
            raise AssertionError("fake client ran out of scripted rounds")
        return _FakeStream(self._rounds.pop(0))


class FakeClient:
    def __init__(self, rounds):
        self.messages = _FakeMessages(rounds)


async def _drain(agent, utterance="hi", messages=None):
    """Run a turn to completion, returning (events, messages)."""
    messages = [] if messages is None else messages
    events = [event async for event in agent.run_turn(utterance, messages)]
    return events, messages


def _kinds(events):
    return [e.kind for e in events]


def _spoken(events):
    return "".join(e.text for e in events if e.kind == "speak")


@override_settings(**VOICE_SETTINGS)
class VoiceAgentNoToolsTests(SimpleTestCase):
    async def test_streams_chunks_then_one_terminator_then_usage(self):
        agent = VoiceAgent(user=_User(), client=FakeClient([_Round(["Hello", " there"])]))
        with patch("realtime.voice_agent.mcp_server.dispatch", new=AsyncMock()) as dispatch:
            events, _ = await _drain(agent)
        self.assertEqual(_kinds(events), ["speak", "speak", "end_utterance", "usage"])
        self.assertEqual(_spoken(events), "Hello there")
        dispatch.assert_not_awaited()

    async def test_exactly_one_end_utterance(self):
        agent = VoiceAgent(user=_User(), client=FakeClient([_Round(["a", "b", "c"])]))
        with patch("realtime.voice_agent.mcp_server.dispatch", new=AsyncMock()):
            events, _ = await _drain(agent)
        self.assertEqual(_kinds(events).count("end_utterance"), 1)

    async def test_usage_is_the_last_event_and_carries_the_model(self):
        agent = VoiceAgent(
            user=_User(), client=FakeClient([_Round(["x"], usage=_Usage(11, 4))])
        )
        with patch("realtime.voice_agent.mcp_server.dispatch", new=AsyncMock()):
            events, _ = await _drain(agent)
        usage = events[-1]
        self.assertEqual(usage.kind, "usage")
        self.assertEqual(usage.payload["input_tokens"], 11)
        self.assertEqual(usage.payload["output_tokens"], 4)
        self.assertEqual(usage.payload["model"], "claude-b-haiku")

    async def test_no_nudge_when_within_budget(self):
        agent = VoiceAgent(user=_User(), client=FakeClient([_Round(["ok"])]))
        with patch("realtime.voice_agent.mcp_server.dispatch", new=AsyncMock()):
            _, messages = await _drain(agent)
        self.assertNotIn(WRAP_UP_NUDGE, str(messages))

    async def test_empty_chunks_do_not_emit_speak_events(self):
        agent = VoiceAgent(user=_User(), client=FakeClient([_Round(["", "hi", ""])]))
        with patch("realtime.voice_agent.mcp_server.dispatch", new=AsyncMock()):
            events, _ = await _drain(agent)
        self.assertEqual(_kinds(events).count("speak"), 1)


@override_settings(**VOICE_SETTINGS)
class VoiceAgentToolRoundTests(SimpleTestCase):
    async def test_one_tool_round_event_sequence(self):
        client = FakeClient([
            _Round(["Let me check that."], blocks=[_tool_use("search_records", query="acme")]),
            _Round(["You have two open items."]),
        ])
        agent = VoiceAgent(user=_User(), client=client)
        with patch("realtime.voice_agent.mcp_server.dispatch",
                   new=AsyncMock(return_value=[{"id": 1}])) as dispatch:
            events, _ = await _drain(agent)

        self.assertEqual(_kinds(events), [
            "speak", "end_utterance",
            "tool_started", "tool_finished",
            "speak", "end_utterance",
            "usage",
        ])
        dispatch.assert_awaited_once()

    async def test_dispatch_receives_the_resolved_user(self):
        """The requirement-1 assertion: tools run as the caller, not anonymously."""
        user = _User()
        client = FakeClient([
            _Round([], blocks=[_tool_use("search_records", query="acme")]),
            _Round(["done"]),
        ])
        agent = VoiceAgent(user=user, client=client)
        with patch("realtime.voice_agent.mcp_server.dispatch", new=AsyncMock(return_value=[])) as dispatch:
            await _drain(agent)
        self.assertIs(dispatch.await_args.kwargs["user"], user)
        self.assertEqual(dispatch.await_args.args[0], "search_records")
        self.assertEqual(dispatch.await_args.args[1], {"query": "acme"})

    async def test_filler_is_emitted_when_a_tool_round_produced_no_text(self):
        client = FakeClient([
            _Round([], blocks=[_tool_use("search_records")]),
            _Round(["here it is"]),
        ])
        agent = VoiceAgent(user=_User(), client=client)
        with patch("realtime.voice_agent.mcp_server.dispatch", new=AsyncMock(return_value=[])):
            events, _ = await _drain(agent)
        fillers = [e for e in events if e.kind == "speak" and e.text == FILLERS[0]]
        self.assertEqual(len(fillers), 1)
        self.assertTrue(fillers[0].preemptible, "filler must be pre-emptible by the real answer")

    async def test_no_filler_when_the_model_spoke_a_preamble(self):
        """The model's own preamble is the better filler, so canned text stays quiet."""
        client = FakeClient([
            _Round(["Let me look."], blocks=[_tool_use("search_records")]),
            _Round(["found it"]),
        ])
        agent = VoiceAgent(user=_User(), client=client)
        with patch("realtime.voice_agent.mcp_server.dispatch", new=AsyncMock(return_value=[])):
            events, _ = await _drain(agent)
        self.assertNotIn(FILLERS[0], [e.text for e in events])

    async def test_filler_text_is_deterministic_across_runs(self):
        async def run():
            client = FakeClient([
                _Round([], blocks=[_tool_use("search_records")]),
                _Round([], blocks=[_tool_use("search_records", id="tu_2")]),
                _Round(["done"]),
            ])
            agent = VoiceAgent(user=_User(), client=client)
            with patch("realtime.voice_agent.mcp_server.dispatch", new=AsyncMock(return_value=[])):
                events, _ = await _drain(agent)
            return [e.text for e in events if e.kind == "speak"]

        first = await run()
        second = await run()
        self.assertEqual(first, second)
        self.assertEqual(first[:2], [FILLERS[0], FILLERS[1]])

    async def test_every_tool_use_block_gets_a_matching_tool_result(self):
        """A missing tool_result 400s the next request, which is unrecoverable mid-call."""
        blocks = [
            _tool_use("search_records", id="tu_a", query="a"),
            _tool_use("get_airtable_records", id="tu_b", table="accounts"),
        ]
        client = FakeClient([_Round([], blocks=blocks), _Round(["done"])])
        agent = VoiceAgent(user=_User(), client=client)
        with patch("realtime.voice_agent.mcp_server.dispatch", new=AsyncMock(return_value=[])):
            await _drain(agent)

        second_call_messages = client.messages.stream_calls[1]["messages"]
        results = [
            block
            for message in second_call_messages
            if isinstance(message.get("content"), list)
            for block in message["content"]
            if isinstance(block, dict) and block.get("type") == "tool_result"
        ]
        self.assertEqual({r["tool_use_id"] for r in results}, {"tu_a", "tu_b"})

    async def test_parallel_tools_dispatch_concurrently(self):
        blocks = [
            _tool_use("search_records", id="tu_a"),
            _tool_use("get_airtable_records", id="tu_b"),
        ]
        client = FakeClient([_Round([], blocks=blocks), _Round(["done"])])
        agent = VoiceAgent(user=_User(), client=client)
        with patch("realtime.voice_agent.mcp_server.dispatch", new=AsyncMock(return_value=[])) as dispatch:
            await _drain(agent)
        self.assertEqual(dispatch.await_count, 2)


@override_settings(**VOICE_SETTINGS)
class VoiceAgentToolFailureTests(SimpleTestCase):
    async def test_timeout_yields_an_is_error_result_and_the_turn_still_terminates(self):
        client = FakeClient([
            _Round([], blocks=[_tool_use("search_records", id="tu_a")]),
            _Round(["couldn't reach it"]),
        ])
        agent = VoiceAgent(user=_User(), client=client)
        with patch("realtime.voice_agent.mcp_server.dispatch",
                   new=AsyncMock(side_effect=TimeoutError())):
            events, _ = await _drain(agent)

        results = _tool_results(client.messages.stream_calls[1]["messages"])
        self.assertTrue(results[0]["is_error"])
        self.assertEqual(results[0]["content"], TOOL_TIMEOUT_MESSAGE)
        self.assertEqual(_kinds(events)[-2:], ["end_utterance", "usage"])
        self.assertEqual(agent.records[0].status, "error")
        self.assertEqual(agent.records[0].error_message, "timeout")

    async def test_an_arbitrary_exception_is_reported_and_siblings_still_run(self):
        blocks = [
            _tool_use("search_records", id="tu_a"),
            _tool_use("get_airtable_records", id="tu_b"),
        ]
        client = FakeClient([_Round([], blocks=blocks), _Round(["partial"])])
        agent = VoiceAgent(user=_User(), client=client)

        async def flaky(name, arguments, user=None):
            if name == "search_records":
                raise RuntimeError("boom")
            return [{"ok": True}]

        with patch("realtime.voice_agent.mcp_server.dispatch", new=AsyncMock(side_effect=flaky)):
            await _drain(agent)

        results = {r["tool_use_id"]: r for r in _tool_results(client.messages.stream_calls[1]["messages"])}
        self.assertTrue(results["tu_a"].get("is_error"))
        self.assertEqual(results["tu_a"]["content"], TOOL_ERROR_MESSAGE)
        self.assertNotIn("is_error", results["tu_b"])
        self.assertIn("ok", results["tu_b"]["content"])

    async def test_exception_detail_is_recorded_but_not_spoken(self):
        client = FakeClient([
            _Round([], blocks=[_tool_use("search_records", id="tu_a")]),
            _Round(["sorry"]),
        ])
        agent = VoiceAgent(user=_User(), client=client)
        with patch("realtime.voice_agent.mcp_server.dispatch",
                   new=AsyncMock(side_effect=RuntimeError("secret-token-abc"))):
            events, _ = await _drain(agent)
        self.assertNotIn("secret-token-abc", _spoken(events))
        self.assertIn("secret-token-abc", agent.records[0].error_message)


@override_settings(**VOICE_SETTINGS)
class VoiceAgentBudgetTests(SimpleTestCase):
    @override_settings(VOICE_MAX_TOOL_ROUNDS=2)
    async def test_round_cap_appends_the_nudge_and_stops(self):
        rounds = [
            _Round([], blocks=[_tool_use("search_records", id=f"tu_{i}")])
            for i in range(3)
        ]
        client = FakeClient(rounds)
        agent = VoiceAgent(user=_User(), client=client)
        with patch("realtime.voice_agent.mcp_server.dispatch", new=AsyncMock(return_value=[])):
            events, messages = await _drain(agent)

        # max_rounds + 1 stream calls, never more.
        self.assertEqual(len(client.messages.stream_calls), 3)
        self.assertIn(WRAP_UP_NUDGE, str(messages))
        self.assertEqual(_kinds(events)[-2:], ["end_utterance", "usage"])

    @override_settings(VOICE_TURN_BUDGET_SECONDS=-1)
    async def test_over_budget_forces_the_wrap_up_round_immediately(self):
        client = FakeClient([_Round(["short answer"])])
        agent = VoiceAgent(user=_User(), client=client)
        with patch("realtime.voice_agent.mcp_server.dispatch", new=AsyncMock()) as dispatch:
            events, messages = await _drain(agent)

        self.assertEqual(len(client.messages.stream_calls), 1)
        self.assertIn(WRAP_UP_NUDGE, str(messages))
        self.assertEqual(_spoken(events), "short answer")
        dispatch.assert_not_awaited()

    @override_settings(VOICE_TURN_BUDGET_SECONDS=-1)
    async def test_tools_requested_on_a_forced_final_round_are_not_dispatched(self):
        client = FakeClient([_Round([], blocks=[_tool_use("delete_action_item", id="tu_a")])])
        agent = VoiceAgent(user=_User(), client=client)
        with patch("realtime.voice_agent.mcp_server.dispatch", new=AsyncMock()) as dispatch:
            events, _ = await _drain(agent)
        dispatch.assert_not_awaited()
        # Still terminated, so TTS is not left waiting.
        self.assertEqual(_kinds(events)[-2:], ["end_utterance", "usage"])

    async def test_nudge_merges_into_the_trailing_user_message(self):
        """
        Two consecutive user messages 400 the Messages API, and after a tool round the
        trailing message is already a user turn carrying tool_result blocks.
        """
        with override_settings(VOICE_MAX_TOOL_ROUNDS=1):
            client = FakeClient([
                _Round([], blocks=[_tool_use("search_records", id="tu_a")]),
                _Round(["done"]),
            ])
            agent = VoiceAgent(user=_User(), client=client)
            with patch("realtime.voice_agent.mcp_server.dispatch", new=AsyncMock(return_value=[])):
                _, messages = await _drain(agent)

        roles = [m["role"] for m in messages]
        for first, second in zip(roles, roles[1:]):
            self.assertNotEqual(first, second, f"consecutive {first} messages: {roles}")

    async def test_usage_sums_across_rounds(self):
        client = FakeClient([
            _Round([], blocks=[_tool_use("search_records")], usage=_Usage(10, 5)),
            _Round(["done"], usage=_Usage(20, 7)),
        ])
        agent = VoiceAgent(user=_User(), client=client)
        with patch("realtime.voice_agent.mcp_server.dispatch", new=AsyncMock(return_value=[])):
            events, _ = await _drain(agent)
        usage = events[-1].payload
        self.assertEqual(usage["input_tokens"], 30)
        self.assertEqual(usage["output_tokens"], 12)
        self.assertEqual(usage["rounds"], 2)


@override_settings(**VOICE_SETTINGS)
class VoiceAgentConfirmationGateTests(SimpleTestCase):
    async def test_gated_tool_is_not_dispatched_and_arms_the_state(self):
        state = VoiceTurnState()
        client = FakeClient([
            _Round([], blocks=[_tool_use("send_sms", id="tu_a", to="+15005550006", body="test")]),
            _Round(["Just to confirm — you want me to text that number?"]),
        ])
        agent = VoiceAgent(user=_User(), client=client, state=state)
        with patch("realtime.voice_agent.mcp_server.dispatch", new=AsyncMock()) as dispatch:
            await _drain(agent)

        dispatch.assert_not_awaited()
        self.assertIsNotNone(state.pending)
        self.assertEqual(state.pending.tool_name, "send_sms")
        self.assertEqual(state.pending.arguments["to"], "+15005550006")

        results = _tool_results(client.messages.stream_calls[1]["messages"])
        self.assertIn(CONFIRMATION_SENTINEL, results[0]["content"])
        self.assertIn("Do not call this tool again", results[0]["content"])

    async def test_gated_call_is_recorded_as_pending(self):
        state = VoiceTurnState()
        client = FakeClient([
            _Round([], blocks=[_tool_use("delete_action_item", id="tu_a", airtable_id="recX")]),
            _Round(["are you sure?"]),
        ])
        agent = VoiceAgent(user=_User(), client=client, state=state)
        with patch("realtime.voice_agent.mcp_server.dispatch", new=AsyncMock()):
            await _drain(agent)
        self.assertEqual(agent.records[0].status, "pending")
        self.assertTrue(agent.records[0].gated)

    async def test_a_non_gated_tool_in_the_same_turn_still_dispatches(self):
        """The gate is per-block, not per-turn."""
        state = VoiceTurnState()
        blocks = [
            _tool_use("search_records", id="tu_a", query="acme"),
            _tool_use("send_sms", id="tu_b", to="+15005550006", body="hi"),
        ]
        client = FakeClient([_Round([], blocks=blocks), _Round(["asking"])])
        agent = VoiceAgent(user=_User(), client=client, state=state)
        with patch("realtime.voice_agent.mcp_server.dispatch", new=AsyncMock(return_value=[])) as dispatch:
            await _drain(agent)

        self.assertEqual(dispatch.await_count, 1)
        self.assertEqual(dispatch.await_args.args[0], "search_records")
        self.assertIsNotNone(state.pending)

    async def test_two_gated_tools_in_one_turn_arm_only_the_first(self):
        """Two spoken questions in one utterance cannot be answered by one keypress."""
        state = VoiceTurnState()
        blocks = [
            _tool_use("delete_action_item", id="tu_a", airtable_id="recA"),
            _tool_use("delete_meeting", id="tu_b", airtable_id="recB"),
        ]
        client = FakeClient([_Round([], blocks=blocks), _Round(["asking"])])
        agent = VoiceAgent(user=_User(), client=client, state=state)
        with patch("realtime.voice_agent.mcp_server.dispatch", new=AsyncMock()) as dispatch:
            await _drain(agent)

        dispatch.assert_not_awaited()
        self.assertEqual(state.pending.tool_name, "delete_action_item")
        results = {r["tool_use_id"]: r["content"] for r in
                   _tool_results(client.messages.stream_calls[1]["messages"])}
        self.assertIn(CONFIRMATION_SENTINEL, results["tu_a"])
        self.assertIn("already pending", results["tu_b"])

    async def test_a_gated_tool_does_not_arm_twice_when_one_is_already_pending(self):
        state = VoiceTurnState()
        state.arm("send_sms", {"to": "+1"}, "text someone", now=0.0)
        client = FakeClient([
            _Round([], blocks=[_tool_use("delete_meeting", id="tu_a", airtable_id="recB")]),
            _Round(["asking"]),
        ])
        agent = VoiceAgent(user=_User(), client=client, state=state)
        with patch("realtime.voice_agent.mcp_server.dispatch", new=AsyncMock()) as dispatch:
            await _drain(agent)
        dispatch.assert_not_awaited()
        self.assertEqual(state.pending.tool_name, "send_sms")


@override_settings(**VOICE_SETTINGS)
class DispatchConfirmedTests(SimpleTestCase):
    async def test_runs_the_tool_with_the_stored_arguments(self):
        user = _User()
        with patch("realtime.voice_agent.mcp_server.dispatch",
                   new=AsyncMock(return_value={"sid": "SM1"})) as dispatch:
            result, record = await dispatch_confirmed("send_sms", {"to": "+1", "body": "x"}, user)
        dispatch.assert_awaited_once_with("send_sms", {"to": "+1", "body": "x"}, user=user)
        self.assertEqual(result, {"sid": "SM1"})
        self.assertEqual(record.status, "success")
        self.assertGreaterEqual(record.duration_ms, 0)

    async def test_a_failure_is_recorded_not_raised(self):
        with patch("realtime.voice_agent.mcp_server.dispatch",
                   new=AsyncMock(side_effect=RuntimeError("nope"))):
            result, record = await dispatch_confirmed("send_sms", {"to": "+1"}, _User())
        self.assertIsNone(result)
        self.assertEqual(record.status, "error")
        self.assertIn("nope", record.error_message)


@override_settings(**VOICE_SETTINGS)
class VoiceAgentRequestShapeTests(SimpleTestCase):
    async def _stream_kwargs(self, skill_inventory=""):
        agent = VoiceAgent(
            user=_User(), client=FakeClient([_Round(["ok"])]), skill_inventory=skill_inventory
        )
        with patch("realtime.voice_agent.mcp_server.dispatch", new=AsyncMock()):
            await _drain(agent)
        return agent, agent._client.messages.stream_calls[0]

    async def test_uses_the_voice_tier_model_and_token_ceiling(self):
        _, kwargs = await self._stream_kwargs()
        self.assertEqual(kwargs["model"], "claude-b-haiku")
        self.assertEqual(kwargs["max_tokens"], 512)

    async def test_tools_include_the_skill_tools(self):
        _, kwargs = await self._stream_kwargs()
        names = [t["name"] for t in kwargs["tools"]]
        self.assertIn("load_skill", names)
        self.assertIn("list_skills", names)

    async def test_escalation_is_never_offered_to_voice(self):
        """Escalating mid-call to a thinking model would add seconds of silence."""
        from agents.agent import ESCALATE_TOOL_NAME
        _, kwargs = await self._stream_kwargs()
        self.assertNotIn(ESCALATE_TOOL_NAME, [t["name"] for t in kwargs["tools"]])

    async def test_system_prompt_carries_the_injected_skill_inventory(self):
        _, kwargs = await self._stream_kwargs("- get-notes — Pull the notes")
        self.assertIn("get-notes", kwargs["system"])
        self.assertIn("SAVED WORKFLOWS", kwargs["system"])

    async def test_system_prompt_forbids_markdown_and_offers_no_hyperlink_rule(self):
        _, kwargs = await self._stream_kwargs()
        system = kwargs["system"]
        self.assertIn("Do not use markdown", system)
        self.assertNotIn("](", system)
        self.assertNotIn("HYPERLINKS", system)

    async def test_model_override_takes_precedence(self):
        with override_settings(AGENT_MODEL_OVERRIDE="claude-pinned-model"):
            _, kwargs = await self._stream_kwargs()
        self.assertEqual(kwargs["model"], "claude-pinned-model")

    async def test_an_explicit_model_argument_wins(self):
        agent = VoiceAgent(user=_User(), client=FakeClient([_Round(["ok"])]), model="forced")
        self.assertEqual(agent.model, "forced")


class BuildVoiceSystemPromptTests(SimpleTestCase):
    def test_base_prompt_covers_the_voice_constraints(self):
        prompt = build_voice_system_prompt()
        self.assertIn("live phone call", prompt)
        self.assertIn("Do not use markdown", prompt)
        self.assertIn("CONFIRMATION", prompt)
        self.assertIn(CONFIRMATION_SENTINEL, prompt)

    def test_empty_inventory_adds_no_heading(self):
        self.assertNotIn("SAVED WORKFLOWS", build_voice_system_prompt(""))
        self.assertNotIn("SAVED WORKFLOWS", build_voice_system_prompt("   \n  "))

    def test_inventory_is_appended_last(self):
        prompt = build_voice_system_prompt("- a — b")
        self.assertLess(prompt.index("live phone call"), prompt.index("SAVED WORKFLOWS"))

    def test_prompt_points_at_load_skill(self):
        self.assertIn("load_skill", build_voice_system_prompt("- a — b"))


def _tool_results(messages):
    """Every tool_result block in a message list, in order."""
    return [
        block
        for message in messages
        if isinstance(message.get("content"), list)
        for block in message["content"]
        if isinstance(block, dict) and block.get("type") == "tool_result"
    ]
