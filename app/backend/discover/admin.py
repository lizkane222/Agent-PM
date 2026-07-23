from django.contrib import admin
from .models import Applet

@admin.register(Applet)
class AppletAdmin(admin.ModelAdmin):
    list_display = ["name", "type", "category", "author", "airtable_id", "created_at"]
    list_filter = ["type", "category"]
    search_fields = ["name", "author", "description"]
