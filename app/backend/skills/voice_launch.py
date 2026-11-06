"""Hand-off of a skill run to a voice call (see models.VoiceLaunchContext)."""

from __future__ import annotations

import secrets
from datetime import timedelta

from django.utils import timezone

from .models import VoiceLaunchContext

TTL = timedelta(minutes=2)
# Spoken prompt budget. The voice loop re-reads it every turn.
MAX_VOICE_CONTEXT_CHARS = 6000


def create_launch_context(user, skill, run_result: dict) -> str:
    VoiceLaunchContext.objects.filter(created_at__lt=timezone.now() - TTL).delete()
    key = secrets.token_urlsafe(24)
    VoiceLaunchContext.objects.create(
        key=key, user=user, skill=skill,
        payload={"script": run_result["script"][:MAX_VOICE_CONTEXT_CHARS],
                 "allowed_tools": list(skill.allowed_tools or []) if skill else []},
    )
    return key


def consume_launch_context(user, key: str) -> dict | None:
    """
    The stored context for `key`, deleted on read. None when unknown, expired, or owned
    by someone else — a leaked key is useless to another account.
    """
    if not key:
        return None
    row = VoiceLaunchContext.objects.filter(key=key, user=user).select_related("skill").first()
    if row is None:
        return None
    VoiceLaunchContext.objects.filter(pk=row.pk).delete()
    if row.created_at < timezone.now() - TTL:
        return None
    return {"skill_name": row.skill.name if row.skill else "", **row.payload}
