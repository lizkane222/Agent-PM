"""DRF serializers for the team app."""

import re

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
    #: Guards against the per-event "important" map growing without bound.
    IMPORTANT_COLOR_LIMIT = 500
    HEX_COLOR_RE = re.compile(r"#[0-9A-Fa-f]{6}")

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
            # Calendar appearance
            "calendar_colors",
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

    def validate_calendar_colors(self, value):
        """Validate the calendar_colors blob.

        Shape: {"categories": {<type>: "#RRGGBB"}, "important": {<uid>: "#RRGGBB"}}

        Colors are validated by *format*, not by membership in a specific palette, so
        offering a new palette in the UI needs no backend change. Category keys are
        checked, because a typo there would silently never apply.
        """
        if not isinstance(value, dict):
            raise serializers.ValidationError("Must be an object.")

        unknown = set(value) - {"categories", "important"}
        if unknown:
            raise serializers.ValidationError(
                f"Unknown key(s): {', '.join(sorted(unknown))}. Expected 'categories' and/or 'important'."
            )

        from scheduler.models import CalendarEvent

        # Action items and reminders are not event_category values — action items are
        # identified by calendar_id="work_tracking" and reminders by a
        # "scheduled-reminder-*" uid — but both are colorable types.
        valid_types = (
            {v for v, _label in CalendarEvent.EVENT_CATEGORY_CHOICES}
            | {"action_item", "reminder"}
        )

        for key, cap in (("categories", None), ("important", self.IMPORTANT_COLOR_LIMIT)):
            section = value.get(key)
            if section is None:
                continue
            if not isinstance(section, dict):
                raise serializers.ValidationError({key: "Must be an object."})
            if cap is not None and len(section) > cap:
                raise serializers.ValidationError(
                    {key: f"Too many entries (max {cap})."}
                )
            for name, color in section.items():
                if key == "categories" and name not in valid_types:
                    raise serializers.ValidationError(
                        {key: f"Unknown event type '{name}'. Expected one of: {', '.join(sorted(valid_types))}."}
                    )
                if not isinstance(color, str) or not self.HEX_COLOR_RE.fullmatch(color):
                    raise serializers.ValidationError(
                        {key: f"'{name}' must be a hex color like #RRGGBB, got {color!r}."}
                    )

        return value


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
