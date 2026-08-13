"""
Celery tasks for the integrations app.

register_gmail_watch       — calls Gmail users.watch() and stores historyId + expiry.
renew_gmail_watches        — beat task: renews expiring watches every 6 days.
sync_gmail_history_for_user — fetches Gmail history since stored historyId, creates SyncReviewItems.
pull_gmail_pubsub_messages — pulls Pub/Sub messages manually (fallback for dev / no public URL).
"""

import json
import logging

from celery import shared_task
from django.conf import settings

logger = logging.getLogger(__name__)

TWILIO_DOMAINS = frozenset(["twilio.com", "segment.com", "sendgrid.com"])


def _is_internal_only(addresses: list[str]) -> bool:
    """Return True if every address belongs to a Twilio/Segment/SendGrid domain."""
    for addr in addresses:
        domain = addr.split("@")[-1].lower() if "@" in addr else addr.lower()
        if domain not in TWILIO_DOMAINS:
            return False
    return bool(addresses)


def _google_creds_for_user(user):
    """Build google.oauth2.credentials.Credentials from the user's Gmail OAuthCredential."""
    from google.oauth2.credentials import Credentials
    from integrations.models import OAuthCredential

    cred = OAuthCredential.objects.get(user=user, provider="gmail", is_active=True)
    return Credentials(
        token=cred.access_token,
        refresh_token=cred.refresh_token or None,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
    )


@shared_task(name="integrations.tasks.register_gmail_watch")
def register_gmail_watch(user_id: int):
    """Register (or renew) a Gmail push-notification watch() for a user."""
    from datetime import datetime, timezone as dt_tz

    from django.contrib.auth import get_user_model
    from googleapiclient.discovery import build as g_build

    from integrations.models import GmailWatchState

    User = get_user_model()
    try:
        user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        logger.warning("register_gmail_watch: user %s not found", user_id)
        return

    topic = getattr(settings, "GMAIL_PUBSUB_TOPIC", "")
    if not topic:
        logger.warning("register_gmail_watch: GMAIL_PUBSUB_TOPIC not set — skipping")
        return

    try:
        google_creds = _google_creds_for_user(user)
        gmail = g_build("gmail", "v1", credentials=google_creds, cache_discovery=False)
        result = gmail.users().watch(
            userId="me",
            body={"topicName": topic, "labelIds": ["INBOX"]},
        ).execute()

        history_id = str(result.get("historyId", ""))
        expiration_ms = int(result.get("expiration", 0))
        expiration = datetime.fromtimestamp(expiration_ms / 1000, tz=dt_tz.utc) if expiration_ms else None

        GmailWatchState.objects.update_or_create(
            user=user,
            defaults={
                "history_id": history_id,
                "expiration": expiration,
                "pub_sub_topic": topic,
            },
        )
        logger.info("Gmail watch registered for %s (expires %s)", user.email, expiration)
    except Exception:
        logger.exception("register_gmail_watch failed for user %s", user_id)


@shared_task(name="integrations.tasks.renew_gmail_watches")
def renew_gmail_watches():
    """Renew Gmail watches expiring within the next 24 hours. Run every 6 days."""
    from datetime import timedelta

    from django.utils import timezone

    from integrations.models import GmailWatchState

    threshold = timezone.now() + timedelta(hours=24)
    expiring = GmailWatchState.objects.filter(expiration__lte=threshold).select_related("user")
    for watch in expiring:
        register_gmail_watch.delay(watch.user_id)
    logger.info("renew_gmail_watches: queued %d renewals", expiring.count())


