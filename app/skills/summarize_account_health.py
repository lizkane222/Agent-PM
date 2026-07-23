"""
Skill: summarize_account_health

Fetches all synced data for a named account — Airtable action items,
Airtable meetings, and Salesforce tasks — and returns a structured health
summary Claude can use to answer questions like:

  "How is Acme Corp doing?"
  "What's open for Stripe?"
  "Give me a quick brief on TechCorp before my next call."

Input
-----
account_name : str
    The account's name exactly as it appears in the app
    (case-insensitive prefix match is attempted as a fallback).

Output
------
{
  "account": { "id": ..., "name": "...", "status": "...", "arr": "...", "health_score": "..." },
  "open_action_items": [ { "task": "...", "priority": "...", "due_date": "..." }, ... ],
  "recent_meetings": [ { "name": "...", "date": "...", "duration_min": ... }, ... ],
  "open_sf_tasks": [ { "subject": "...", "priority": "...", "due_date": "..." }, ... ],
  "summary": {
    "total_open_action_items": int,
    "overdue_action_items": int,
    "total_open_sf_tasks": int,
    "last_meeting_date": "..." | null,
    "health_score": "..." | null
  }
}
"""

import asyncio
import logging
from datetime import date

logger = logging.getLogger(__name__)


async def summarize_account_health(account_name: str) -> dict:
    """Return a structured health summary for a named account covering open action items, recent meetings, and Salesforce tasks."""

    if not account_name or not account_name.strip():
        return {"error": "account_name is required."}

    loop = asyncio.get_event_loop()

    def _fetch() -> dict:
        # All DB access runs in a thread via run_in_executor so we never block
        # the async event loop.
        from airtable_sync.models import AirtableAccount, AirtableActionItem, AirtableMeeting
        from salesforce_sync.models import SalesforceTask
        from django.utils import timezone

        name = account_name.strip()

        # ── Resolve account (exact then prefix) ───────────────────────────────
        acct = AirtableAccount.objects.filter(name__iexact=name).first()
        if acct is None:
            acct = AirtableAccount.objects.filter(name__istartswith=name).first()
        if acct is None:
            return {"error": f"No account found matching '{name}'."}

        # ── Open action items ─────────────────────────────────────────────────
        open_items_qs = AirtableActionItem.objects.filter(
            account=acct,
            status__in=["Open", "In Progress", "Blocked"],
        ).order_by("due_date")

        today = date.today()
        open_items = []
        overdue = 0
        for item in open_items_qs[:20]:
            is_overdue = bool(item.due_date and item.due_date < today)
            if is_overdue:
                overdue += 1
            open_items.append({
                "task": item.task,
                "priority": item.priority,
                "status": item.status,
                "due_date": item.due_date.isoformat() if item.due_date else None,
                "overdue": is_overdue,
            })

        # ── Recent meetings (last 5) ──────────────────────────────────────────
        meetings_qs = AirtableMeeting.objects.filter(
            account=acct,
        ).order_by("-date")[:5]

        meetings = []
        last_meeting_date = None
        for mtg in meetings_qs:
            d = mtg.date.isoformat() if mtg.date else None
            if d and last_meeting_date is None:
                last_meeting_date = d
            meetings.append({
                "name": mtg.name,
                "date": d,
                "duration_min": round(mtg.duration / 60) if mtg.duration else None,
            })

        # ── Open Salesforce tasks ─────────────────────────────────────────────
        # SalesforceTask links to accounts via account_name (string) or FK.
        sf_tasks_qs = SalesforceTask.objects.filter(
            account_name__iexact=acct.name,
        ).exclude(status__in=["Completed", "Cancelled"]).order_by("due_date")[:10]

        sf_tasks = []
        for t in sf_tasks_qs:
            sf_tasks.append({
                "subject": t.subject,
                "priority": t.priority,
                "status": t.status,
                "due_date": t.due_date.isoformat() if t.due_date else None,
                "assigned_to": t.assigned_to_name,
            })

        return {
            "account": {
                "id": acct.id,
                "airtable_id": acct.airtable_id,
                "name": acct.name,
                "health_score": acct.health_score or None,
                "next_meeting": acct.next_meeting.isoformat() if acct.next_meeting else None,
                "open_ticket_count": acct.open_ticket_count,
                "time_budget_hours": round(acct.time_budget / 3600, 1) if acct.time_budget else None,
            },
            "open_action_items": open_items,
            "recent_meetings": meetings,
            "open_sf_tasks": sf_tasks,
            "summary": {
                "total_open_action_items": len(open_items),
                "overdue_action_items": overdue,
                "total_open_sf_tasks": len(sf_tasks),
                "last_meeting_date": last_meeting_date,
                "health_score": acct.health_score or None,
            },
        }

    try:
        result = await loop.run_in_executor(None, _fetch)
        logger.info("summarize_account_health: account=%s", account_name)
        return result
    except Exception as exc:
        logger.exception("summarize_account_health failed: %s", exc)
        return {"error": str(exc)}
