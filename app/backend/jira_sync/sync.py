"""
JIRA → local DB sync.

Fetches issues updated since the last sync using JQL, maps them to
local ActionItems, and links them to matching Accounts where possible.
Run via Celery beat every 30 min or call sync_all(user) directly.
"""
import logging
from datetime import date, datetime
from difflib import SequenceMatcher

import requests
from django.utils import timezone

from integrations.models import OAuthCredential, SyncState

from .models import JiraConfig, JiraTicket

logger = logging.getLogger(__name__)

ATLASSIAN_API = "https://api.atlassian.com"
FUZZY_THRESHOLD = 0.65

_PRIORITY_MAP = {
    "highest": "urgent",
    "high": "high",
    "medium": "normal",
    "low": "low",
    "lowest": "low",
}

_STATUS_MAP = {
    "to do": "open",
    "open": "open",
    "backlog": "open",
    "selected for development": "open",
    "in progress": "in_progress",
    "in review": "in_progress",
    "done": "done",
    "closed": "done",
    "resolved": "done",
}


def _get_credential(user):
    return OAuthCredential.objects.get(user=user, provider="jira", is_active=True)


def _get_config(user):
    return JiraConfig.objects.get(user=user)


def _auth_headers(access_token):
    return {"Authorization": f"Bearer {access_token}", "Accept": "application/json"}


def _map_priority(jira_priority: str) -> str:
    return _PRIORITY_MAP.get(jira_priority.lower(), "normal")


def _map_status(jira_status: str) -> str:
    return _STATUS_MAP.get(jira_status.lower(), "open")


def _parse_date(value) -> date | None:
    if not value:
        return None
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
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


def _description_text(fields: dict) -> str:
    """Extract plain text from JIRA description (Atlassian Document Format or string)."""
    desc = fields.get("description")
    if not desc:
        return ""
    if isinstance(desc, str):
        return desc[:2000]
    # Atlassian Document Format — walk content nodes
    try:
        parts = []
        for block in desc.get("content", []):
            for inline in block.get("content", []):
                if inline.get("type") == "text":
                    parts.append(inline.get("text", ""))
        return " ".join(parts)[:2000]
    except Exception:
        return ""


def _fetch_issues(cloud_id, access_token, since_iso=None):
    """Return a list of JIRA issue dicts updated after since_iso."""
    url = f"{ATLASSIAN_API}/ex/jira/{cloud_id}/rest/api/3/search"
    jql = "ORDER BY updated ASC"
    if since_iso:
        date_part = since_iso[:10]
        jql = f'updated >= "{date_part}" ORDER BY updated ASC'

    params = {
        "jql": jql,
        "fields": "summary,description,status,priority,assignee,duedate,issuetype,updated",
        "maxResults": 100,
        "startAt": 0,
    }
    headers = _auth_headers(access_token)
    results = []

    while True:
        try:
            resp = requests.get(url, params=params, headers=headers, timeout=15)
        except requests.RequestException as exc:
            logger.error("JIRA API request failed: %s", exc)
            break
        if not resp.ok:
            logger.error("JIRA API error %s: %s", resp.status_code, resp.text[:200])
            break
        data = resp.json()
        issues = data.get("issues", [])
        results.extend(issues)
        total = data.get("total", 0)
        if params["startAt"] + len(issues) >= total or not issues:
            break
        params["startAt"] += len(issues)

    return results


def sync_issues(user) -> int:
    cred = _get_credential(user)
    config = _get_config(user)

    sync_state, _ = SyncState.objects.get_or_create(
        user=user, provider="jira", resource="issues",
        defaults={"sync_token": ""},
    )
    since_iso = sync_state.sync_token or None

    issues = _fetch_issues(config.cloud_id, cred.access_token, since_iso)
    count = 0
    latest_updated = since_iso

    for issue in issues:
        jira_key = issue.get("key", "")
        issue_id = issue.get("id", "")
        fields = issue.get("fields", {})

        summary = fields.get("summary", "")
        description = _description_text(fields)
        issue_type = (fields.get("issuetype") or {}).get("name", "")
        jira_status = (fields.get("status") or {}).get("name", "")
        jira_priority = (fields.get("priority") or {}).get("name", "")
        assignee = fields.get("assignee") or {}
        assignee_email = assignee.get("emailAddress", "")
        due_date = _parse_date(fields.get("duedate"))
        updated_str = fields.get("updated", "")

        if updated_str and (not latest_updated or updated_str > latest_updated):
            latest_updated = updated_str

        base_url = f"https://{config.cloud_name}.atlassian.net" if config.cloud_name else ""
        url = f"{base_url}/browse/{jira_key}" if jira_key else ""

        mirror, created = JiraTicket.objects.update_or_create(
            jira_key=jira_key,
            defaults={
                "cloud_id": config.cloud_id,
                "issue_id": issue_id,
                "summary": summary,
                "description": description,
                "issue_type": issue_type,
                "jira_status": jira_status,
                "jira_priority": jira_priority,
                "assignee_email": assignee_email,
                "due_date": due_date,
                "url": url,
            },
        )

        from sync_review.models import SyncReviewItem
        SyncReviewItem.objects.update_or_create(
            source="jira",
            source_id=jira_key,
            defaults={
                "source_url": url,
                "content_type": "ticket",
                "raw_content": {
                    "title": summary,
                    "summary": summary,
                    "description": description,
                    "status": jira_status,
                    "priority": jira_priority,
                    "assignee_email": assignee_email,
                    "issue_type": issue_type,
                    "due_date": str(due_date) if due_date else None,
                    "url": url,
                },
                "status": "pending_agent",
            },
        )

        count += 1

    if latest_updated:
        sync_state.sync_token = latest_updated
        sync_state.last_synced_at = timezone.now()
        sync_state.save()

    config.last_synced = timezone.now()
    config.save(update_fields=["last_synced"])

    if count:
        from sync_review.tasks import run_agent_review
        run_agent_review.delay()

    logger.info("jira sync_issues: %d records for user %s", count, user.email)
    return count


def sync_all(user) -> dict:
    issues = sync_issues(user)
    return {"issues": issues}
