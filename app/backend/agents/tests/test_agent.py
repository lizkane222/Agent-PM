"""
Tests for agents.agent — backend selection, model tiers, self-escalation, streaming.

The Anthropic client is always injected as a fake; no test reaches a real endpoint.
"""

from unittest.mock import patch

import anthropic
from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase, override_settings

from agents.agent import (
    ESCALATE_TOOL,
    ESCALATE_TOOL_NAME,
    SYSTEM_PROMPT,
    TIER_DEFAULT,
    TIER_STRONG,
    AgentOrchestrator,
    build_client,
    build_system_prompt,
    max_tokens_for_tier,
    model_for_tier,
)
from agents.mcp_server import GROUP_LABELS, mcp_server

TIERS = {
    "bedrock": {"default": "claude-bedrock-sonnet", "strong": "claude-bedrock-sonnet5", "voice": "claude-bedrock-haiku"},
    "gateway": {"default": "claude-gw-sonnet", "strong": "claude-gw-sonnet5", "voice": "claude-gw-haiku"},
}

# A stand-in for the MCP tool list, so these tests don't depend on the real registry.
DUMMY_TOOLS = [{"name": "search_records", "description": "x", "input_schema": {}}]


# ── Fakes ─────────────────────────────────────────────────────────────────────

class _Usage:
    def __init__(self, input_tokens=0, output_tokens=0):
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens


class _Block:
    """Stands in for a content block (text or tool_use)."""

    def __init__(self, type, *, name=None, id=None, input=None, text=None):
        self.type = type
        self.name = name
        self.id = id
        self.input = input
        self.text = text


class _Response:
    def __init__(self, content, usage=None):
        self.content = content
        self.usage = usage or _Usage(1, 1)


def _tool_use(name, id="tu_1", **inp):
    return _Block("tool_use", name=name, id=id, input=inp)


class _FakeStream:
    def __init__(self, chunks, usage):
        self._chunks = chunks
        self._usage = usage

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    @property
    def text_stream(self):
        async def _gen():
            for c in self._chunks:
                yield c

        return _gen()

    async def get_final_message(self):
        return _Response([], self._usage)


class _FakeMessages:
    def __init__(self, responses, stream_chunks, stream_usage):
        self._responses = list(responses)
        self._stream_chunks = stream_chunks
        self._stream_usage = stream_usage
        self.create_calls: list[dict] = []
        self.stream_calls: list[dict] = []

    async def create(self, **kwargs):
        self.create_calls.append(kwargs)
        if not self._responses:
            raise AssertionError("fake client ran out of scripted responses")
        return self._responses.pop(0)

    def stream(self, **kwargs):
        self.stream_calls.append(kwargs)
        return _FakeStream(self._stream_chunks, self._stream_usage)


class FakeClient:
    def __init__(self, responses=(), stream_chunks=("hi",), stream_usage=None):
        self.messages = _FakeMessages(
            responses, list(stream_chunks), stream_usage or _Usage(10, 5)
        )


async def _drain(orchestrator, tools=DUMMY_TOOLS, messages=None):
    """Run the loop to completion, returning (text_chunks, sentinel)."""
    items = []
    async for item in orchestrator._agentic_loop(
        messages if messages is not None else [{"role": "user", "content": "hi"}],
        tools,
    ):
        items.append(item)
    sentinel = items[-1] if isinstance(items[-1], dict) else None
    text = [i for i in items if not isinstance(i, dict)]
    return text, sentinel


def _tool_names(kwargs):
    return [t["name"] for t in kwargs["tools"]]


# ── Tier / backend resolution ─────────────────────────────────────────────────

