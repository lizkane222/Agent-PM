"""
Claude-powered agent orchestrator.

Accepts a user message or voice transcript, calls Claude claude-sonnet-4-6
with tool_use enabled, dispatches tool calls to the MCPServer, and streams
the final text response back to the caller.

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

MODEL = "us.anthropic.claude-sonnet-4-6"

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

    def __init__(self) -> None:
        # truststore.inject_into_ssl() (called at module load) injects the system
        # CA bundle (including corporate Zscaler CA) into Python's SSL context so
        # that TLS certificate verification works correctly without disabling it.
        self._client = anthropic.AnthropicBedrock()

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
            {"__token_usage__": True, "input_tokens": int, "output_tokens": int}
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
            {"__token_usage__": True, "input_tokens": int, "output_tokens": int}
        """
        MAX_ITERATIONS = 10
        total_input_tokens = 0
        total_output_tokens = 0

        for iteration in range(MAX_ITERATIONS):
            # Run the blocking Anthropic call in a thread so we don't block the event loop.
            response = await asyncio.get_running_loop().run_in_executor(
                None,
                lambda: self._client.messages.create(
                    model=MODEL,
                    max_tokens=4096,
                    system=SYSTEM_PROMPT,
                    tools=tools,
                    messages=messages,
                    stream=False,  # We handle streaming manually below after tool calls resolve.
                ),
            )

            if hasattr(response, "usage") and response.usage:
                total_input_tokens += getattr(response.usage, "input_tokens", 0)
                total_output_tokens += getattr(response.usage, "output_tokens", 0)

            tool_use_blocks = [b for b in response.content if b.type == "tool_use"]

            if not tool_use_blocks:
                # No more tool calls — stream the final text response.
                async for item in self._stream_final_response(messages, tools):
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

        yield {"__token_usage__": True, "input_tokens": total_input_tokens, "output_tokens": total_output_tokens}

    async def _stream_final_response(
        self,
        messages: list[dict],
        tools: list[dict],
    ) -> AsyncIterator[Any]:
        """Stream the final text response from Claude, yield text chunks then a token-usage sentinel."""
        loop = asyncio.get_running_loop()

        # stream=True returns a context manager; run it in a thread.
        def _collect_stream() -> tuple[list[str], int, int]:
            chunks: list[str] = []
            with self._client.messages.stream(
                model=MODEL,
                max_tokens=4096,
                system=SYSTEM_PROMPT,
                tools=tools,
                messages=messages,
            ) as stream:
                for text in stream.text_stream:
                    chunks.append(text)
                final = stream.get_final_message()
            input_tokens = getattr(getattr(final, "usage", None), "input_tokens", 0)
            output_tokens = getattr(getattr(final, "usage", None), "output_tokens", 0)
            return chunks, input_tokens, output_tokens

        text_chunks, input_tokens, output_tokens = await loop.run_in_executor(None, _collect_stream)
        for chunk in text_chunks:
            yield chunk
        yield {"__token_usage__": True, "input_tokens": input_tokens, "output_tokens": output_tokens}

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
