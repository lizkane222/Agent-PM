"""Feedback model — user-submitted bug reports and UX issues."""

from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()

STATUS_CHOICES = [
    ("open", "Open"),
    ("in_progress", "In Progress"),
    ("resolved", "Resolved"),
    ("wont_fix", "Won't Fix"),
]


class Feedback(models.Model):
    author = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="feedback_items",
    )
    description = models.TextField()
    # Where in the app the issue occurred (element / page captured via click-to-attach)
    element_label = models.CharField(max_length=500, blank=True)
    element_path = models.CharField(max_length=1000, blank=True)
    page_url = models.CharField(max_length=2000, blank=True)
    # Optional attachment (screenshot / file)
    attachment = models.FileField(upload_to="feedback/attachments/", null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="open", db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Feedback #{self.id} by {self.author_id} — {self.status}"


class FeedbackComment(models.Model):
    """Follow-up comments / status updates on a Feedback item."""

    feedback = models.ForeignKey(
        Feedback,
        on_delete=models.CASCADE,
        related_name="comments",
    )
    author = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="feedback_comments",
    )
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"FeedbackComment #{self.id} on Feedback #{self.feedback_id}"
