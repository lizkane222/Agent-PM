from django.contrib import admin
from .models import Feedback, FeedbackComment

class FeedbackCommentInline(admin.TabularInline):
    model = FeedbackComment
    extra = 0
    readonly_fields = ("author", "created_at")

@admin.register(Feedback)
class FeedbackAdmin(admin.ModelAdmin):
    list_display = ("id", "author", "status", "element_label", "created_at")
    list_filter = ("status",)
    inlines = [FeedbackCommentInline]

@admin.register(FeedbackComment)
class FeedbackCommentAdmin(admin.ModelAdmin):
    list_display = ("id", "feedback", "author", "created_at")
