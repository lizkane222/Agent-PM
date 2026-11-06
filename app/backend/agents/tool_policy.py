"""
Enforcement for every agent tool call — the part of the MCP server that protects what the
agent may do on a user's behalf.

`MCPServer.dispatch` is the one function chat, voice and saved workflows all reach a tool
through, so every rule lives behind it rather than in each tool body. Before this module
each tool re-implemented its own checks, and four of them quietly dropped their owner
filter when no user was attached, returning every user's data.

What `enforce()` guarantees, in order:

1. **No anonymous calls.** A dispatch with no authenticated user is refused before the tool
   body runs, so no tool can fall through to an unscoped queryset.
2. **Arguments match the schema the model was given.** Enums, types, required keys and
   unknown keys are checked server-side; the model's view of the schema is a hint, not a
   guarantee.
3. **Saved-workflow scope.** While a skill is active, only the tools it declared in
   `allowed_tools` (and that are `skill_safe`) can run. Before this, `allowed_tools` was
   text in a prompt and nothing enforced it.
4. **Confirmation for irreversible and outbound tools.** A tool in `CONFIRM_REQUIRED` runs
   only with a single-use token minted for that exact user, tool and argument set — so the
   model cannot change the arguments between the question and the action.
5. **Per-user rate limits by category**, backed by the shared Django cache.
6. **A timeout and a concurrency ceiling**, so one hung third-party call cannot pin the
   worker.
7. **One error shape.** Every failure reaches the model as
   ``{"status": "error", "error_code", "message", "retryable", "retry_after"?}`` with no
   exception text, so URIs, account SIDs and stack details never reach the model, the
   browser or the activity feed.

Voice keeps its own spoken gate (`realtime.voice_policy`) and passes `confirmed=True` once
the caller has said yes; that is the only other way past rule 4.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import secrets
import time
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any

from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)


# ── Error vocabulary ──────────────────────────────────────────────────────────


class ToolPolicyError(Exception):
    """A refusal raised by policy (or by a tool) that is safe to show the model verbatim."""

    def __init__(
        self,
        error_code: str,
        message: str,
        *,
        retryable: bool = False,
        retry_after: int | None = None,
        extra: dict | None = None,
    ) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.message = message
        self.retryable = retryable
        self.retry_after = retry_after
        self.extra = extra or {}

    def as_result(self) -> dict:
        result: dict[str, Any] = {
            "status": "error",
            "error_code": self.error_code,
            "message": self.message,
            "retryable": self.retryable,
        }
        if self.retry_after is not None:
            result["retry_after"] = self.retry_after
        result.update(self.extra)
        return result


def error_result(error_code: str, message: str, **kwargs) -> dict:
    return ToolPolicyError(error_code, message, **kwargs).as_result()


# Fixed strings for exceptions we did not raise ourselves. Nothing from the exception is
# interpolated: Twilio's TwilioRestException.__str__ carries the request URI with the
# account SID, and DB errors carry SQL.
_GENERIC_FAILURE = "The tool failed unexpectedly. The error has been logged."


def classify_exception(exc: BaseException, tool_name: str, ref: str) -> dict:
    """Map an unexpected tool exception onto the error vocabulary, without leaking its text."""
    if isinstance(exc, ToolPolicyError):
        return exc.as_result()

    status = _status_code(exc)
    retry_after = _retry_after(exc)
    if status == 429 or _is_rate_limit(exc):
        return error_result(
            "upstream_rate_limited",
            "A connected service is rate limiting requests. Wait before retrying.",
            retryable=True,
            retry_after=retry_after or 30,
            extra={"ref": ref},
        )
    if status in (401, 403):
        return error_result(
            "upstream_unauthorized",
            "A connected service rejected the credentials. The user may need to reconnect it in Settings.",
            extra={"ref": ref},
        )
    if status is not None and status >= 500:
        return error_result(
            "upstream_unavailable",
            "A connected service is temporarily unavailable.",
            retryable=True,
            retry_after=retry_after or 15,
            extra={"ref": ref},
        )
    if isinstance(exc, (TimeoutError, asyncio.TimeoutError)):
        return error_result(
            "timeout", f"{tool_name} took too long and was stopped.", retryable=True,
            extra={"ref": ref},
        )
    return error_result("internal_error", _GENERIC_FAILURE, extra={"ref": ref})


def _status_code(exc: BaseException) -> int | None:
    for attr in ("status_code", "status"):
        value = getattr(exc, attr, None)
        if isinstance(value, int):
            return value
    resp = getattr(exc, "resp", None) or getattr(exc, "response", None)
    value = getattr(resp, "status", None) or getattr(resp, "status_code", None)
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _retry_after(exc: BaseException) -> int | None:
    resp = getattr(exc, "response", None) or getattr(exc, "resp", None)
    headers = getattr(resp, "headers", None) or (resp if isinstance(resp, dict) else None)
    if not headers:
        return None
    raw = None
    try:
        raw = headers.get("retry-after") or headers.get("Retry-After")
    except Exception:  # noqa: BLE001 — header containers vary by client library
        return None
    try:
        return max(1, int(float(raw))) if raw is not None else None
    except (TypeError, ValueError):
        return None


def _is_rate_limit(exc: BaseException) -> bool:
    # Twilio 20429 / 14107 and Salesforce REQUEST_LIMIT_EXCEEDED arrive as non-429 statuses.
    code = getattr(exc, "code", None)
    if code in (20429, 14107):
        return True
    text = type(exc).__name__.lower()
    return "ratelimit" in text or "request_limit_exceeded" in str(getattr(exc, "content", "")).lower()


# ── Categories, limits, timeouts ──────────────────────────────────────────────

# Rate-limit buckets. A tool's category comes from its registered group, with outbound
# tools pulled into their own tight bucket regardless of group.
CATEGORY_FOR_GROUP = {
    "read": "read",
    "skills": "read",
    "create": "write",
    "update": "write",
    "delete": "delete",
    "communicate": "outbound",
    "other": "write",
}

# Tools that leave the platform. They share the strictest budget.
OUTBOUND_TOOLS = frozenset({"send_sms", "make_phone_call", "invite_to_meeting", "log_time_week"})

# Tools that may not run without an explicit confirmation token (chat) or a spoken /
# keypad "yes" (voice). Deletes are irreversible; outbound tools reach other people.
#
# EVERY tool in OUTBOUND_TOOLS must be listed here. Only two of the four used to be, so chat
# could email calendar guests (`invite_to_meeting`) or write timesheets (`log_time_week`) with
# no approval — after a customer received 2,000+ invitation emails. The product rule is that
# anything communicating with another person needs the user's explicit approval, on every
# surface. `agents/tests/test_outbound_approval.py` enforces it against the live registry, so
# a new outbound tool cannot be added without a gate. Do not remove entries.
CONFIRM_REQUIRED = frozenset({
    "delete_action_item",
    "delete_calendar_event",
    "send_sms",
    "make_phone_call",
    "invite_to_meeting",
    "log_time_week",
    # Notifies another person from the user's account. It stays inside the app (no email), so
    # it is not in OUTBOUND_TOOLS, but it is a message to someone else and a misheard name
    # would reach the wrong colleague — so it needs the same yes.
    "leave_note_for",
})

# Never callable from inside a saved workflow, whatever its allowed_tools says.
NEVER_SKILL_SAFE = CONFIRM_REQUIRED | OUTBOUND_TOOLS


def category_for(tool_name: str, group: str) -> str:
    if tool_name in OUTBOUND_TOOLS:
        return "outbound"
    return CATEGORY_FOR_GROUP.get(group, "write")


def _limits() -> dict[str, tuple[int, int]]:
    """{category: (max_calls, window_seconds)} — overridable per deployment."""
    defaults = {
        "read": (120, 60),
        "write": (40, 60),
        "delete": (10, 3600),
        "outbound": (5, 3600),
        "outbound_per_recipient": (3, 3600),
    }
    configured = getattr(settings, "AGENT_TOOL_RATE_LIMITS", None) or {}
    return {**defaults, **configured}


def _timeout_for(tool_name: str) -> float:
    per_tool = getattr(settings, "AGENT_TOOL_TIMEOUTS", None) or {}
    if tool_name in per_tool:
        return float(per_tool[tool_name])
    return float(getattr(settings, "AGENT_TOOL_TIMEOUT_SECONDS", 30))


# One process-wide ceiling on concurrent tool executions. `asyncio.gather` in the chat
# loop runs every tool_use block of a turn at once, and each one occupies a worker thread
# while it waits on Airtable / Google / Twilio.
_semaphore: asyncio.Semaphore | None = None
_semaphore_loop: asyncio.AbstractEventLoop | None = None


def _concurrency_gate() -> asyncio.Semaphore:
    global _semaphore, _semaphore_loop
    loop = asyncio.get_running_loop()
    if _semaphore is None or _semaphore_loop is not loop:
        _semaphore = asyncio.Semaphore(int(getattr(settings, "AGENT_TOOL_MAX_CONCURRENCY", 8)))
        _semaphore_loop = loop
    return _semaphore


# ── Rate limiting ─────────────────────────────────────────────────────────────


def check_rate_limit(user_id: int, category: str, *, now: float | None = None) -> None:
    """
    Fixed-window counter in the shared cache. Raises ToolPolicyError when over budget.

    `cache.add` + `cache.incr` is atomic on Redis and LocMem alike, so concurrent tool
    calls in one turn cannot both slip under the limit.
    """
    if not getattr(settings, "AGENT_TOOL_RATE_LIMITS_ENABLED", True):
        return
    limits = _limits()
    if category.startswith("outbound-to:"):
        # Per-recipient budget: one person cannot be messaged more than a few times an
        # hour however the overall outbound budget is set.
        max_calls, window = limits.get("outbound_per_recipient", (3, 3600))
    else:
        max_calls, window = limits.get(category, (40, 60))
    now = time.time() if now is None else now
    bucket = int(now // window)
    key = f"agent-tool-rl:{user_id}:{category}:{bucket}"
    cache.add(key, 0, timeout=window + 5)
    try:
        count = cache.incr(key)
    except ValueError:  # evicted between add and incr
        cache.set(key, 1, timeout=window + 5)
        count = 1
    if count > max_calls:
        retry_after = max(1, int(window - (now % window)))
        # Never echo the bucket key: for the per-recipient budget it holds a phone number.
        what = "messages or calls to this person" if category.startswith("outbound-to:") else f"{category} actions"
        raise ToolPolicyError(
            "rate_limited",
            f"Too many {what}. The limit is {max_calls} per "
            f"{_human_window(window)}; try again in {retry_after} seconds.",
            retryable=True,
            retry_after=retry_after,
        )


def _human_window(seconds: int) -> str:
    if seconds % 3600 == 0:
        hours = seconds // 3600
        return "hour" if hours == 1 else f"{hours} hours"
    if seconds % 60 == 0:
        minutes = seconds // 60
        return "minute" if minutes == 1 else f"{minutes} minutes"
    return f"{seconds} seconds"


# ── Argument validation ───────────────────────────────────────────────────────

_JSON_TYPES: dict[str, tuple[type, ...]] = {
    "string": (str,),
    "integer": (int,),
    "number": (int, float),
    "boolean": (bool,),
    "array": (list,),
    "object": (dict,),
}

MAX_STRING_LENGTH = 20_000


def validate_arguments(tool_name: str, schema: dict, arguments: Any) -> dict:
    """
    Check `arguments` against the tool's input_schema. Returns a cleaned copy.

    Deliberately small and strict rather than a full JSON Schema implementation: it covers
    exactly what the tool schemas in this codebase use (type, enum, required, minimum,
    maximum, maxLength, items.type, nullable via a list type), and refuses unknown keys —
    an unknown key used to surface as a Python TypeError whose text went to the model.
    """
    if arguments is None:
        arguments = {}
    if not isinstance(arguments, dict):
        raise ToolPolicyError("invalid_arguments", "Tool arguments must be a JSON object.")

    props: dict = schema.get("properties", {}) or {}
    required = schema.get("required", []) or []

    unknown = sorted(set(arguments) - set(props))
    if unknown:
        raise ToolPolicyError(
            "invalid_arguments",
            f"{tool_name} does not accept: {', '.join(unknown)}.",
            extra={"accepted": sorted(props)},
        )

    missing = [k for k in required if arguments.get(k) in (None, "")]
    if missing:
        raise ToolPolicyError("invalid_arguments", f"{tool_name} requires: {', '.join(missing)}.")

    cleaned: dict[str, Any] = {}
    for key, value in arguments.items():
        cleaned[key] = _validate_value(tool_name, key, props[key], value)
    return cleaned


def _validate_value(tool_name: str, key: str, spec: dict, value: Any) -> Any:
    if value is None:
        return None  # optional fields are passed as None/omitted throughout the tools

    declared = spec.get("type")
    types = declared if isinstance(declared, list) else [declared] if declared else []
    types = [t for t in types if t != "null"]

    if types:
        allowed: tuple[type, ...] = tuple(t for name in types for t in _JSON_TYPES.get(name, ()))
        # bool is an int subclass; never let True satisfy "integer"/"number".
        if isinstance(value, bool) and "boolean" not in types:
            raise _type_error(tool_name, key, types)
        if "integer" in types and isinstance(value, float) and value.is_integer():
            value = int(value)
        if "integer" in types and isinstance(value, str) and value.strip().lstrip("-").isdigit():
            value = int(value.strip())  # models frequently quote ids
        if allowed and not isinstance(value, allowed):
            raise _type_error(tool_name, key, types)

    if "enum" in spec and value not in spec["enum"]:
        raise ToolPolicyError(
            "invalid_arguments",
            f"{key} must be one of: {', '.join(map(str, spec['enum']))}.",
        )
    if isinstance(value, str):
        limit = min(int(spec.get("maxLength", MAX_STRING_LENGTH)), MAX_STRING_LENGTH)
        if len(value) > limit:
            raise ToolPolicyError("invalid_arguments", f"{key} is longer than {limit} characters.")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in spec and value < spec["minimum"]:
            raise ToolPolicyError("invalid_arguments", f"{key} must be at least {spec['minimum']}.")
        if "maximum" in spec and value > spec["maximum"]:
            raise ToolPolicyError("invalid_arguments", f"{key} must be at most {spec['maximum']}.")
    if isinstance(value, list):
        item_type = (spec.get("items") or {}).get("type")
        if item_type:
            allowed_items = _JSON_TYPES.get(item_type, ())
            if any(not isinstance(v, allowed_items) or isinstance(v, bool) and item_type != "boolean" for v in value):
                raise ToolPolicyError("invalid_arguments", f"Every item in {key} must be a {item_type}.")
        if len(value) > 500:
            raise ToolPolicyError("invalid_arguments", f"{key} has too many items (max 500).")
    return value


def _type_error(tool_name: str, key: str, types: list[str]) -> ToolPolicyError:
    return ToolPolicyError("invalid_arguments", f"{key} must be a {' or '.join(types)}.")


# ── Confirmation tokens ───────────────────────────────────────────────────────

CONFIRM_TTL_SECONDS = 300


def _argument_digest(tool_name: str, arguments: dict) -> str:
    canonical = json.dumps({"tool": tool_name, "args": arguments}, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()


def issue_confirmation(user_id: int, tool_name: str, arguments: dict) -> str:
    """Mint a single-use token binding this user to this exact tool call."""
    token = secrets.token_urlsafe(18)
    cache.set(
        f"agent-tool-confirm:{token}",
        {"user_id": user_id, "tool": tool_name, "digest": _argument_digest(tool_name, arguments)},
        timeout=CONFIRM_TTL_SECONDS,
    )
    return token


def peek_confirmation(token: str) -> dict | None:
    return cache.get(f"agent-tool-confirm:{token}")


def redeem_confirmation(token: str, user_id: int, tool_name: str, arguments: dict) -> bool:
    """True exactly once for a matching token; any mismatch burns nothing and returns False."""
    key = f"agent-tool-confirm:{token}"
    record = cache.get(key)
    if not record:
        return False
    if (
        record.get("user_id") != user_id
        or record.get("tool") != tool_name
        or not secrets.compare_digest(record.get("digest", ""), _argument_digest(tool_name, arguments))
    ):
        return False
    cache.delete(key)
    return True


def revoke_confirmation(token: str, user_id: int) -> bool:
    key = f"agent-tool-confirm:{token}"
    record = cache.get(key)
    if not record or record.get("user_id") != user_id:
        return False
    cache.delete(key)
    return True


# ── Active saved-workflow scope ───────────────────────────────────────────────

# Set by load_skill (and by the skills `run` path via the chat orchestrator). While set,
# only the skill's declared tools may be dispatched in this context.
active_skill: ContextVar["SkillScope | None"] = ContextVar("active_skill", default=None)


@dataclass(frozen=True)
class SkillScope:
    name: str
    allowed_tools: frozenset[str]


# Tools that stay callable inside a skill so it can still find records and report back.
SKILL_ALWAYS_ALLOWED = frozenset({"list_skills", "load_skill", "search_records", "resolve_skill_keywords"})


def check_skill_scope(tool_name: str, meta: dict) -> None:
    scope = active_skill.get()
    if scope is None:
        return
    if tool_name in SKILL_ALWAYS_ALLOWED:
        return
    if tool_name in NEVER_SKILL_SAFE or not meta.get("skill_safe", False):
        raise ToolPolicyError(
            "not_allowed_in_skill",
            f"The saved workflow '{scope.name}' cannot use {tool_name}. "
            f"Ask the user to do this directly instead.",
        )
    if tool_name not in scope.allowed_tools:
        raise ToolPolicyError(
            "not_allowed_in_skill",
            f"The saved workflow '{scope.name}' is not permitted to use {tool_name}. "
            f"It may use: {', '.join(sorted(scope.allowed_tools)) or 'no tools'}.",
        )
