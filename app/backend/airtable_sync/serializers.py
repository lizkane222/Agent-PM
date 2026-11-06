from rest_framework import serializers
from .models import AirtableAccount, AirtableMeeting, AirtableActionItem, ActionItemAttachment, ActionItemDependency, ActionItemStep, CalendarEventAccountLink


class AirtableAccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = AirtableAccount
        fields = "__all__"


class AirtableMeetingSerializer(serializers.ModelSerializer):
    account_name = serializers.CharField(source="account.name", read_only=True)

    class Meta:
        model = AirtableMeeting
        fields = "__all__"


class ActionItemAttachmentSerializer(serializers.ModelSerializer):
    uploaded_by_username = serializers.SerializerMethodField()
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = ActionItemAttachment
        fields = [
            "id", "action_item", "artifact_type", "name", "url",
            "file_url", "mime_type", "file_size",
            "uploaded_by", "uploaded_by_username", "source_artifact",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "action_item", "uploaded_by", "uploaded_by_username", "file_url",
            "source_artifact", "created_at", "updated_at",
        ]

    def get_uploaded_by_username(self, obj):
        if obj.uploaded_by:
            return getattr(obj.uploaded_by, "get_full_name", lambda: None)() or obj.uploaded_by.username
        return None

    def get_file_url(self, obj):
        if obj.file:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(obj.file.url)
            return obj.file.url
        return obj.url or None


class ActionItemStepSerializer(serializers.ModelSerializer):
    """A checklist step. Local-only — never written back to Airtable."""

    class Meta:
        model = ActionItemStep
        fields = ["id", "action_item", "title", "status", "order", "created_at"]
        read_only_fields = ["id", "created_at"]


class WaitingOnItemSerializer(serializers.ModelSerializer):
    """Minimal summary of a dependency item — enough for the frontend pill."""
    class Meta:
        model = AirtableActionItem
        fields = ["id", "airtable_id", "task", "status"]


class AirtableActionItemSerializer(serializers.ModelSerializer):
    account_name = serializers.CharField(source="account.name", read_only=True)
    # airtable_id is assigned server-side on create; callers don't need to provide it
    airtable_id = serializers.CharField(required=False, allow_blank=True, default="")
    # Reminder shortcut fields — read-only computed from the linked Reminder object
    reminder_id = serializers.IntegerField(source="reminder.id", read_only=True, allow_null=True)
    reminder_due_at = serializers.DateTimeField(source="reminder.due_at", read_only=True, allow_null=True)
    reminder_status = serializers.CharField(source="reminder.status", read_only=True, allow_null=True)
    attachments = ActionItemAttachmentSerializer(many=True, read_only=True)
    # Items this action item is waiting on before it can proceed
    waiting_on = serializers.SerializerMethodField()
    linked_meeting_name = serializers.CharField(source="linked_meeting.name", read_only=True, allow_null=True)

    class Meta:
        model = AirtableActionItem
        fields = "__all__"

    def get_waiting_on(self, obj):
        deps = obj.waiting_on_deps.select_related("waiting_on_item").all()
        return WaitingOnItemSerializer([d.waiting_on_item for d in deps], many=True).data

    def _caller(self):
        request = self.context.get("request") if hasattr(self, "context") else None
        return getattr(request, "user", None)

    def validate(self, attrs):
        """Assignee rule (airtable_sync/assignment.py), checked against the item's account —
        the incoming one if this write also moves it, else the existing one."""
        attrs = super().validate(attrs)
        if "assignee_airtable_id" in attrs:
            user = self._caller()
            if user is not None and getattr(user, "is_authenticated", False):
                from .assignment import ASSIGN_DENIED, can_assign
                account = attrs["account"] if "account" in attrs else getattr(self.instance, "account", None)
                if not can_assign(user, account, attrs["assignee_airtable_id"]):
                    raise serializers.ValidationError({"assignee_airtable_id": ASSIGN_DENIED})
        return attrs

    def validate_linked_meeting(self, value):
        """Only allow linking to meetings on an account the caller belongs to."""
        if value is None:
            return value
        user = self._caller()
        if user is None or not getattr(user, "is_authenticated", False):
            return value
        if getattr(user, "is_staff", False):
            return value
        acct = getattr(value, "account", None)
        if acct is None:
            # Meetings without an account link are stubs — allow (no cross-team leak risk)
            return value
        from accounts.models import Account
        allowed = Account.objects.filter(
            airtable_id=acct.airtable_id, team_members__user=user
        ).exists() or Account.objects.filter(
            airtable_id=acct.airtable_id, admin_owner=user
        ).exists()
        if not allowed:
            raise serializers.ValidationError(
                "You can only link this action item to meetings on your own accounts."
            )
        return value


class CalendarEventMatchSerializer(serializers.Serializer):
    event_uid = serializers.CharField()
    title = serializers.CharField()
    description = serializers.CharField(allow_blank=True, default="")
    attendee_emails = serializers.ListField(child=serializers.EmailField(), default=list)


class ManualCategorizationSerializer(serializers.Serializer):
    event_uid = serializers.CharField()
    account_id = serializers.IntegerField(allow_null=True, required=False)
    account_name = serializers.CharField(allow_blank=True, required=False, default="")
    categorization = serializers.CharField(allow_blank=True, default="")


class EventContextSerializer(serializers.Serializer):
    """Full context returned when an event is matched."""
    match_method = serializers.CharField()
    categorization = serializers.CharField()
    account = AirtableAccountSerializer(allow_null=True)
    action_items = AirtableActionItemSerializer(many=True)
    meetings = AirtableMeetingSerializer(many=True)
    needs_categorization = serializers.BooleanField()
