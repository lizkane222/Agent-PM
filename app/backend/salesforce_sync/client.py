"""
Salesforce API client.

Wraps simple_salesforce for all SF API calls used by Agent PM.
Handles token refresh via the stored OAuthCredential.
"""
import logging

import requests
import truststore
from django.contrib.auth import get_user_model
from django.utils import timezone

truststore.inject_into_ssl()

logger = logging.getLogger(__name__)
User = get_user_model()

SF_TOKEN_URL = "{instance_url}/services/oauth2/token"
SF_API_VERSION = "v59.0"


def _get_credential(user):
    from integrations.models import OAuthCredential
    try:
        return OAuthCredential.objects.get(user=user, provider="salesforce", is_active=True)
    except OAuthCredential.DoesNotExist:
        raise PermissionError("Salesforce not connected for this user.")


def _refresh_token(cred):
    from django.conf import settings
    resp = requests.post(
        f"{settings.SALESFORCE_INSTANCE_URL}/services/oauth2/token",
        data={
            "grant_type": "refresh_token",
            "client_id": settings.SALESFORCE_CLIENT_ID,
            "client_secret": settings.SALESFORCE_CLIENT_SECRET,
            "refresh_token": cred.refresh_token,
        },
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    cred.access_token = data["access_token"]
    if "refresh_token" in data:
        cred.refresh_token = data["refresh_token"]
    cred.save(update_fields=["access_token", "refresh_token", "updated_at"])
    return cred


def get_client(user):
    """Return a configured simple_salesforce Salesforce instance for this user."""
    from simple_salesforce import Salesforce
    from django.conf import settings

    cred = _get_credential(user)
    instance_url = settings.SALESFORCE_INSTANCE_URL.rstrip("/")

    try:
        sf = Salesforce(
            instance_url=instance_url,
            session_id=cred.access_token,
            version=SF_API_VERSION,
        )
        # Quick connectivity test
        sf.restful("limits")
    except Exception:
        # Token likely expired — refresh and retry
        cred = _refresh_token(cred)
        sf = Salesforce(
            instance_url=instance_url,
            session_id=cred.access_token,
            version=SF_API_VERSION,
        )

    return sf


def discover_namespace(sf) -> str:
    """
    Query installed packages to find the Cloud Coach namespace.
    Falls back to 'cc4sf' if detection fails.
    """
    try:
        result = sf.query(
            "SELECT NamespacePrefix FROM PackageLicense "
            "WHERE NamespacePrefix LIKE '%cc%' OR NamespacePrefix LIKE '%cloud%' LIMIT 5"
        )
        for rec in result.get("records", []):
            ns = rec.get("NamespacePrefix", "")
            if ns:
                return ns
    except Exception:
        pass

    # Fallback: try to describe a known Cloud Coach object
    for ns in ("cc4sf", "cloudcoach", "cc"):
        try:
            sf.restful(f"sobjects/{ns}__Project__c/describe")
            return ns
        except Exception:
            continue

    return "cc4sf"
