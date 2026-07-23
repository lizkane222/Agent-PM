"""DRF serializers for the skills app."""

from rest_framework import serializers

from .models import AgentSkill, ClaudeSkill, SkillInvocation


class SkillInvocationSerializer(serializers.ModelSerializer):
    skill_name = serializers.CharField(source="skill.name", read_only=True)

    class Meta:
        model = SkillInvocation
        fields = [
            "id", "skill", "skill_name", "session_id", "invoked_by",
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


class AgentSkillSerializer(serializers.ModelSerializer):
    created_by_username = serializers.SerializerMethodField(read_only=True)
    pinned_by_me        = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = AgentSkill
        fields = [
            "id", "name", "description", "instructions", "allowed_tools",
            "scripts", "references", "status", "visibility",
            "review_verdict", "review_findings", "reviewed_at",
            "pinned_to_roles", "pinned_by_me",
            "version", "created_by_username", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "status", "review_verdict", "review_findings", "reviewed_at",
            "pinned_by_me", "version", "created_by_username", "created_at", "updated_at",
        ]

    def get_created_by_username(self, obj):
        return obj.created_by.username if obj.created_by else None

    def get_pinned_by_me(self, obj):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.pinned_to_users.filter(pk=request.user.pk).exists()
        return False