@override_settings(AGENT_MODEL_TIERS=TIERS, AGENT_MODEL_OVERRIDE="")
class ModelTierTest(SimpleTestCase):
    @override_settings(AGENT_BACKEND="bedrock")
    def test_resolves_bedrock_tiers(self):
        self.assertEqual(model_for_tier(TIER_DEFAULT), "claude-bedrock-sonnet")
        self.assertEqual(model_for_tier(TIER_STRONG), "claude-bedrock-sonnet5")

    @override_settings(AGENT_BACKEND="gateway")
    def test_resolves_gateway_tiers(self):
        """Model ids are backend-specific — the same tier maps elsewhere."""
        self.assertEqual(model_for_tier(TIER_DEFAULT), "claude-gw-sonnet")
        self.assertEqual(model_for_tier(TIER_STRONG), "claude-gw-sonnet5")

    @override_settings(AGENT_BACKEND="bedrock", AGENT_MODEL_OVERRIDE="claude-pinned-model")
    def test_override_wins_for_every_tier(self):
        self.assertEqual(model_for_tier(TIER_DEFAULT), "claude-pinned-model")
        self.assertEqual(model_for_tier(TIER_STRONG), "claude-pinned-model")

    @override_settings(AGENT_BACKEND="nonsense")
    def test_unknown_backend_raises(self):
        with self.assertRaises(ImproperlyConfigured):
            model_for_tier(TIER_DEFAULT)

    @override_settings(
        AGENT_BACKEND="gateway",
        AGENT_MODEL_TIERS={"gateway": {"default": "", "strong": ""}},
    )
    def test_unconfigured_tier_raises_rather_than_sending_empty_model(self):
        with self.assertRaises(ImproperlyConfigured):
            model_for_tier(TIER_DEFAULT)


@override_settings(
    AGENT_MAX_TOKENS_DEFAULT=4096,
    AGENT_MAX_TOKENS_STRONG=16000,
    AGENT_MAX_TOKENS_STREAM_DEFAULT=8192,
    AGENT_MAX_TOKENS_STREAM_STRONG=32000,
)
class MaxTokensTest(SimpleTestCase):
    def test_strong_tier_gets_more_headroom(self):
        """Opus-tier thinking shares max_tokens with visible text, so it needs room."""
        self.assertGreater(
            max_tokens_for_tier(TIER_STRONG, streaming=False),
            max_tokens_for_tier(TIER_DEFAULT, streaming=False),
        )
        self.assertGreater(
            max_tokens_for_tier(TIER_STRONG, streaming=True),
            max_tokens_for_tier(TIER_DEFAULT, streaming=True),
        )

    def test_exact_values(self):
        self.assertEqual(max_tokens_for_tier(TIER_DEFAULT, streaming=False), 4096)
        self.assertEqual(max_tokens_for_tier(TIER_DEFAULT, streaming=True), 8192)
        self.assertEqual(max_tokens_for_tier(TIER_STRONG, streaming=False), 16000)
        self.assertEqual(max_tokens_for_tier(TIER_STRONG, streaming=True), 32000)


@override_settings(AGENT_MODEL_TIERS=TIERS)
class BuildClientTest(SimpleTestCase):
    @override_settings(AGENT_BACKEND="bedrock")
    def test_bedrock_backend(self):
        self.assertIsInstance(build_client(), anthropic.AsyncAnthropicBedrock)

    @override_settings(
        AGENT_BACKEND="gateway",
        ANTHROPIC_API_KEY="sk-test",
        AGENT_GATEWAY_BASE_URL="https://gw.example.com",
    )
    def test_gateway_backend_uses_explicit_base_url(self):
        """base_url must come from settings, never from an inherited ANTHROPIC_BASE_URL."""
        client = build_client()
        self.assertIsInstance(client, anthropic.AsyncAnthropic)
        self.assertEqual(str(client.base_url).rstrip("/"), "https://gw.example.com")

    @override_settings(
        AGENT_BACKEND="gateway", ANTHROPIC_API_KEY="", AGENT_GATEWAY_TOKEN_COMMAND=""
    )
    def test_gateway_with_no_credential_source_at_all_raises(self):
        """A static key is optional now — the Okta token helper is the fallback."""
        from core.llm import reset_gateway_token_cache
        reset_gateway_token_cache()
        with self.assertRaises(ImproperlyConfigured):
            build_client()

    @override_settings(AGENT_BACKEND="nonsense")
    def test_unknown_backend_raises(self):
        with self.assertRaises(ImproperlyConfigured):
            build_client()


# ── Escalation ────────────────────────────────────────────────────────────────

