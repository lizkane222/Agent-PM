"""
Single entry point for every LLM call this app makes.

Before this module there were **six** independent client constructions — the agent
orchestrator, skill generate/review, sync-review triage, the account-feed field-type
guesser, and two Gong/Zoom summarisers — five of them hardwired to Bedrock or to the
direct Anthropic API. Switching provider meant editing five files and was easy to do
incompletely. Everything now resolves its model through `model_for_tier()` and its
client through `build_sync_client()` / `build_async_client()`.

Two backends:

* ``gateway`` (default) — the corporate LiteLLM proxy. Authenticated with a
  short-lived Okta token, minted by ``AGENT_GATEWAY_TOKEN_COMMAND`` and cached here
  until just before it expires. A static ``ANTHROPIC_API_KEY`` (a LiteLLM virtual
  key) takes precedence when set, which is what CI and prod should use.
* ``bedrock`` — the previous path, kept so it can be switched back with one env var.

**Non-Anthropic models are refused.** The gateway publishes ``et-router`` and
``claude-router``, which pool Anthropic's models with third-party ones — measured
2026-08-31, both dispatched to ``moonshotai.kimi-k2.5``. Account, meeting and
customer-contact data must not leave for another vendor, so `model_for_tier()`
rejects any resolved id that is not Anthropic. The guard is deliberately in the
resolver rather than at the call sites: it is the one funnel every path goes through.
Set ``AGENT_REQUIRE_ANTHROPIC_MODEL=0`` to lift it deliberately.
"""

from __future__ import annotations

import base64
import json
import logging
import shlex
import subprocess
import threading
import time

import anthropic
import truststore
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

truststore.inject_into_ssl()

logger = logging.getLogger(__name__)

TIER_DEFAULT = "default"
TIER_STRONG = "strong"
TIER_VOICE = "voice"

# Refresh this far ahead of the token's own expiry so a request never starts with a
# credential that dies mid-flight.
TOKEN_REFRESH_MARGIN_SECONDS = 120

# Substrings that mark a model id as Anthropic-served. Checked rather than an
# allow-list of exact ids so a new Claude release needs no code change.
_ANTHROPIC_MARKERS = ("claude", "anthropic")

# Known cross-vendor routers on the gateway. Named explicitly so the error says what
# is actually wrong instead of "not an Anthropic model".
_KNOWN_ROUTERS = ("et-router", "claude-router")

# Opus is disabled by request (cost). Substring-matched so every variant is covered —
# claude-opus-5, claude-opus-4-8[1m], us.anthropic.claude-opus-4-7, …
_OPUS_MARKER = "opus"

# Tiers tried, in order, when a resolved model has to be replaced. Read from the same
# tier map so the substitute is always valid for the active backend — a hardcoded id
# would be wrong under `bedrock`.
_FALLBACK_TIER_ORDER = (TIER_DEFAULT, TIER_VOICE, TIER_STRONG)


class GatewayCredentialError(ImproperlyConfigured):
    """
    The gateway credential could not be obtained.

    A distinct type so the API layer can offer "re-authenticate" advice, instead of
    lumping it in with genuine misconfiguration like an unset model tier. Both are
    ImproperlyConfigured, but only one is something the user can fix themselves.
    """

_token_lock = threading.Lock()
_token_cache: tuple[str, float] | None = None  # (token, expires_at_epoch)


# ── Model resolution ──────────────────────────────────────────────────────────

def model_for_tier(tier: str) -> str:
    """
    Resolve a tier name to a concrete model id for the configured backend.

    Opus is substituted rather than rejected: the request was to *fall back to the
    other models*, so a tier (or an AGENT_MODEL_OVERRIDE) that names Opus degrades to
    the best non-Opus model configured for this backend and logs that it did. Raising
    would take the whole agent down over a cost preference.
    """
    model = _raw_model_for_tier(tier)
    if is_opus_blocked(model):
        replacement = _non_opus_fallback(tier)
        logger.warning(
            "Opus is disabled (AGENT_BLOCK_OPUS): tier %r resolved to %r, using %r instead",
            tier, model, replacement,
        )
        model = replacement
    _assert_anthropic(model, tier)
    return model


