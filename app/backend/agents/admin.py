"""Django Admin registration for the agents app."""

from django.contrib import admin

from .models import AgentMessage, AgentSession, ToolCall


class AgentMessageInline(admin.TabularInline):
    model = AgentMessage
    extra = 0
    readonly_fields = ["role", "content", "input_tokens", "output_tokens", "created_at"]
    can_delete = False


class ToolCallInline(admin.TabularInline):
    model = ToolCall
    extra = 0
    readonly_fields = ["tool_name", "arguments", "result", "status", "duration_ms", "created_at"]
    can_delete = False


@admin.register(AgentSession)
class AgentSessionAdmin(admin.ModelAdmin):
    list_display = ["id", "user", "title", "status", "started_at", "ended_at"]
    list_filter = ["status"]
    search_fields = ["user__username", "title"]
    readonly_fields = ["started_at", "created_at", "updated_at"]
    inlines = [AgentMessageInline]


@admin.register(AgentMessage)
class AgentMessageAdmin(admin.ModelAdmin):
    list_display = ["id", "session", "role", "input_tokens", "output_tokens", "created_at"]
    list_filter = ["role"]
    search_fields = ["content"]
    readonly_fields = ["created_at", "updated_at"]
    inlines = [ToolCallInline]


@admin.register(ToolCall)
class ToolCallAdmin(admin.ModelAdmin):
    list_display = ["id", "tool_name", "status", "duration_ms", "created_at"]
    list_filter = ["tool_name", "status"]
    search_fields = ["tool_name"]
    readonly_fields = ["created_at", "updated_at"]
