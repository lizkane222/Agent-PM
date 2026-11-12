"""DRF serializers for the team app."""

import re

from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import (
    LeftNote, Notification, PublicItem, Tag, Team, TeamMember, TeamMemberDocument,
    TeamMembership, UserProfile,
)

# E.164: "+", a non-zero country code digit, 7–15 digits total.
E164_RE = re.compile(r"^\+[1-9]\d{6,14}$")

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
    team_name = serializers.CharField(source="team.name", read_only=True)

    class Meta:
        model = TeamMembership
        fields = [
            "id", "user", "user_email", "user_display_name",
            "team", "team_name", "role", "joined_at", "created_at", "updated_at",
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
            "allow_reminders_from_others",
            # Web Push — only expose whether a subscription exists, not the raw secret
            "push_subscription_active",
            # Staff view mode
            "staff_view_override",
            # Authorisation tier — read-only here; set via the Admin-only access-level action
            "access_level",
            # Calendar appearance
            "calendar_colors",
            "status_labels",
            # Gmail watch configuration
            "gmail_watch_config",
            "teams",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id", "email", "username", "is_staff", "okta_uid", "airtable_collaborator_id",
            "push_subscription_active", "access_level", "created_at", "updated_at",
        ]

    push_subscription_active = serializers.SerializerMethodField()

    def get_push_subscription_active(self, obj) -> bool:
        return bool(obj.push_subscription)

    def validate_phone_number(self, value):
        """Store E.164 (`+<country><number>`), which Twilio requires.

        Spaces, dashes, dots and parentheses are stripped. A number without a country code
        used to be saved as-is and then fail silently at Twilio when an SMS reminder fired.
        """
        if not value:
            return ""
        cleaned = re.sub(r"[\s().-]", "", str(value))
        if not E164_RE.match(cleaned):
            raise serializers.ValidationError(
                "Enter the number with its country code, e.g. +1 415 555 0123."
            )
        return cleaned

    # Allowed display names per canonical action-item status (display only).
    STATUS_LABEL_CHOICES = {
        "Open": ("Open", "Not Started"),
        "In Progress": ("In Progress", "Pending"),
        "Blocked": ("Blocked",),
        "Done": ("Done", "Completed"),
        "Backlogged": ("Backlogged", "Not Going To Do"),
    }

    def validate_status_labels(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Must be an object.")
        for status, label in value.items():
            allowed = self.STATUS_LABEL_CHOICES.get(status)
            if allowed is None:
                raise serializers.ValidationError(
                    f"Unknown status '{status}'. Expected one of: {', '.join(self.STATUS_LABEL_CHOICES)}."
                )
            if label not in allowed:
                raise serializers.ValidationError(
                    f"'{label}' is not a valid name for {status}. Expected one of: {', '.join(allowed)}."
                )
        return value

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

    def validate_gmail_watch_config(self, value):
        """Validate the gmail_watch_config blob.

        Shape: {"label_name": "Agent PM - Threads", "keywords": [str], "block_keywords": [str]}

        All fields are optional. Keywords are case-insensitive strings (fuzzy matching happens
        downstream). Keywords list is capped at 100 to prevent abuse.
        """
        if not isinstance(value, dict):
            raise serializers.ValidationError("Must be an object.")

        unknown = set(value) - {"label_name", "keywords", "block_keywords"}
        if unknown:
            raise serializers.ValidationError(
                f"Unknown key(s): {', '.join(sorted(unknown))}."
            )

        if "label_name" in value:
            label = value["label_name"]
            if not isinstance(label, str):
                raise serializers.ValidationError({"label_name": "Must be a string."})
            if not label or len(label) > 100:
                raise serializers.ValidationError(
                    {"label_name": "Must be 1-100 characters."}
                )

        for key in ("keywords", "block_keywords"):
            if key in value:
                items = value[key]
                if not isinstance(items, list):
                    raise serializers.ValidationError({key: "Must be a list."})
                if len(items) > 100:
                    raise serializers.ValidationError({key: "Too many items (max 100)."})
                if not all(isinstance(s, str) for s in items):
                    raise serializers.ValidationError({key: "All items must be strings."})

        return value


class TeamMemberDocumentSerializer(serializers.ModelSerializer):
    added_by_name = serializers.CharField(
        source="added_by.profile.display_name", read_only=True, default=""
    )

    class Meta:
        model = TeamMemberDocument
        fields = [
            "id", "team_member", "name", "url", "position",
            "added_by", "added_by_name", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "team_member", "added_by", "created_at", "updated_at"]


class TeamMemberSerializer(serializers.ModelSerializer):
    tags = TagSerializer(many=True, read_only=True)
    tag_ids = serializers.PrimaryKeyRelatedField(
        queryset=Tag.objects.all(), many=True, write_only=True, source="tags", required=False
    )
    manager_name = serializers.CharField(
        source="manager.full_name", read_only=True, allow_null=True
    )
    # Effective zone: the person's own setting wins, else the one someone assigned, else "".
    timezone = serializers.SerializerMethodField()
    timezone_source = serializers.SerializerMethodField()
    assigned_by_username = serializers.SerializerMethodField()

    def get_timezone(self, obj):
        return obj.timezone_with_source()[0]

    def validate_additional_emails(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("Expected a list of email addresses.")
        if len(value) > 10:
            raise serializers.ValidationError("At most 10 additional addresses.")
        field = serializers.EmailField()
        cleaned: list[str] = []
        for raw in value:
            if not isinstance(raw, str):
                raise serializers.ValidationError("Each address must be text.")
            addr = field.run_validation(raw.strip()).lower()
            if addr not in cleaned:
                cleaned.append(addr)
        primary = (self.initial_data.get("email") or (self.instance.email if self.instance else "")).strip().lower()
        cleaned = [a for a in cleaned if a != primary]
        taken = TeamMember.objects.filter(email__in=cleaned)
        if self.instance:
            taken = taken.exclude(pk=self.instance.pk)
        if taken.exists():
            raise serializers.ValidationError("Another team member already uses one of these addresses.")
        return cleaned

    def get_timezone_source(self, obj):
        return obj.timezone_with_source()[1]

    def get_assigned_by_username(self, obj):
        # Only named while the assignment is the value in force.
        if obj.timezone_with_source()[1] != "assigned" or not obj.assigned_timezone_by_id:
            return None
        return obj.assigned_timezone_by.username

    class Meta:
        model = TeamMember
        fields = [
            "id",
            "user",
            "full_name",
            "email",
            "additional_emails",
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
            "timezone",
            "timezone_source",
            "assigned_by_username",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class NotificationSerializer(serializers.ModelSerializer):
    # Only the reminder's owner can reschedule it. Someone who was notified through a teammate's
    # reminder can acknowledge it, not snooze it.
    can_snooze = serializers.SerializerMethodField()

    def get_can_snooze(self, obj) -> bool:
        return bool(obj.reminder_id and obj.reminder.created_by_id == obj.user_id)

    class Meta:
        model = Notification
        fields = ["id", "channel", "kind", "title", "body", "link", "status", "read_at", "created_at",
                  "reminder", "fired_for", "can_snooze"]
        read_only_fields = fields


def _safe_url(value: str) -> str:
    """Only http(s) links may be shown to other users (blocks javascript: and data:)."""
    value = (value or "").strip()
    if value and not re.match(r"^https?://", value, re.IGNORECASE):
        raise serializers.ValidationError("Links must start with http:// or https://.")
    return value


_TASK_ITEM_RE = re.compile(
    r'<li[^>]*data-checked="(true|false)"[^>]*>\s*<label>.*?</label>\s*<div>\s*(<p>)?(.*?)</div>\s*</li>',
    re.S,
)


def flatten_task_lists(markup: str) -> str:
    """Turn the editor's checklist (``Steps``) into plain list items marked ☐ / ☑.

    The sanitizer strips ``input``, ``label`` and ``data-*`` (it also guards uploaded HTML files),
    so a checklist saved as-is would come back as bullets with no checkboxes. The state is kept as
    text rather than loosening that allowlist.
    """
    def one(m: "re.Match[str]") -> str:
        mark = "\u2611" if m.group(1) == "true" else "\u2610"
        return f"<li>{m.group(2) or ''}{mark} {m.group(3)}</li>"

    out = _TASK_ITEM_RE.sub(one, markup)
    return re.sub(r'<ul[^>]*data-type="taskList"[^>]*>', "<ul>", out)


class PublicItemSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = PublicItem
        fields = [
            "id", "owner", "item_type", "title", "url", "file", "file_url",
            "body", "ref", "position", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "owner", "file_url", "created_at", "updated_at"]
        extra_kwargs = {"file": {"write_only": True, "required": False}}

    def get_file_url(self, obj):
        return obj.file.url if obj.file else ""

    def validate_url(self, value):
        return _safe_url(value)

    def validate_ref(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("ref must be an object.")
        if value.get("url"):
            value = {**value, "url": str(value["url"])}
            if not str(value["url"]).startswith("/"):
                _safe_url(value["url"])
        return value

    def validate_body(self, value):
        from core.html_sanitize import sanitize_html

        return sanitize_html(flatten_task_lists(value or ""))

    def validate(self, attrs):
        item_type = attrs.get("item_type") or getattr(self.instance, "item_type", "")
        if not (attrs.get("title") or getattr(self.instance, "title", "")):
            raise serializers.ValidationError({"title": "A title is required."})
        if item_type == "artifact_link" and not (attrs.get("url") or getattr(self.instance, "url", "")):
            raise serializers.ValidationError({"url": "A link needs a URL."})
        if item_type == "record_ref" and not (attrs.get("ref") or getattr(self.instance, "ref", {})):
            raise serializers.ValidationError({"ref": "A record reference needs a record."})
        return attrs


class LeftNoteSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()

    class Meta:
        model = LeftNote
        fields = ["id", "author", "author_name", "body", "created_at"]
        read_only_fields = ["id", "author", "author_name", "created_at"]

    def get_author_name(self, obj):
        profile = getattr(obj.author, "profile", None)
        return (profile.display_name if profile and profile.display_name else "") or obj.author.get_full_name() or obj.author.username
