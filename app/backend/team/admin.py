"""Django Admin registration for the team app."""

from django.contrib import admin

from .models import Tag, Team, TeamMember, TeamMembership, UserProfile


class TeamMembershipInline(admin.TabularInline):
    model = TeamMembership
    extra = 0
    fields = ["user", "role", "joined_at"]
    autocomplete_fields = ["user"]


@admin.register(Team)
class TeamAdmin(admin.ModelAdmin):
    list_display = ["id", "name", "description", "created_at"]
    search_fields = ["name"]
    readonly_fields = ["created_at", "updated_at"]
    inlines = [TeamMembershipInline]


@admin.register(TeamMembership)
class TeamMembershipAdmin(admin.ModelAdmin):
    list_display = ["id", "user", "team", "role", "joined_at"]
    list_filter = ["role", "team"]
    search_fields = ["user__email", "team__name"]
    autocomplete_fields = ["user", "team"]
    readonly_fields = ["created_at", "updated_at"]


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ["id", "user", "display_name", "title", "timezone", "updated_at"]
    search_fields = ["user__email", "display_name", "title", "okta_uid"]
    readonly_fields = ["created_at", "updated_at", "okta_uid"]


@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    list_display = ["id", "name", "color", "description"]
    search_fields = ["name"]


@admin.register(TeamMember)
class TeamMemberAdmin(admin.ModelAdmin):
    list_display = [
        "id", "full_name", "email", "title", "department", "status", "joined_at"
    ]
    list_filter = ["status", "department"]
    search_fields = ["full_name", "email", "title", "department", "slack_handle"]
    filter_horizontal = ["tags"]
    readonly_fields = ["created_at", "updated_at"]
