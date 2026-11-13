"""DRF serializers for the agents app."""

from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import AgentMessage, AgentSession, ToolCall

User = get_user_model()


class ToolCallSerializer(serializers.ModelSerializer):
    class Meta:
        model = ToolCall
        fields = [
            "id",
            "tool_name",
            "arguments",
            "result",
            "status",
            "error_message",
            "duration_ms",
            "created_at",
        ]
        read_only_fields = fields


class AgentMessageSerializer(serializers.ModelSerializer):
    tool_calls = ToolCallSerializer(many=True, read_only=True)
    cost_usd = serializers.SerializerMethodField()

    def get_cost_usd(self, obj):
        """What this message's real usage cost at the current price (display only)."""
        if not (obj.input_tokens or obj.output_tokens):
            return "0.0000"
        from . import token_budget
        # One pricing lookup per serialisation pass, not one per message.
        cache = self.context.setdefault("_pricing_cache", {})
        if "p" not in cache:
            cache["p"] = token_budget.get_pricing()
        return str(token_budget.usage_usd(obj.input_tokens, obj.output_tokens, cache["p"]))

    class Meta:
        model = AgentMessage
        fields = [
            "id",
            "role",
            "content",
            "input_tokens",
            "output_tokens",
            "cost_usd",
            "tool_calls",
            "created_at",
        ]
        read_only_fields = fields


class ParticipantSerializer(serializers.ModelSerializer):
    display_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "email", "display_name"]
        read_only_fields = fields

    def get_display_name(self, obj):
        full = f"{obj.first_name} {obj.last_name}".strip()
        return full or obj.username


class AgentSessionSerializer(serializers.ModelSerializer):
    messages = AgentMessageSerializer(many=True, read_only=True)
    participants = ParticipantSerializer(many=True, read_only=True)
    owner_username = serializers.SerializerMethodField()

    class Meta:
        model = AgentSession
        fields = [
            "id",
            "title",
            "status",
            "is_shared",
            "owner_username",
            "participants",
            "started_at",
            "ended_at",
            "messages",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "is_shared", "owner_username", "participants", "started_at", "messages", "created_at", "updated_at"]

    def get_owner_username(self, obj):
        return obj.user.username


class AgentMessageInputSerializer(serializers.Serializer):
    """Input payload for sending a new message to the agent."""

    message = serializers.CharField(min_length=1, max_length=10_000)
    session_id = serializers.IntegerField(required=False, allow_null=True)
    # Set by the app when this message launches a saved skill (see skills.SkillRun). Optional;
    # an id that isn't the caller's, or is stale, is quietly ignored rather than rejected.
    skill_run_id = serializers.CharField(required=False, allow_null=True, allow_blank=True, max_length=64)


class ShareSessionSerializer(serializers.Serializer):
    """Input payload for sharing a session with other users."""

    user_ids = serializers.ListField(
        child=serializers.IntegerField(), min_length=1
    )
