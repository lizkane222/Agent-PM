"""DRF serializers for the scheduler app."""

from django.contrib.auth.models import User
from rest_framework import serializers

from . import reminder_calendar, reminder_links, reminder_recipients
from .models import ActionItem, CalendarEvent, MeetingNote, Reminder, Task


class CalendarEventSerializer(serializers.ModelSerializer):
    owner_username = serializers.CharField(source="owner.username", read_only=True)
    account_name = serializers.CharField(source="account.company_name", read_only=True, allow_null=True)
    project_name = serializers.CharField(source="project.name", read_only=True, allow_null=True)

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
            "reminder",
            "project",
            "project_name",
            "references",
            "artifact_ids",
            "created_at",
            "updated_at",
        ]
        # `attended` is written through the dedicated `attendance` action, which is
        # owner-scoped and free of the account-membership check that guards this
        # serializer's normal update path.
        #
        # `agentpm_airtable_id` and `reminder` stay read-only here because the Airtable and
        # Google syncs own them on an existing row — but `perform_create` assigns both on the
        # model directly (the same thing `attendance` does with the equally read-only
        # `attended`), so scheduling an action item or a reminder onto the calendar can record
        # what it is a scheduled occurrence *of*. Without that, the link is silently dropped
        # and the row comes back as an untitled work-tracking block belonging to nothing.
        read_only_fields = [
            "id", "owner", "google_event_id", "attended",
            "agentpm_airtable_id", "reminder", "project", "project_name",
            "created_at", "updated_at",
        ]


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
    # Other people to notify besides the creator (see `reminder_recipients` for every rule).
    recipients = serializers.PrimaryKeyRelatedField(
        many=True, queryset=User.objects.filter(is_active=True), required=False,
    )
    recipient_details = serializers.SerializerMethodField()
    # Every time the reminder is on the calendar (each a 15-minute block), earliest first.
    occurrences = serializers.SerializerMethodField()
    # Write-only approval: must be true whenever someone is being *added* as a recipient.
    confirm_notify_others = serializers.BooleanField(write_only=True, required=False, default=False)

    def get_occurrences(self, obj):
        return [
            {"id": o.pk, "start": o.start_datetime, "end": o.end_datetime}
            for o in reminder_calendar.occurrences(obj)
        ]

    def get_recipient_details(self, obj):
        return [
            {"id": u.pk, "name": reminder_recipients.display_name(u)}
            for u in obj.recipients.select_related("profile").all()
        ]

    def validate(self, attrs):
        confirmed = attrs.pop("confirm_notify_others", False)
        request = self.context.get("request")
        user = getattr(request, "user", None)
        instance = self.instance

        # ── Links. `links` is the list; resource_type/id/label mirror the primary one. ──
        if "links" in attrs:
            clean = reminder_links.normalize_links(user, attrs["links"])
            attrs["links"] = clean
            primary = reminder_links.primary(clean)
            attrs["resource_type"] = primary["resource_type"] if primary else "general"
            attrs["resource_id"] = primary["resource_id"] if primary else None
            attrs["resource_label"] = primary["resource_label"] if primary else ""
        elif any(k in attrs for k in ("resource_type", "resource_id", "resource_label")):
            # A caller that still sends the single link (the calendar sidebar, the agent):
            # keep `links` in step with it.
            rtype = attrs.get("resource_type", getattr(instance, "resource_type", "general"))
            rid = attrs.get("resource_id", getattr(instance, "resource_id", None))
            label = attrs.get("resource_label", getattr(instance, "resource_label", ""))
            attrs["links"] = (
                [{"resource_type": rtype, "resource_id": rid, "resource_label": label}]
                if rtype not in ("", "general") and rid else []
            )

        effective = attrs["links"] if "links" in attrs else (reminder_links.all_links(instance) if instance else [])
        # Teammates come from the accounts the links lead to — an account link, or the account
        # an action item or meeting is filed under — that the creator is on.
        pool, _sources = reminder_recipients.pool(user, effective) if user is not None else ([], [])
        eligible = {c.user_id: c for c in pool if c.user_id is not None}

        if "recipients" not in attrs:
            # Re-linking the reminder can take someone out of reach (the account they were
            # chosen from is no longer linked). Keep whoever is still on a linked account; drop
            # the rest rather than leave a person notified through a link that no longer exists.
            if instance is not None and instance.recipients.exists() and "links" in attrs:
                attrs["recipients"] = [u for u in instance.recipients.all() if u.pk in eligible]
            return attrs

        others = [u for u in attrs["recipients"] if getattr(user, "pk", None) != u.pk]
        attrs["recipients"] = others  # the creator is always notified; never listed twice
        if not others:
            return attrs

        existing = set(instance.recipients.values_list("pk", flat=True)) if instance is not None else set()
        added = [u for u in others if u.pk not in existing]
        if not added:
            return attrs

        for u in added:
            cand = eligible.get(u.pk)
            if cand is None:
                raise serializers.ValidationError(
                    {"recipients": "You can notify your manager, and people on the team of an account this reminder "
                                   "is linked to (or your colleagues, for a reminder about your Admin workspace)."}
                )
            if not cand.available:
                raise serializers.ValidationError({"recipients": cand.reason})
        if not confirmed:
            raise serializers.ValidationError({
                "confirm_notify_others":
                    "Confirm that you want to notify these users before adding them.",
            })
        return attrs

    def create(self, validated_data):
        # Channels the caller did not name come from the creator's own Settings defaults.
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if user is not None and getattr(user, "is_authenticated", False):
            flags = reminder_recipients.channels_from_request(user, self.initial_data)
            for name, value in flags.items():
                if name not in self.initial_data:
                    validated_data[name] = value
        return super().create(validated_data)

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
            "links",
            "due_at",
            "notify_in_app",
            "notify_slack",
            "notify_push",
            "notify_sms",
            "recipients",
            "recipient_details",
            "occurrences",
            "confirm_notify_others",
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
