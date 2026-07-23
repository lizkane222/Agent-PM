from celery import shared_task
import logging
from .sync import sync_all

logger = logging.getLogger(__name__)


@shared_task(name="airtable_sync.tasks.sync_airtable")
def sync_airtable():
    result = sync_all()
    logger.info("Airtable sync complete: %s", result)
    return result
