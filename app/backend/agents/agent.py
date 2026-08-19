"""
Claude-powered agent orchestrator.

Accepts a user message or voice transcript, calls Claude with tool_use enabled,
dispatches tool calls to the MCPServer, and streams the final text response back
to the caller a chunk at a time.

Two things are configurable via settings (see core.settings, "Anthropic" block):

* **Backend** — `AGENT_BACKEND` selects AWS Bedrock or the corporate LiteLLM
  gateway. Model ids differ between the two, so they are keyed by backend.
* **Model tier** — every request starts on the `default` tier. The model may
  escalate itself once to the `strong` tier by calling ESCALATE_TOOL, which is
  intercepted here and never reaches the MCP server.

Usage (async)
-------------
    from agents.agent import AgentOrchestrator

    orchestrator = AgentOrchestrator()
    async for chunk in orchestrator.run("Schedule a call with Alice tomorrow at 2pm"):
        print(chunk, end="", flush=True)
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from typing import Any

import anthropic
import truststore
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

from .mcp_server import mcp_server

truststore.inject_into_ssl()

logger = logging.getLogger(__name__)


def _publish(user, event_type: str, title: str, detail: str = "") -> None:
    """Fire-and-forget Sync publish — import lazily to avoid circular imports."""
    try:
        from realtime.sync import publish_activity_event
        publish_activity_event(user, event_type, title, detail=detail)
    except Exception as exc:
        logger.debug("Sync publish skipped: %s", exc)

TIER_DEFAULT = "default"
TIER_STRONG = "strong"


def model_for_tier(tier: str) -> str:
    """Resolve a tier name to a concrete model id for the configured backend."""
    if settings.AGENT_MODEL_OVERRIDE:
        return settings.AGENT_MODEL_OVERRIDE
    backend = settings.AGENT_BACKEND
    try:
        tiers = settings.AGENT_MODEL_TIERS[backend]
    except KeyError:
        raise ImproperlyConfigured(
            f"AGENT_BACKEND={backend!r} is not one of "
            f"{sorted(settings.AGENT_MODEL_TIERS)}."
        ) from None
    model = tiers.get(tier) or ""
    if not model:
        raise ImproperlyConfigured(
            f"No model configured for backend {backend!r} tier {tier!r}. "
            f"Set AGENT_MODEL_{backend.upper()}_{tier.upper()}."
        )
    return model


def max_tokens_for_tier(tier: str, *, streaming: bool) -> int:
    """
    Output-token ceiling for a tier.

    This bounds thinking *and* visible text together. Opus-tier models think by
    default, so the strong tier needs far more headroom than the default tier or
    replies get truncated mid-answer.
    """
    if streaming:
        return (
            settings.AGENT_MAX_TOKENS_STREAM_STRONG
            if tier == TIER_STRONG
            else settings.AGENT_MAX_TOKENS_STREAM_DEFAULT
        )
    return (
        settings.AGENT_MAX_TOKENS_STRONG
        if tier == TIER_STRONG
        else settings.AGENT_MAX_TOKENS_DEFAULT
    )


def build_client() -> Any:
    """
    Construct the Anthropic async client for the configured backend.

    `base_url` is always passed explicitly: Claude Code's managed settings export
    ANTHROPIC_BASE_URL, and a bare client would otherwise inherit it from whichever
    shell launched Django.
    """
    backend = settings.AGENT_BACKEND
    if backend == "gateway":
        if not settings.ANTHROPIC_API_KEY:
            raise ImproperlyConfigured(
                "AGENT_BACKEND=gateway requires ANTHROPIC_API_KEY (the LiteLLM virtual key)."
            )
        # The gateway authenticates with a bearer token, not an x-api-key header.
        return anthropic.AsyncAnthropic(
            base_url=settings.AGENT_GATEWAY_BASE_URL,
            auth_token=settings.ANTHROPIC_API_KEY,
        )
    if backend == "bedrock":
        # Credentials resolve from AWS_PROFILE / AWS_REGION via botocore.
        return anthropic.AsyncAnthropicBedrock()
    raise ImproperlyConfigured(
        f"AGENT_BACKEND={backend!r} is not one of "
        f"{sorted(settings.AGENT_MODEL_TIERS)}."
    )


ESCALATE_TOOL_NAME = "escalate_to_stronger_model"

# Offered only while on the default tier. Intercepted in _agentic_loop — it is never
# dispatched to the MCP server. The description is deliberately prescriptive about *when*
# to call, which materially improves should-call accuracy over describing only what it does.
ESCALATE_TOOL = {
    "name": ESCALATE_TOOL_NAME,
    "description": (
        "Switch to a more capable model for this request. Call this BEFORE doing the work, "
        "as your first action, when the request needs deeper reasoning than you can do well: "
        "multi-step analysis across many records, ambiguous requests spanning several "
        "entities, tricky scheduling or dependency logic, weighing trade-offs, or anything "
        "where a wrong answer is costly to the user. Do NOT call it for simple lookups, "
        "single-record reads or edits, straightforward searches, or ordinary conversation — "
        "you handle those well already. You may call this at most once per request."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "reason": {
                "type": "string",
                "description": "One sentence on why this request needs a stronger model.",
            },
        },
        "required": ["reason"],
    },
}

SYSTEM_PROMPT = """You are Agent PM, an AI assistant embedded in a team productivity platform.

