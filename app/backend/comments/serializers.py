"""DRF serializers for the comments app."""

from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Comment

User = get_user_model()


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
        if not obj.author:
            return "Unknown"
        profile = getattr(obj.author, "profile", None)
        if profile and getattr(profile, "display_name", None):
            return profile.display_name
        full = obj.author.get_full_name()
        return full if full else obj.author.username

    def get_replies(self, obj):
        # Only include replies on top-level comments, not recursively on replies
        if obj.parent_id is not None:
            return []
        qs = obj.replies.select_related("author", "author__profile").order_by("created_at")
        return CommentSerializer(qs, many=True, context=self.context).data
