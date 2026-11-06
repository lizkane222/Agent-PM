"""DRF serializers for the accounts app."""

from rest_framework import serializers

from comments.serializers import _user_display_name

from .artifact_images import delete_image_file, image_upload_error
from .models import Account, AccountArtifact, AccountNote, AccountProject, AccountQuickLink, AccountRole, CustomerContact, CustomerContactNote, ProjectMember


class AccountArtifactSerializer(serializers.ModelSerializer):
    uploaded_by_username = serializers.SerializerMethodField()
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
            "uploaded_by", "uploaded_by_username",
            "created_at", "updated_at",
        ]
        # mime_type and file_size are server-derived from the uploaded file; a
        # client-supplied value could misrepresent the artifact in the UI or
        # bypass storage quotas.
        read_only_fields = [
            "id", "uploaded_by", "uploaded_by_username", "file_url", "used_in",
            "mime_type", "file_size",
            "created_at", "updated_at",
        ]

    def get_uploaded_by_username(self, obj):
        if obj.uploaded_by:
            return _user_display_name(obj.uploaded_by)
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
            "airtable_id", "notes_count", "notes", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "airtable_id", "notes_count", "notes", "created_at", "updated_at"]


class AccountProjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = AccountProject
        fields = [
            "id", "account", "name", "description", "position",
            "url", "action_ids", "meeting_ids", "goal_ids", "resources",
            "sf_data", "sf_project_id", "kind", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


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
