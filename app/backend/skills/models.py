"""Models for the skills app — Claude tool definitions and their invocation history."""

from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class ClaudeSkill(models.Model):
    """
    A user-submitted custom Python tool that can be registered into the MCP
    server and invoked by Claude during any conversation.
    """

    STATUS_CHOICES = [
        ("pending_review", "Pending Review"),
        ("reviewing",      "Reviewing"),
        ("approved",       "Approved"),
        ("rejected",       "Rejected"),
        ("disabled",       "Disabled"),
    ]

    # Identity
    name        = models.CharField(max_length=100, unique=True)
    description = models.TextField(help_text="Shown to Claude as the tool description.")
    command     = models.CharField(
        max_length=64, blank=True, default="",
        help_text="Slash command shortcut, e.g. /generate_status_report.",
    )
    roles       = models.JSONField(
        default=list, blank=True,
        help_text="Role tags this skill appears under, e.g. ['Solutions Architect', 'CSM'].",
    )

    # Source
    code         = models.TextField(help_text="Python async def source of the tool function.")
    input_schema = models.JSONField(
        default=dict, blank=True,
        help_text="JSON Schema for the tool's input parameters.",
    )
    source_file = models.CharField(
        max_length=255, blank=True, default="",
        help_text="Original filename if imported from the skills/ directory.",
    )

    # Review
    status             = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending_review")
    review_feedback    = models.TextField(blank=True)
    review_suggestions = models.TextField(blank=True)
    reviewed_at        = models.DateTimeField(null=True, blank=True)

    # Usage
    invocation_count = models.PositiveIntegerField(default=0)
    last_invoked_at  = models.DateTimeField(null=True, blank=True)

    # Ownership
    submitted_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="submitted_skills",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Claude Skill"
        verbose_name_plural = "Claude Skills"

    def __str__(self) -> str:
        return f"{self.name} ({self.status})"


class AgentSkill(models.Model):
    """
    A structured Claude Skill — instructions-based (not Python code).
    Defines what Claude should do, which tools it may reference, and optional
    scripts for deterministic computation.
    """

    STATUS_CHOICES = [
        ("draft",          "Draft"),
        ("pending_review", "Pending Review"),
        ("approved",       "Approved"),
        ("rejected",       "Rejected"),
    ]

    VISIBILITY_CHOICES = [
        ("private", "Private"),
        ("team",    "Team"),
        ("public",  "Public"),
    ]

    name          = models.CharField(max_length=100, unique=True, help_text="kebab-case, unique per team.")
    description   = models.TextField(help_text="What it does AND when to use it. This is the auto-trigger signal.")
    instructions  = models.TextField(help_text="Markdown steps Claude follows when this skill is active.")
    allowed_tools = models.JSONField(
        default=list, blank=True,
        help_text="Whitelist of platform tool names this skill may reference.",
    )
    scripts = models.JSONField(
        default=list, blank=True,
        help_text="List of {filename, language, code} objects for deterministic computation.",
    )
    references = models.JSONField(
        default=list, blank=True,
        help_text="Supporting docs loaded on demand.",
    )

    status     = models.CharField(max_length=20, choices=STATUS_CHOICES, default="draft")
    visibility = models.CharField(max_length=20, choices=VISIBILITY_CHOICES, default="private")

    review_verdict    = models.CharField(max_length=20, blank=True, default="")
    review_findings   = models.JSONField(default=dict, blank=True)
    reviewed_at       = models.DateTimeField(null=True, blank=True)

    pinned_to_roles = models.JSONField(
        default=list, blank=True,
        help_text="Role labels this skill is pinned to, e.g. ['Solutions Architect'].",
    )
    pinned_to_users = models.ManyToManyField(
        User, blank=True, related_name="pinned_agent_skills",
        help_text="Users who have pinned this skill to their profile.",
    )

    version    = models.PositiveIntegerField(default=1)
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="agent_skills",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Agent Skill"
        verbose_name_plural = "Agent Skills"

    def __str__(self) -> str:
        return f"{self.name} ({self.status})"


class SkillInvocation(models.Model):
    """
    Records every time a skill tool is called by Claude within an agent session.
    Provides a full audit trail of arguments, results, and timing.
    """

    STATUS_CHOICES = [
        ("success", "Success"),
        ("error",   "Error"),
    ]

    skill      = models.ForeignKey(ClaudeSkill, on_delete=models.CASCADE, related_name="invocations")
    # Soft link — nullable so invocations survive session deletion
    session_id = models.PositiveIntegerField(
        null=True, blank=True,
        help_text="ID of the AgentSession that triggered this invocation.",
    )
    invoked_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="skill_invocations",
    )

    arguments    = models.JSONField(default=dict)
    result       = models.JSONField(null=True, blank=True)
    status       = models.CharField(max_length=20, choices=STATUS_CHOICES, default="success")
    error        = models.TextField(blank=True)
    duration_ms  = models.PositiveIntegerField(default=0)
    input_tokens  = models.PositiveIntegerField(default=0)
    output_tokens = models.PositiveIntegerField(default=0)

    invoked_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-invoked_at"]
        verbose_name = "Skill Invocation"
        verbose_name_plural = "Skill Invocations"

    def __str__(self) -> str:
        return f"{self.skill.name} @ {self.invoked_at:%Y-%m-%d %H:%M} ({self.status})"
