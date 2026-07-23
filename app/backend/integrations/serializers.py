"""DRF serializers for the integrations app."""

from rest_framework import serializers

from .models import OAuthCredential, SyncState, WebhookLog


class OAuthCredentialSerializer(serializers.ModelSerializer):
    provider_display = serializers.CharField(source="get_provider_display", read_only=True)

    class Meta:
        model = OAuthCredential
        fields = [
            "id",
            "provider",
            "provider_display",
            "scopes",
            "is_active",
            "token_expiry",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class SyncStateSerializer(serializers.ModelSerializer):
    class Meta:
        model = SyncState
        fields = [
            "id",
            "provider",
            "resource",
            "last_synced_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class WebhookLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = WebhookLog
        fields = [
            "id",
            "source",
            "event_type",
            "payload",
            "processed",
            "error_message",
            "created_at",
        ]
        read_only_fields = fields


class GoogleOAuthCallbackSerializer(serializers.Serializer):
    code = serializers.CharField()
    state = serializers.CharField(required=False, allow_blank=True)
