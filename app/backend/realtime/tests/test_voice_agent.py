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

from django.test import SimpleTestCase, TestCase, override_settings

from realtime.voice_agent import (
    FILLERS,
    TOOL_ERROR_MESSAGE,
    TOOL_TIMEOUT_MESSAGE,
    WRAP_UP_NUDGE,
    VoiceAgent,
    build_voice_system_prompt,
    current_date_line,
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

    async def test_exception_detail_is_neither_spoken_nor_stored(self):
        client = FakeClient([
            _Round([], blocks=[_tool_use("search_records", id="tu_a")]),
            _Round(["sorry"]),
        ])
        agent = VoiceAgent(user=_User(), client=client)
        with patch("realtime.voice_agent.mcp_server.dispatch",
                   new=AsyncMock(side_effect=RuntimeError("secret-token-abc"))):
            events, _ = await _drain(agent)
        self.assertNotIn("secret-token-abc", _spoken(events))
        # The ToolCall row is visible in the Sessions list, so it records the exception
        # type only; the detail stays in the server log (logger.exception).
        self.assertEqual(agent.records[0].error_message, "RuntimeError")
        self.assertNotIn("secret-token-abc", agent.records[0].error_message)


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
            _tool_use("delete_calendar_event", id="tu_b", event_id=7),
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
            _Round([], blocks=[_tool_use("delete_calendar_event", id="tu_a", event_id=7)]),
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
        dispatch.assert_awaited_once_with(
            "send_sms", {"to": "+1", "body": "x"}, user=user, confirmed=True
        )
        self.assertEqual(result, {"sid": "SM1"})
        self.assertEqual(record.status, "success")
        self.assertGreaterEqual(record.duration_ms, 0)

    async def test_a_failure_is_recorded_not_raised(self):
        with patch("realtime.voice_agent.mcp_server.dispatch",
                   new=AsyncMock(side_effect=RuntimeError("nope"))):
            result, record = await dispatch_confirmed("send_sms", {"to": "+1"}, _User())
        self.assertIsNone(result)
        self.assertEqual(record.status, "error")
        self.assertEqual(record.error_message, "RuntimeError")


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

    def test_prompt_grounds_replies_in_tool_results(self):
        # A caller said "Orchestrator", the system linked "Archistrator", and the agent
        # repeated the caller's word. It must also never call an error a success.
        prompt = build_voice_system_prompt()
        self.assertIn("REPORT WHAT THE TOOL DID", prompt)
        self.assertIn("account_name", prompt)
        self.assertIn("status error", prompt)
        self.assertIn("candidates", prompt)
        self.assertIn("account_fallback", prompt)

    def test_prompt_teaches_the_meeting_with_a_colleague_workflow(self):
        prompt = build_voice_system_prompt()
        for tool in ("find_person", "get_colleague_availability", "create_calendar_event", "invite_to_meeting"):
            self.assertIn(tool, prompt)
        # The agent used to tell callers it had no access to a colleague's calendar.
        self.assertIn("never say you cannot access their calendar", prompt)
        # Privacy: availability only, never what the meetings are.
        self.assertIn("never what their meetings are", prompt)

    def test_every_tool_named_in_the_prompt_is_a_registered_tool(self):
        from agents.mcp_server import mcp_server
        prompt = build_voice_system_prompt()
        for tool in ("find_person", "get_colleague_availability", "create_calendar_event", "invite_to_meeting"):
            self.assertIn(tool, mcp_server.list_tools())
            self.assertIn(tool, prompt)

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


class CurrentDateLineTests(SimpleTestCase):
    """
    The voice prompt used to carry no date, so "next Monday" was resolved against the model's
    training data: a meeting for "Monday, October 19th" was created in 2025 and never showed on
    the caller's calendar.
    """

    def _line(self, now_utc, tz="UTC"):
        from datetime import datetime, timezone as dt_tz

        return current_date_line(tz, now=datetime(*now_utc, tzinfo=dt_tz.utc))

    def test_names_today_with_the_year_and_weekday(self):
        line = self._line((2026, 10, 16, 18, 0))
        self.assertIn("Friday, October 16, 2026", line)
        self.assertIn("2026-10-16", line)

    def test_includes_the_time_so_free_slots_can_start_after_now(self):
        self.assertIn("11:00", self._line((2026, 10, 16, 18, 0), "America/Los_Angeles"))

    def test_uses_the_callers_timezone_for_the_date(self):
        # 02:00 UTC on the 17th is still the evening of the 16th in Los Angeles.
        line = self._line((2026, 10, 17, 2, 0), "America/Los_Angeles")
        self.assertIn("Friday, October 16, 2026", line)
        self.assertIn("America/Los_Angeles", line)

    def test_states_how_to_write_times_for_the_tools(self):
        line = self._line((2026, 10, 16, 18, 0), "America/Los_Angeles")
        self.assertIn("ISO 8601", line)
        self.assertIn("next Monday", line)

    def test_a_typed_abbreviation_is_understood_not_silently_treated_as_utc(self):
        # Settings is a free-text box and the real profile value was "PST". It used to fall
        # through to UTC, so the agent announced the wrong day and hour.
        line = self._line((2026, 10, 17, 2, 0), "PST")  # 02:00Z on the 17th
        self.assertIn("Friday, October 16, 2026", line)
        self.assertIn("19:00", line)  # 7pm Pacific daylight time, not 18:00 (fixed UTC-8)
        self.assertIn("America/Los_Angeles", line)

    def test_lists_the_upcoming_dates_so_the_model_does_not_do_weekday_arithmetic(self):
        # On Friday 16 Oct 2026 the model resolved "next Monday" to the 20th, a Tuesday, in
        # every tool call. It is bad at counting days, so the answers are handed to it.
        line = self._line((2026, 10, 16, 18, 0))
        self.assertIn("Monday 2026-10-19", line)
        self.assertIn("Tuesday 2026-10-20", line)
        self.assertIn("Friday 2026-10-23", line)

    def test_upcoming_dates_start_tomorrow_and_cover_a_full_week_plus(self):
        line = self._line((2026, 10, 16, 18, 0))
        self.assertNotIn("Friday 2026-10-16 (", line.split("Upcoming")[-1])  # today is not "upcoming"
        self.assertIn("Saturday 2026-10-17", line)
        self.assertIn("Monday 2026-10-26", line)  # the Monday after next, 10 days out

    def test_upcoming_dates_use_the_callers_local_calendar(self):
        # 02:00Z on the 17th is still Friday evening the 16th in Los Angeles, so tomorrow is
        # Saturday the 17th and the next Monday is still the 19th.
        line = self._line((2026, 10, 17, 2, 0), "PST")
        self.assertIn("Saturday 2026-10-17", line)
        self.assertIn("Monday 2026-10-19", line)

    def test_says_that_next_monday_means_the_first_monday_after_today(self):
        self.assertIn("next Monday", self._line((2026, 10, 16, 18, 0)))
        self.assertIn("first", self._line((2026, 10, 16, 18, 0)).lower())

    def test_unknown_timezone_falls_back_to_utc_instead_of_raising(self):
        line = self._line((2026, 10, 16, 18, 0), "Not/AZone")
        self.assertIn("UTC", line)
        self.assertIn("2026-10-16", line)

    def test_blank_timezone_falls_back_to_utc(self):
        self.assertIn("UTC", self._line((2026, 10, 16, 18, 0), ""))


class VoiceAgentDateInRequestTests(SimpleTestCase):
    async def _system(self):
        agent = VoiceAgent(user=_User(), client=FakeClient([_Round(["ok"])]))
        with patch("realtime.voice_agent.mcp_server.dispatch", new=AsyncMock()):
            await _drain(agent)
        return agent._client.messages.stream_calls[0]["system"]

    async def test_every_request_carries_the_current_date(self):
        from datetime import datetime

        system = await self._system()
        self.assertIn(str(datetime.now().year), system)
        self.assertIn("Today is", system)

    async def test_the_date_is_added_per_request_not_frozen_into_the_base_prompt(self):
        # A call that crosses midnight must not keep announcing yesterday.
        self.assertNotIn("Today is", build_voice_system_prompt())


class VoiceAgentWithARealUserTests(TestCase):
    """
    The fake `_User` used elsewhere has no `.profile`, which hid a crash: the agent read
    `user.profile.timezone` inside the async loop, and on a real Django User that lazy query
    raises SynchronousOnlyOperation. The caller's timezone is now passed in, never fetched.
    """

    async def _real_user(self):
        from channels.db import database_sync_to_async
        from django.contrib.auth import get_user_model
        from team.models import UserProfile

        def make():
            user = get_user_model().objects.create_user("real-voice-user", password="x")
            UserProfile.objects.create(user=user, timezone="America/Los_Angeles")
            return get_user_model().objects.get(pk=user.pk)  # fresh instance: profile NOT cached

        return await database_sync_to_async(make)()

    async def test_a_turn_runs_for_a_real_user_without_touching_the_database(self):
        user = await self._real_user()
        agent = VoiceAgent(user=user, client=FakeClient([_Round(["ok"])]), tz_name="America/Los_Angeles")
        with patch("realtime.voice_agent.mcp_server.dispatch", new=AsyncMock()):
            await _drain(agent)  # raised SynchronousOnlyOperation before the fix
        system = agent._client.messages.stream_calls[0]["system"]
        self.assertIn("America/Los_Angeles", system)

    async def test_the_agent_does_not_read_the_profile_itself(self):
        user = await self._real_user()
        agent = VoiceAgent(user=user, client=FakeClient([_Round(["ok"])]))  # no timezone given
        with patch("realtime.voice_agent.mcp_server.dispatch", new=AsyncMock()):
            await _drain(agent)
        self.assertIn("UTC", agent._client.messages.stream_calls[0]["system"])
