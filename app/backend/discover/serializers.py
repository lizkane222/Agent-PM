from rest_framework import serializers
from .models import Applet, AppletPin

MAX_TAG_LENGTH = 30
MAX_TAGS = 10


def normalise_tags(raw) -> list[str]:
    """Trim, drop blanks, de-dup case-insensitively (first spelling wins)."""
    seen: set[str] = set()
    out: list[str] = []
    for t in raw:
        if not isinstance(t, str):
            raise serializers.ValidationError("Tags must be text.")
        t = " ".join(t.split())
        if not t:
            continue
        if len(t) > MAX_TAG_LENGTH:
            raise serializers.ValidationError(f"A tag can be at most {MAX_TAG_LENGTH} characters.")
        if t.lower() in seen:
            continue
        seen.add(t.lower())
        out.append(t)
    if len(out) > MAX_TAGS:
        raise serializers.ValidationError(f"At most {MAX_TAGS} tags per item.")
    return out


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

    def validate_tags(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("Tags must be a list.")
        return normalise_tags(value)

    def validate_url(self, value):
        if not value.lower().startswith(("http://", "https://")):
            raise serializers.ValidationError("Only http(s) links are allowed.")
        return value


class PinnedAppletSerializer(serializers.ModelSerializer):
    class Meta:
        model = Applet
        fields = ["id", "type", "name", "description", "url", "category"]


class AppletPinSerializer(serializers.ModelSerializer):
    applet = PinnedAppletSerializer(read_only=True)
    account_name = serializers.SerializerMethodField()
    pinned_by_username = serializers.CharField(source="user.username", read_only=True)
    can_remove = serializers.SerializerMethodField()

    class Meta:
        model = AppletPin
        fields = [
            "id", "applet", "account", "account_name",
            "pinned_by_username", "can_remove", "created_at",
        ]

    def get_account_name(self, obj):
        return obj.account.company_name if obj.account_id else None

    def get_can_remove(self, obj):
        from core.mixins import is_admin
        user = self.context["request"].user
        return obj.user_id == user.pk or is_admin(user)
