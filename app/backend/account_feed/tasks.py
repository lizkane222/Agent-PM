"""
Celery tasks for account_feed.

create_airtable_field            — creates a field in Airtable with the user-specified type.
determine_and_create_airtable_field — asks Claude to determine the best Airtable field type,
                                      then creates the field.
"""

import json
import logging

from celery import shared_task
from django.conf import settings

logger = logging.getLogger(__name__)

AIRTABLE_META_BASE = "https://api.airtable.com/v0/meta/bases"


def _airtable_meta_token():
    token = getattr(settings, "AIRTABLE_METADATA_TOKEN", "") or getattr(settings, "AIRTABLE_API_KEY", "")
    if not token:
        raise RuntimeError("AIRTABLE_METADATA_TOKEN is not configured.")
    return token


def _airtable_base_id():
    base_id = getattr(settings, "AIRTABLE_BASE_ID", "")
    if not base_id:
        raise RuntimeError("AIRTABLE_BASE_ID is not configured.")
    return base_id


def _create_field_in_airtable(field_name: str, field_type: str, table_id: str) -> str:
    """Create a field in Airtable and return the new field ID."""
    import requests
    url = f"{AIRTABLE_META_BASE}/{_airtable_base_id()}/tables/{table_id}/fields"
    headers = {
        "Authorization": f"Bearer {_airtable_meta_token()}",
        "Content-Type": "application/json",
    }
    payload = {"name": field_name, "type": field_type}
    resp = requests.post(url, json=payload, headers=headers, timeout=15)
    resp.raise_for_status()
    return resp.json().get("id", "")


def _bedrock_determine_type(field_name: str, field_value: str) -> str:
    """Ask Claude on Bedrock to pick the best Airtable field type for a custom field."""
    import boto3
    session = boto3.Session(profile_name=getattr(settings, "AWS_PROFILE", None))
    client = session.client("bedrock-runtime", region_name=getattr(settings, "AWS_REGION", "us-west-2"))
    prompt = f"""You are an Airtable schema designer. Given the field name and sample value below,
pick the most appropriate Airtable field type from this list:
singleLineText, multilineText, url, number, checkbox, date, singleSelect, multipleSelects, multipleAttachments

Field name: {field_name}
Sample value: {field_value or "(none provided)"}

Respond with ONLY the field type name, nothing else."""
    body = json.dumps({
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 32,
        "messages": [{"role": "user", "content": prompt}],
    })
    response = client.invoke_model(
        modelId="anthropic.claude-sonnet-4-5",
        contentType="application/json",
        accept="application/json",
        body=body,
    )
    result = json.loads(response["body"].read())
    return result["content"][0]["text"].strip()


@shared_task(name="account_feed.tasks.create_airtable_field")
def create_airtable_field(field_id: int):
    from .models import AccountFeedCustomField
    try:
        field = AccountFeedCustomField.objects.select_related("feed_config__account").get(pk=field_id)
    except AccountFeedCustomField.DoesNotExist:
        logger.warning("create_airtable_field: field %s not found", field_id)
        return

    table_id = settings.AIRTABLE_TABLE_ACCOUNTS
    if not table_id:
        logger.warning("create_airtable_field: AIRTABLE_TABLE_ACCOUNTS not set")
        return

    try:
        airtable_field_id = _create_field_in_airtable(field.name, field.airtable_field_type, table_id)
        if airtable_field_id:
            field.airtable_field_id = airtable_field_id
            field.save(update_fields=["airtable_field_id"])
            logger.info("Created Airtable field '%s' (id=%s) for account %s",
                        field.name, airtable_field_id, field.feed_config.account.company_name)
    except Exception:
        logger.exception("create_airtable_field failed for field %s", field_id)


@shared_task(name="account_feed.tasks.determine_and_create_airtable_field")
def determine_and_create_airtable_field(field_id: int):
    from .models import AccountFeedCustomField
    try:
        field = AccountFeedCustomField.objects.select_related("feed_config__account").get(pk=field_id)
    except AccountFeedCustomField.DoesNotExist:
        logger.warning("determine_and_create_airtable_field: field %s not found", field_id)
        return

    valid_types = {
        "singleLineText", "multilineText", "url", "number",
        "checkbox", "date", "singleSelect", "multipleSelects", "multipleAttachments",
    }
    try:
        determined_type = _bedrock_determine_type(field.name, field.value)
        if determined_type not in valid_types:
            determined_type = "singleLineText"
        field.airtable_field_type = determined_type
        field.save(update_fields=["airtable_field_type"])
        logger.info("Agent determined type '%s' for field '%s'", determined_type, field.name)
    except Exception:
        logger.exception("determine_and_create_airtable_field: type determination failed for field %s", field_id)
        field.airtable_field_type = "singleLineText"
        field.save(update_fields=["airtable_field_type"])

    create_airtable_field.delay(field_id)