@override_settings(
    AGENT_BACKEND="bedrock",
    AGENT_MODEL_TIERS=TIERS,
    AGENT_MODEL_OVERRIDE="",
    AGENT_MAX_TOKENS_DEFAULT=4096,
    AGENT_MAX_TOKENS_STRONG=16000,
    AGENT_MAX_TOKENS_STREAM_DEFAULT=8192,
    AGENT_MAX_TOKENS_STREAM_STRONG=32000,
)
class EscalationTest(SimpleTestCase):
    async def test_escalate_tool_is_offered_on_default_tier(self):
        client = FakeClient(responses=[_Response([_Block("text", text="done")])])
        orch = AgentOrchestrator(client=client)
        await _drain(orch)
        self.assertIn(ESCALATE_TOOL_NAME, _tool_names(client.messages.create_calls[0]))

    async def test_no_escalation_keeps_default_model(self):
        client = FakeClient(responses=[_Response([_Block("text", text="done")])])
        orch = AgentOrchestrator(client=client)
        _, sentinel = await _drain(orch)
        self.assertEqual(orch.tier, TIER_DEFAULT)
        self.assertEqual(sentinel["model"], "claude-bedrock-sonnet")

    async def test_escalation_switches_model_and_withdraws_the_tool(self):
        client = FakeClient(
            responses=[
                _Response([_tool_use(ESCALATE_TOOL_NAME, reason="multi-step analysis")]),
                _Response([_Block("text", text="done")]),
            ]
        )
        orch = AgentOrchestrator(client=client)
        _, sentinel = await _drain(orch)

        self.assertEqual(orch.tier, TIER_STRONG)
        self.assertEqual(orch.model, "claude-bedrock-sonnet5")
        self.assertEqual(sentinel["model"], "claude-bedrock-sonnet5")

        first, second = client.messages.create_calls[0], client.messages.create_calls[1]
        self.assertIn(ESCALATE_TOOL_NAME, _tool_names(first))
        self.assertEqual(first["model"], "claude-bedrock-sonnet")
        # Withdrawn after use so a request cannot bounce between tiers.
        self.assertNotIn(ESCALATE_TOOL_NAME, _tool_names(second))
        self.assertEqual(second["model"], "claude-bedrock-sonnet5")

    async def test_escalation_is_never_dispatched_to_mcp(self):
        """It is an orchestrator concern; dispatching it would raise 'Unknown tool'."""
        client = FakeClient(
            responses=[
                _Response([_tool_use(ESCALATE_TOOL_NAME, reason="hard")]),
                _Response([_Block("text", text="done")]),
            ]
        )
        orch = AgentOrchestrator(client=client)
        with patch.object(
            AgentOrchestrator, "_execute_tools", return_value=[]
        ) as execute:
            await _drain(orch)
        execute.assert_not_called()

    async def test_escalation_answers_sibling_tool_calls_in_the_same_turn(self):
        """Every tool_use block must get a tool_result or the next request 400s."""
        client = FakeClient(
            responses=[
                _Response([
                    _tool_use(ESCALATE_TOOL_NAME, id="tu_esc", reason="hard"),
                    _tool_use("search_records", id="tu_search", query="acme"),
                ]),
                _Response([_Block("text", text="done")]),
            ]
        )
        orch = AgentOrchestrator(client=client)
        sibling_result = {
            "type": "tool_result", "tool_use_id": "tu_search", "content": "[]",
        }
        with patch.object(
            AgentOrchestrator, "_execute_tools", return_value=[sibling_result]
        ) as execute:
            await _drain(orch)

        # The sibling ran; the escalation block did not go to MCP.
        dispatched = [b.name for b in execute.call_args.args[0]]
        self.assertEqual(dispatched, ["search_records"])

        follow_up = client.messages.create_calls[1]["messages"]
        answered = {
            r["tool_use_id"] for r in follow_up[-1]["content"] if isinstance(r, dict)
        }
        self.assertEqual(answered, {"tu_esc", "tu_search"})

    async def test_escalation_happens_at_most_once(self):
        client = FakeClient(
            responses=[
                _Response([_tool_use(ESCALATE_TOOL_NAME, id="a", reason="hard")]),
                _Response([_tool_use(ESCALATE_TOOL_NAME, id="b", reason="harder")]),
                _Response([_Block("text", text="done")]),
            ]
        )
        orch = AgentOrchestrator(client=client)
        # Second escalation request is a normal tool_use, so it goes to MCP and is
        # reported back as an error rather than silently swapping tiers again.
        with patch.object(
            AgentOrchestrator,
            "_execute_tools",
            return_value=[{"type": "tool_result", "tool_use_id": "b",
                           "is_error": True, "content": "Unknown tool"}],
        ):
            await _drain(orch)
        self.assertEqual(orch.model, "claude-bedrock-sonnet5")
        self.assertEqual(
            sum(
                1 for c in client.messages.create_calls
                if ESCALATE_TOOL_NAME in _tool_names(c)
            ),
            1,
        )

    async def test_streaming_call_uses_escalated_tier_budget(self):
        client = FakeClient(
            responses=[
                _Response([_tool_use(ESCALATE_TOOL_NAME, reason="hard")]),
                _Response([_Block("text", text="done")]),
            ]
        )
        orch = AgentOrchestrator(client=client)
        await _drain(orch)
        stream_kwargs = client.messages.stream_calls[0]
        self.assertEqual(stream_kwargs["model"], "claude-bedrock-sonnet5")
        self.assertEqual(stream_kwargs["max_tokens"], 32000)

    @override_settings(AGENT_MODEL_OVERRIDE="claude-pinned-model")
    async def test_override_suppresses_escalation_entirely(self):
        client = FakeClient(responses=[_Response([_Block("text", text="done")])])
        orch = AgentOrchestrator(client=client)
        _, sentinel = await _drain(orch)
        self.assertNotIn(ESCALATE_TOOL_NAME, _tool_names(client.messages.create_calls[0]))
        self.assertEqual(sentinel["model"], "claude-pinned-model")


