"""
Zendesk → local DB sync.

Uses the Zendesk incremental tickets export (start_time cursor) to pull
tickets changed since the last sync and map them to local ActionItems.
Run via Celery beat every 30 min or call sync_all(user) directly.
"""
import logging
from datetime import date, datetime
from difflib import SequenceMatcher

import requests
from django.utils import timezone

from integrations.models import OAuthCredential, SyncState

from .models import ZendeskConfig, ZendeskTicket

logger = logging.getLogger(__name__)

FUZZY_THRESHOLD = 0.65

_STATUS_MAP = {
    "new": "open",
    "open": "open",
    "pending": "open",
    "hold": "open",
    "solved": "done",
    "closed": "done",
}

_PRIORITY_MAP = {
    "urgent": "urgent",
    "high": "high",
    "normal": "normal",
    "low": "low",
}


def _get_credential(user):
    """Return the Zendesk credential.

    Prefers the org-level admin credential (provider='zendesk_admin') so the
    scraper can run with a single shared token instead of per-user credentials.
    Falls back to the per-user credential for backward compatibility.
    """
    try:
        return OAuthCredential.objects.get(provider="zendesk_admin", is_active=True)
    except OAuthCredential.DoesNotExist:
        pass
    return OAuthCredential.objects.get(user=user, provider="zendesk", is_active=True)


def _get_subdomain(user):
    """Return the Zendesk subdomain from settings or per-user config."""
    from django.conf import settings as _s
    if _s.ZENDESK_SUBDOMAIN:
        return _s.ZENDESK_SUBDOMAIN
    return ZendeskConfig.objects.get(user=user).subdomain


def _get_config(user):
    return ZendeskConfig.objects.get(user=user)


def _auth_headers(access_token):
    return {"Authorization": f"Bearer {access_token}", "Accept": "application/json"}


def _map_status(zendesk_status: str) -> str:
    return _STATUS_MAP.get((zendesk_status or "").lower(), "open")


def _map_priority(zendesk_priority: str) -> str:
    return _PRIORITY_MAP.get((zendesk_priority or "").lower(), "normal")


def _parse_dt(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


def _match_account_by_name(name: str):
    from accounts.models import Account
    name_lower = name.lower()
    for acc in Account.objects.all():
        ratio = SequenceMatcher(None, acc.company_name.lower(), name_lower).ratio()
        if ratio >= FUZZY_THRESHOLD:
            return acc
        if acc.company_name.lower() in name_lower:
            return acc
    return None


def _fetch_tickets(subdomain, access_token, start_time=0):
    """
    Fetch tickets via Zendesk incremental export.
    start_time is a Unix timestamp (0 = all tickets).
    Returns (tickets list, next end_time).
    """
    url = f"https://{subdomain}.zendesk.com/api/v2/incremental/tickets.json"
    params = {"start_time": start_time}
    headers = _auth_headers(access_token)
    tickets = []
    end_time = start_time

    try:
        resp = requests.get(url, params=params, headers=headers, timeout=30)
    except requests.RequestException as exc:
        logger.error("Zendesk API request failed: %s", exc)
        return tickets, end_time

    if not resp.ok:
        logger.error("Zendesk API error %s: %s", resp.status_code, resp.text[:200])
        return tickets, end_time

    data = resp.json()
    tickets = data.get("tickets", [])
    end_time = data.get("end_time", start_time)
    return tickets, end_time


def sync_tickets(user) -> int:
    cred = _get_credential(user)

    sync_state, _ = SyncState.objects.get_or_create(
        user=user, provider="zendesk", resource="tickets",
        defaults={"sync_token": "0"},
    )
    start_time = int(sync_state.sync_token or "0")

    subdomain = _get_subdomain(user)
    tickets, end_time = _fetch_tickets(subdomain, cred.access_token, start_time)
    count = 0

    for ticket in tickets:
        zendesk_id = ticket.get("id")
        if not zendesk_id:
            continue

        subject = ticket.get("subject") or ticket.get("raw_subject") or ""
        description = (ticket.get("description") or "")[:2000]
        zendesk_status = ticket.get("status", "")
        zendesk_priority = ticket.get("priority") or ""
        requester_id = ticket.get("requester_id")
        assignee_id = ticket.get("assignee_id")
        created_at = _parse_dt(ticket.get("created_at"))
        updated_at = _parse_dt(ticket.get("updated_at"))
        url = f"https://{subdomain}.zendesk.com/agent/tickets/{zendesk_id}"

        # Skip deleted tickets
        if ticket.get("status") == "deleted":
            continue

        mirror, created = ZendeskTicket.objects.update_or_create(
            zendesk_id=zendesk_id,
            defaults={
                "subdomain": subdomain,
                "subject": subject[:512],
                "description": description,
                "zendesk_status": zendesk_status,
                "zendesk_priority": zendesk_priority,
                "assignee_id": assignee_id,
                "ticket_created_at": created_at,
                "ticket_updated_at": updated_at,
                "url": url,
            },
        )

        from sync_review.models import SyncReviewItem
        SyncReviewItem.objects.update_or_create(
            source="zendesk",
            source_id=str(zendesk_id),
            defaults={
                "source_url": url,
                "content_type": "ticket",
                "raw_content": {
                    "title": subject,
                    "summary": subject,
                    "description": description,
                    "status": zendesk_status,
                    "priority": zendesk_priority,
                    "requester_id": str(requester_id) if requester_id else None,
                    "url": url,
                },
                "status": "pending_agent",
            },
        )

        count += 1

    if end_time and end_time != start_time:
        sync_state.sync_token = str(end_time)
        sync_state.last_synced_at = timezone.now()
        sync_state.save()

    try:
        config = _get_config(user)
        config.last_synced = timezone.now()
        config.save(update_fields=["last_synced"])
    except ZendeskConfig.DoesNotExist:
        pass  # admin-credential flow: no per-user config record

    if count:
        from sync_review.tasks import run_agent_review
        run_agent_review.delay()

    logger.info("zendesk sync_tickets: %d records for user %s", count, user.email)
    return count


def sync_all(user) -> dict:
    tickets = sync_tickets(user)
    return {"tickets": tickets}
