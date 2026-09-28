"""
Voice-safe tool policy: a spoken confirmation gate for irreversible actions.

Chat and voice deliberately have *different* gates, and the asymmetry is the point.
A chat user sees the exact tool arguments rendered in the UI before anything runs;
agents/agent.py's prompt-level guidance is enough there. A voice user hears a lossy
paraphrase of arguments derived from a lossy transcription and cannot review
anything. Different trust levels warrant different gates, so this module exists
alongside the chat path rather than replacing it — agents/agent.py and
agents/mcp_server.py are not touched by the gate.

The authoritative record is a PendingConfirmation held on the consumer instance
(one WebSocket = one call = one state object). It is deliberately *not* the model's
memory of the conversation and not something in the transcript, so the model cannot
talk itself past it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Literal

from django.conf import settings


def _digits(number: str) -> str:
    """
    Render a phone number so a misheard digit is audible: "plus 1, 555, 123, 4567".

    Reading "+15551234567" as one number produces TTS that no caller can verify,
    which would make the confirmation theatre rather than a real check.
    """
    raw = (number or "").strip()
    if not raw:
        return "that number"
    plus = raw.startswith("+")
    digits = re.sub(r"\D", "", raw)
    if not digits:
        return "that number"

    parts: list[str] = []
    rest = digits
    # North-American shape: 1 + area + exchange + line. Anything else falls back to
    # 3-digit groups, which is still far more intelligible than one long run.
    if plus and len(digits) == 11 and digits.startswith("1"):
        parts = ["plus 1", digits[1:4], digits[4:7], digits[7:]]
        rest = ""
    elif len(digits) == 10:
        parts = [digits[:3], digits[3:6], digits[6:]]
        rest = ""
    else:
        if plus:
            parts.append("plus")
        while rest:
            parts.append(rest[:3])
            rest = rest[3:]
    return ", ".join(p for p in parts if p)


def _trim(text: str, limit: int = 160) -> str:
    """Bound a spoken echo of free text so a long SMS body isn't read out in full."""
    cleaned = " ".join((text or "").split())
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[:limit].rstrip() + ", and so on"


def _label(arguments: dict, *keys: str) -> str:
    """First non-empty argument among `keys`, for naming a record out loud."""
    for key in keys:
        value = arguments.get(key)
        if value:
            return str(value)
    return "that record"


def _week_phrase(week_start: str) -> str:
    """"the week of 2026-08-31", or "this week" when the tool was called with no date."""
    cleaned = (week_start or "").strip()
    return f"the week of {cleaned}" if cleaned else "this week"


@dataclass(frozen=True)
class ConfirmSpec:
    category: Literal["destructive", "outbound"]
    summarize: Callable[[dict], str]


# Every entry must be a real registered tool name — test_voice_policy asserts this,
# so renaming a tool in mcp_server.py cannot silently disarm its gate.
VOICE_CONFIRM_TOOLS: dict[str, ConfirmSpec] = {
    "delete_action_item": ConfirmSpec(
        "destructive",
        lambda a: f"permanently delete the action item {_label(a, 'airtable_id')}",
    ),
    "delete_meeting": ConfirmSpec(
        "destructive",
        lambda a: f"permanently delete the meeting {_label(a, 'airtable_id')}",
    ),
    "delete_calendar_event": ConfirmSpec(
        "destructive",
        lambda a: f"permanently delete calendar event {_label(a, 'event_id')}",
    ),
    "send_sms": ConfirmSpec(
        "outbound",
        lambda a: f"text {_digits(a.get('to', ''))} saying: {_trim(a.get('body', ''))}",
    ),
    "make_phone_call": ConfirmSpec(
        "outbound",
        lambda a: f"call {_digits(a.get('to', ''))} and say: {_trim(a.get('message', ''))}",
    ),
    # "outbound" rather than "destructive": it writes timesheet rows into Salesforce on the
    # user's behalf — the same trust level as sending an SMS, not a local delete. Gated
    # because a misheard "log my time" writes real records into a shared org, and over a
    # lossy speech channel "press 1" is the reliable path.
    "log_time_week": ConfirmSpec(
        "outbound",
        lambda a: (
            "log your time"
            + (f" for {a['account_name']}" if a.get("account_name") else "")
            + f" for {_week_phrase(a.get('week_start', ''))} to Cloud Coach"
        ),
    ),
}

