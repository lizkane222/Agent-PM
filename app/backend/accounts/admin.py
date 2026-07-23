from django.contrib import admin
from .models import Account, AccountArtifact, AccountNote, AccountQuickLink, CustomerContact, CustomerContactNote

@admin.register(Account)
class AccountAdmin(admin.ModelAdmin):
    list_display = ["company_name", "status", "industry", "arr", "owner"]
    list_filter = ["status", "industry"]
    search_fields = ["company_name", "website"]

@admin.register(AccountNote)
class AccountNoteAdmin(admin.ModelAdmin):
    list_display = ["account", "author", "created_at"]
    raw_id_fields = ["account", "author"]

@admin.register(AccountArtifact)
class AccountArtifactAdmin(admin.ModelAdmin):
    list_display = ["name", "account", "artifact_type", "mime_type", "uploaded_by", "created_at"]
    list_filter = ["artifact_type"]
    search_fields = ["name", "account__company_name"]
    raw_id_fields = ["account", "uploaded_by"]

@admin.register(AccountQuickLink)
class AccountQuickLinkAdmin(admin.ModelAdmin):
    list_display = ["name", "account", "url", "position", "created_by", "created_at"]
    search_fields = ["name", "account__company_name", "url"]
    raw_id_fields = ["account", "created_by"]

@admin.register(CustomerContact)
class CustomerContactAdmin(admin.ModelAdmin):
    list_display = ["name", "account", "role", "email", "created_at"]
    search_fields = ["name", "account__company_name", "email"]
    raw_id_fields = ["account"]

@admin.register(CustomerContactNote)
class CustomerContactNoteAdmin(admin.ModelAdmin):
    list_display = ["contact", "author", "created_at"]
    raw_id_fields = ["contact", "author"]
