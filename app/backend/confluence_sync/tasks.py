import logging
from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(name="confluence_sync.tasks.sync_confluence_for_user")
def sync_confluence_for_user(user_id: int):
    from django.contrib.auth import get_user_model
    from .sync import sync_all

    User = get_user_model()
    try:
        user = User.objects.get(pk=user_id)
        result = sync_all(user)
        logger.info("Confluence sync complete for user %s: %s", user.email, result)
        return result
    except Exception:
        logger.exception("Confluence sync failed for user_id=%s", user_id)


@shared_task(name="confluence_sync.tasks.sync_confluence_all_users")
def sync_confluence_all_users():
    """Sync Confluence for every user who has an active Confluence credential."""
    from integrations.models import OAuthCredential

    user_ids = OAuthCredential.objects.filter(
        provider="confluence", is_active=True
    ).values_list("user_id", flat=True)

    for uid in user_ids:
        sync_confluence_for_user.delay(uid)
