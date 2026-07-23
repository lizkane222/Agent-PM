"""Django Admin registration for the realtime app."""

from django.contrib import admin

from .models import AgentActivityEvent, VoiceSession


@admin.register(VoiceSession)
class VoiceSessionAdmin(admin.ModelAdmin):
    list_display = [
        "id", "call_sid", "user", "from_number", "to_number",
        "status", "duration_seconds", "created_at",
    ]
    list_filter = ["status"]
    search_fields = ["call_sid", "from_number", "to_number", "user__username"]
    readonly_fields = ["created_at", "updated_at"]


@admin.register(AgentActivityEvent)
class AgentActivityEventAdmin(admin.ModelAdmin):
    list_display = ["id", "user", "event_type", "title", "created_at"]
    list_filter = ["event_type"]
    search_fields = ["title", "detail", "user__username"]
    readonly_fields = ["created_at", "updated_at"]