@shared_task(name="integrations.tasks.sync_gmail_history_for_user")
def sync_gmail_history_for_user(user_id: int, new_history_id: str = ""):
    """
    Fetch Gmail history since the stored historyId, create SyncReviewItems,
    then update the stored historyId.
    """
    from django.contrib.auth import get_user_model
    from googleapiclient.discovery import build as g_build

    from integrations.models import GmailWatchState
    from sync_review.models import SyncReviewItem

    User = get_user_model()
    try:
        user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        return

    try:
        watch_state = GmailWatchState.objects.get(user=user)
    except GmailWatchState.DoesNotExist:
        logger.warning("sync_gmail_history_for_user: no watch state for user %s", user_id)
        return

    start_history_id = watch_state.history_id
    if not start_history_id:
        logger.info("sync_gmail_history_for_user: no stored historyId for %s — skipping", user.email)
        return

    try:
        google_creds = _google_creds_for_user(user)
        gmail = g_build("gmail", "v1", credentials=google_creds, cache_discovery=False)

        history_items = []
        page_token = None
        while True:
            kwargs = {"userId": "me", "startHistoryId": start_history_id, "historyTypes": ["messageAdded"]}
            if page_token:
                kwargs["pageToken"] = page_token
            resp = gmail.users().history().list(**kwargs).execute()
            history_items.extend(resp.get("history", []))
            page_token = resp.get("nextPageToken")
            if not page_token:
                break

    except Exception:
        logger.exception("sync_gmail_history_for_user: history fetch failed for %s", user.email)
        return

    created = 0
    for history_entry in history_items:
        for msg_added in history_entry.get("messagesAdded", []):
            msg = msg_added.get("message", {})
            thread_id = msg.get("threadId", "")
            msg_id = msg.get("id", "")
            if not thread_id:
                continue

            try:
                thread = gmail.users().threads().get(userId="me", id=thread_id, format="metadata").execute()
                messages = thread.get("messages", [])
                if not messages:
                    continue

                headers_map = {}
                all_addresses = []
                for m in messages:
                    for h in m.get("payload", {}).get("headers", []):
                        name = h.get("name", "").lower()
                        if name in ("from", "to", "cc"):
                            headers_map.setdefault(name, []).append(h.get("value", ""))
                            all_addresses.append(h.get("value", ""))

                subject = next(
                    (h.get("value") for m in messages
                     for h in m.get("payload", {}).get("headers", [])
                     if h.get("name", "").lower() == "subject"),
                    "(no subject)"
                )

                is_internal = _is_internal_only(all_addresses)
                content_type = "internal_email" if is_internal else "email"

                SyncReviewItem.objects.update_or_create(
                    source="gmail",
                    source_id=thread_id,
                    defaults={
                        "source_url": f"https://mail.google.com/mail/u/0/#inbox/{thread_id}",
                        "content_type": content_type,
                        "is_sensitive": is_internal,
                        "raw_content": {
                            "subject": subject,
                            "thread_id": thread_id,
                            "addresses": all_addresses,
                            "snippet": (messages[-1].get("snippet", "") if messages else ""),
                        },
                        "status": "pending_agent" if not is_internal else "pending_human",
                    },
                )
                created += 1
            except Exception:
                logger.exception("sync_gmail_history_for_user: failed to process thread %s", thread_id)

    if new_history_id:
        watch_state.history_id = new_history_id
        watch_state.save(update_fields=["history_id", "updated_at"])

    if created:
        from sync_review.tasks import run_agent_review
        run_agent_review.delay()

    logger.info("sync_gmail_history_for_user: created/updated %d SyncReviewItems for %s", created, user.email)


@shared_task(name="integrations.tasks.pull_gmail_pubsub_messages")
def pull_gmail_pubsub_messages():
    """
    Pull pending Pub/Sub messages from the subscription.
    Used in development when push delivery is not available.
    Requires GCP_PROJECT_ID and GCP_SERVICE_ACCOUNT_JSON env vars.
    """
    import base64
    import json as _json

    gcp_project = getattr(settings, "GCP_PROJECT_ID", "")
    service_account_json = getattr(settings, "GCP_SERVICE_ACCOUNT_JSON", "")
    subscription_id = getattr(settings, "GMAIL_PUBSUB_SUBSCRIPTION", "gmail-push-sub")

    if not gcp_project or not service_account_json:
        logger.info("pull_gmail_pubsub_messages: GCP not configured — skipping")
        return

    try:
        from google.cloud import pubsub_v1
        from google.oauth2 import service_account

        sa_info = _json.loads(service_account_json)
        credentials = service_account.Credentials.from_service_account_info(
            sa_info, scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        subscriber = pubsub_v1.SubscriberClient(credentials=credentials)
        subscription_path = subscriber.subscription_path(gcp_project, subscription_id)

        response = subscriber.pull(
            request={"subscription": subscription_path, "max_messages": 100}
        )
        ack_ids = []
        for received_message in response.received_messages:
            ack_ids.append(received_message.ack_id)
            try:
                raw = received_message.message.data
                payload = _json.loads(base64.b64decode(raw).decode("utf-8"))
                email_address = payload.get("emailAddress", "")
                history_id = str(payload.get("historyId", ""))
                if email_address and history_id:
                    from django.contrib.auth import get_user_model
                    User = get_user_model()
                    user = User.objects.filter(email=email_address).first()
                    if user:
                        sync_gmail_history_for_user.delay(user.pk, history_id)
            except Exception:
                logger.exception("pull_gmail_pubsub_messages: failed to process message")

        if ack_ids:
            subscriber.acknowledge(request={"subscription": subscription_path, "ack_ids": ack_ids})
            logger.info("pull_gmail_pubsub_messages: acknowledged %d messages", len(ack_ids))
    except Exception:
        logger.exception("pull_gmail_pubsub_messages: pull failed")
