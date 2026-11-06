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


# ── Daily token budgets ───────────────────────────────────────────────────────────────


class TokenPricing(models.Model):
    """
    The one definition of how tokens convert to dollars. A single row (pk=1).

    Budgets are *stored in tokens* and shown in both units, so a dollar figure an admin types
    is converted once, here, at the rate that was in force — never re-derived per screen.
    The rates are the admin's to set: they depend on the model tier and contract, and nothing
    in the code can know what Twilio pays.

    A token budget cannot be turned into dollars exactly, because input and output tokens
    cost different amounts. `output_share` is the assumed fraction of a turn's tokens that are
    output, which gives a *blended* $/million used only for converting a budget. Actual usage
    is priced exactly, from the real input/output counts.
    """

    input_usd_per_million = models.DecimalField(max_digits=10, decimal_places=4, default=3)
    output_usd_per_million = models.DecimalField(max_digits=10, decimal_places=4, default=15)
    output_share = models.DecimalField(max_digits=4, decimal_places=3, default="0.200")
    updated_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Token pricing"
        verbose_name_plural = "Token pricing"

    def __str__(self) -> str:
        return f"in ${self.input_usd_per_million}/M, out ${self.output_usd_per_million}/M"


class RoleTokenDefault(models.Model):
    """Daily token allowance for everyone in a job role (SA, CSM, …). Admins must set these."""

    role = models.CharField(max_length=10, unique=True)
    warn_tokens = models.PositiveBigIntegerField(null=True, blank=True)
    block_tokens = models.PositiveBigIntegerField(null=True, blank=True)
    updated_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"{self.role}: warn {self.warn_tokens} / block {self.block_tokens}"


class UserTokenBudget(models.Model):
    """
    One person's override of their role's allowance.

    A blank limit means "use the role default" — not "unlimited". `block_at_warn` is the
    admin's restriction: reaching the *warn* limit then blocks, instead of only warning.
    """

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="token_budget")
    warn_tokens = models.PositiveBigIntegerField(null=True, blank=True)
    block_tokens = models.PositiveBigIntegerField(null=True, blank=True)
    block_at_warn = models.BooleanField(default=False)
    updated_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"{self.user_id}: warn {self.warn_tokens} / block {self.block_tokens} / restrict={self.block_at_warn}"


class TokenAlert(models.Model):
    """
    A user reached a limit on a given local day. One row per (user, day, level), which both
    de-duplicates the admin notification and answers "how many days has this person hit it?".
    """

    LEVEL_CHOICES = [("warn", "Warn limit"), ("block", "Block limit")]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="token_alerts")
    day = models.DateField()
    level = models.CharField(max_length=5, choices=LEVEL_CHOICES)
    tokens_used = models.PositiveBigIntegerField(default=0)
    limit_tokens = models.PositiveBigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "day", "level"], name="uniq_token_alert_per_day")]
        ordering = ["-day", "-created_at"]