You are a capable general-purpose assistant — you can answer questions, explain concepts, write content, help with analysis, and hold natural conversation on any topic.

IMPORTANT — you have FULL tool access right now. Ignore anything said in earlier turns about lacking capabilities.

== YOUR TOOLS ==

READ / SEARCH
- search_records: fuzzy keyword search across action_items, meetings, accounts, or calendar_events
- get_calendar_events: search calendar events by date range
- get_airtable_records: read full lists of action items, accounts, or meetings
- get_emails: search Gmail
- get_slack_messages: read Slack channels
- get_token_usage: check how many tokens have been used (today / this_week / this_month / all_time)

CREATE
- create_action_item: create a new action item and sync to Airtable
- create_calendar_event: create a new calendar event
- add_account_note: add a timestamped note to an account

UPDATE
- update_action_item: update status, priority, due date, notes, or assignee of an action item
- update_calendar_event: update title, time, location, or status of a calendar event
- update_meeting: update name, date, topics, or notes of a meeting; push to Airtable
- update_account: update account details (name, status, ARR, industry)

DELETE (not available for accounts or users)
- delete_action_item: permanently remove an action item
- delete_calendar_event: permanently remove a calendar event
- delete_meeting: permanently remove a meeting record

COMMUNICATE
- send_sms: send an SMS via Twilio
- make_phone_call: make a phone call via Twilio

== GUIDELINES ==

VAGUE REFERENCES — when the user says "that meeting where we discussed pricing" or "the action item about onboarding":
1. Call search_records with the best keyword(s) from the user's description.
2. If 1 clear match → proceed. If multiple matches → list them briefly and ask which one.
3. Never refuse because you don't have the exact ID — always search first.

TOOL USE — always call a tool when the user asks you to create, read, update, or delete a record. Never describe how they would do it themselves.

CONFIRMATION BEFORE MUTATIONS:
- DELETE or UPDATE: briefly confirm the specific record and the exact change with the user UNLESS they have already been explicit (e.g. "delete task 'Q3 report'" is explicit enough; "clean up my old tasks" is not — ask which ones first).
- CREATE or ADD NOTE: proceed immediately, no confirmation needed.

NEVER INVENT DATA — if a required field (ID, name, date, etc.) is missing or ambiguous, ask the user rather than guessing.

DATE HANDLING:
- "tomorrow", "next Monday" → resolve to YYYY-MM-DD relative to today
- Calendar times → ISO 8601 (e.g. 2026-06-30T14:00:00)

PARALLEL CALLS — when a request involves multiple independent operations (e.g. create an action item AND log a note), call both tools in parallel.

CONFIRMATIONS — after mutations, confirm what was done in one sentence: "Done — updated the action item to 'In Progress' and linked it to Acme Corp."

