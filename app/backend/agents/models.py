"""Models for tracking agent runs, tool calls, and conversation history."""

from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class AgentSession(models.Model):
    """Represents a single conversation session with the AI agent."""

    STATUS_CHOICES = [
        ("active", "Active"),
        ("completed", "Completed"),
        ("error", "Error"),
    ]

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="agent_sessions",
    )
    title = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="active")
    is_shared = models.BooleanField(default=False)
    participants = models.ManyToManyField(
        User,
        blank=True,
        related_name="shared_sessions",
    )
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-started_at"]

    def __str__(self) -> str:
        return f"Session {self.pk} — {self.user.username} ({self.status})"


class AgentMessage(models.Model):
    """A single message within an agent session (user or assistant turn)."""

    ROLE_CHOICES = [
        ("user", "User"),
        ("assistant", "Assistant"),
        ("tool_result", "Tool Result"),
    ]

    session = models.ForeignKey(
        AgentSession,
        on_delete=models.CASCADE,
        related_name="messages",
    )
    role = models.CharField(max_length=20, choices=ROLE_CHOICES)
    content = models.TextField()
    input_tokens = models.PositiveIntegerField(default=0)
    output_tokens = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"{self.role.capitalize()} message in session {self.session_id}"


class ToolCall(models.Model):
    """Records an individual MCP tool invocation made during an agent session."""

    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("success", "Success"),
        ("error", "Error"),
    ]

    message = models.ForeignKey(
        AgentMessage,
        on_delete=models.CASCADE,
        related_name="tool_calls",
        null=True,
        blank=True,
    )
    tool_name = models.CharField(max_length=100)
    arguments = models.JSONField(default=dict)
    result = models.JSONField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    error_message = models.TextField(blank=True)
    duration_ms = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"{self.tool_name} ({self.status})"
