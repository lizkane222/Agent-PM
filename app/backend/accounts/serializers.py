"""DRF serializers for the accounts app."""

import zoneinfo

from rest_framework import serializers

from comments.serializers import _user_display_name

from .artifact_images import delete_image_file, image_upload_error
from .models import Account, AccountArtifact, AccountNote, AccountProject, AccountQuickLink, AccountRole, AccountTicket, CustomerContact, CustomerContactNote, ProjectMember


class AccountArtifactSerializer(serializers.ModelSerializer):
    uploaded_by_username = serializers.SerializerMethodField()
    updated_by_username = serializers.SerializerMethodField()
    file_url = serializers.SerializerMethodField()
    used_in = serializers.SerializerMethodField()
    image_url = serializers.SerializerMethodField()
    # Write-only: the stored image is read back through `image_url`.
    custom_image = serializers.FileField(write_only=True, required=False, allow_null=True)
    remove_image = serializers.BooleanField(write_only=True, required=False, default=False)

    class Meta:
        model = AccountArtifact
        fields = [
            "id", "account", "artifact_type", "name", "url", "secondary_url", "icon_key",
            "file_url", "image_url", "custom_image", "remove_image",
            "mime_type", "file_size", "description", "references", "used_in",
            "uploaded_by", "uploaded_by_username", "updated_by", "updated_by_username",
            "created_at", "updated_at",
        ]
        # mime_type and file_size are server-derived from the uploaded file; a
        # client-supplied value could misrepresent the artifact in the UI or
        # bypass storage quotas.
        read_only_fields = [
            "id", "uploaded_by", "uploaded_by_username", "updated_by", "updated_by_username",
            "file_url", "used_in",
            "mime_type", "file_size",
            "created_at", "updated_at",
        ]

    def get_uploaded_by_username(self, obj):
        if obj.uploaded_by:
            return _user_display_name(obj.uploaded_by)
        return None

    def get_updated_by_username(self, obj):
        if obj.updated_by:
            return _user_display_name(obj.updated_by)
        return None

    def get_used_in(self, obj):
        return self.context.get("used_in_map", {}).get(obj.id, [])

    def get_image_url(self, obj):
        if not obj.custom_image:
            return None
        request = self.context.get("request")
        return request.build_absolute_uri(obj.custom_image.url) if request else obj.custom_image.url

    def validate_custom_image(self, value):
        if value is not None:
            error = image_upload_error(value)
            if error:
                raise serializers.ValidationError(error)
        return value

    def create(self, validated_data):
        validated_data.pop("remove_image", None)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        remove = validated_data.pop("remove_image", False)
        replacing = validated_data.get("custom_image") is not None
        if remove or replacing or ("custom_image" in validated_data and validated_data["custom_image"] is None):
            delete_image_file(instance)
            if not replacing:
                validated_data.pop("custom_image", None)
        return super().update(instance, validated_data)

    def get_file_url(self, obj):
        if obj.file:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(obj.file.url)
            return obj.file.url
        return obj.url or None


class AccountNoteSerializer(serializers.ModelSerializer):
    author_username = serializers.CharField(source="author.username", read_only=True, allow_null=True)
    author_display = serializers.CharField(
        source="author.profile.display_name", read_only=True, default=""
    )

    class Meta:
        model = AccountNote
        fields = ["id", "account", "author", "author_username", "author_display", "content", "references", "created_at", "updated_at"]
        read_only_fields = ["id", "account", "author", "author_username", "author_display", "created_at", "updated_at"]


class AccountQuickLinkSerializer(serializers.ModelSerializer):
    class Meta:
        model = AccountQuickLink
        fields = ["id", "account", "name", "url", "position", "created_by", "created_at", "updated_at"]
        read_only_fields = ["id", "account", "created_by", "created_at", "updated_at"]


