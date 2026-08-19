"""DRF serializers for the scheduler app."""

from rest_framework import serializers

from .models import ActionItem, CalendarEvent, MeetingNote, Reminder, Task


class CalendarEventSerializer(serializers.ModelSerializer):
    owner_username = serializers.CharField(source="owner.username", read_only=True)
    account_name = serializers.CharField(source="account.company_name", read_only=True, allow_null=True)

    class Meta:
        model = CalendarEvent
        fields = [
            "id",
            "owner",
            "owner_username",
            "account",
            "account_name",
            "google_event_id",
            "title",
            "description",
            "location",
            "start_datetime",
            "end_datetime",
            "all_day",
            "status",
            "attendees",
            "meet_link",
            "calendar_id",
            "is_synced",
            "event_category",
            "attended",
            "agentpm_airtable_id",
            "created_at",
            "updated_at",
        ]
        # `attended` is written through the dedicated `attendance` action, which is
        # owner-scoped and free of the account-membership check that guards this
        # serializer's normal update path.
        read_only_fields = ["id", "owner", "google_event_id", "attended", "agentpm_airtable_id", "created_at", "updated_at"]


class ActionItemSerializer(serializers.ModelSerializer):
    assigned_to_username = serializers.CharField(
        source="assigned_to.username", read_only=True, allow_null=True
    )
    account_name = serializers.CharField(source="account.company_name", read_only=True, allow_null=True)

    class Meta:
        model = ActionItem
        fields = [
            "id",
            "assigned_to",
            "assigned_to_username",
            "created_by",
            "title",
            "notes",
            "priority",
            "status",
            "due_date",
            "source_event",
            "account",
            "account_name",
            "airtable_record_id",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_by", "airtable_record_id", "created_at", "updated_at"]


class ReminderSerializer(serializers.ModelSerializer):
    created_by_username = serializers.CharField(source="created_by.username", read_only=True)

    class Meta:
        model = Reminder
        fields = [
            "id",
            "created_by",
            "created_by_username",
            "title",
            "body",
            "resource_type",
            "resource_id",
            "resource_label",
            "due_at",
            "notify_in_app",
            "notify_slack",
            "notify_push",
            "notify_sms",
            "status",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_by", "created_at", "updated_at"]


class MeetingNoteSerializer(serializers.ModelSerializer):
    author_username = serializers.CharField(source="author.username", read_only=True, allow_null=True)
    author_display = serializers.SerializerMethodField()

    def get_author_display(self, obj):
        if not obj.author:
            return "Unknown"
        return getattr(obj.author, "display_name", None) or obj.author.get_full_name() or obj.author.username

    class Meta:
        model = MeetingNote
        fields = [
            "id", "event", "author", "author_username", "author_display",
            "html", "text", "due_date", "position", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "author", "created_at", "updated_at"]


class TaskSerializer(serializers.ModelSerializer):
    assigned_to_username = serializers.CharField(
        source="assigned_to.username", read_only=True, allow_null=True
    )

    class Meta:
        model = Task
        fields = [
            "id",
            "title",
            "description",
            "assigned_to",
            "assigned_to_username",
            "created_by",
            "status",
            "priority",
            "due_date",
            "tags",
            "action_item",
            "airtable_record_id",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_by", "airtable_record_id", "created_at", "updated_at"]