# ── Streaming ─────────────────────────────────────────────────────────────────

@override_settings(
    AGENT_BACKEND="bedrock",
    AGENT_MODEL_TIERS=TIERS,
    AGENT_MODEL_OVERRIDE="",
    AGENT_MAX_TOKENS_DEFAULT=4096,
    AGENT_MAX_TOKENS_STRONG=16000,
    AGENT_MAX_TOKENS_STREAM_DEFAULT=8192,
    AGENT_MAX_TOKENS_STREAM_STRONG=32000,
)
class StreamingTest(SimpleTestCase):
    async def test_chunks_are_yielded_individually_not_concatenated(self):
        """Regression guard: the old implementation collected chunks into a list first."""
        client = FakeClient(
            responses=[_Response([_Block("text", text="x")])],
            stream_chunks=["Hel", "lo ", "world"],
        )
        orch = AgentOrchestrator(client=client)
        text, _ = await _drain(orch)
        self.assertEqual(text, ["Hel", "lo ", "world"])

    async def test_chunks_arrive_before_the_stream_completes(self):
        """
        Prove laziness: consume one chunk and stop. A buffering implementation
        would have already drained the whole source.
        """
        consumed: list[str] = []

        class _TrackingStream(_FakeStream):
            @property
            def text_stream(self):
                async def _gen():
                    for c in self._chunks:
                        consumed.append(c)
                        yield c

                return _gen()

        client = FakeClient(
            responses=[_Response([_Block("text", text="x")])],
            stream_chunks=["a", "b", "c"],
        )
        client.messages.stream = lambda **kw: _TrackingStream(["a", "b", "c"], _Usage())
        orch = AgentOrchestrator(client=client)

        agen = orch._agentic_loop([{"role": "user", "content": "hi"}], DUMMY_TOOLS)
        first = await agen.__anext__()
        self.assertEqual(first, "a")
        self.assertEqual(consumed, ["a"], "source was drained ahead of the consumer")
        await agen.aclose()

    async def test_token_usage_sentinel_is_last_and_carries_model(self):
        client = FakeClient(
            responses=[_Response([_Block("text", text="x")], usage=_Usage(7, 3))],
            stream_chunks=["ok"],
            stream_usage=_Usage(10, 5),
        )
        orch = AgentOrchestrator(client=client)
        _, sentinel = await _drain(orch)
        self.assertTrue(sentinel["__token_usage__"])
        # Loop turn (7/3) plus the streamed final response (10/5).
        self.assertEqual(sentinel["input_tokens"], 17)
        self.assertEqual(sentinel["output_tokens"], 8)
        self.assertEqual(sentinel["model"], "claude-bedrock-sonnet")


