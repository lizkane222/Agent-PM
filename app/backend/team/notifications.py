"""Write path for the per-user notification history."""

import logging

logger = logging.getLogger(__name__)


def account_for_resource(resource_type, resource_id):
    """The Django `Account` a record belongs to, or None. Never raises."""
    try:
        rid = int(resource_id)
        from accounts.models import Account

        if resource_type == "account":
            return Account.objects.filter(pk=rid).first()
        if resource_type == "account_note":
            from accounts.models import AccountNote

            n = AccountNote.objects.select_related("account").filter(pk=rid).first()
            return n.account if n else None
        if resource_type == "artifact":
            from accounts.models import AccountArtifact

            n = AccountArtifact.objects.select_related("account").filter(pk=rid).first()
            return n.account if n else None
        if resource_type == "calendar_event":
            from scheduler.models import CalendarEvent

            e = CalendarEvent.objects.select_related("account").filter(pk=rid).first()
            return e.account if e else None
        if resource_type == "action_item":
            from airtable_sync.models import AirtableActionItem

            it = AirtableActionItem.objects.select_related("account").filter(pk=rid).first()
            if it and it.account and it.account.airtable_id:
                return Account.objects.filter(airtable_id=it.account.airtable_id).first()
    except Exception:
        logger.debug("account_for_resource(%s, %s) failed", resource_type, resource_id, exc_info=True)
    return None


def account_for_user_by_name(user, name):
    """An account the user can see whose company name matches `name` exactly (any case)."""
    if not name:
        return None
    try:
        from django.db.models import Q
        from accounts.models import Account

        return (
            Account.objects.filter(company_name__iexact=name)
            .filter(Q(team_members__user=user) | Q(admin_owner=user))
            .first()
        )
    except Exception:
        return None


def record_notification(user, channel, kind, title, body="", link="", status="sent", account=None):
    """Persist one notification row. Never raises: history must not break a send."""
    if user is None:
        return None
    try:
        from .models import Notification

        return Notification.objects.create(
            user=user,
            channel=channel,
            kind=kind,
            title=(title or "")[:300],
            body=body or "",
            link=(link or "")[:500],
            status=status,
            account=account,
        )
    except Exception:
        logger.exception("Could not record %s/%s notification for user %s", kind, channel, getattr(user, "pk", "?"))
        return None
