"""DRF serializers for the team app."""

from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Tag, Team, TeamMember, TeamMembership, UserProfile

User = get_user_model()


class TagSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = ["id", "name", "color", "description", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class TeamMembershipSerializer(serializers.ModelSerializer):
    user_email = serializers.EmailField(source="user.email", read_only=True)
    user_display_name = serializers.CharField(
        source="user.profile.display_name", read_only=True, default=""
    )

    class Meta:
        model = TeamMembership
        fields = [
            "id", "user", "user_email", "user_display_name",
            "team", "role", "joined_at", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class TeamSerializer(serializers.ModelSerializer):
    memberships = TeamMembershipSerializer(many=True, read_only=True)
    member_count = serializers.IntegerField(source="memberships.count", read_only=True)

    class Meta:
        model = Team
        fields = ["id", "name", "description", "member_count", "memberships", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


ROLE_RANK = {"admin": 4, "manager": 3, "member": 2, "viewer": 1}


class UserProfileSerializer(serializers.ModelSerializer):
    email = serializers.EmailField(source="user.email", read_only=True)
    username = serializers.CharField(source="user.username", read_only=True)
    is_staff = serializers.BooleanField(source="user.is_staff", read_only=True)
    role = serializers.SerializerMethodField()
    teams = serializers.SerializerMethodField()

    def get_role(self, obj):
        memberships = obj.user.memberships.all()
        if not memberships:
            return "member"
        return max(
            (m.role for m in memberships),
            key=lambda r: ROLE_RANK.get(r, 0),
            default="member",
        )

    def get_teams(self, obj):
        memberships = obj.user.memberships.select_related("team").all()
        return [
            {"id": m.team.id, "name": m.team.name, "role": m.role}
            for m in memberships
        ]

    class Meta:
        model = UserProfile
        fields = [
            "id",
            "email",
            "username",
            "is_staff",
            "okta_uid",
            "display_name",
            "avatar_url",
            "title",
            "role",
            "phone_number",
            "timezone",
            "slack_user_id",
            "google_account_email",
            "airtable_collaborator_id",
            "notification_email",
            "notification_slack",
            # Reminder notification defaults
            "notify_default_in_app",
            "notify_default_slack",
            "notify_default_push",
            "notify_default_sms",
            # Web Push — only expose whether a subscription exists, not the raw secret
            "push_subscription_active",
            # Staff view mode
            "staff_view_override",
            "teams",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id", "email", "username", "is_staff", "okta_uid", "airtable_collaborator_id",
            "push_subscription_active", "created_at", "updated_at",
        ]

    push_subscription_active = serializers.SerializerMethodField()

    def get_push_subscription_active(self, obj) -> bool:
        return bool(obj.push_subscription)


class TeamMemberSerializer(serializers.ModelSerializer):
    tags = TagSerializer(many=True, read_only=True)
    tag_ids = serializers.PrimaryKeyRelatedField(
        queryset=Tag.objects.all(), many=True, write_only=True, source="tags", required=False
    )
    manager_name = serializers.CharField(
        source="manager.full_name", read_only=True, allow_null=True
    )

    class Meta:
        model = TeamMember
        fields = [
            "id",
            "user",
            "full_name",
            "email",
            "title",
            "department",
            "status",
            "tags",
            "tag_ids",
            "manager",
            "manager_name",
            "slack_handle",
            "avatar_url",
            "joined_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]
