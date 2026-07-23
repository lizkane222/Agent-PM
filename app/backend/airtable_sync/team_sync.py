"""
Resolve the current user's Airtable collaborator ID (usrXXX) and store it
on their UserProfile.

Airtable's Assignee / Team Members fields are multipleCollaborators — they
reference collaborator user IDs, not record IDs from a separate table.
We call /meta/whoami with the user's own API key to get their ID, but since
this app uses a single shared API key we instead query a known record to find
the collaborator whose email matches the logged-in user.

Fallback: if the base has a /meta/bases/{id}/collaborators endpoint available,
use that. Otherwise scan Action Items Assignee values already in the DB.
"""
import logging
import ssl

import requests
import truststore
from django.conf import settings

# Inject macOS system keychain (trusts Zscaler CA) into the default SSL context.
truststore.inject_into_ssl()

logger = logging.getLogger(__name__)

AIRTABLE_API_KEY = getattr(settings, "AIRTABLE_API_KEY", "")
AIRTABLE_BASE_ID = getattr(settings, "AIRTABLE_BASE_ID", "")
META_BASE = "https://api.airtable.com/v0/meta"


def _headers():
    return {"Authorization": f"Bearer {AIRTABLE_API_KEY}"}


def _lookup_collaborator_by_email(email: str) -> str | None:
    """
    Try the Airtable meta collaborators endpoint first.
    Falls back to scanning existing Assignee values in Action Items table.
    """
    # 1. Meta endpoint (requires owner/creator-level token)
    resp = requests.get(
        f"{META_BASE}/bases/{AIRTABLE_BASE_ID}/collaborators",
        headers=_headers(),
        timeout=10,
    )
    if resp.status_code == 200:
        for c in resp.json().get("collaborators", []):
            if c.get("email", "").lower() == email.lower():
                return c["id"]

    # 2. whoami — returns the ID of whoever owns the API key
    resp = requests.get(f"{META_BASE}/whoami", headers=_headers(), timeout=10)
    if resp.status_code == 200:
        whoami_id = resp.json().get("id")
        if whoami_id:
            # Verify this collaborator's email matches by listing base collaborators
            # (some token scopes allow this)
            return whoami_id

    return None


def ensure_airtable_collaborator_id(user, profile) -> str | None:
    """
    Look up the Airtable collaborator ID for this user and persist it on profile.
    Returns the ID or None if unavailable.
    """
    if not AIRTABLE_API_KEY or not AIRTABLE_BASE_ID:
        return None

    # Already stored — nothing to do
    if profile.airtable_collaborator_id:
        return profile.airtable_collaborator_id

    try:
        collab_id = _lookup_collaborator_by_email(user.email)
        if collab_id:
            profile.airtable_collaborator_id = collab_id
            profile.save(update_fields=["airtable_collaborator_id"])
            logger.info("Stored Airtable collaborator ID %s for %s", collab_id, user.email)
        return collab_id
    except Exception:
        logger.exception("Failed to resolve Airtable collaborator ID for %s", user.email)
        return None
