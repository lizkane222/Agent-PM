"""Generic comment model that can attach to any resource in the app."""

from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()

RESOURCE_TYPE_CHOICES = [
    ("account", "Account"),
    ("airtable_account", "Airtable Account"),
    ("action_item", "Airtable Action Item"),
    ("action_item_step", "Action Item Step"),
    ("meeting", "Airtable Meeting"),
    ("calendar_event", "Calendar Event"),
    ("reminder", "Reminder"),
    ("task", "Task"),
    ("account_note", "Account Note"),
    ("artifact", "Account Artifact"),
    ("meeting_note", "Meeting Note"),
    ("claude_skill", "Claude Skill"),
]


class Comment(models.Model):
    """A threaded comment on any resource."""

    author = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="comments",
    )
    # Generic FK via type + id pair (avoids separate tables per resource)
    resource_type = models.CharField(max_length=30, choices=RESOURCE_TYPE_CHOICES, db_index=True)
    resource_id = models.PositiveIntegerField(db_index=True)
    resource_label = models.CharField(max_length=500, blank=True)

    content = models.TextField()

    # Threading: null = top-level, non-null = reply
    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="replies",
        db_index=True,
    )

    # Rich references: list of {type, id, label, url} objects added via @# trigger
    references = models.JSONField(
        default=list,
        help_text="Records referenced via @# picker: [{resource_type, resource_id, label, url}]",
    )

    # @user mentions: list of {user_id, username, display_name}
    mentions = models.JSONField(
        default=list,
        help_text="User mentions via @ picker: [{user_id, username, display_name}]",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["resource_type", "resource_id"]),
        ]

    def __str__(self) -> str:
        return f"Comment by {self.author_id} on {self.resource_type}:{self.resource_id}"
