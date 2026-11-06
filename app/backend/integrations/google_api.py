"""
One retry policy and one credentials path for every Google API call.

Before this there were three hand-rolled 429 loops (`_push_event_to_google`, the sync's
`events().list`, `GoogleActionItemsPushView`) with different attempt counts and caps, none
of which retried Google's *other* rate-limit signal — a 403 with reason
``rateLimitExceeded`` / ``userRateLimitExceeded`` — or a 5xx, and none with jitter. Several
calls in `scheduler/views.py` had no retry at all.

`googleapiclient` already implements the right policy in `HttpRequest.execute(num_retries=)`:
it retries 429, every 5xx, the two rate-limit 403s, and transient socket errors, with
jittered exponential backoff (``random() * 2**n`` seconds). So that is used everywhere,
through `execute_with_retry`, rather than reimplemented a fourth time.

`credentials_for(user)` is the other half: it passes the stored expiry so google-auth
refreshes *before* a request instead of after a 401, persists the refreshed access token
(previously every call re-refreshed from a stale token), and marks the connection inactive
on ``invalid_grant`` so a revoked grant stops being retried every five minutes forever.
"""

from __future__ import annotations

import logging
from datetime import timezone as dt_timezone

from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)

# Up to 5 retries ≈ 2+4+8+16+32 s worst case before giving up — enough for a quota blip,
# short enough that one stuck user cannot hold the 5-minute beat job.
DEFAULT_RETRIES = 5


class GoogleConnectionRevoked(Exception):
    """The user's Google grant is gone (revoked, expired refresh token). They must reconnect."""


def execute_with_retry(request, *, label: str = "google request", num_retries: int = DEFAULT_RETRIES):
    """Execute a googleapiclient request with Google's own retry policy."""
    try:
        return request.execute(num_retries=num_retries)
    except Exception:
        logger.warning("Google API call failed after retries: %s", label)
        raise


def credentials_for(user):
    """
    google.oauth2 Credentials for the user's active Google connection, or None.

    The returned object refreshes itself when needed; `persist_refreshed(user, creds)` should
    be called after use so a refreshed token is saved rather than thrown away.
    """
    from google.oauth2.credentials import Credentials

    from .models import OAuthCredential

    cred = OAuthCredential.objects.filter(user=user, provider="google", is_active=True).first()
    if cred is None:
        return None
    expiry = cred.token_expiry
    if expiry is not None and timezone.is_aware(expiry):
        # google-auth compares expiry against a naive UTC now.
        expiry = expiry.astimezone(dt_timezone.utc).replace(tzinfo=None)
    creds = Credentials(
        token=cred.access_token or None,
        refresh_token=cred.refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        scopes=(cred.scopes or "").split() or None,
        expiry=expiry,
    )
    creds._agentpm_original_token = cred.access_token  # noqa: SLF001 — change detection only
    return creds


def ensure_fresh(user, creds) -> None:
    """
    Refresh now if the token is expired, persisting the result, and convert a revoked grant
    into `GoogleConnectionRevoked` (after deactivating the stored credential).
    """
    from google.auth.exceptions import RefreshError
    from google.auth.transport.requests import Request

    if creds is None or (creds.valid and not creds.expired):
        return
    try:
        creds.refresh(Request())
    except RefreshError as exc:
        if "invalid_grant" in str(exc).lower() or "revoked" in str(exc).lower():
            _deactivate(user)
            raise GoogleConnectionRevoked("Google access was revoked or expired.") from exc
        raise
    persist_refreshed(user, creds)


def persist_refreshed(user, creds) -> None:
    """Save the access token and expiry if google-auth refreshed them during use."""
    from .models import OAuthCredential

    if creds is None or not creds.token:
        return
    if creds.token == getattr(creds, "_agentpm_original_token", None):
        return
    expiry = creds.expiry
    if expiry is not None and timezone.is_naive(expiry):
        expiry = timezone.make_aware(expiry, dt_timezone.utc)
    fields = {"access_token": creds.token, "token_expiry": expiry}
    if creds.refresh_token:
        fields["refresh_token"] = creds.refresh_token
    OAuthCredential.objects.filter(user=user, provider="google").update(**fields)
    creds._agentpm_original_token = creds.token  # noqa: SLF001


def _deactivate(user) -> None:
    from .models import OAuthCredential

    updated = OAuthCredential.objects.filter(user=user, provider="google", is_active=True).update(is_active=False)
    if updated:
        logger.warning("Google connection for user %s was revoked; marked inactive", user.pk)
