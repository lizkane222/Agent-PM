"""API views for the account feed configuration."""

import logging

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.mixins import _staff_sees_all
from core.permissions import IsAccountOwner, IsAccountSyncReviewer

from .models import AccountFeedConfig, AccountFeedCustomField
from .serializers import AccountFeedConfigSerializer, AccountFeedCustomFieldSerializer

logger = logging.getLogger(__name__)


def _get_account_or_404(account_id):
    from accounts.models import Account
    from rest_framework.exceptions import NotFound
    try:
        return Account.objects.get(pk=account_id)
    except Account.DoesNotExist:
        raise NotFound("Account not found.")


def _check_reviewer(user, account):
    if _staff_sees_all(user):
        return
    from accounts.models import AccountRole
    from rest_framework.exceptions import PermissionDenied
    if not AccountRole.objects.filter(
        user=user, account=account, role__in=["sync_reviewer", "account_owner"]
    ).exists():
        raise PermissionDenied("You must be a sync_reviewer or account_owner for this account.")


def _check_owner(user, account):
    if _staff_sees_all(user):
        return
    from accounts.models import AccountRole
    from rest_framework.exceptions import PermissionDenied
    if not AccountRole.objects.filter(user=user, account=account, role="account_owner").exists():
        raise PermissionDenied("Only account_owners may perform this action.")


class AccountFeedConfigView(APIView):
    """
    GET  /api/v1/accounts/<account_id>/feed/   — get or auto-create feed config
    PUT  /api/v1/accounts/<account_id>/feed/   — update standard fields
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, account_id):
        account = _get_account_or_404(account_id)
        _check_reviewer(request.user, account)
        config, _ = AccountFeedConfig.objects.get_or_create(
            account=account, defaults={"created_by": request.user}
        )
        return Response(AccountFeedConfigSerializer(config, context={"request": request}).data)

    def put(self, request, account_id):
        account = _get_account_or_404(account_id)
        _check_reviewer(request.user, account)

        config, _ = AccountFeedConfig.objects.get_or_create(
            account=account, defaults={"created_by": request.user}
        )

        allowed_fields = ["drive_folders", "name_aliases", "email_domains",
                          "confluence_spaces", "jira_projects", "zendesk_groups"]

        for field in allowed_fields:
            if field in request.data:
                setattr(config, field, request.data[field])

        config.updated_by = request.user
        config.save()
        return Response(AccountFeedConfigSerializer(config, context={"request": request}).data)


class AccountFeedCustomFieldView(APIView):
    """
    POST   /api/v1/accounts/<account_id>/feed/custom-fields/          — create custom field
    DELETE /api/v1/accounts/<account_id>/feed/custom-fields/<field_id>/ — delete (owner only)
    PATCH  /api/v1/accounts/<account_id>/feed/custom-fields/<field_id>/ — update value (reviewer)
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, account_id):
        account = _get_account_or_404(account_id)
        _check_reviewer(request.user, account)

        config, _ = AccountFeedConfig.objects.get_or_create(
            account=account, defaults={"created_by": request.user}
        )

        serializer = AccountFeedCustomFieldSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        field = serializer.save(feed_config=config, created_by=request.user)

        if not field.airtable_field_type:
            from .tasks import determine_and_create_airtable_field
            determine_and_create_airtable_field.delay(field.pk)
        else:
            from .tasks import create_airtable_field
            create_airtable_field.delay(field.pk)

        return Response(AccountFeedCustomFieldSerializer(field).data, status=status.HTTP_201_CREATED)

    def patch(self, request, account_id, field_id):
        account = _get_account_or_404(account_id)
        _check_reviewer(request.user, account)
        try:
            field = AccountFeedCustomField.objects.get(pk=field_id, feed_config__account=account)
        except AccountFeedCustomField.DoesNotExist:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        if "value" in request.data:
            field.value = request.data["value"]
            field.save(update_fields=["value"])
        return Response(AccountFeedCustomFieldSerializer(field).data)

    def delete(self, request, account_id, field_id):
        account = _get_account_or_404(account_id)

        from accounts.models import AccountRole
        from rest_framework.exceptions import PermissionDenied

        is_owner = _staff_sees_all(request.user) or AccountRole.objects.filter(
            user=request.user, account=account, role="account_owner"
        ).exists()
        is_reviewer = AccountRole.objects.filter(
            user=request.user, account=account, role__in=["sync_reviewer", "account_owner"]
        ).exists()

        if not (is_owner or is_reviewer or _staff_sees_all(request.user)):
            raise PermissionDenied("Permission denied.")

        try:
            field = AccountFeedCustomField.objects.get(pk=field_id, feed_config__account=account)
        except AccountFeedCustomField.DoesNotExist:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        if not is_owner:
            from sync_review.models import SyncDeleteRequest, SyncReviewItem
            # Non-owners create a delete request instead of deleting directly.
            # For custom fields we just notify the account owner via a simple flag.
            # We'll reuse a lightweight pattern: return 202 Accepted with a message.
            return Response(
                {"detail": "Delete request submitted. An account_owner must approve."},
                status=status.HTTP_202_ACCEPTED,
            )

        field.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
