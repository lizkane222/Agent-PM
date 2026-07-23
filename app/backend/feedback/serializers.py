"""DRF serializers for the feedback app."""

from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Feedback, FeedbackComment

User = get_user_model()


def _display(user):
    if not user:
        return "Unknown"
    profile = getattr(user, "profile", None)
    if profile and getattr(profile, "display_name", None):
        return profile.display_name
    full = user.get_full_name()
    return full if full else user.username


class FeedbackCommentSerializer(serializers.ModelSerializer):
    author_display = serializers.SerializerMethodField()
    author_username = serializers.SerializerMethodField()

    class Meta:
        model = FeedbackComment
        fields = [
            "id", "feedback", "author", "author_username", "author_display",
            "content", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "author", "author_username", "author_display", "created_at", "updated_at"]

    def get_author_display(self, obj):
        return _display(obj.author)

    def get_author_username(self, obj):
        return obj.author.username if obj.author else None


class FeedbackSerializer(serializers.ModelSerializer):
    author_display = serializers.SerializerMethodField()
    author_username = serializers.SerializerMethodField()
    comments = FeedbackCommentSerializer(many=True, read_only=True)
    comment_count = serializers.SerializerMethodField()

    class Meta:
        model = Feedback
        fields = [
            "id", "author", "author_username", "author_display",
            "description", "element_label", "element_path", "page_url",
            "attachment", "status", "comments", "comment_count",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "author", "author_username", "author_display",
            "comments", "comment_count", "created_at", "updated_at",
        ]

    def get_author_display(self, obj):
        return _display(obj.author)

    def get_author_username(self, obj):
        return obj.author.username if obj.author else None

    def get_comment_count(self, obj):
        return obj.comments.count()
