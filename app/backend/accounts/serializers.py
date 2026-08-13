"""DRF serializers for the accounts app."""

from rest_framework import serializers

from .models import Account, AccountArtifact, AccountNote, AccountProject, AccountQuickLink, AccountRole, CustomerContact, CustomerContactNote


class AccountArtifactSerializer(serializers.ModelSerializer):
    uploaded_by_username = serializers.SerializerMethodField()
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = AccountArtifact
        fields = [
            "id", "account", "artifact_type", "name", "url", "secondary_url", "icon_key",
            "file_url", "mime_type", "file_size",
            "uploaded_by", "uploaded_by_username",
            "created_at", "updated_at",
        ]
        # mime_type and file_size are server-derived from the uploaded file; a
        # client-supplied value could misrepresent the artifact in the UI or
        # bypass storage quotas.
        read_only_fields = [
            "id", "uploaded_by", "uploaded_by_username", "file_url",
            "mime_type", "file_size",
            "created_at", "updated_at",
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


class AccountNoteSerializer(serializers.ModelSerializer):
    author_username = serializers.CharField(source="author.username", read_only=True, allow_null=True)
    author_display = serializers.CharField(
        source="author.profile.display_name", read_only=True, default=""
    )

    class Meta:
        model = AccountNote
        fields = ["id", "account", "author", "author_username", "author_display", "content", "created_at", "updated_at"]
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
            "id", "account", "name", "role", "description", "email",
            "airtable_id", "notes_count", "notes", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "airtable_id", "notes_count", "notes", "created_at", "updated_at"]


class AccountProjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = AccountProject
        fields = [
            "id", "account", "name", "description", "position",
            "url", "action_ids", "meeting_ids", "goal_ids", "resources",
            "sf_data", "kind", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class AccountRoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = AccountRole
        fields = ["id", "user", "account", "role", "assigned_by", "created_at"]
        read_only_fields = ["id", "assigned_by", "created_at"]
