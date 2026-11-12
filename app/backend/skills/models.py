"""Models for the skills app — Claude tool definitions and their invocation history."""

import uuid

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

    # What the skill builds on besides its own instructions. All are names/ids only:
    # the content is resolved at run time, under the *runner's* permissions.
    twilio_skills = models.JSONField(
        default=list, blank=True, help_text="Slugs of Twilio skills this skill builds on.",
    )
    chained_skills = models.JSONField(
        default=list, blank=True, help_text="Names of other AgentSkills whose instructions run first.",
    )
    context_defaults = models.JSONField(
        default=dict, blank=True,
        help_text="{records:[{resource_type,resource_id,label}], account_ids:[], "
                  "slack:[{id,kind,label}], needs_accounts:bool}",
    )
    templates = models.JSONField(
        default=list, blank=True,
        help_text="Selectable variants: [{key, title, body_html}]. The runner picks one.",
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

    # Claude's estimate of what one run costs in tokens (see skills/token_estimate.py). Kept
    # off the public serializer: it is an admin planning figure, not part of the skill's contract.
    token_estimate = models.JSONField(default=dict, blank=True)
    token_estimated_at = models.DateTimeField(null=True, blank=True)

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


class AgentSkillAttachment(models.Model):
    """
    A document attached to an AgentSkill as standing context.

    `text` is extracted once at upload so run-time prompt assembly never re-parses a
    file. When the uploader chose an account, the file is also filed as an
    `accounts.AccountArtifact` (`artifact`), so it shows up on that account too.
    """

    skill = models.ForeignKey(AgentSkill, on_delete=models.CASCADE, related_name="attachments")
    name = models.CharField(max_length=300)
    file = models.FileField(upload_to="skill_attachments/%Y/%m/", null=True, blank=True)
    url = models.TextField(blank=True, default="")
    mime_type = models.CharField(max_length=100, blank=True, default="")
    file_size = models.PositiveIntegerField(null=True, blank=True)
    text = models.TextField(blank=True, default="")
    artifact = models.ForeignKey(
        "accounts.AccountArtifact", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="skill_attachments",
    )
    uploaded_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="skill_attachments",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"{self.name} → {self.skill_id}"


class VoiceLaunchContext(models.Model):
    """
    Short-lived hand-off from "Use in Voice" to the call that follows.

    Twilio's connect params are tiny and browser-controlled, so only this row's key
    travels; the prompt, records and skill are looked up server-side when the call
    sets up. Consumed (deleted) on first use and expired after a couple of minutes.
    """

    key = models.CharField(max_length=64, unique=True)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="voice_launch_contexts")
    skill = models.ForeignKey(AgentSkill, on_delete=models.CASCADE, null=True, blank=True)
    payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


# ── Page pins & the skill-run Console ──────────────────────────────────────────────────


class SkillPagePin(models.Model):
    """
    A skill pinned to a page of the app (calendar, reminders, an account page, …).

    `user` is the person it belongs to; `user=NULL` is an **everyone-pin** that only an admin
    can create or remove. The profile page's "Pin to my page" is a different, older mechanism
    (`AgentSkill.pinned_to_users`) and is untouched.
    """

    PAGES = [
        ("calendar", "Calendar"),
        ("action-items", "Action items"),
        ("reminders", "Reminders"),
        ("account-detail", "Account detail (every account)"),
        ("layouts", "Layouts"),
        ("activity-log", "Activity log"),
    ]

    user = models.ForeignKey(User, null=True, blank=True, on_delete=models.CASCADE, related_name="skill_page_pins")
    skill = models.ForeignKey(AgentSkill, on_delete=models.CASCADE, related_name="page_pins")
    page = models.CharField(max_length=30, choices=PAGES)
    created_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [
            models.UniqueConstraint(fields=["user", "skill", "page"], condition=models.Q(user__isnull=False),
                                    name="uniq_personal_skill_page_pin"),
            models.UniqueConstraint(fields=["skill", "page"], condition=models.Q(user__isnull=True),
                                    name="uniq_everyone_skill_page_pin"),
        ]

    def __str__(self) -> str:
        return f"{self.skill_id} on {self.page} ({'everyone' if self.user_id is None else self.user_id})"


class SkillRun(models.Model):
    """
    One launch of a saved skill, from a button, a pinned page or a voice launch.

    Created when the run is assembled; the chat turn / voice call that actually executes it
    attaches to it by id, so the Console can show what the skill did. Without this a chat turn
    had no link back to the skill that started it.
    """

    SURFACES = [("chat", "Chat"), ("voice", "Voice")]
    STATUSES = [("launched", "Launched"), ("running", "Running"), ("completed", "Completed"), ("failed", "Failed")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="skill_runs")
    skill = models.ForeignKey(AgentSkill, null=True, blank=True, on_delete=models.SET_NULL, related_name="runs")
    skill_name = models.CharField(max_length=100)
    surface = models.CharField(max_length=10, choices=SURFACES, default="chat")
    page = models.CharField(max_length=30, blank=True, default="")
    params = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=12, choices=STATUSES, default="launched")
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    tool_count = models.PositiveIntegerField(default=0)
    records_created = models.PositiveIntegerField(default=0)
    records_updated = models.PositiveIntegerField(default=0)
    input_tokens = models.PositiveIntegerField(default=0)
    output_tokens = models.PositiveIntegerField(default=0)
    # Data too big for one chat message, staged here and read by the agent in pages through
    # `get_skill_run_data`: [{"label": str, "text": str}]. Empty when the prompt fit inline.
    data_parts = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["-started_at"]
        indexes = [models.Index(fields=["user", "-started_at"])]

    def __str__(self) -> str:
        return f"{self.skill_name} ({self.status})"


class SkillRunEvent(models.Model):
    """One line in a run's Console: a tool the skill called, and what came of it."""

    KINDS = [("launched", "Launched"), ("tool", "Tool call"), ("finished", "Finished")]

    run = models.ForeignKey(SkillRun, on_delete=models.CASCADE, related_name="events")
    ts = models.DateTimeField(auto_now_add=True)
    kind = models.CharField(max_length=10, choices=KINDS, default="tool")
    tool_name = models.CharField(max_length=100, blank=True, default="")
    # ok | created | updated | error
    status = models.CharField(max_length=10, blank=True, default="")
    error_code = models.CharField(max_length=60, blank=True, default="")
    summary = models.CharField(max_length=400, blank=True, default="")
    args = models.JSONField(default=dict, blank=True)
    record_type = models.CharField(max_length=40, blank=True, default="")
    record_id = models.CharField(max_length=64, blank=True, default="")
    record_label = models.CharField(max_length=200, blank=True, default="")
    record_url = models.CharField(max_length=500, blank=True, default="")
    duration_ms = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["ts", "id"]
        indexes = [models.Index(fields=["run", "ts"])]