class EscalateToolShapeTest(SimpleTestCase):
    def test_schema_is_a_valid_tool_definition(self):
        self.assertEqual(ESCALATE_TOOL["name"], ESCALATE_TOOL_NAME)
        self.assertEqual(ESCALATE_TOOL["input_schema"]["required"], ["reason"])

    def test_description_states_when_to_call_and_when_not_to(self):
        """Prescriptive trigger conditions measurably improve should-call accuracy."""
        description = ESCALATE_TOOL["description"].lower()
        self.assertIn("call this before doing the work", description)
        self.assertIn("do not call it for simple lookups", description)


class SystemPromptGenerationTest(SimpleTestCase):
    """
    The "== YOUR TOOLS ==" section is generated from the MCP registry.

    The hand-written block it replaced had drifted: get_meeting_notes_from_email was
    registered and sent to Claude in the schemas but absent from the prompt, so the
    model was never told it existed. These tests are the permanent guard.
    """

    def test_prompt_contains_every_registered_tool_name(self):
        for name in mcp_server.list_tools():
            self.assertIn(name, SYSTEM_PROMPT, f"{name} is missing from SYSTEM_PROMPT")

    def test_prompt_contains_the_previously_omitted_tool(self):
        self.assertIn("get_meeting_notes_from_email", SYSTEM_PROMPT)

    def test_prompt_contains_the_voice_reachable_skill_tools(self):
        self.assertIn("list_skills", SYSTEM_PROMPT)
        self.assertIn("load_skill", SYSTEM_PROMPT)

    def test_prompt_contains_every_non_empty_group_heading(self):
        for group in mcp_server.grouped_catalog():
            self.assertIn(GROUP_LABELS[group], SYSTEM_PROMPT)

    def test_tool_descriptions_come_from_the_registry(self):
        for schema in mcp_server.tool_schemas():
            self.assertIn(f"- {schema['name']}: {schema['description']}", SYSTEM_PROMPT)

    def test_chat_guidance_was_not_gutted_by_the_refactor(self):
        """Only the tool list is generated; the curated guidelines must survive."""
        self.assertIn("HYPERLINKS", SYSTEM_PROMPT)
        self.assertIn("[Record Title](url)", SYSTEM_PROMPT)
        self.assertIn("CONFIRMATION BEFORE MUTATIONS", SYSTEM_PROMPT)
        self.assertIn("VAGUE REFERENCES", SYSTEM_PROMPT)
        self.assertIn("NEVER INVENT DATA", SYSTEM_PROMPT)

    def test_preamble_precedes_tools_which_precede_guidelines(self):
        self.assertLess(SYSTEM_PROMPT.index("FULL tool access"), SYSTEM_PROMPT.index("== YOUR TOOLS =="))
        self.assertLess(SYSTEM_PROMPT.index("== YOUR TOOLS =="), SYSTEM_PROMPT.index("== GUIDELINES =="))

    def test_build_system_prompt_is_deterministic(self):
        self.assertEqual(build_system_prompt(), SYSTEM_PROMPT)


@override_settings(AGENT_MODEL_TIERS=TIERS, AGENT_MODEL_OVERRIDE="")
class VoiceTierTest(SimpleTestCase):
    """Voice gets its own tier — it must never reuse the chat default or escalate."""

    @override_settings(AGENT_BACKEND="bedrock")
    def test_voice_tier_resolves_for_bedrock(self):
        self.assertEqual(model_for_tier("voice"), "claude-bedrock-haiku")

    @override_settings(AGENT_BACKEND="gateway")
    def test_voice_tier_resolves_for_gateway(self):
        self.assertEqual(model_for_tier("voice"), "claude-gw-haiku")

    @override_settings(AGENT_BACKEND="bedrock")
    def test_unknown_tier_raises(self):
        with self.assertRaises(ImproperlyConfigured):
            model_for_tier("no-such-tier")

    def test_real_settings_configure_a_voice_model_for_the_active_backend(self):
        """Guards against shipping the tier map without the voice entry."""
        from django.conf import settings as real_settings
        backend = real_settings.AGENT_BACKEND
        self.assertTrue(real_settings.AGENT_MODEL_TIERS[backend]["voice"])
