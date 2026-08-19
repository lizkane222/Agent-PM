"""DRF views for the comments app."""

from rest_framework import permissions, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from core.query_params import csv_int_params

from .models import RESOURCE_TYPE_CHOICES, Comment
from .serializers import CommentPreviewSerializer, CommentSerializer

#: How many recent comments the batched ``/summary/`` route previews per record.
SUMMARY_PREVIEW_LIMIT = 3

#: Upper bound on ``?resource_ids=`` so one request can't scan the whole table.
SUMMARY_MAX_IDS = 500


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
                from django.db.models import Q as _Q
                return AirtableMeeting.objects.filter(
                    _Q(id=rid, account__isnull=True) |
                    _Q(id=rid, account__airtable_id__in=allowed_airtable_ids)
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


def _notify_reply_author(replier, parent_comment, reply):
    """Create an AgentActivityEvent for the parent comment's author when someone replies.

    Idempotent: keyed on client_id=f"reply-{reply.id}" so double calls are safe.
    Skipped when the replier is replying to their own comment.
    """
    if parent_comment.author is None or parent_comment.author == replier:
        return
    from realtime.models import AgentActivityEvent
    client_id = f"reply-{reply.id}"
    if AgentActivityEvent.objects.filter(client_id=client_id).exists():
        return
    AgentActivityEvent.objects.create(
        user=parent_comment.author,
        event_type="comment_reply",
        title=f"{replier.username} replied to your comment on {parent_comment.resource_label}",
        detail=reply.content[:500],
        metadata={
            "resource_type": parent_comment.resource_type,
            "resource_id": parent_comment.resource_id,
            "reply_id": reply.id,
        },
        client_id=client_id,
    )


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

    @action(detail=False, methods=["get"], url_path="summary")
    def summary(self, request):
        """Comment count + newest-``SUMMARY_PREVIEW_LIMIT`` preview for many records at once.

        ``GET /comments/comments/summary/?resource_type=action_item&resource_ids=1,2,3``

        Record cards across the app show a comment badge and an inline preview, so
        the alternative is one request per visible card — which bursts past the
        ``user`` throttle (see the batching notes in ``core/query_params.py``).

        Records with no comments are omitted from ``results`` entirely; the client
        treats a missing key as zero. Visibility is checked with the same
        ``_user_can_see_resource`` gate the list route uses, but only for ids that
        actually have comments, so the per-id query cost tracks comment volume
        rather than page size.
        """
        resource_type = request.query_params.get("resource_type")
        if not resource_type:
            raise ValidationError("resource_type is required.")
        if resource_type not in dict(RESOURCE_TYPE_CHOICES):
            raise ValidationError(f"Unknown resource_type '{resource_type}'.")

        ids = csv_int_params(request.query_params.get("resource_ids"))
        if not ids:
            return Response({"results": {}})
        if len(ids) > SUMMARY_MAX_IDS:
            raise ValidationError(f"At most {SUMMARY_MAX_IDS} resource_ids per request.")

        scoped = Comment.objects.filter(resource_type=resource_type, resource_id__in=set(ids))
        present = set(scoped.values_list("resource_id", flat=True).distinct())
        visible = {
            rid for rid in present
            if _user_can_see_resource(request.user, resource_type, rid)
        }
        if not visible:
            return Response({"results": {}})

        rows = (
            scoped.filter(resource_id__in=visible)
            .select_related("author", "author__profile")
            .order_by("resource_id", "-created_at", "-id")
        )

        results: dict[str, dict] = {}
        for comment in rows:
            entry = results.setdefault(str(comment.resource_id), {"count": 0, "comments": []})
            # ``count`` covers replies too — a badge reading "1" on a record with
            # one parent and five replies would understate the conversation.
            entry["count"] += 1
            if comment.parent_id is None and len(entry["comments"]) < SUMMARY_PREVIEW_LIMIT:
                entry["comments"].append(CommentPreviewSerializer(comment).data)

        # Newest-first while collecting (so the limit keeps the *latest* three),
        # oldest-first for display so the preview reads like a conversation.
        for entry in results.values():
            entry["comments"].reverse()

        return Response({"results": results})

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
        comment = serializer.save(author=self.request.user)
        if parent:
            _notify_reply_author(self.request.user, parent, comment)

    def perform_update(self, serializer):
        comment = self.get_object()
        if comment.author != self.request.user and not self.request.user.is_staff:
            raise PermissionDenied("You can only edit your own comments.")
        serializer.save()

    def perform_destroy(self, instance):
        if instance.author != self.request.user and not self.request.user.is_staff:
            raise PermissionDenied("You can only delete your own comments.")
        instance.delete()