HYPERLINKS — whenever you create, update, or reference a record, include a clickable markdown link to it if the tool response includes a `url` field:
- Format: [Record Title](url)
- Examples: [Update USER_STORIES.md](https://airtable.com/...) or [Q2 QBR with Acme](https://airtable.com/...)
- If the tool response does NOT include a `url`, omit the link entirely — never invent one.

ERRORS — if a tool returns an error, report it clearly and suggest a next step.

TONE — concise and natural. Match length to the user's message. Voice-friendly: short responses work better when the user is on a voice session.
"""


class AgentOrchestrator:
    """
    Manages a single agent conversation turn:
    1. Send the user message to Claude with all MCP tool schemas.
    2. Execute any tool_use blocks by dispatching through MCPServer.
    3. Feed tool results back to Claude for the final response.
    4. Stream the final text response to the caller.
    """

    def __init__(self, client: Any | None = None) -> None:
        # truststore.inject_into_ssl() (called at module load) injects the system
        # CA bundle (including corporate Zscaler CA) into Python's SSL context so
        # that TLS certificate verification works correctly without disabling it.
        # `client` is injectable so tests never reach a real endpoint.
        self._client = client if client is not None else build_client()
        # Tier actually used for this request; escalation mutates it. Reported to the
        # caller on the token-usage sentinel.
        self.tier = TIER_DEFAULT
        self.model = model_for_tier(TIER_DEFAULT)

    # ── Public API ────────────────────────────────────────────────────────────

    # Phrases that indicate a prior assistant turn incorrectly claimed it lacked a capability.
    _REFUSAL_MARKERS = (
        "not yet implemented",
        "not yet available",
        "creating events is not yet",
        "cannot create",
        "can't create",
        "unable to create",
        "don't have the ability to create",
        "don't have the capability",
        "creating airtable",
        "creating records",
        "not able to",
        "no capability",
        "outside my capabilities",
        "beyond my current",
        "not supported",
        "i lack",
    )

    def _sanitize_history(self, history: list[dict]) -> list[dict]:
        """Strip or rewrite prior assistant turns that incorrectly claimed capability gaps."""
        clean = []
        for msg in history:
            if msg.get("role") == "assistant":
                content = msg.get("content", "")
                text = content if isinstance(content, str) else " ".join(
                    b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"
                )
                if any(marker in text.lower() for marker in self._REFUSAL_MARKERS):
                    # Replace the stale refusal with a neutral acknowledgement so the
                    # alternating user/assistant pattern is preserved.
                    clean.append({"role": "assistant", "content": "Understood, let me help with that."})
                    continue
            clean.append(msg)
        return clean

    async def run(
        self,
        user_message: str,
        conversation_history: list[dict] | None = None,
        user=None,
    ) -> AsyncIterator[str]:
        """
        Async generator that yields text chunks as Claude streams them.

        The last value yielded is a sentinel dict:
            {"__token_usage__": True, "input_tokens": int, "output_tokens": int, "model": str}
        Callers that only want text should skip items where isinstance(item, dict).

        Parameters
        ----------
        user_message:
            The latest user message or voice transcript.
        conversation_history:
            Optional prior turns in Anthropic message format.
        user:
            Django User instance for Sync feed publishing (optional).
        """
        history = self._sanitize_history(list(conversation_history or []))
        messages: list[dict] = history
        messages.append({"role": "user", "content": user_message})

        # Always provide all tools — gating by keyword caused tools to be absent
        # when users rephrased requests without action keywords.
        tools = mcp_server.tool_schemas()

        async for item in self._agentic_loop(messages, tools, user=user):
            yield item

    # ── Internal ──────────────────────────────────────────────────────────────

    async def _agentic_loop(
        self,
        messages: list[dict],
        tools: list[dict],
        user=None,
    ) -> AsyncIterator[Any]:
        """
        Run the tool-use agentic loop, yielding text chunks then a token-usage sentinel.

        Claude may request several rounds of tool calls before producing
        a final text response. We handle each round and re-submit results
        until stop_reason is 'end_turn'.

        The last item yielded is always:
            {"__token_usage__": True, "input_tokens": int, "output_tokens": int, "model": str}
        """
        MAX_ITERATIONS = 10
        total_input_tokens = 0
        total_output_tokens = 0

        # Escalation is offered only while on the default tier, and only when no explicit
        # override pins the model. `can_escalate` goes False after one use so a request can
        # never bounce tiers repeatedly.
        can_escalate = not settings.AGENT_MODEL_OVERRIDE

        for iteration in range(MAX_ITERATIONS):
            turn_tools = [*tools, ESCALATE_TOOL] if can_escalate else tools

            response = await self._client.messages.create(
                model=self.model,
                max_tokens=max_tokens_for_tier(self.tier, streaming=False),
                system=SYSTEM_PROMPT,
                tools=turn_tools,
                messages=messages,
                stream=False,  # We handle streaming manually below after tool calls resolve.
            )

            if getattr(response, "usage", None):
                total_input_tokens += getattr(response.usage, "input_tokens", 0)
                total_output_tokens += getattr(response.usage, "output_tokens", 0)

            tool_use_blocks = [b for b in response.content if b.type == "tool_use"]

            # Intercept escalation before anything is dispatched: this is an orchestrator
            # concern, not an MCP tool, so it must never reach mcp_server.dispatch().
            escalations = [b for b in tool_use_blocks if b.name == ESCALATE_TOOL_NAME]
            if escalations and can_escalate:
                reason = (escalations[0].input or {}).get("reason", "(no reason given)")
                self.tier = TIER_STRONG
                self.model = model_for_tier(TIER_STRONG)
                can_escalate = False
                logger.info(
                    "Agent escalated to %s (user=%s): %s", self.model, user, reason
                )

                # Answer every tool_use block in this turn, or the next request 400s.
                # Non-escalation calls in the same turn still run normally.
                other_blocks = [b for b in tool_use_blocks if b.name != ESCALATE_TOOL_NAME]
                results: list[dict] = []
                if other_blocks:
                    results.extend(await self._execute_tools(other_blocks, user=user))
                results.extend(
                    {
                        "type": "tool_result",
                        "tool_use_id": b.id,
                        "content": (
                            "Switched to a more capable model. Continue with the request."
                        ),
                    }
                    for b in escalations
                )
                messages.append({"role": "assistant", "content": response.content})
                messages.append({"role": "user", "content": results})
                continue

            if not tool_use_blocks:
                # No more tool calls — stream the final text response.
                async for item in self._stream_final_response(messages, turn_tools):
                    if isinstance(item, dict) and item.get("__token_usage__"):
                        total_input_tokens += item["input_tokens"]
                        total_output_tokens += item["output_tokens"]
                    else:
                        yield item
                break

            # Execute tool calls concurrently.
            tool_results = await self._execute_tools(tool_use_blocks, user=user)

            # Append assistant turn + tool results to the message history.
            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user", "content": tool_results})
        else:
            # Reached iteration cap without end_turn — surface an error.
            logger.error("Agent loop hit max iterations (%d) for user %s", MAX_ITERATIONS, user)
            yield "[Agent stopped: too many tool calls. Please try a simpler request.]"

        yield {
            "__token_usage__": True,
            "input_tokens": total_input_tokens,
            "output_tokens": total_output_tokens,
            "model": self.model,
        }

    async def _stream_final_response(
        self,
        messages: list[dict],
        tools: list[dict],
    ) -> AsyncIterator[Any]:
        """
        Stream the final text response, yielding each chunk as it arrives.

        Chunks are yielded straight through rather than collected first — buffering
        here would defeat streaming no matter what the transport layer does.
        """
        async with self._client.messages.stream(
            model=self.model,
            max_tokens=max_tokens_for_tier(self.tier, streaming=True),
            system=SYSTEM_PROMPT,
            tools=tools,
            messages=messages,
        ) as stream:
            async for text in stream.text_stream:
                yield text
            final = await stream.get_final_message()

        usage = getattr(final, "usage", None)
        yield {
            "__token_usage__": True,
            "input_tokens": getattr(usage, "input_tokens", 0),
            "output_tokens": getattr(usage, "output_tokens", 0),
            "model": self.model,
        }

    async def _execute_tools(
        self, tool_use_blocks: list[Any], user=None
    ) -> list[dict]:
        """Dispatch all tool_use blocks concurrently and return tool_result content."""

        async def _call_one(block: Any) -> dict:
            # Publish "tool_call" event to Sync feed before executing.
            if user:
                await asyncio.get_running_loop().run_in_executor(
                    None,
                    lambda: _publish(user, "tool_call", block.name, str(block.input or {})),
                )
            try:
                result = await mcp_server.dispatch(block.name, block.input or {}, user=user)
                result_str = json.dumps(result, default=str)
                if user:
                    await asyncio.get_running_loop().run_in_executor(
                        None,
                        lambda: _publish(user, "tool_result", block.name, result_str[:300]),
                    )
                return {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result_str,
                }
            except Exception as exc:
                logger.exception("Tool '%s' raised an error: %s", block.name, exc)
                if user:
                    await asyncio.get_running_loop().run_in_executor(
                        None,
                        lambda: _publish(user, "error", block.name, str(exc)),
                    )
                return {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "is_error": True,
                    "content": str(exc),
                }

        return await asyncio.gather(*[_call_one(b) for b in tool_use_blocks])
