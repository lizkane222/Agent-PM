from rest_framework import serializers

from .models import AIRTABLE_FIELD_TYPES, AccountFeedConfig, AccountFeedCustomField


class AccountFeedCustomFieldSerializer(serializers.ModelSerializer):
    class Meta:
        model = AccountFeedCustomField
        fields = ["id", "name", "value", "airtable_field_type", "airtable_field_id", "created_by", "created_at"]
        read_only_fields = ["id", "airtable_field_id", "created_by", "created_at"]


class AccountFeedConfigSerializer(serializers.ModelSerializer):
    custom_fields = AccountFeedCustomFieldSerializer(many=True, read_only=True)
    airtable_field_type_choices = serializers.SerializerMethodField()

    class Meta:
        model = AccountFeedConfig
        fields = [
            "id", "account",
            "drive_folders", "name_aliases", "email_domains",
            "confluence_spaces", "jira_projects", "zendesk_groups",
            "custom_fields", "airtable_field_type_choices",
            "updated_at", "updated_by",
        ]
        read_only_fields = ["id", "account", "updated_at", "updated_by", "custom_fields", "airtable_field_type_choices"]

    def get_airtable_field_type_choices(self, obj):
        return [{"value": v, "label": l} for v, l in AIRTABLE_FIELD_TYPES]
