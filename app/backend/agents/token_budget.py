"""
Daily token budgets: who may spend how much, and what happens at the limit.

Everything about budgets lives here so chat, voice, skill launches and the admin API cannot
disagree. Budgets are stored in **tokens**; dollars are a view of them through `TokenPricing`.

Behaviour at a limit (the owner's decision):
* **warn limit** — the user is warned and admins are notified. Nothing is stopped… unless an
  admin has set `block_at_warn` on that user, which turns the warn limit into a block.
* **block limit** — new requests are refused with a message naming who to ask.
* A turn that is already running is never cut off; the check happens before a turn starts, so
  the last turn may overshoot. A response cut off mid-stream would be worse than a small overrun.

A blank limit means "no limit has been set", and a user's own blank means "use my role's".
Nothing is limited until an admin sets a number — rollout cannot surprise anyone.

What counts: tokens the agent used for the person's chat and voice sessions
(`AgentMessage` rows of the user's own sessions — the same rows `token-stats` reports).
Skill runs are chat/voice turns, so they count. One-off author-side helpers (generate,
review, recommend tools, estimate) and background summarisers are not metered here.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.db.models import Sum
from django.utils import timezone

from .models import AgentMessage, RoleTokenDefault, TokenAlert, TokenPricing, UserTokenBudget

logger = logging.getLogger(__name__)
User = get_user_model()

# Mirrors `ROLE_ORDER` / `ROLE_META.label` in twilio-agent-pm-shared/src/brain/titleRoles.ts.
ROLE_ORDER = ["SA", "PM", "PgM", "CSM", "MA", "TAM", "AE", "ENG", "other"]
ROLE_LABELS = {
    "SA": "Solutions Architect", "PM": "Product Manager", "PgM": "Program Manager",
    "CSM": "Customer Success Manager", "MA": "Manager", "TAM": "Technical Account Manager",
    "AE": "Account Executive", "ENG": "Engineer", "other": "Other / no recognised title",
}


def title_role(title: str | None) -> str:
    """Port of `getTitleRole` (same specificity order). A parity test pins the cases."""
    import re

    if not title:
        return "other"
    t = title.lower()
    if "solution" in t and "architect" in t:
        return "SA"
    if re.search(r"\bsa\b", t):
        return "SA"
    if "technical account" in t or re.search(r"\btam\b", t):
        return "TAM"
    if "customer success" in t or re.search(r"\bcsm\b", t):
        return "CSM"
    if "program manager" in t or "project manager" in t or re.search(r"\bpgm\b", t):
        return "PgM"
    if "product manager" in t or re.search(r"\bpm\b", t):
        return "PM"
    if "manager" in t or re.search(r"\bma\b", t):
        return "MA"
    if "account executive" in t or re.search(r"\bae\b", t):
        return "AE"
    if "engineer" in t or re.search(r"\beng\b", t):
        return "ENG"
    return "other"


def role_of(user) -> str:
    try:
        return title_role(user.profile.title)
    except Exception:
        return "other"


# ── Pricing ───────────────────────────────────────────────────────────────────────────


def get_pricing() -> TokenPricing:
    return TokenPricing.objects.get_or_create(pk=1)[0]


def blended_usd_per_million(p: TokenPricing) -> Decimal:
    share = Decimal(p.output_share)
    return Decimal(p.input_usd_per_million) * (1 - share) + Decimal(p.output_usd_per_million) * share


def tokens_to_usd(tokens: int, p: TokenPricing | None = None) -> Decimal:
    """What `tokens` costs at the blended rate. Used to *display* a budget in dollars."""
    p = p or get_pricing()
    return (Decimal(tokens) * blended_usd_per_million(p) / Decimal(1_000_000)).quantize(Decimal("0.0001"))


def usd_to_tokens(usd: Decimal | float | str, p: TokenPricing | None = None) -> int:
    """The token budget a dollar amount buys at the blended rate."""
    p = p or get_pricing()
    rate = blended_usd_per_million(p)
    if rate <= 0:
        raise ValueError("The blended price must be above zero to convert dollars to tokens.")
    return int((Decimal(str(usd)) / rate * Decimal(1_000_000)).to_integral_value())


def usage_usd(input_tokens: int, output_tokens: int, p: TokenPricing | None = None) -> Decimal:
    """Exact cost of real usage — input and output priced separately."""
    p = p or get_pricing()
    return (
        (Decimal(input_tokens) * Decimal(p.input_usd_per_million)
         + Decimal(output_tokens) * Decimal(p.output_usd_per_million)) / Decimal(1_000_000)
    ).quantize(Decimal("0.0001"))


# ── Usage today ───────────────────────────────────────────────────────────────────────


def user_zone(user) -> ZoneInfo:
    try:
        return ZoneInfo(user.profile.timezone or "UTC")
    except Exception:
        return ZoneInfo("UTC")


def local_today(user) -> date:
    return timezone.now().astimezone(user_zone(user)).date()


def day_bounds(user, day: date) -> tuple[datetime, datetime]:
    """[start, end) of `day` in the user's own timezone, as aware datetimes."""
    tz = user_zone(user)
    start = datetime.combine(day, time.min, tzinfo=tz)
    return start, start + timedelta(days=1)


