"""DRF serializers for the skills app."""

from rest_framework import serializers

from .models import AgentSkill, AgentSkillAttachment, ClaudeSkill, SkillInvocation


class SkillInvocationSerializer(serializers.ModelSerializer):
    skill_name = serializers.CharField(source="skill.name", read_only=True)
    invoked_by_username = serializers.CharField(source="invoked_by.username", read_only=True, default=None)

    class Meta:
        model = SkillInvocation
        fields = [
            "id", "skill", "skill_name", "session_id", "invoked_by", "invoked_by_username",
            "arguments", "result", "status", "error", "duration_ms", "invoked_at",
        ]
        read_only_fields = fields


class ClaudeSkillSerializer(serializers.ModelSerializer):
    submitted_by_username = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = ClaudeSkill
        fields = [
            "id", "name", "description", "command", "roles", "code", "input_schema", "source_file",
            "status", "review_feedback", "review_suggestions", "reviewed_at",
            "invocation_count", "last_invoked_at",
            "submitted_by_username", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "status", "review_feedback", "review_suggestions", "reviewed_at",
            "invocation_count", "last_invoked_at",
            "submitted_by_username", "created_at", "updated_at",
        ]

    def get_submitted_by_username(self, obj):
        return obj.submitted_by.username if obj.submitted_by else None


class AgentSkillAttachmentSerializer(serializers.ModelSerializer):
    uploaded_by_username = serializers.CharField(source="uploaded_by.username", read_only=True, default=None)
    has_text = serializers.SerializerMethodField()
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = AgentSkillAttachment
        fields = ["id", "name", "url", "file_url", "mime_type", "file_size", "has_text",
                  "artifact", "uploaded_by_username", "created_at"]
        read_only_fields = fields

    def get_has_text(self, obj):
        return bool(obj.text)

    def get_file_url(self, obj):
        return obj.file.url if obj.file else ""


class AgentSkillSerializer(serializers.ModelSerializer):
    created_by_username = serializers.SerializerMethodField(read_only=True)
    attachments = AgentSkillAttachmentSerializer(many=True, read_only=True)
    pinned_by_me        = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = AgentSkill
        fields = [
            "id", "name", "description", "instructions", "allowed_tools",
            "scripts", "references", "status", "visibility",
            "twilio_skills", "chained_skills", "context_defaults", "templates", "attachments",
            "review_verdict", "review_findings", "reviewed_at",
            "pinned_to_roles", "pinned_by_me",
            "version", "created_by_username", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "status", "review_verdict", "review_findings", "reviewed_at", "attachments",
            "pinned_by_me", "version", "created_by_username", "created_at", "updated_at",
        ]

    def get_created_by_username(self, obj):
        return obj.created_by.username if obj.created_by else None

    def get_pinned_by_me(self, obj):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.pinned_to_users.filter(pk=request.user.pk).exists()
        return False


# ── Page pins & the skill-run Console ──────────────────────────────────────────────────

from .models import SkillPagePin, SkillRun, SkillRunEvent  # noqa: E402


class SkillRunEventSerializer(serializers.ModelSerializer):
    record = serializers.SerializerMethodField()

    class Meta:
        model = SkillRunEvent
        fields = ["id", "ts", "kind", "tool_name", "status", "error_code", "summary", "args", "duration_ms", "record"]
        read_only_fields = fields

    def get_record(self, obj):
        if not obj.record_type:
            return None
        return {"type": obj.record_type, "id": obj.record_id, "label": obj.record_label, "url": obj.record_url}


class SkillRunSerializer(serializers.ModelSerializer):
    user_username = serializers.CharField(source="user.username", read_only=True)

    class Meta:
        model = SkillRun
        fields = [
            "id", "skill", "skill_name", "surface", "page", "params", "status", "started_at", "finished_at",
            "tool_count", "records_created", "records_updated", "input_tokens", "output_tokens", "user_username",
        ]
        read_only_fields = fields


class SkillRunDetailSerializer(SkillRunSerializer):
    events = SkillRunEventSerializer(many=True, read_only=True)

    class Meta(SkillRunSerializer.Meta):
        fields = SkillRunSerializer.Meta.fields + ["events"]
        read_only_fields = fields
