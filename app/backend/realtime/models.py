"""Models for real-time event tracking and voice session management."""

from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class VoiceSession(models.Model):
    """Tracks an active or completed Twilio Voice call session."""

    STATUS_CHOICES = [
        ("ringing", "Ringing"),
        ("in_progress", "In Progress"),
        ("completed", "Completed"),
        ("failed", "Failed"),
        ("no_answer", "No Answer"),
    ]

    user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="voice_sessions",
    )
    call_sid = models.CharField(max_length=34, unique=True, db_index=True)
    from_number = models.CharField(max_length=30)
    to_number = models.CharField(max_length=30)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="ringing")
    duration_seconds = models.PositiveIntegerField(default=0)
    recording_url = models.URLField(blank=True)
    transcript = models.TextField(blank=True)
    conversation_sid = models.CharField(
        max_length=34,
        blank=True,
        help_text="Twilio Conversations SID (CH…) linked to this call.",
    )
    started_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Call {self.call_sid} ({self.status})"


class AgentActivityEvent(models.Model):
    """
    A single real-time activity event published to the agent feed.
    These are also pushed to Twilio Sync so the dashboard can update live.
    """

    EVENT_TYPE_CHOICES = [
        ("tool_call", "Tool Call"),
        ("tool_result", "Tool Result"),
        ("message", "Message"),
        ("error", "Error"),
        ("voice_transcript", "Voice Transcript"),
        ("calendar_sync", "Calendar Sync"),
        ("task_created", "Task Created"),
        ("task_updated", "Task Updated"),
        # Frontend activity log categories
        ("account", "Account"),
        ("team", "Team"),
        ("action_item", "Action Item"),
        ("calendar", "Calendar"),
        ("comment_reply", "Comment Reply"),
    ]

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="activity_events",
    )
    event_type = models.CharField(max_length=30, choices=EVENT_TYPE_CHOICES)
    title = models.CharField(max_length=300)
    detail = models.TextField(blank=True)
    metadata = models.JSONField(default=dict)
    client_id = models.CharField(
        max_length=64,
        blank=True,
        db_index=True,
        help_text="Opaque ID assigned by the frontend so duplicates can be detected.",
    )
    client_ts = models.BigIntegerField(
        null=True,
        blank=True,
        help_text="Frontend Date.now() timestamp in ms when the event was created.",
    )
    sync_document_id = models.CharField(
        max_length=100,
        blank=True,
        help_text="Twilio Sync document/list item ID if published.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.event_type}: {self.title}"
