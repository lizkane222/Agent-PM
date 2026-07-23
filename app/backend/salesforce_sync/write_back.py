"""
Write-back operations to Salesforce.
All functions get a client via get_client(user) and write directly.
"""
import logging
from datetime import date

from .client import get_client
from .models import SalesforceConfig, SalesforceTimeEntry

logger = logging.getLogger(__name__)


def log_time(
    user,
    project_sf_id: str,
    task_sf_id: str | None,
    entry_date: date,
    duration_minutes: int,
    description: str,
) -> SalesforceTimeEntry:
    """
    Create a Cloud Coach Time Entry record in Salesforce and store locally.
    """
    from .models import SalesforceProject, SalesforceTask

    project = SalesforceProject.objects.filter(sf_id=project_sf_id).first()
    task = SalesforceTask.objects.filter(sf_id=task_sf_id).first() if task_sf_id else None

    entry = SalesforceTimeEntry.objects.create(
        user=user,
        project=project,
        task=task,
        date=entry_date,
        duration_minutes=duration_minutes,
        description=description,
        synced_to_sf=False,
    )

    try:
        config = SalesforceConfig.objects.get(user=user)
        ns = config.namespace
        sf = get_client(user)

        payload = {
            f"{ns}__Project__c": project_sf_id,
            f"{ns}__Date__c": entry_date.isoformat(),
            f"{ns}__Duration_Minutes__c": duration_minutes,
            f"{ns}__Description__c": description,
        }
        if task_sf_id:
            payload[f"{ns}__Task__c"] = task_sf_id
        if config.sf_user_id:
            payload[f"{ns}__User__c"] = config.sf_user_id

        result = sf.restful(
            f"sobjects/{ns}__Time_Entry__c",
            method="POST",
            json=payload,
        )
        entry.sf_id = result.get("id", "")
        entry.synced_to_sf = True
        entry.save(update_fields=["sf_id", "synced_to_sf"])
        logger.info("Time entry created in SF: %s", entry.sf_id)

    except Exception as exc:
        entry.sync_error = str(exc)
        entry.save(update_fields=["sync_error"])
        logger.exception("Failed to create SF time entry for user %s", user)

    return entry


def post_chatter(user, record_id: str, body: str) -> dict:
    """
    Post a Chatter feed item on a Salesforce record (typically a Project).
    Returns the created FeedItem data.
    """
    sf = get_client(user)
    result = sf.restful(
        "chatter/feed-elements",
        method="POST",
        json={
            "feedElementType": "FeedItem",
            "subjectId": record_id,
            "body": {
                "messageSegments": [
                    {"type": "Text", "text": body}
                ]
            },
        },
    )
    logger.info("Chatter post created on %s by %s", record_id, user)
    return result


def update_task_status(user, task_sf_id: str, status: str) -> None:
    """Update a Cloud Coach Task status in Salesforce."""
    config = SalesforceConfig.objects.get(user=user)
    ns = config.namespace
    sf = get_client(user)
    sf.restful(
        f"sobjects/{ns}__Task__c/{task_sf_id}",
        method="PATCH",
        json={f"{ns}__Status__c": status},
    )
    logger.info("SF task %s status → %s", task_sf_id, status)
