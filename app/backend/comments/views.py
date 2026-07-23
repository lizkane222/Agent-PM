"""DRF views for the comments app."""

from rest_framework import permissions, viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError

from .models import Comment
from .serializers import CommentSerializer


def _user_can_see_resource(user, resource_type: str, resource_id) -> bool:
    """
    Return True when `user` may view comments for (resource_type, resource_id).
    Mirrors the access rules enforced by each resource's own view set — the
    global comment API must not leak comment content for records the caller
    can't otherwise see.
    """
    if not resource_type or not resource_id:
        return False
    if getattr(user, "is_staff", False):
        return True
    try:
        rid = int(resource_id)
    except (TypeError, ValueError):
        return False

    try:
        if resource_type in ("account", "account_note", "artifact"):
            from accounts.models import Account, AccountNote, AccountArtifact
            if resource_type == "account":
                return Account.objects.filter(
                    id=rid,
                ).filter(team_members__user=user).exists() or Account.objects.filter(
                    id=rid, admin_owner=user,
                ).exists()
            if resource_type == "account_note":
                return AccountNote.objects.filter(
                    id=rid, account__team_members__user=user,
                ).exists() or AccountNote.objects.filter(
                    id=rid, account__admin_owner=user,
                ).exists() or AccountNote.objects.filter(
                    id=rid, author=user,
                ).exists()
            if resource_type == "artifact":
                return AccountArtifact.objects.filter(
                    id=rid, account__team_members__user=user,
                ).exists() or AccountArtifact.objects.filter(
                    id=rid, account__admin_owner=user,
                ).exists() or AccountArtifact.objects.filter(
                    id=rid, uploaded_by=user,
                ).exists()

        if resource_type in ("airtable_account", "action_item", "meeting"):
            from accounts.models import Account
            from airtable_sync.models import AirtableAccount, AirtableActionItem, AirtableMeeting
            allowed_airtable_ids = Account.objects.filter(
                team_members__user=user,
            ).exclude(airtable_id__exact="").values_list("airtable_id", flat=True)
            if resource_type == "airtable_account":
                return AirtableAccount.objects.filter(
                    id=rid, airtable_id__in=allowed_airtable_ids,
                ).exists()
            if resource_type == "action_item":
                return AirtableActionItem.objects.filter(
                    id=rid, account__airtable_id__in=allowed_airtable_ids,
                ).exists()
            if resource_type == "meeting":
                return AirtableMeeting.objects.filter(
                    id=rid, account__airtable_id__in=allowed_airtable_ids,
                ).exists()

        if resource_type == "calendar_event":
            from scheduler.models import CalendarEvent
            return CalendarEvent.objects.filter(id=rid, owner=user).exists()
        if resource_type == "reminder":
            from scheduler.models import Reminder
            return Reminder.objects.filter(id=rid, created_by=user).exists()
        if resource_type == "task":
            from django.db.models import Q
            from scheduler.models import Task
            return Task.objects.filter(id=rid).filter(
                Q(assigned_to=user) | Q(created_by=user)
            ).exists()
        if resource_type == "meeting_note":
            # Meeting notes are broadcast to any user connected to the event ws;
            # visibility isn't currently gated at the resource level, so gate
            # comments on it to authored-comments-only for non-staff callers.
            return False
        if resource_type == "claude_skill":
            from skills.models import ClaudeSkill
            return ClaudeSkill.objects.filter(id=rid, submitted_by=user).exists()
    except Exception:
        return False
    return False


class CommentViewSet(viewsets.ModelViewSet):
    serializer_class = CommentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = (
            Comment.objects
            .select_related("author", "author__profile")
            .prefetch_related("replies__author", "replies__author__profile")
            .filter(parent__isnull=True)
        )
        resource_type = self.request.query_params.get("resource_type")
        resource_id = self.request.query_params.get("resource_id")
        if not resource_type or not resource_id:
            # No filters — return all comments authored by the current user, newest first.
            return qs.filter(author=self.request.user).order_by("-created_at")
        # Refuse to expose comments on records the caller can't otherwise see.
        if not _user_can_see_resource(self.request.user, resource_type, resource_id):
            return qs.none()
        return qs.filter(resource_type=resource_type, resource_id=resource_id)

    def perform_create(self, serializer):
        resource_type = serializer.validated_data.get("resource_type")
        resource_id = serializer.validated_data.get("resource_id")
        parent = serializer.validated_data.get("parent")
        if not resource_type or not resource_id:
            raise ValidationError("resource_type and resource_id are required.")
        if parent and (parent.resource_type != resource_type or parent.resource_id != resource_id):
            raise ValidationError("Reply resource must match parent comment resource.")
        if not _user_can_see_resource(self.request.user, resource_type, resource_id):
            raise PermissionDenied("You cannot comment on this resource.")
        serializer.save(author=self.request.user)

    def perform_update(self, serializer):
        comment = self.get_object()
        if comment.author != self.request.user and not self.request.user.is_staff:
            raise PermissionDenied("You can only edit your own comments.")
        serializer.save()

    def perform_destroy(self, instance):
        if instance.author != self.request.user and not self.request.user.is_staff:
            raise PermissionDenied("You can only delete your own comments.")
        instance.delete()