def usage_on(user, day: date) -> tuple[int, int]:
    start, end = day_bounds(user, day)
    agg = AgentMessage.objects.filter(
        session__user=user, role="assistant", created_at__gte=start, created_at__lt=end,
    ).aggregate(i=Sum("input_tokens"), o=Sum("output_tokens"))
    return int(agg["i"] or 0), int(agg["o"] or 0)


# ── Effective budget & state ──────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Budget:
    warn: int | None
    block: int | None
    block_at_warn: bool
    warn_source: str   # "user" | "role" | "none"
    block_source: str


def effective_budget(user) -> Budget:
    own = UserTokenBudget.objects.filter(user=user).first()
    role = RoleTokenDefault.objects.filter(role=role_of(user)).first()

    def pick(field):
        if own is not None and getattr(own, field) is not None:
            return getattr(own, field), "user"
        if role is not None and getattr(role, field) is not None:
            return getattr(role, field), "role"
        return None, "none"

    warn, ws = pick("warn_tokens")
    block, bs = pick("block_tokens")
    return Budget(warn, block, bool(own and own.block_at_warn), ws, bs)


@dataclass(frozen=True)
class BudgetStatus:
    state: str            # "ok" | "warn" | "blocked"
    used: int
    warn: int | None
    block: int | None
    block_at_warn: bool
    reason: str = ""      # "block_limit" | "warn_limit_restricted" | ""

    def as_dict(self) -> dict:
        return {"state": self.state, "used": self.used, "warn": self.warn, "block": self.block,
                "block_at_warn": self.block_at_warn, "reason": self.reason}


def status_for(user, extra_tokens: int = 0) -> BudgetStatus:
    """The user's state today. `extra_tokens` lets a caller include a turn still in flight."""
    i, o = usage_on(user, local_today(user))
    used = i + o + max(0, extra_tokens)
    b = effective_budget(user)
    if b.block is not None and used >= b.block:
        return BudgetStatus("blocked", used, b.warn, b.block, b.block_at_warn, "block_limit")
    if b.warn is not None and used >= b.warn:
        if b.block_at_warn:
            return BudgetStatus("blocked", used, b.warn, b.block, True, "warn_limit_restricted")
        return BudgetStatus("warn", used, b.warn, b.block, False)
    return BudgetStatus("ok", used, b.warn, b.block, b.block_at_warn)


def gate_status(user, extra_tokens: int = 0) -> BudgetStatus:
    """
    `status_for` for the request gates (chat, voice, skill launch): fails *open*.

    A budget is a cost control, not a security boundary, so if the check itself breaks — an
    unmigrated database, a bad row — the agent keeps working and the failure is logged loudly,
    rather than every chat turn returning a 500. The admin API and tests call `status_for`
    directly, so a real fault is still visible there.
    """
    try:
        return status_for(user, extra_tokens)
    except Exception:
        logger.exception("Token budget check failed for user %s; allowing the request", getattr(user, "pk", "?"))
        return BudgetStatus("ok", 0, None, None, False)


def _admins():
    from core.mixins import is_admin

    return [u for u in User.objects.filter(is_active=True) if is_admin(u)]


def blocked_message(status: BudgetStatus) -> str:
    if status.reason == "warn_limit_restricted":
        what = "your daily token limit (an admin has set it to stop at this point)"
    else:
        what = "your daily token limit"
    return (f"You've reached {what}, so the agent is paused until tomorrow. "
            "Ask an admin if you need more today.")


def note_state(user, status: BudgetStatus) -> None:
    """
    Record that a limit was reached (once per user, day and level) and tell people.

    Admins are notified so they can see who is hitting limits; the user is told too, since a
    warning nobody sees changes nothing. Never raises: bookkeeping must not break a turn.
    """
    if status.state == "ok":
        return
    try:
        level = "block" if status.state == "blocked" else "warn"
        limit = (status.block if status.reason == "block_limit" else status.warn) or 0
        _, created = TokenAlert.objects.get_or_create(
            user=user, day=local_today(user), level=level,
            defaults={"tokens_used": status.used, "limit_tokens": limit},
        )
        if not created:
            return
        from team.notifications import record_notification

        name = getattr(getattr(user, "profile", None), "display_name", "") or user.get_username()
        if level == "warn":
            title = f"{name} reached their daily token warn limit"
            body = f"{status.used:,} tokens used today (warn limit {limit:,})."
        else:
            title = f"{name} is blocked: daily token limit reached"
            body = f"{status.used:,} tokens used today (limit {limit:,}). The agent is paused for them until tomorrow."
        for admin in _admins():
            if admin.pk != user.pk:
                record_notification(admin, "in_app", "token_budget", title, body, link="/settings/admin-data")
        record_notification(
            user, "in_app", "token_budget",
            "Daily token limit reached" if level == "block" else "Approaching your daily token limit",
            blocked_message(status) if level == "block"
            else f"You've used {status.used:,} tokens today (warn limit {limit:,}).",
        )
    except Exception:
        logger.exception("Could not record token alert for user %s", getattr(user, "pk", "?"))


def days_hit(user, level: str, days: int = 14) -> int:
    since = local_today(user) - timedelta(days=days - 1)
    return TokenAlert.objects.filter(user=user, level=level, day__gte=since).count()
