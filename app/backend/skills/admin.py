from django.contrib import admin

from .models import AgentSkill, ClaudeSkill, SkillInvocation


@admin.register(ClaudeSkill)
class ClaudeSkillAdmin(admin.ModelAdmin):
    list_display  = ("name", "status", "invocation_count", "submitted_by", "created_at")
    list_filter   = ("status",)
    search_fields = ("name", "description", "code")
    readonly_fields = (
        "invocation_count", "last_invoked_at", "reviewed_at",
        "review_feedback", "review_suggestions", "created_at", "updated_at",
    )
    fieldsets = (
        (None, {"fields": ("name", "description", "status", "submitted_by")}),
        ("Source", {"fields": ("code", "input_schema", "source_file")}),
        ("Review", {"fields": ("review_feedback", "review_suggestions", "reviewed_at")}),
        ("Usage",  {"fields": ("invocation_count", "last_invoked_at")}),
        ("Timestamps", {"fields": ("created_at", "updated_at")}),
    )


@admin.register(AgentSkill)
class AgentSkillAdmin(admin.ModelAdmin):
    list_display  = ("name", "status", "visibility", "created_by", "created_at")
    list_filter   = ("status", "visibility")
    search_fields = ("name", "description", "instructions")
    readonly_fields = ("review_verdict", "review_findings", "reviewed_at", "version", "created_at", "updated_at")
    fieldsets = (
        (None, {"fields": ("name", "description", "status", "visibility", "created_by")}),
        ("Content", {"fields": ("instructions", "allowed_tools", "scripts", "references")}),
        ("Review", {"fields": ("review_verdict", "review_findings", "reviewed_at")}),
        ("Meta", {"fields": ("version", "created_at", "updated_at")}),
    )


@admin.register(SkillInvocation)
class SkillInvocationAdmin(admin.ModelAdmin):
    list_display  = ("skill", "status", "duration_ms", "invoked_by", "invoked_at")
    list_filter   = ("status", "skill")
    search_fields = ("skill__name",)
    readonly_fields = ("skill", "session_id", "invoked_by", "arguments", "result",
                       "status", "error", "duration_ms", "invoked_at")
