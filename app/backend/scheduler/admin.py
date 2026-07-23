"""Django Admin registration for the scheduler app."""

from django.contrib import admin

from .models import ActionItem, CalendarEvent, Task


@admin.register(CalendarEvent)
class CalendarEventAdmin(admin.ModelAdmin):
    list_display = [
        "id", "title", "owner", "start_datetime", "end_datetime", "status", "is_synced"
    ]
    list_filter = ["status", "all_day", "is_synced"]
    search_fields = ["title", "description", "google_event_id", "owner__username"]
    readonly_fields = ["created_at", "updated_at"]
    date_hierarchy = "start_datetime"


@admin.register(ActionItem)
class ActionItemAdmin(admin.ModelAdmin):
    list_display = ["id", "title", "assigned_to", "priority", "status", "due_date", "created_at"]
    list_filter = ["priority", "status"]
    search_fields = ["title", "notes", "assigned_to__username"]
    readonly_fields = ["created_at", "updated_at"]
    date_hierarchy = "due_date"


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ["id", "title", "assigned_to", "priority", "status", "due_date", "created_at"]
    list_filter = ["priority", "status"]
    search_fields = ["title", "description", "assigned_to__username"]
    readonly_fields = ["created_at", "updated_at"]
    date_hierarchy = "due_date"
