from rest_framework import serializers

from .models import SyncDeleteRequest, SyncReviewItem


class SyncReviewItemSerializer(serializers.ModelSerializer):
    suggested_account_name = serializers.CharField(
        source="suggested_account.company_name", read_only=True, allow_null=True
    )
    reviewed_by_email = serializers.CharField(source="reviewed_by.email", read_only=True, allow_null=True)

    class Meta:
        model = SyncReviewItem
        fields = [
            "id", "source", "source_id", "source_url", "content_type", "raw_content",
            "status", "suggested_account", "suggested_account_name",
            "confidence_score", "claude_analysis", "is_sensitive",
            "reviewed_by", "reviewed_by_email", "reviewed_at",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "source", "source_id", "source_url", "content_type", "raw_content",
            "confidence_score", "claude_analysis", "is_sensitive",
            "reviewed_by", "reviewed_by_email", "reviewed_at",
            "created_at", "updated_at",
        ]


class SyncDeleteRequestSerializer(serializers.ModelSerializer):
    requested_by_email = serializers.CharField(source="requested_by.email", read_only=True)
    reviewed_by_email = serializers.CharField(source="reviewed_by.email", read_only=True, allow_null=True)
    account_name = serializers.CharField(source="account.company_name", read_only=True)

    class Meta:
        model = SyncDeleteRequest
        fields = [
            "id", "review_item", "account", "account_name",
            "requested_by", "requested_by_email",
            "status", "reviewed_by", "reviewed_by_email",
            "reason", "claude_mismatch_analysis",
            "created_at", "resolved_at",
        ]
        read_only_fields = [
            "id", "requested_by", "requested_by_email",
            "reviewed_by", "reviewed_by_email",
            "claude_mismatch_analysis", "created_at", "resolved_at",
        ]
