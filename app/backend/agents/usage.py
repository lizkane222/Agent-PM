"""
Record token usage from non-chat LLM calls against the user who triggered them.

`token-stats` and the daily budget (`agents/token_budget.py`) both sum assistant
`AgentMessage` rows of the user's own sessions, so that is where usage is written: one
quiet, completed `AgentSession` per (user, feature) holding one assistant message per call.
Never raises: accounting must not break the feature it measures.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

TITLE_PREFIX = "AI usage: "


def record_llm_usage(user, feature: str, message) -> None:
    """`message` is an Anthropic response (has `.usage`). `user` must be the signed-in caller."""
    try:
        if user is None or not getattr(user, "pk", None):
            return
        usage = getattr(message, "usage", None)
        i = int(getattr(usage, "input_tokens", 0) or 0)
        o = int(getattr(usage, "output_tokens", 0) or 0)
        if not (i or o):
            return
        from agents.models import AgentMessage, AgentSession

        session, _ = AgentSession.objects.get_or_create(
            user=user, title=f"{TITLE_PREFIX}{feature}",
            defaults={"status": "completed"},
        )
        AgentMessage.objects.create(
            session=session, role="assistant", content=f"[{feature}]",
            input_tokens=i, output_tokens=o,
        )
    except Exception:  # noqa: BLE001
        logger.warning("could not record LLM usage for %s", feature, exc_info=True)
