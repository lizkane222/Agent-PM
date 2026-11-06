"""Notifications, the public profile section, and notes left for another user."""

from pathlib import Path

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.html_sanitize import is_html_filename
from core.pagination import ClientPageSizePagination

from .models import LeftNote, Notification, PublicItem, TeamMember
from .notifications import record_notification
from .serializers import (
    LeftNoteSerializer,
    NotificationSerializer,
    PublicItemSerializer,
    TeamMemberSerializer,
)

_BLOCKED_EXTENSIONS = {
    ".py", ".sh", ".bash", ".exe", ".bat", ".cmd", ".ps1",
    ".php", ".rb", ".pl", ".js", ".jsx", ".ts", ".tsx", ".svg", ".xml",
}
_MAX_UPLOAD_BYTES = 25 * 1024 * 1024


class NotificationViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """The caller's own notification history. Never exposes another user's."""

    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = ClientPageSizePagination

    def get_queryset(self):
        qs = Notification.objects.filter(user=self.request.user)
        channel = self.request.query_params.get("channel")
        kind = self.request.query_params.get("kind")
        if channel:
            qs = qs.filter(channel=channel)
        if kind:
            qs = qs.filter(kind=kind)
        return qs

    @action(detail=False, methods=["post"], url_path="mark-read")
    def mark_read(self, request):
        """Mark the given ids (or every unread one when `ids` is omitted) as read."""
        qs = Notification.objects.filter(user=request.user, read_at__isnull=True)
        ids = request.data.get("ids")
        if ids is not None:
            if not isinstance(ids, list):
                return Response({"error": "ids must be a list."}, status=400)
            qs = qs.filter(pk__in=[i for i in ids if isinstance(i, int)])
        return Response({"updated": qs.update(read_at=timezone.now())})


class PublicItemViewSet(viewsets.ModelViewSet):
    """
    Public profile items. Any authenticated user may read (`?member=<TeamMember id>`);
    only the owner may write — staff get no bypass, per the product rule.
    """

    serializer_class = PublicItemSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        qs = PublicItem.objects.all()
        if self.action in ("update", "partial_update", "destroy"):
            return qs.filter(owner=self.request.user)
        member = self.request.query_params.get("member")
        if member == "me":
            return qs.filter(owner=self.request.user)
        if member:
            if not str(member).isdigit():
                return qs.none()
            return qs.filter(owner__team_member__pk=int(member))
        if self.action == "list":
            return qs.filter(owner=self.request.user)
        return qs

    def _check_file(self, request):
        file_obj = request.FILES.get("file")
        if not file_obj:
            return
        if file_obj.size > _MAX_UPLOAD_BYTES:
            raise PermissionDenied("File too large (max 25 MB).")
        ext = Path(file_obj.name).suffix.lower()
        if ext in _BLOCKED_EXTENSIONS:
            raise PermissionDenied(f"File type '{ext}' is not permitted.")

    def perform_create(self, serializer):
        self._check_file(self.request)
        file_obj = self.request.FILES.get("file")
        extra = {}
        if file_obj and is_html_filename(file_obj.name):
            from accounts.views import _sanitized_html_upload

            cleaned = _sanitized_html_upload(file_obj)
            if cleaned is None:
                raise PermissionDenied("That HTML file could not be read as text.")
            extra["file"] = cleaned
        serializer.save(owner=self.request.user, **extra)

    def perform_update(self, serializer):
        self._check_file(self.request)
        serializer.save()


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def member_public_profile(request, pk):
    """Safe header for any team member — deliberately not UserProfileSerializer."""
    member = get_object_or_404(TeamMember, pk=pk)
    data = TeamMemberSerializer(member).data
    data["is_self"] = member.user_id == request.user.id
    return Response(data)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def leave_note(request, pk):
    """
    POST: leave a private note for a member and notify them.
    GET: the notes left for *the caller* (pk must be the caller's own member).
    """
    member = get_object_or_404(TeamMember, pk=pk)
    if request.method == "GET":
        if member.user_id != request.user.id:
            raise PermissionDenied("You can only read notes left for you.")
        notes = LeftNote.objects.filter(recipient=request.user).select_related("author__profile")
        return Response(LeftNoteSerializer(notes, many=True).data)

    body = str(request.data.get("body", "")).strip()
    if not body:
        return Response({"error": "A note cannot be empty."}, status=400)
    if member.user is None:
        return Response({"error": "That person does not have an account yet."}, status=400)
    if member.user_id == request.user.id:
        return Response({"error": "You cannot leave a note for yourself."}, status=400)

    note = LeftNote.objects.create(author=request.user, recipient=member.user, body=body)
    author = LeftNoteSerializer(note).data["author_name"]
    title = f"{author} left you a note"
    record_notification(member.user, "in_app", "note_for_you", title, body[:500], "/profile")
    try:
        from realtime.sync import publish_activity_event

        publish_activity_event(
            user=member.user, event_type="note_for_you", title=title, detail=body[:500],
            metadata={"note_id": note.pk},
        )
    except Exception:
        pass
    return Response(LeftNoteSerializer(note).data, status=status.HTTP_201_CREATED)
