"""Keeping AgentPM's calendar current with Google, without anyone clicking Sync.

Three triggers, all converging on `sync_user_calendar`:

1. **Google push notifications** (`events().watch`). Google calls
   `/api/v1/integrations/google/calendar-webhook/` within seconds of a change. Only possible
   when `GOOGLE_WEBHOOK_BASE_URL` is a public HTTPS URL Google can reach — not a laptop
   behind the corporate proxy. Channels expire (~7 days), so `ensure_watch` renews them.
2. **A 5-minute Celery beat job** (`sync_all_google_calendars`), the safety net for dropped
   notifications and the only server-side path in development.
3. **The open calendar page** polls the sync endpoint every 5 minutes and on tab focus —
   this one works even when no Celery worker is running.

After a sync that changed anything, a `calendar.synced` activity event is published so other
open tabs/devices reload the visible week.
"""

from __future__ import annotations

import logging
import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)

WATCH_RESOURCE = "calendar_watch"
# Renew a channel this long before Google expires it.
WATCH_RENEW_MARGIN = timedelta(hours=24)


def google_credentials_for(user):
    """google.oauth2 Credentials for the user's active Google connection, or None.

    Delegates to `integrations.google_api.credentials_for`, which passes the stored expiry
    (so a stale token is refreshed before a request, not after a 401) and supports saving
    the refreshed token back.
    """
    from .google_api import credentials_for

    return credentials_for(user)


# One sync per user at a time. The 5-minute beat job, a Google push notification and the
# open calendar page's own poll can all fire together; without this they run the same
# pull concurrently and race each other's writes to the same rows.
SYNC_LOCK_SECONDS = 240


def _sync_lock_key(user) -> str:
    return f"google-calendar-sync-lock:{user.pk}"


def sync_user_calendar(user, *, source: str) -> dict | None:
    """Run the full Google sync for `user`. Returns change counts, or None if not connected."""
    from django.core.cache import cache

    from .google_api import GoogleConnectionRevoked, ensure_fresh, persist_refreshed
    from .views import _sync_google_calendar

    creds = google_credentials_for(user)
    if creds is None:
        return None
    # cache.add is atomic: only one caller acquires the lock, the rest skip cleanly. The TTL
    # bounds a crashed run so the next beat tick is never blocked for long.
    if not cache.add(_sync_lock_key(user), source, timeout=SYNC_LOCK_SECONDS):
        logger.info("Google Calendar sync for %s already running; skipping (%s)", user.pk, source)
        return {"skipped": "already_running", "changed": 0}
    try:
        try:
            ensure_fresh(user, creds)
        except GoogleConnectionRevoked:
            # The credential is now marked inactive, so the beat job stops retrying it.
            return {"skipped": "google_disconnected", "changed": 0}
        counts = _sync_google_calendar(user, creds) or {}
        persist_refreshed(user, creds)
    finally:
        cache.delete(_sync_lock_key(user))
    changed = sum(counts.get(k, 0) for k in ("created", "updated", "deleted", "unlinked"))
    if changed:
        _announce(user, changed, source)
    return {**counts, "changed": changed}


def _announce(user, changed: int, source: str) -> None:
    """Tell the user's other open tabs/devices to reload (via the activity feed)."""
    from realtime.sync import publish_activity_event

    publish_activity_event(
        user, "calendar.synced",
        "Calendar updated from Google",
        detail=f"{changed} change{'s' if changed != 1 else ''}",
        metadata={"changed": changed, "source": source},
    )


# ── Push notifications ─────────────────────────────────────────────────────────


def webhook_url() -> str:
    base = (getattr(settings, "GOOGLE_WEBHOOK_BASE_URL", "") or "").rstrip("/")
    if not base.startswith("https://"):
        return ""  # Google only delivers to HTTPS
    return f"{base}/api/v1/integrations/google/calendar-webhook/"


def ensure_watch(user) -> bool:
    """Register (or renew) a push channel for the user's primary calendar.

    State lives in `SyncState(provider="google", resource="calendar_watch")`:
    `sync_token` holds `"<channel_id>|<resource_id>|<secret token>"`, `last_synced_at`
    the channel's expiry. Returns True when a channel is active after the call.
    """
    from googleapiclient.discovery import build

    from .models import SyncState

    url = webhook_url()
    if not url:
        return False
    state, _ = SyncState.objects.get_or_create(user=user, provider="google", resource=WATCH_RESOURCE)
    if state.sync_token and state.last_synced_at and state.last_synced_at - timezone.now() > WATCH_RENEW_MARGIN:
        return True  # still comfortably valid

    creds = google_credentials_for(user)
    if creds is None:
        return False
    service = build("calendar", "v3", credentials=creds, cache_discovery=False)

    old = parse_watch_state(state.sync_token)
    channel_id, token = str(uuid.uuid4()), secrets.token_urlsafe(24)
    result = service.events().watch(calendarId="primary", body={
        "id": channel_id, "type": "web_hook", "address": url, "token": token,
    }).execute()
    expiry_ms = int(result.get("expiration") or 0)
    expiry = (
        timezone.datetime.fromtimestamp(expiry_ms / 1000, tz=timezone.utc)
        if expiry_ms else timezone.now() + timedelta(days=7)
    )
    state.sync_token = f"{channel_id}|{result.get('resourceId', '')}|{token}"
    state.last_synced_at = expiry
    state.save(update_fields=["sync_token", "last_synced_at", "updated_at"])

    if old:  # stop the channel we just replaced so Google doesn't double-notify
        try:
            service.channels().stop(body={"id": old["channel_id"], "resourceId": old["resource_id"]}).execute()
        except Exception:
            logger.info("Could not stop superseded calendar channel for %s", user)
    return True


def parse_watch_state(raw: str) -> dict | None:
    parts = (raw or "").split("|")
    if len(parts) != 3 or not all(parts):
        return None
    return {"channel_id": parts[0], "resource_id": parts[1], "token": parts[2]}


def user_for_channel(channel_id: str, token: str):
    """The user a webhook call belongs to — only if both channel id and secret token match."""
    from .models import SyncState

    if not channel_id or not token:
        return None
    for state in SyncState.objects.filter(provider="google", resource=WATCH_RESOURCE, sync_token__startswith=f"{channel_id}|"):
        parsed = parse_watch_state(state.sync_token)
        if parsed and secrets.compare_digest(parsed["token"], token):
            return state.user
    return None