class TeamMemberSummarySerializer(serializers.Serializer):
    id = serializers.IntegerField()
    full_name = serializers.CharField()
    title = serializers.CharField(allow_blank=True)
    email = serializers.EmailField()
    additional_emails = serializers.ListField(child=serializers.EmailField(), default=list)
    avatar_url = serializers.URLField(allow_blank=True)
    slack_handle = serializers.CharField(allow_blank=True)


class AccountSerializer(serializers.ModelSerializer):
    owner_username = serializers.CharField(source="owner.username", read_only=True, allow_null=True)
    primary_contact_name = serializers.CharField(
        source="primary_contact.full_name", read_only=True, allow_null=True
    )
    notes_count = serializers.IntegerField(source="notes.count", read_only=True)
    team_members = TeamMemberSummarySerializer(many=True, read_only=True)
    team_member_ids = serializers.PrimaryKeyRelatedField(
        many=True, write_only=True, source="team_members",
        queryset=__import__("team.models", fromlist=["TeamMember"]).TeamMember.objects.all(),
        required=False,
    )

    def validate_slack_channels(self, value):
        from .slack_channels import clean_slack_channels

        return clean_slack_channels(value)

    def validate_primary_contact_text(self, value):
        return (value or "").strip()

    class Meta:
        model = Account
        fields = [
            "id",
            "company_name",
            "airtable_id",
            "website",
            "industry",
            "status",
            "arr",
            "slack_channels",
            "owner",
            "owner_username",
            "primary_contact",
            "primary_contact_name",
            "primary_contact_text",
            "team_members",
            "team_member_ids",
            "notes_count",
            "created_by",
            "is_admin_account",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "airtable_id", "created_by", "notes_count", "is_admin_account", "created_at", "updated_at"]


class CustomerContactNoteSerializer(serializers.ModelSerializer):
    author_display = serializers.CharField(
        source="author.profile.display_name", read_only=True, default=""
    )

    class Meta:
        model = CustomerContactNote
        fields = ["id", "contact", "author", "author_display", "content", "created_at", "updated_at"]
        read_only_fields = ["id", "contact", "author", "author_display", "created_at", "updated_at"]


class CustomerContactSerializer(serializers.ModelSerializer):
    notes = CustomerContactNoteSerializer(many=True, read_only=True)
    notes_count = serializers.IntegerField(source="notes.count", read_only=True)

    class Meta:
        model = CustomerContact
        fields = [
            "id", "account", "name", "role", "description", "email", "team", "is_main_poc",
            "timezone", "airtable_id", "notes_count", "notes", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "airtable_id", "notes_count", "notes", "created_at", "updated_at"]

    def validate_timezone(self, value):
        value = (value or "").strip()
        if value and value not in zoneinfo.available_timezones():
            raise serializers.ValidationError("Enter a valid IANA time zone, e.g. America/Chicago.")
        return value


class AccountProjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = AccountProject
        fields = [
            "id", "account", "name", "description", "position",
            "url", "action_ids", "meeting_ids", "goal_ids", "resources", "note_refs",
            "sf_data", "sf_project_id", "kind", "created_at",
        ]
        read_only_fields = ["id", "created_at"]

    NOTE_REF_KINDS = ("account_note", "meeting_note", "summary")
    NOTE_REF_MAX = 200

    def validate_note_refs(self, value):
        """References to notes (never copies): a bounded list of well-shaped dicts."""
        if not isinstance(value, list):
            raise serializers.ValidationError("note_refs must be a list.")
        if len(value) > self.NOTE_REF_MAX:
            raise serializers.ValidationError(f"At most {self.NOTE_REF_MAX} linked notes per project.")
        clean, seen = [], set()
        account_id = self.initial_data.get("account") if hasattr(self, "initial_data") else None
        if account_id is None and self.instance is not None:
            account_id = self.instance.account_id
        for ref in value:
            if not isinstance(ref, dict):
                raise serializers.ValidationError("Each linked note must be an object.")
            kind = ref.get("kind")
            if kind not in self.NOTE_REF_KINDS:
                raise serializers.ValidationError("Unknown linked note kind.")
            rid = ref.get("id")
            if isinstance(rid, bool) or not isinstance(rid, (str, int)) or not str(rid).strip():
                raise serializers.ValidationError("A linked note needs an id.")
            rid = str(rid)
            if len(rid) > 200:
                raise serializers.ValidationError("Linked note id is too long.")
            label = ref.get("label", "")
            if not isinstance(label, str) or len(label) > 300:
                raise serializers.ValidationError("Linked note label must be text up to 300 characters.")
            meeting_id = ref.get("meetingId", "")
            if isinstance(meeting_id, int) and not isinstance(meeting_id, bool):
                meeting_id = str(meeting_id)
            if not isinstance(meeting_id, str) or len(meeting_id) > 200:
                raise serializers.ValidationError("Linked note meetingId must be text up to 200 characters.")
            if kind == "account_note":
                from .models import AccountNote
                if not rid.isdigit() or not AccountNote.objects.filter(pk=int(rid), account_id=account_id).exists():
                    raise serializers.ValidationError("That note does not belong to this account.")
            key = (kind, rid)
            if key in seen:
                continue
            seen.add(key)
            item = {"kind": kind, "id": rid, "label": label}
            if meeting_id:
                item["meetingId"] = meeting_id
            clean.append(item)
        return clean


