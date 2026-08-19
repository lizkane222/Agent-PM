"""DRF serializers for the comments app."""

from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Comment

User = get_user_model()


def _author_display(obj) -> str:
    """Human-facing name for a comment's author, falling back to the username."""
    if not obj.author:
        return "Unknown"
    profile = getattr(obj.author, "profile", None)
    if profile and getattr(profile, "display_name", None):
        return profile.display_name
    full = obj.author.get_full_name()
    return full if full else obj.author.username


class CommentPreviewSerializer(serializers.ModelSerializer):
    """Trimmed comment shape for the batched ``/summary/`` route.

    Deliberately excludes ``replies`` (which recurses) and the JSON blobs — the
    summary feeds a 3-line preview on record cards, not the full thread, and is
    fetched for every visible card at once.
    """

    author_display = serializers.SerializerMethodField()

    class Meta:
        model = Comment
        fields = ["id", "resource_id", "author", "author_display", "content", "created_at"]

    def get_author_display(self, obj):
        return _author_display(obj)


class CommentSerializer(serializers.ModelSerializer):
    author_username = serializers.SerializerMethodField()
    author_display = serializers.SerializerMethodField()
    replies = serializers.SerializerMethodField()

    class Meta:
        model = Comment
        fields = [
            "id",
            "resource_type",
            "resource_id",
            "resource_label",
            "author",
            "author_username",
            "author_display",
            "content",
            "parent",
            "references",
            "mentions",
            "replies",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id", "author", "author_username", "author_display", "replies",
            "created_at", "updated_at",
        ]

    def get_author_username(self, obj):
        if obj.author:
            return obj.author.username
        return None

    def get_author_display(self, obj):
        return _author_display(obj)

    def get_replies(self, obj):
        # Only include replies on top-level comments, not recursively on replies
        if obj.parent_id is not None:
            return []
        qs = obj.replies.select_related("author", "author__profile").order_by("created_at")
        return CommentSerializer(qs, many=True, context=self.context).data
