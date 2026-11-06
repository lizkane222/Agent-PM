"""Live Tracking: server-side start/stop timers for action items.

The rules, as specified:

* Two time fields. ``time_spent`` is the overall total (tracked + manual edits);
  ``tracked_time`` is what Live Tracking alone has added. A stop adds the session's
  seconds to both, atomically (``F()``), so concurrent stops by two people never lose
  an increment.
* The first Start puts a ``work_tracking`` block on the calendar immediately.
* That block is reused while the tracked time it represents is ≤ 15 minutes. A Start
  after that, once it has gone over 15 minutes, opens a *new* block at the new start time,
  and the rule applies again to that block.
* A block is drawn as its tracked seconds rounded up to a 15-minute increment from its
  first start — e.g. start 9:00, stop 9:05, restart 9:40, stop 9:48 = 13 min tracked,
  one block 9:00–9:15. Log Time reads these blocks, which is how time reaches it in
  15-minute increments.

One running session per (user, item), enforced by a DB constraint. Everything here is
synchronous and DB-only except the best-effort Airtable mirror of the two totals.
"""

from __future__ import annotations

import logging
import math
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models import F, Sum
from django.utils import timezone

from .models import ActionItemTimeSession, AirtableActionItem

logger = logging.getLogger(__name__)

BLOCK_SECONDS = 15 * 60
# A single session longer than this is almost certainly a forgotten timer.
MAX_SESSION_SECONDS = 12 * 60 * 60


def block_seconds_for(tracked_seconds: int) -> int:
    """Calendar length for `tracked_seconds`: rounded up to 15 min, never zero."""
    if tracked_seconds <= 0:
        return BLOCK_SECONDS
    return int(math.ceil(tracked_seconds / BLOCK_SECONDS) * BLOCK_SECONDS)


def _block_tracked_seconds(event_id: int) -> int:
    return (
        ActionItemTimeSession.objects
        .filter(calendar_event_id=event_id, ended_at__isnull=False)
        .aggregate(total=Sum("seconds"))["total"] or 0
    )


def _latest_block(user, item):
    last = (
        ActionItemTimeSession.objects
        .filter(user=user, action_item=item, calendar_event__isnull=False)
        .select_related("calendar_event")
        .order_by("-started_at")
        .first()
    )
    return last.calendar_event if last else None


def _create_block(user, item, start):
    from scheduler.models import CalendarEvent

    return CalendarEvent.objects.create(
        owner=user,
        title=item.task or "Action item",
        description=f"Work session — {item.account.name if item.account else ''}".rstrip(" —"),
        start_datetime=start,
        end_datetime=start + timedelta(seconds=BLOCK_SECONDS),
        all_day=False,
        status="confirmed",
        calendar_id="work_tracking",
        is_synced=False,
        event_category="task",
        agentpm_airtable_id=item.airtable_id,
        account=_scheduler_account_for(item),
    )


def _scheduler_account_for(item):
    """The accounts.Account for an action item's AirtableAccount, matched by name."""
    if not item.account or not item.account.name:
        return None
    from accounts.models import Account

    return Account.objects.filter(company_name__iexact=item.account.name).first()


def running_session(user, item):
    return ActionItemTimeSession.objects.filter(user=user, action_item=item, ended_at__isnull=True).first()


def start(user, item) -> ActionItemTimeSession:
    """Start (or return the already-running) session, attaching it to a calendar block."""
    now = timezone.now()
    with transaction.atomic():
        existing = running_session(user, item)
        if existing:
            return existing
        block = _latest_block(user, item)
        if block is None or _block_tracked_seconds(block.pk) > BLOCK_SECONDS:
            block = _create_block(user, item, now)
        try:
            with transaction.atomic():
                return ActionItemTimeSession.objects.create(
                    user=user, action_item=item, started_at=now, calendar_event=block,
                )
        except IntegrityError:
            # A concurrent start won the race (two tabs) — return that one.
            return running_session(user, item)


def stop(user, item) -> ActionItemTimeSession | None:
    """Stop the running session: add its seconds to both totals and resize its block."""
    now = timezone.now()
    with transaction.atomic():
        session = (
            ActionItemTimeSession.objects
            .select_for_update()
            .filter(user=user, action_item=item, ended_at__isnull=True)
            .first()
        )
        if session is None:
            return None
        seconds = int((now - session.started_at).total_seconds())
        seconds = max(0, min(seconds, MAX_SESSION_SECONDS))
        session.ended_at = now
        session.seconds = seconds
        session.save(update_fields=["ended_at", "seconds"])

        if seconds:
            AirtableActionItem.objects.filter(pk=item.pk).update(
                time_spent=F("time_spent") + seconds,
                tracked_time=F("tracked_time") + seconds,
            )

        block = session.calendar_event
        if block is not None:
            block.end_datetime = block.start_datetime + timedelta(
                seconds=block_seconds_for(_block_tracked_seconds(block.pk))
            )
            block.save(update_fields=["end_datetime", "updated_at"])

    item.refresh_from_db(fields=["time_spent", "tracked_time"])
    _push_totals(item)
    return session


def cancel(user, item) -> bool:
    """Discard a running session without logging time. Drops its block if it was new."""
    with transaction.atomic():
        session = running_session(user, item)
        if session is None:
            return False
        block = session.calendar_event
        session.delete()
        if block is not None and not block.time_sessions.exists():
            block.delete()
    return True


def _push_totals(item) -> None:
    """Mirror the totals to Airtable (seconds — the fields are `duration`). Best effort."""
    if not item.airtable_id or item.airtable_id.startswith("local-"):
        return
    try:
        from .airtable_client import TABLE_ACTION_ITEMS, get_table

        get_table(TABLE_ACTION_ITEMS).update(item.airtable_id, {"Time Spent": item.time_spent})
    except Exception:
        logger.exception("Failed to push tracked time to Airtable for %s", item.airtable_id)


def serialize(session: ActionItemTimeSession | None) -> dict | None:
    if session is None:
        return None
    return {
        "id": session.id,
        "action_item": session.action_item.airtable_id,
        "task": session.action_item.task,
        "account_name": session.action_item.account.name if session.action_item.account else None,
        "started_at": session.started_at.isoformat(),
        "ended_at": session.ended_at.isoformat() if session.ended_at else None,
        "seconds": session.seconds,
        "calendar_event": session.calendar_event_id,
    }