def is_opus(model: str) -> bool:
    return _OPUS_MARKER in (model or "").lower()


def is_opus_blocked(model: str) -> bool:
    """True when `model` is an Opus id and Opus is disabled."""
    return getattr(settings, "AGENT_BLOCK_OPUS", True) and is_opus(model)


def _non_opus_fallback(tier: str) -> str:
    """
    The best non-Opus model configured for the active backend.

    Read from the tier map rather than hardcoded, so it stays correct for whichever
    backend is active. Raises if *every* configured tier is Opus — at that point there
    is nothing legitimate to fall back to, and inventing a model id would be worse
    than a loud failure.
    """
    tiers = settings.AGENT_MODEL_TIERS.get(settings.AGENT_BACKEND, {})
    for candidate_tier in _FALLBACK_TIER_ORDER:
        candidate = tiers.get(candidate_tier) or ""
        if candidate and not is_opus(candidate):
            return candidate
    raise ImproperlyConfigured(
        f"Opus is disabled (AGENT_BLOCK_OPUS) and tier {tier!r} resolved to an Opus "
        f"model, but backend {settings.AGENT_BACKEND!r} configures no non-Opus model "
        f"to fall back to. Set AGENT_MODEL_{settings.AGENT_BACKEND.upper()}_DEFAULT."
    )


def _raw_model_for_tier(tier: str) -> str:
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


def is_anthropic_model(model: str) -> bool:
    lowered = (model or "").lower()
    if lowered in _KNOWN_ROUTERS:
        return False
    return any(marker in lowered for marker in _ANTHROPIC_MARKERS)


def _assert_anthropic(model: str, tier: str) -> None:
    if not getattr(settings, "AGENT_REQUIRE_ANTHROPIC_MODEL", True):
        return
    if is_anthropic_model(model):
        return
    if (model or "").lower() in _KNOWN_ROUTERS:
        raise ImproperlyConfigured(
            f"Tier {tier!r} resolves to {model!r}, a cross-vendor router: it pools "
            f"Anthropic's models with third-party ones (measured routing to "
            f"moonshotai.kimi-k2.5), so app data would leave for another vendor. "
            f"Pin an Anthropic model instead, e.g. claude-sonnet-4-6."
        )
    raise ImproperlyConfigured(
        f"Tier {tier!r} resolves to {model!r}, which is not an Anthropic model. "
        f"Set AGENT_REQUIRE_ANTHROPIC_MODEL=0 only if sending this app's data to "
        f"another vendor is intended."
    )


# ── Gateway credential ────────────────────────────────────────────────────────

def _jwt_expiry(token: str) -> float | None:
    """`exp` from a JWT payload, or None if it isn't a decodable JWT.

    The signature is not verified — this is only used to decide when to re-mint.
    """
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload))
        exp = claims.get("exp")
        return float(exp) if exp else None
    except Exception:  # noqa: BLE001 — an opaque key is fine, it just isn't cacheable by exp
        return None


def _mint_gateway_token() -> tuple[str, float]:
    command = getattr(settings, "AGENT_GATEWAY_TOKEN_COMMAND", "")
    if not command:
        raise GatewayCredentialError(
            "AGENT_BACKEND=gateway needs either ANTHROPIC_API_KEY (a LiteLLM virtual "
            "key) or AGENT_GATEWAY_TOKEN_COMMAND (a helper that prints a token)."
        )
    timeout = float(getattr(settings, "AGENT_GATEWAY_TOKEN_TIMEOUT", 20))
    try:
        completed = subprocess.run(  # noqa: S603 — operator-configured command
            shlex.split(command),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=True,
        )
    except subprocess.TimeoutExpired:
        # The helper falls back to an interactive browser login when its cached token
        # has expired, which would otherwise hang a web worker indefinitely.
        raise GatewayCredentialError(
            f"{command} timed out after {timeout}s. Its cached token has probably "
            f"expired and it is waiting on a browser login — run it once in a "
            f"terminal to re-authenticate, then retry."
        ) from None
    except FileNotFoundError:
        raise GatewayCredentialError(f"AGENT_GATEWAY_TOKEN_COMMAND not found: {command}") from None
    except subprocess.CalledProcessError as exc:
        # stderr may name the auth failure; the token itself is on stdout and is not logged.
        raise GatewayCredentialError(
            f"{command} failed (exit {exc.returncode}): {(exc.stderr or '').strip()[:300]}"
        ) from None

    token = (completed.stdout or "").strip()
    if not token:
        raise GatewayCredentialError(f"{command} produced no token.")

    expiry = _jwt_expiry(token)
    if expiry is None:
        # Not a JWT — cache briefly so a hot path doesn't fork a subprocess per call.
        expiry = time.time() + 300
    return token, expiry


