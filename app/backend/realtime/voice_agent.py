"""
The voice agentic loop for ConversationRelay.

This is deliberately a *separate* loop from AgentOrchestrator._agentic_loop rather
than a reuse of it. It shares the parts that should be shared — mcp_server,
build_client(), model_for_tier() — and duplicates ~40 lines of loop structure,
because five requirements genuinely conflict with the chat loop:

1. The chat prompt instructs markdown hyperlinks; voice forbids markdown outright.
   Those are contradictory requirements, not something one prompt can satisfy.
2. Chat only streams the *final* turn — tool rounds go through non-streaming
   messages.create and yield nothing. There is no hook to speak during a tool round,
   which is precisely the dead-air problem on a phone call.
3. Chat offers ESCALATE_TOOL. Escalating mid-call to an Opus tier that thinks by
   default would add many seconds of silence to a live conversation. Voice must
   never escalate.
4. MAX_ITERATIONS=10 is right for chat and catastrophic for voice.
5. Threading filler callbacks, per-turn deadlines and a confirmation gate through
   the chat loop means five new branches in the chat hot path, which CLAUDE.md's
   "never change visible behaviour" constraint makes the more expensive option.

Streaming every round is the core latency win. Chat pays a full non-streaming
round-trip before it streams anything; here the first token of round 0 is the first
audio, and Claude's own preamble ("Let me pull up your action items") becomes the
filler — better than any canned phrase, and free, because those tokens were going to
be generated anyway.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, Literal

from django.conf import settings

from agents.agent import build_client, model_for_tier
from agents.mcp_server import mcp_server

from .voice_persistence import ToolCallRecord
from .voice_policy import (
    VOICE_BLOCKED_TOOLS,
    VoiceTurnState,
    confirmation_result_content,
    gate_for,
    spoken_summary,
)

logger = logging.getLogger(__name__)

TIER_VOICE = "voice"

VOICE_SYSTEM_PROMPT_BASE = (
    "You are Agent PM, a helpful AI assistant for product managers at Twilio. "
    "You are speaking with a user on a live phone call. "
    "Keep your responses concise and conversational — typically one to three sentences. "
    "Do not use markdown, bullet points, headers, or lists; they will not render in voice. "
    "Never read out a URL or a record ID unless the user explicitly asks for it. "
    "Answer questions directly and clearly.\n"
    "\n"
    "TOOLS — call a tool whenever the user asks you to look something up, create, "
    "update or delete a record. Say a short sentence about what you are doing before "
    "you call it, so the caller is not left in silence.\n"
    "\n"
    "CONFIRMATION — some actions are irreversible or leave the platform (deleting a "
    "record, sending a text, placing a call). If a tool result says "
    "CONFIRMATION_REQUIRED, ask the caller exactly the question it gives you and then "
    "stop. Do not call that tool again; the system runs it for you once they agree.\n"
    "\n"
    "SPOKEN NUMBERS — read phone numbers back digit by digit in small groups so the "
    "caller can check them.\n"
    "\n"
    "IF YOU CANNOT FIND SOMETHING — say so plainly in one sentence. Never invent a "
    "record, a date or a name."
)

_SKILL_PROMPT_HEADER = (
    "SAVED WORKFLOWS — these are set up for this caller. If the request matches one, "
    "call load_skill with its name FIRST to get the steps, then follow them:"
)

# A user turn, not tool_choice={"type": "none"}. tool_choice: none is the stricter
# mechanism but Bedrock's support for it varies by model snapshot, and a 400 mid-call
# is unrecoverable — the caller hears the assistant die. A nudge works on every
# backend. Worth revisiting behind a setting once verified against the real endpoint.
WRAP_UP_NUDGE = (
    "Answer now in one or two spoken sentences using only what you already found. "
    "Do not call any more tools."
)

# Indexed by round number rather than chosen at random, so tests are deterministic.
# Deliberately generic: a filler that promises specifics ("checking Airtable now")
# becomes a lie the moment the tool set changes.
FILLERS = ("One moment.", "Still working on that.", "Almost there.")

TOOL_TIMEOUT_MESSAGE = "Tool timed out; tell the user you couldn't reach that system."
TOOL_ERROR_MESSAGE = "Tool failed; tell the user you couldn't complete that and stop."

EventKind = Literal["speak", "end_utterance", "tool_started", "tool_finished", "usage"]


@dataclass
class VoiceEvent:
    kind: EventKind
    text: str = ""
    # Filler frames are pre-emptible so the real answer interrupts them rather than
    # queueing behind them. Without <ConversationRelay preemptible="true"> a 0.4s
    # tool call means the caller sits through "One moment." before hearing the
    # answer — worse than the dead air the filler was meant to hide.
    preemptible: bool = False
    tool_name: str = ""
    payload: dict | None = None


def build_voice_system_prompt(skill_inventory: str = "") -> str:
    """
    The voice system prompt: base rules plus this caller's skill inventory.

    The inventory is injected rather than discovered because list_skills + load_skill
    would be two extra round-trips before the real work starts — 1–2 seconds of dead
    air. AgentSkill.description is the documented auto-trigger signal, so with the
    descriptions in the prompt a skill fires with zero discovery cost and the agent
    only needs load_skill to fetch the instructions.

    Volatile content goes last on purpose (see the prompt-cache note in the plan);
    nothing here sets cache_control, since per-call prompts sit under the cache
    minimum and would only pay write premiums with no reads.
    """
    prompt = VOICE_SYSTEM_PROMPT_BASE
    if skill_inventory.strip():
        prompt = f"{prompt}\n\n{_SKILL_PROMPT_HEADER}\n{skill_inventory.strip()}"
    return prompt


def _append_nudge(messages: list[dict]) -> None:
    """
    Add WRAP_UP_NUDGE as user-role text.

    Merged into the trailing user message rather than appended as a new one: the
    Messages API requires user/assistant roles to alternate, and after a tool round
    the last entry is already a user message carrying the tool_result blocks. A
    second consecutive user message would 400 mid-call.
    """
    block = {"type": "text", "text": WRAP_UP_NUDGE}
    last = messages[-1] if messages else None
    if isinstance(last, dict) and last.get("role") == "user":
        content = last.get("content")
        if isinstance(content, str):
            last["content"] = [{"type": "text", "text": content}, block]
            return
        if isinstance(content, list):
            content.append(block)
            return
    messages.append({"role": "user", "content": [block]})


@dataclass
class _Planned:
    """A tool_use block paired with the decision made about it before dispatch."""

    block: Any
    result: dict | None = None          # set when the block is answered without running
    record: ToolCallRecord | None = None


class VoiceAgent:
    """
    Drives one caller utterance to a spoken answer.

    `client` is injectable so tests never reach Bedrock (mirroring
    AgentOrchestrator.__init__). `state` is the per-call VoiceTurnState owned by the
    consumer — it holds the pending spoken confirmation, which must outlive a turn.
    """

    def __init__(
        self,
        *,
        user,
        client: Any | None = None,
        model: str | None = None,
        state: VoiceTurnState | None = None,
        skill_inventory: str = "",
    ) -> None:
        self._user = user
        self._client = client if client is not None else build_client()
        self.model = model or model_for_tier(TIER_VOICE)
        self.state = state if state is not None else VoiceTurnState()
        self.system_prompt = build_voice_system_prompt(skill_inventory)
        # Buffered for the consumer to write at turn end, once the assistant
        # AgentMessage exists to link them to.
        self.records: list[ToolCallRecord] = []

    # ── Public API ────────────────────────────────────────────────────────────

    async def run_turn(self, utterance: str, messages: list[dict]) -> AsyncIterator[VoiceEvent]:
        """
        Drive one caller utterance to completion, mutating `messages` in place.

        Exactly one rule governs frame boundaries: **one utterance per round**. A
        round that ends without tool calls emits its text chunks then one
        end_utterance; a round that ends in tool_use emits its text (or a filler if
        it produced none) then an end_utterance, closing that utterance so TTS
        flushes before the tool wait. A turn therefore produces 2–4 terminators,
        which is correct — `last:true` closes an *utterance*, not the session. The
        bug to avoid is a stranded `last:false` with no terminator, which leaves
        Twilio's TTS buffer waiting forever.
        """
        loop = asyncio.get_running_loop()
        started = loop.time()
        max_rounds = int(getattr(settings, "VOICE_MAX_TOOL_ROUNDS", 3))
        budget = float(getattr(settings, "VOICE_TURN_BUDGET_SECONDS", 20))
        max_tokens = int(getattr(settings, "VOICE_MAX_TOKENS", 512))

        messages.append({"role": "user", "content": utterance})

        total_input = 0
        total_output = 0
        rounds_used = 0

        for round_no in range(max_rounds + 1):
            rounds_used = round_no + 1
            over_budget = (loop.time() - started) > budget
            final_round = round_no == max_rounds or over_budget
            if final_round:
                # Streaming is never cancelled to enforce the budget — cancelling
                # mid-stream strands a last:false frame and wedges TTS for the rest
                # of the call. Instead the model is told to wrap up, and this round
                # runs to completion normally.
                _append_nudge(messages)
                if over_budget:
                    logger.info(
                        "Voice turn over budget (%.1fs) — forcing wrap-up round %d",
                        loop.time() - started, round_no,
                    )

            spoke = False
            async with self._client.messages.stream(
                model=self.model,
                max_tokens=max_tokens,
                system=self.system_prompt,
                tools=mcp_server.tool_schemas(),
                messages=messages,
            ) as stream:
                async for text in stream.text_stream:
                    if text:
                        spoke = True
                        yield VoiceEvent("speak", text=text)
                final = await stream.get_final_message()

            usage = getattr(final, "usage", None)
            total_input += getattr(usage, "input_tokens", 0) or 0
            total_output += getattr(usage, "output_tokens", 0) or 0

            content = list(getattr(final, "content", None) or [])
            tool_blocks = [b for b in content if getattr(b, "type", "") == "tool_use"]

            if not tool_blocks:
                yield VoiceEvent("end_utterance")
                break

            if final_round:
                # The nudge was ignored. Answering the blocks and looping again would
                # exceed the cap, so close the utterance and stop here rather than
                # leaving the caller with a stranded frame.
                logger.warning(
                    "Voice: model called tools on the final round; ending turn without them"
                )
                if not spoke:
                    yield VoiceEvent("speak", text=FILLERS[-1], preemptible=True)
                yield VoiceEvent("end_utterance")
                break

            # Close whatever we just spoke, or cover the wait with filler if the
            # round produced no text at all. Filler is only emitted in that case, so
            # the caller never hears the three fillers stacked up.
            if not spoke:
                yield VoiceEvent(
                    "speak", text=FILLERS[min(round_no, len(FILLERS) - 1)], preemptible=True
                )
            yield VoiceEvent("end_utterance")

            for block in tool_blocks:
                yield VoiceEvent("tool_started", tool_name=getattr(block, "name", ""))

            results, records = await self._execute_tools(
                tool_blocks, deadline=started + budget
            )
            self.records.extend(records)
            for record in records:
                yield VoiceEvent(
                    "tool_finished",
                    tool_name=record.tool_name,
                    payload={"status": record.status, "duration_ms": record.duration_ms},
                )

            messages.append({"role": "assistant", "content": content})
            messages.append({"role": "user", "content": results})

        yield VoiceEvent(
            "usage",
            payload={
                "input_tokens": total_input,
                "output_tokens": total_output,
                "model": self.model,
                "rounds": rounds_used,
            },
        )

    # ── Internal ──────────────────────────────────────────────────────────────

    def _plan(self, blocks: list[Any]) -> list[_Planned]:
        """
        Decide, synchronously and in order, which blocks may actually run.

        Done as an ordered pre-pass rather than inside the concurrent dispatch so
        that "which gated tool armed the confirmation" cannot depend on task
        scheduling. Gating is per *block*, not per turn: a non-gated tool in the same
        turn still dispatches normally and in parallel.
        """
        loop = asyncio.get_running_loop()
        planned: list[_Planned] = []
        armed_this_turn = False

        for block in blocks:
            name = getattr(block, "name", "")
            arguments = getattr(block, "input", None) or {}

            if name in VOICE_BLOCKED_TOOLS:
                planned.append(_Planned(
                    block,
                    result=self._error_result(block, "That action isn't available by phone."),
                    record=ToolCallRecord(name, arguments, status="error",
                                          error_message="blocked for voice"),
                ))
                continue

            if gate_for(name) is None:
                planned.append(_Planned(block))
                continue

            if armed_this_turn or self.state.pending is not None:
                # One spoken confirmation at a time — stacking two questions in one
                # utterance is unanswerable by speech or by a single keypress.
                planned.append(_Planned(
                    block,
                    result=self._text_result(
                        block,
                        "Another confirmation is already pending. Ask about that one "
                        "first, then raise this again.",
                    ),
                    record=ToolCallRecord(name, arguments, status="pending", gated=True),
                ))
                continue

            spoken = spoken_summary(name, arguments)
            self.state.arm(name, arguments, spoken, now=loop.time())
            armed_this_turn = True
            logger.info("Voice: gated '%s' pending confirmation (user=%s)", name, self._user)
            planned.append(_Planned(
                block,
                result=self._text_result(block, confirmation_result_content(spoken)),
                record=ToolCallRecord(name, arguments, status="pending", gated=True),
            ))

        return planned

    async def _execute_tools(
        self, blocks: list[Any], *, deadline: float
    ) -> tuple[list[dict], list[ToolCallRecord]]:
        """
        Answer every tool_use block, dispatching the ones that are allowed to run.

        **Every** block gets a tool_result, including gated, blocked and failed ones.
        A missing tool_result makes the next request 400 — the same invariant the
        chat loop respects for escalation, and mid-call a 400 is unrecoverable.
        """
        planned = self._plan(blocks)
        runnable = [p for p in planned if p.result is None]

        if runnable:
            outcomes = await asyncio.gather(
                *[self._dispatch_one(p.block, deadline=deadline) for p in runnable]
            )
            for plan, (result, record) in zip(runnable, outcomes):
                plan.result = result
                plan.record = record

        results = [p.result for p in planned if p.result is not None]
        records = [p.record for p in planned if p.record is not None]
        return results, records

    async def _dispatch_one(
        self, block: Any, *, deadline: float
    ) -> tuple[dict, ToolCallRecord]:
        loop = asyncio.get_running_loop()
        name = getattr(block, "name", "")
        arguments = getattr(block, "input", None) or {}

        per_tool = float(getattr(settings, "VOICE_TOOL_TIMEOUT_SECONDS", 8))
        # Bounded by the turn deadline as well as the per-tool ceiling, but never
        # below a floor — a tool given 0s would always "time out", which reads to the
        # caller as a broken integration.
        timeout = min(per_tool, max(0.1, deadline - loop.time()))

        start = loop.time()
        try:
            result = await asyncio.wait_for(
                mcp_server.dispatch(name, arguments, user=self._user), timeout=timeout
            )
        except (TimeoutError, asyncio.TimeoutError):
            duration = int((loop.time() - start) * 1000)
            logger.warning("Voice: tool '%s' timed out after %.1fs", name, timeout)
            return (
                self._error_result(block, TOOL_TIMEOUT_MESSAGE),
                ToolCallRecord(name, arguments, status="error",
                               error_message="timeout", duration_ms=duration),
            )
        except Exception as exc:  # noqa: BLE001 — one bad tool must not kill the call
            duration = int((loop.time() - start) * 1000)
            logger.exception("Voice: tool '%s' raised: %s", name, exc)
            return (
                self._error_result(block, TOOL_ERROR_MESSAGE),
                ToolCallRecord(name, arguments, status="error",
                               error_message=str(exc)[:500], duration_ms=duration),
            )

        duration = int((loop.time() - start) * 1000)
        return (
            self._text_result(block, json.dumps(result, default=str)),
            ToolCallRecord(name, arguments, result=result, status="success",
                           duration_ms=duration),
        )

    @staticmethod
    def _text_result(block: Any, content: str) -> dict:
        return {"type": "tool_result", "tool_use_id": getattr(block, "id", ""), "content": content}

    @staticmethod
    def _error_result(block: Any, content: str) -> dict:
        return {
            "type": "tool_result",
            "tool_use_id": getattr(block, "id", ""),
            "is_error": True,
            "content": content,
        }


async def dispatch_confirmed(
    tool_name: str, arguments: dict, user
) -> tuple[Any, ToolCallRecord]:
    """
    Run a tool the caller confirmed out loud, bypassing the model entirely.

    The model is not consulted between the question and the execution, so it cannot
    alter the arguments after the caller agreed to them — the whole point of holding
    PendingConfirmation on the consumer rather than in the transcript.
    """
    loop = asyncio.get_running_loop()
    start = loop.time()
    timeout = float(getattr(settings, "VOICE_TOOL_TIMEOUT_SECONDS", 8))
    try:
        result = await asyncio.wait_for(
            mcp_server.dispatch(tool_name, arguments, user=user), timeout=timeout
        )
    except Exception as exc:  # noqa: BLE001
        duration = int((loop.time() - start) * 1000)
        logger.exception("Voice: confirmed tool '%s' failed: %s", tool_name, exc)
        return None, ToolCallRecord(
            tool_name, arguments, status="error",
            error_message=str(exc)[:500], duration_ms=duration,
        )
    duration = int((loop.time() - start) * 1000)
    return result, ToolCallRecord(
        tool_name, arguments, result=result, status="success", duration_ms=duration
    )
