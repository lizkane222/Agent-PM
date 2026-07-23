"""DRF views for the feedback app."""

from rest_framework import permissions, status, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, MultiPartParser, JSONParser
from rest_framework.response import Response

from .models import Feedback, FeedbackComment
from .serializers import FeedbackCommentSerializer, FeedbackSerializer


class FeedbackViewSet(viewsets.ModelViewSet):
    serializer_class = FeedbackSerializer
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        qs = (
            Feedback.objects
            .select_related("author", "author__profile")
            .prefetch_related("comments__author", "comments__author__profile")
        )
        if not self.request.user.is_staff:
            qs = qs.filter(author=self.request.user)
        return qs

    def perform_create(self, serializer):
        serializer.save(author=self.request.user)

    def perform_update(self, serializer):
        feedback = self.get_object()
        if feedback.author != self.request.user and not self.request.user.is_staff:
            raise PermissionDenied("You can only edit your own feedback.")
        serializer.save()

    def perform_destroy(self, instance):
        if instance.author != self.request.user and not self.request.user.is_staff:
            raise PermissionDenied("You can only delete your own feedback.")
        instance.delete()


class FeedbackCommentViewSet(viewsets.ModelViewSet):
    serializer_class = FeedbackCommentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = FeedbackComment.objects.select_related("author", "author__profile")
        # Scope: non-staff callers can only see comments on feedback they authored.
        # This prevents enumeration of ?feedback=<n> across the system.
        if not self.request.user.is_staff:
            qs = qs.filter(feedback__author=self.request.user)
        feedback_id = self.request.query_params.get("feedback")
        if feedback_id:
            qs = qs.filter(feedback_id=feedback_id)
        return qs

    def perform_create(self, serializer):
        # Only allow comments on feedback the caller can see (their own, or all
        # for staff). Prevents attackers from writing into other users' threads.
        feedback = serializer.validated_data.get("feedback")
        user = self.request.user
        if feedback is not None and not user.is_staff and feedback.author_id != getattr(user, "pk", None):
            raise PermissionDenied("You cannot comment on this feedback.")
        serializer.save(author=user)

    def perform_update(self, serializer):
        comment = self.get_object()
        if comment.author != self.request.user and not self.request.user.is_staff:
            raise PermissionDenied("You can only edit your own comments.")
        serializer.save()

    def perform_destroy(self, instance):
        if instance.author != self.request.user and not self.request.user.is_staff:
            raise PermissionDenied("You can only delete your own comments.")
        instance.delete()
