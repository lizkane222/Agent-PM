"""
Confluence → local DB sync.

Fetches pages changed since the last sync, maps them to AccountNote +
AccountArtifact, and links them to matching local Accounts where possible.
Run via Celery beat every 30 min or call sync_all(user) directly.
"""
import base64
import logging
from difflib import SequenceMatcher

import requests
from django.utils import timezone

from integrations.models import OAuthCredential, SyncState

from .models import ConfluenceConfig, ConfluencePage

logger = logging.getLogger(__name__)

ATLASSIAN_API = "https://api.atlassian.com"
FUZZY_THRESHOLD = 0.65


def _get_credential(user):
    return OAuthCredential.objects.get(user=user, provider="confluence", is_active=True)


def _get_config(user):
    return ConfluenceConfig.objects.get(user=user)


def _auth_headers(access_token, atlassian_email=None):
    if atlassian_email:
        encoded = base64.b64encode(f"{atlassian_email}:{access_token}".encode()).decode()
        return {"Authorization": f"Basic {encoded}", "Accept": "application/json"}
    return {"Authorization": f"Bearer {access_token}", "Accept": "application/json"}


def _match_account_by_name(name):
    """Fuzzy-match a local Account by company name."""
    from accounts.models import Account
    name_lower = name.lower()
    for acc in Account.objects.all():
        ratio = SequenceMatcher(None, acc.company_name.lower(), name_lower).ratio()
        if ratio >= FUZZY_THRESHOLD:
            return acc
        if acc.company_name.lower() in name_lower:
            return acc
    return None


def _parse_dt(value):
    if not value:
        return None
    try:
        from datetime import datetime
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


def _fetch_pages(cloud_id, access_token, atlassian_email=None, since_iso=None):
    """Return a list of Confluence page records changed after since_iso.

    Uses Basic auth against the direct Confluence URL when atlassian_email is set
    (API token mode), otherwise falls back to Bearer token via the Atlassian API.
    """
    if atlassian_email:
        base = f"https://{cloud_id}.atlassian.net/wiki/rest/api/content/search"
    else:
        base = f"{ATLASSIAN_API}/ex/confluence/{cloud_id}/wiki/rest/api/content/search"
    cql = "type=page AND status=current"
    if since_iso:
        date_part = since_iso[:10]
        cql += f' AND lastModified >= "{date_part}"'
    cql += " ORDER BY lastModified DESC"

    params = {"cql": cql, "expand": "space,history.lastUpdated", "limit": 50, "start": 0}
    headers = _auth_headers(access_token, atlassian_email)
    results = []

    while True:
        try:
            resp = requests.get(base, params=params, headers=headers, timeout=15)
        except requests.RequestException as exc:
            logger.error("Confluence API request failed: %s", exc)
            break
        if not resp.ok:
            logger.error("Confluence API error %s: %s", resp.status_code, resp.text[:200])
            break
        data = resp.json()
        results.extend(data.get("results", []))
        if data.get("_links", {}).get("next"):
            params["start"] += params["limit"]
        else:
            break

    return results


def sync_pages(user) -> int:
    cred = _get_credential(user)
    config = _get_config(user)

    sync_state, _ = SyncState.objects.get_or_create(
        user=user, provider="confluence", resource="pages",
        defaults={"sync_token": ""},
    )
    since_iso = sync_state.sync_token or None

    pages = _fetch_pages(config.cloud_id, cred.access_token, config.atlassian_email or None, since_iso)
    count = 0
    latest_modified = since_iso

    for page in pages:
        page_id = page.get("id", "")
        title = page.get("title", "")
        space = page.get("space", {})
        space_key = space.get("key", "")
        space_name = space.get("name", "")
        history = page.get("history", {})
        last_updated_str = (history.get("lastUpdated") or {}).get("when", "")
        webui_link = (page.get("_links") or {}).get("webui", "")
        url = (
            f"https://{config.cloud_name}.atlassian.net/wiki{webui_link}"
            if webui_link
            else ""
        )

        if last_updated_str and (not latest_modified or last_updated_str > latest_modified):
            latest_modified = last_updated_str

        mirror, _ = ConfluencePage.objects.update_or_create(
            page_id=page_id,
            defaults={
                "cloud_id": config.cloud_id,
                "title": title,
                "space_key": space_key,
                "space_name": space_name,
                "url": url,
                "last_modified": _parse_dt(last_updated_str),
            },
        )

        from sync_review.models import SyncReviewItem
        SyncReviewItem.objects.update_or_create(
            source="confluence",
            source_id=page_id,
            defaults={
                "source_url": url,
                "content_type": "page",
                "raw_content": {
                    "title": title,
                    "space_key": space_key,
                    "space_name": space_name,
                    "last_modified": last_updated_str,
                    "url": url,
                },
                "status": "pending_agent",
            },
        )

        count += 1

    if latest_modified:
        sync_state.sync_token = latest_modified
        sync_state.last_synced_at = timezone.now()
        sync_state.save()

    config.last_synced = timezone.now()
    config.save(update_fields=["last_synced"])

    if count:
        from sync_review.tasks import run_agent_review
        run_agent_review.delay()

    logger.info("confluence sync_pages: %d records for user %s", count, user.email)
    return count


def sync_all(user) -> dict:
    pages = sync_pages(user)
    return {"pages": pages}
