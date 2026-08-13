"""API views for the sync review queue."""

import logging

from django.db.models import Q
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.mixins import _staff_sees_all
from core.permissions import IsAccountOwner, IsAccountSyncReviewer

from .models import SyncDeleteRequest, SyncReviewItem
from .serializers import SyncDeleteRequestSerializer, SyncReviewItemSerializer

logger = logging.getLogger(__name__)

TWILIO_DOMAINS = frozenset(["twilio.com", "segment.com", "sendgrid.com"])


def _is_staff_or_reviewer_for_account(user, account):
    if _staff_sees_all(user):
        return True
    from accounts.models import AccountRole
    return AccountRole.objects.filter(
        user=user, account=account, role__in=["sync_reviewer", "account_owner"]
    ).exists()


def _is_staff_or_owner_for_account(user, account):
    if _staff_sees_all(user):
        return True
    from accounts.models import AccountRole
    return AccountRole.objects.filter(
        user=user, account=account, role="account_owner"
    ).exists()


class SyncReviewItemViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = SyncReviewItemSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs = SyncReviewItem.objects.select_related("suggested_account", "reviewed_by")

        if not _staff_sees_all(user):
            from accounts.models import AccountRole
            reviewer_account_ids = AccountRole.objects.filter(
                user=user, role__in=["sync_reviewer", "account_owner"]
            ).values_list("account_id", flat=True)
            qs = qs.filter(
                Q(suggested_account_id__in=reviewer_account_ids)
                | Q(suggested_account__isnull=True, status="unassigned")
            )

        status_filter = self.request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)

        account_id = self.request.query_params.get("account_id")
        if account_id:
            qs = qs.filter(suggested_account_id=account_id)

        source_filter = self.request.query_params.get("source")
        if source_filter:
            qs = qs.filter(source=source_filter)

        return qs

    @action(detail=True, methods=["patch"], url_path="accept")
    def accept(self, request, pk=None):
        """Accept a review item and link it to an account."""
        item = self.get_object()
        account_id = request.data.get("account_id") or (
            item.suggested_account_id
        )
        if not account_id:
            return Response(
                {"detail": "account_id is required."}, status=status.HTTP_400_BAD_REQUEST
            )

        from accounts.models import Account
        try:
            account = Account.objects.get(pk=account_id)
        except Account.DoesNotExist:
            return Response({"detail": "Account not found."}, status=status.HTTP_404_NOT_FOUND)

        if not _is_staff_or_reviewer_for_account(request.user, account):
            return Response({"detail": "Permission denied."}, status=status.HTTP_403_FORBIDDEN)

        item.status = "accepted"
        item.suggested_account = account
        item.reviewed_by = request.user
        item.reviewed_at = timezone.now()
        item.save(update_fields=["status", "suggested_account", "reviewed_by", "reviewed_at", "updated_at"])

        _write_local_record(item, account, request.user)

        return Response(SyncReviewItemSerializer(item).data)

    @action(detail=True, methods=["patch"], url_path="reject")
    def reject(self, request, pk=None):
        item = self.get_object()
        if item.suggested_account and not _is_staff_or_reviewer_for_account(
            request.user, item.suggested_account
        ):
            return Response({"detail": "Permission denied."}, status=status.HTTP_403_FORBIDDEN)

        item.status = "rejected"
        item.reviewed_by = request.user
        item.reviewed_at = timezone.now()
        item.save(update_fields=["status", "reviewed_by", "reviewed_at", "updated_at"])
        return Response(SyncReviewItemSerializer(item).data)

    @action(detail=True, methods=["patch"], url_path="reassign")
    def reassign(self, request, pk=None):
        """Move an item to a different account suggestion (resets to pending_human)."""
        item = self.get_object()
        account_id = request.data.get("account_id")
        if not account_id:
            return Response({"detail": "account_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        from accounts.models import Account
        try:
            account = Account.objects.get(pk=account_id)
        except Account.DoesNotExist:
            return Response({"detail": "Account not found."}, status=status.HTTP_404_NOT_FOUND)

        if not _is_staff_or_reviewer_for_account(request.user, account):
            return Response({"detail": "Permission denied."}, status=status.HTTP_403_FORBIDDEN)

        item.suggested_account = account
        item.status = "pending_human"
        item.save(update_fields=["suggested_account", "status", "updated_at"])
        return Response(SyncReviewItemSerializer(item).data)

    @action(detail=True, methods=["post"], url_path="request-delete")
    def request_delete(self, request, pk=None):
        """Sync reviewer requests removal of an accepted item from its account."""
        item = self.get_object()
        if item.status != "accepted" or not item.suggested_account:
            return Response(
                {"detail": "Only accepted items with an account can be deletion-requested."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not _is_staff_or_reviewer_for_account(request.user, item.suggested_account):
            return Response({"detail": "Permission denied."}, status=status.HTTP_403_FORBIDDEN)

        delete_req = SyncDeleteRequest.objects.create(
            review_item=item,
            account=item.suggested_account,
            requested_by=request.user,
            reason=request.data.get("reason", ""),
        )
        return Response(SyncDeleteRequestSerializer(delete_req).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"], url_path="pending-count")
    def pending_count(self, request):
        """Returns pending_human count, optionally scoped to an account."""
        account_id = request.query_params.get("account_id")
        qs = self.get_queryset().filter(status="pending_human")
        if account_id:
            qs = qs.filter(suggested_account_id=account_id)
        return Response({"count": qs.count()})


class SyncDeleteRequestViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = SyncDeleteRequestSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs = SyncDeleteRequest.objects.select_related(
            "review_item", "account", "requested_by", "reviewed_by"
        )
        if not _staff_sees_all(user):
            from accounts.models import AccountRole
            owner_account_ids = AccountRole.objects.filter(
                user=user, role="account_owner"
            ).values_list("account_id", flat=True)
            qs = qs.filter(account_id__in=owner_account_ids)

        status_filter = self.request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)

        return qs

    @action(detail=True, methods=["patch"], url_path="resolve")
    def resolve(self, request, pk=None):
        """Account owner approves or rejects a delete request."""
        delete_req = self.get_object()
        if not _is_staff_or_owner_for_account(request.user, delete_req.account):
            return Response({"detail": "Permission denied."}, status=status.HTTP_403_FORBIDDEN)

        decision = request.data.get("decision")
        if decision not in ("approved", "rejected"):
            return Response(
                {"detail": "decision must be 'approved' or 'rejected'"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        delete_req.status = decision
        delete_req.reviewed_by = request.user
        delete_req.reason = request.data.get("reason", delete_req.reason)
        delete_req.resolved_at = timezone.now()
        delete_req.save(update_fields=["status", "reviewed_by", "reason", "resolved_at"])

        if decision == "approved":
            item = delete_req.review_item
            item.status = "unassigned"
            item.suggested_account = None
            item.save(update_fields=["status", "suggested_account", "updated_at"])
            from .tasks import run_mismatch_analysis
            run_mismatch_analysis.delay(delete_req.pk)

        return Response(SyncDeleteRequestSerializer(delete_req).data)


def _write_local_record(item, account, user):
    """Create or update the appropriate local record for an accepted SyncReviewItem."""
    try:
        if item.content_type in ("document", "page"):
            from accounts.models import AccountArtifact
            AccountArtifact.objects.get_or_create(
                account=account,
                url=item.source_url,
                defaults={
                    "uploaded_by": user,
                    "artifact_type": "link",
                    "name": item.raw_content.get("title", item.source_url[:200]),
                    "icon_key": item.source,
                },
            )
        elif item.content_type in ("email", "internal_email"):
            from accounts.models import AccountNote
            AccountNote.objects.get_or_create(
                account=account,
                content=item.raw_content.get("snippet", item.source_url)[:2000],
                defaults={"author": user},
            )
        elif item.content_type == "ticket":
            from scheduler.models import ActionItem
            _status_map = {
                "new": "todo", "open": "in_progress", "pending": "in_progress",
                "solved": "done", "closed": "done",
                "to do": "todo", "in progress": "in_progress", "done": "done",
            }
            raw_status = item.raw_content.get("status", "").lower()
            local_status = _status_map.get(raw_status, "todo")
            ActionItem.objects.get_or_create(
                airtable_record_id=f"{item.source}:{item.source_id}",
                defaults={
                    "account": account,
                    "created_by": user,
                    "assigned_to": user,
                    "title": item.raw_content.get("title", item.raw_content.get("summary", ""))[:500],
                    "notes": item.raw_content.get("description", ""),
                    "status": local_status,
                    "priority": item.raw_content.get("priority", "medium").lower()[:10],
                },
            )
    except Exception:
        logger.exception("Failed to write local record for SyncReviewItem %s", item.pk)
