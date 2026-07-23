"""Django Admin registration for the integrations app."""

from django.contrib import admin

from .models import OAuthCredential, SyncState, WebhookLog


@admin.register(OAuthCredential)
class OAuthCredentialAdmin(admin.ModelAdmin):
    list_display = ["id", "user", "provider", "is_active", "token_expiry", "updated_at"]
    list_filter = ["provider", "is_active"]
    search_fields = ["user__username"]
    readonly_fields = ["created_at", "updated_at"]
    # Never show raw token values in list view.
    exclude = ["access_token", "refresh_token"]


@admin.register(WebhookLog)
class WebhookLogAdmin(admin.ModelAdmin):
    list_display = ["id", "source", "event_type", "processed", "created_at"]
    list_filter = ["source", "processed"]
    search_fields = ["event_type"]
    readonly_fields = ["created_at", "updated_at"]


@admin.register(SyncState)
class SyncStateAdmin(admin.ModelAdmin):
    list_display = ["id", "user", "provider", "resource", "last_synced_at"]
    list_filter = ["provider"]
    search_fields = ["user__username", "resource"]
    readonly_fields = ["created_at", "updated_at"]
