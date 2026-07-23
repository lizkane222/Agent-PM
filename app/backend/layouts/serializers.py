from rest_framework import serializers
from .models import LayoutInteraction, PageLayout, UserPageNote, WorkingSession


class PageLayoutSerializer(serializers.ModelSerializer):
    creator_name = serializers.SerializerMethodField()
    forked_from_name = serializers.CharField(source="forked_from.name", read_only=True, allow_null=True)
    heart_count = serializers.IntegerField(read_only=True)
    fork_count = serializers.IntegerField(read_only=True)
    # Per-request user state — injected by the view
    hearted = serializers.SerializerMethodField()
    pinned = serializers.SerializerMethodField()

    class Meta:
        model = PageLayout
        fields = [
            "id", "name", "creator", "creator_name",
            "forked_from", "forked_from_name",
            "nodes", "is_public",
            "heart_count", "fork_count",
            "hearted", "pinned",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "creator", "creator_name", "heart_count", "fork_count",
                            "hearted", "pinned", "created_at", "updated_at"]

    def get_creator_name(self, obj):
        if not obj.creator:
            return None
        return obj.creator.get_full_name() or obj.creator.username

    def _interaction(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return None
        return obj.interactions.filter(user=request.user).first()

    def get_hearted(self, obj):
        i = self._interaction(obj)
        return bool(i and i.hearted)

    def get_pinned(self, obj):
        i = self._interaction(obj)
        return bool(i and i.pinned)


class WorkingSessionSerializer(serializers.ModelSerializer):
    owner_username = serializers.CharField(source="owner.username", read_only=True)

    class Meta:
        model = WorkingSession
        fields = ["id", "owner", "owner_username", "name", "canvas_nodes", "record_refs",
                  "airtable_id", "created_at", "updated_at"]
        read_only_fields = ["id", "owner", "owner_username", "airtable_id", "created_at", "updated_at"]


class UserPageNoteSerializer(serializers.ModelSerializer):
    owner_username = serializers.CharField(source="owner.username", read_only=True)

    class Meta:
        model = UserPageNote
        fields = ["id", "owner", "owner_username", "content", "account_ref_label",
                  "created_at", "updated_at"]
        read_only_fields = ["id", "owner", "owner_username", "created_at", "updated_at"]
