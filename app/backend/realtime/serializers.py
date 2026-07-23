"""DRF serializers for the realtime app."""

from rest_framework import serializers

from .models import AgentActivityEvent, VoiceSession


class VoiceSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = VoiceSession
        fields = [
            "id",
            "call_sid",
            "from_number",
            "to_number",
            "status",
            "duration_seconds",
            "recording_url",
            "transcript",
            "started_at",
            "ended_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class AgentActivityEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = AgentActivityEvent
        fields = [
            "id",
            "event_type",
            "title",
            "detail",
            "metadata",
            "sync_document_id",
            "client_id",
            "client_ts",
            "created_at",
        ]
        read_only_fields = ["id", "sync_document_id", "created_at"]


class SyncTokenSerializer(serializers.Serializer):
    """Response payload for the Twilio Sync token endpoint."""

    token = serializers.CharField()
    identity = serializers.CharField()
    sync_service_sid = serializers.CharField()