# Escape hatch for withdrawing a tool from voice entirely. Empty by default.
VOICE_BLOCKED_TOOLS: frozenset[str] = frozenset()

# Regex rather than an LLM classifier: zero added latency, fully deterministic, and
# testable. An LLM round-trip would add ~500ms at the single most safety-critical
# moment in the call. The two-strike escape below plus DTMF cover the ambiguity.
AFFIRM_RE = re.compile(
    r"\b(yes|yeah|yep|yup|confirm(?:ed)?|do it|go ahead|please do|correct|affirmative|"
    r"that'?s right|sounds good)\b",
    re.I,
)
DENY_RE = re.compile(
    r"\b(no|nope|nah|cancel|stop|don'?t|do not|nevermind|never mind|abort|forget it|"
    r"negative)\b",
    re.I,
)

Reply = Literal["affirm", "deny", "unclear"]


def classify_reply(utterance: str) -> Reply:
    """
    Classify a reply to a spoken confirmation.

    DENY wins on a tie: "yes, no wait, cancel" must not delete anything. Erring
    toward not-acting is always the recoverable direction.
    """
    text = utterance or ""
    denies = bool(DENY_RE.search(text))
    affirms = bool(AFFIRM_RE.search(text))
    if denies:
        return "deny"
    if affirms:
        return "affirm"
    return "unclear"


# DTMF is the important half of this design: for an irreversible action over a lossy
# speech channel a keypress is far more reliable than ASR, which is why the spoken
# prompt says "say yes, or press 1".
DTMF_AFFIRM = "1"
DTMF_DENY = {"2", "*"}


def classify_dtmf(digit: str) -> Reply:
    """1 confirms, 2 and * cancel, everything else is ignored (pending survives)."""
    if digit == DTMF_AFFIRM:
        return "affirm"
    if digit in DTMF_DENY:
        return "deny"
    return "unclear"


# The tool_result content handed back to the model in place of the real result. It
# must forbid re-calling the tool, or the model loops on it for the rest of the turn.
CONFIRMATION_SENTINEL = "CONFIRMATION_REQUIRED"

MAX_UNCLEAR_ASKS = 2


def confirmation_result_content(spoken: str) -> str:
    return (
        f"{CONFIRMATION_SENTINEL}. Do not call this tool again. Ask the user, in one "
        f'sentence: "Just to confirm — you want me to {spoken}? Say yes, or press 1."'
    )


@dataclass
class PendingConfirmation:
    tool_name: str
    arguments: dict
    spoken: str
    created_at: float
    asks: int = 0

    def question(self) -> str:
        return f"Just to confirm — you want me to {self.spoken}? Say yes, or press 1."


@dataclass
class VoiceTurnState:
    """Per-call mutable state, owned by the consumer instance."""

    pending: PendingConfirmation | None = None

    def arm(self, tool_name: str, arguments: dict, spoken: str, now: float) -> PendingConfirmation:
        self.pending = PendingConfirmation(
            tool_name=tool_name, arguments=dict(arguments), spoken=spoken, created_at=now
        )
        return self.pending

    def clear(self) -> None:
        self.pending = None

    def expire(self, now: float) -> bool:
        """Drop a stale pending confirmation. Returns True if one was dropped."""
        if self.pending is None:
            return False
        ttl = getattr(settings, "VOICE_CONFIRM_TTL_SECONDS", 90)
        if now - self.pending.created_at > ttl:
            self.pending = None
            return True
        return False


def gate_for(tool_name: str) -> ConfirmSpec | None:
    """The ConfirmSpec guarding this tool, or None if it may run unconfirmed."""
    return VOICE_CONFIRM_TOOLS.get(tool_name)


def spoken_summary(tool_name: str, arguments: dict) -> str:
    """One spoken sentence describing what the tool is about to do."""
    spec = VOICE_CONFIRM_TOOLS[tool_name]
    try:
        return spec.summarize(arguments or {})
    except Exception:  # noqa: BLE001 — a summariser must never break the gate
        return f"run {tool_name.replace('_', ' ')}"
