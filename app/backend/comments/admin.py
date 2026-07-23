from django.contrib import admin
from .models import Comment


@admin.register(Comment)
class CommentAdmin(admin.ModelAdmin):
    list_display = ["id", "resource_type", "resource_id", "author", "parent", "created_at"]
    list_filter = ["resource_type"]
    search_fields = ["content", "resource_label"]
    raw_id_fields = ["author", "parent"]
