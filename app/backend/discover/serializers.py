from rest_framework import serializers
from .models import Applet

class AppletSerializer(serializers.ModelSerializer):
    submitted_by_username = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Applet
        fields = [
            "id", "type", "name", "description", "url", "category",
            "author", "tags", "airtable_id",
            "submitted_by_username", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "airtable_id", "submitted_by_username", "created_at", "updated_at"]

    def get_submitted_by_username(self, obj):
        return obj.submitted_by.username if obj.submitted_by else None
