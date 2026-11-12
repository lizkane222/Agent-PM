from django.db.models import Q
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
    account_name = serializers.CharField(source="account.company_name", read_only=True, default="")

    class Meta:
        model = UserPageNote
        fields = ["id", "owner", "owner_username", "content", "account_ref_label", "account", "account_name",
                  "created_at", "updated_at"]
        read_only_fields = ["id", "owner", "owner_username", "created_at", "updated_at"]

    def validate_account(self, account):
        """A note can only be filed under an account the writer is on (or their own Admin workspace)."""
        if account is None:
            return None
        user = self.context["request"].user
        from accounts.models import Account
        allowed = Account.objects.filter(Q(team_members__user=user) | Q(admin_owner=user), pk=account.pk).exists()
        if not allowed:
            raise serializers.ValidationError("You can only link a note to an account you are on.")
        return account

    def validate(self, attrs):
        # The label follows the link, so the notepad tab and the account page never disagree.
        if "account" in attrs:
            attrs["account_ref_label"] = attrs["account"].company_name if attrs["account"] else ""
        return attrs