class ProjectMemberSerializer(serializers.ModelSerializer):
    team_member_name = serializers.CharField(source="team_member.full_name", read_only=True)
    team_member_email = serializers.CharField(source="team_member.email", read_only=True)
    team_member_avatar_url = serializers.CharField(source="team_member.avatar_url", read_only=True)

    class Meta:
        model = ProjectMember
        fields = [
            "id", "project", "team_member", "team_member_name", "team_member_email",
            "team_member_avatar_url", "role", "added_by", "created_at",
        ]
        read_only_fields = ["id", "added_by", "created_at"]


class AccountRoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = AccountRole
        fields = ["id", "user", "account", "role", "assigned_by", "created_at"]
        read_only_fields = ["id", "assigned_by", "created_at"]


class AccountTicketSerializer(serializers.ModelSerializer):
    account_name = serializers.CharField(source="account.company_name", read_only=True, default=None)
    created_by_username = serializers.CharField(source="created_by.username", read_only=True, default=None)
    found_by_username = serializers.CharField(source="found_by.username", read_only=True, default=None)

    class Meta:
        model = AccountTicket
        fields = [
            "id", "account", "account_name", "kind", "url", "external_key", "title", "status", "notes",
            "source_created_at", "source_updated_at", "resolved_at", "created_at", "updated_at",
            "created_by", "created_by_username", "review_state", "found_by", "found_by_username",
            "source_message_id", "source_subject", "source_sender", "source_snippet",
        ]
        read_only_fields = [
            "id", "account_name", "created_at", "updated_at", "created_by", "created_by_username",
            "review_state", "found_by", "found_by_username", "source_message_id",
            "source_subject", "source_sender", "source_snippet",
        ]
        extra_kwargs = {"kind": {"required": False}}

    def validate_url(self, value):
        from .ticket_links import is_http_url
        if value and not is_http_url(value):
            raise serializers.ValidationError("Only http(s) links are allowed.")
        return value

    def validate_notes(self, value):
        from core.html_sanitize import sanitize_html
        return sanitize_html(value or "")

    def validate(self, attrs):
        from .ticket_links import parse_ticket_url
        inst = self.instance
        url = attrs.get("url", inst.url if inst else "")
        parsed = parse_ticket_url(url) if url else {"kind": "", "external_key": ""}
        if not attrs.get("kind") and not inst:
            if not parsed["kind"]:
                raise serializers.ValidationError({"kind": "kind is required unless the link is a recognised JIRA or Zendesk URL."})
            attrs["kind"] = parsed["kind"]
        if "url" in attrs and url and not attrs.get("external_key") and not (inst and inst.external_key and "url" not in attrs):
            if parsed["external_key"] and not (inst and inst.external_key and attrs.get("url") == inst.url):
                attrs["external_key"] = parsed["external_key"]
        return attrs