def gateway_token(*, force: bool = False) -> str:
    """
    A currently-valid gateway credential.

    ``ANTHROPIC_API_KEY`` wins when set (static LiteLLM virtual key, the right thing
    for CI and prod). Otherwise the helper command is run and its token cached in
    process until ``TOKEN_REFRESH_MARGIN_SECONDS`` before it expires.
    """
    static_key = getattr(settings, "ANTHROPIC_API_KEY", "") or ""
    if static_key:
        return static_key

    global _token_cache
    with _token_lock:
        now = time.time()
        if not force and _token_cache is not None:
            token, expires_at = _token_cache
            if now < expires_at - TOKEN_REFRESH_MARGIN_SECONDS:
                return token
        token, expires_at = _mint_gateway_token()
        _token_cache = (token, expires_at)
        logger.info(
            "Minted LiteLLM gateway token (expires in %.0fs)", max(0.0, expires_at - now)
        )
        return token


def reset_gateway_token_cache() -> None:
    """Drop the cached token. For tests and for forcing a re-auth."""
    global _token_cache
    with _token_lock:
        _token_cache = None


# ── Clients ───────────────────────────────────────────────────────────────────

def _gateway_kwargs() -> dict:
    # base_url is always explicit: Claude Code's managed settings export
    # ANTHROPIC_BASE_URL, so a bare client would silently inherit it from whichever
    # shell launched Django.
    return {
        "base_url": settings.AGENT_GATEWAY_BASE_URL,
        # The gateway authenticates with a bearer token, not an x-api-key header.
        "auth_token": gateway_token(),
    }


def build_async_client():
    """Async Anthropic client for the configured backend."""
    backend = settings.AGENT_BACKEND
    if backend == "gateway":
        return anthropic.AsyncAnthropic(**_gateway_kwargs())
    if backend == "bedrock":
        # Credentials resolve from AWS_PROFILE / AWS_REGION via botocore.
        return anthropic.AsyncAnthropicBedrock()
    raise ImproperlyConfigured(
        f"AGENT_BACKEND={backend!r} is not one of {sorted(settings.AGENT_MODEL_TIERS)}."
    )


def build_sync_client():
    """Blocking Anthropic client, for Celery tasks and DRF request paths."""
    backend = settings.AGENT_BACKEND
    if backend == "gateway":
        return anthropic.Anthropic(**_gateway_kwargs())
    if backend == "bedrock":
        return anthropic.AnthropicBedrock()
    raise ImproperlyConfigured(
        f"AGENT_BACKEND={backend!r} is not one of {sorted(settings.AGENT_MODEL_TIERS)}."
    )


def complete(
    prompt: str,
    *,
    tier: str = TIER_DEFAULT,
    max_tokens: int = 1024,
    system: str = "",
    model: str | None = None,
) -> str:
    """
    Single-turn completion returning plain text.

    Replaces the hand-rolled boto3 ``invoke_model`` calls in sync_review and
    account_feed, which spoke the Bedrock wire protocol directly
    (``{"anthropic_version": "bedrock-2023-05-31", ...}``) and so could not reach the
    gateway at all.
    """
    client = build_sync_client()
    kwargs = {
        "model": model or model_for_tier(tier),
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}],
    }
    if system:
        kwargs["system"] = system
    message = client.messages.create(**kwargs)
    return "".join(
        block.text for block in message.content if getattr(block, "type", "") == "text"
    ).strip()
