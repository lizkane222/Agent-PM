import logging
from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(name="jira_sync.tasks.sync_jira_for_user")
def sync_jira_for_user(user_id: int):
    from django.contrib.auth import get_user_model
    from .sync import sync_all

    User = get_user_model()
    try:
        user = User.objects.get(pk=user_id)
        result = sync_all(user)
        logger.info("JIRA sync complete for user %s: %s", user.email, result)
        return result
    except Exception:
        logger.exception("JIRA sync failed for user_id=%s", user_id)


@shared_task(name="jira_sync.tasks.sync_jira_all_users")
def sync_jira_all_users():
    """Sync JIRA for every user who has an active JIRA credential."""
    from integrations.models import OAuthCredential

    user_ids = OAuthCredential.objects.filter(
        provider="jira", is_active=True
    ).values_list("user_id", flat=True)

    for uid in user_ids:
        sync_jira_for_user.delay(uid)
