"""Models for user profiles, team membership, and tagging."""

from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class Team(models.Model):
    """A named group of users. Drives all row-level data scoping."""

    name = models.CharField(max_length=200, unique=True)
    description = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class TeamMembership(models.Model):
    """
    Maps a Django user to a Team with a role. This is the authority for all
    data scoping — queryset filters use team__memberships__user=request.user.
    """

    ROLE_CHOICES = [
        ("admin", "Admin"),
        ("manager", "Manager"),
        ("member", "Member"),
        ("viewer", "Viewer"),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="memberships")
    team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="memberships")
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default="member")
    joined_at = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("user", "team")]
        ordering = ["team", "user"]

    def __str__(self) -> str:
        return f"{self.user.email} → {self.team.name} ({self.role})"


class UserProfile(models.Model):
    """Extended profile data synced from Okta on first login."""

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    okta_uid = models.CharField(max_length=255, blank=True, db_index=True)
    display_name = models.CharField(max_length=150, blank=True)
    avatar_url = models.URLField(blank=True)
    title = models.CharField(max_length=150, blank=True)
    phone_number = models.CharField(max_length=30, blank=True)
    timezone = models.CharField(max_length=60, default="UTC")
    slack_user_id = models.CharField(max_length=50, blank=True)
    google_account_email = models.EmailField(blank=True)
    airtable_collaborator_id = models.CharField(
        max_length=64, blank=True, default="",
        help_text="Airtable collaborator user ID (usrXXX) — used to populate Assignee / Team Members linked fields.",
        db_index=True,
    )
    notification_email = models.BooleanField(default=True)
    notification_slack = models.BooleanField(default=True)

    # ── Reminder notification defaults ───────────────────────────────────────
    # These pre-fill the channel checkboxes on new reminders.
    notify_default_in_app = models.BooleanField(default=True)
    notify_default_slack = models.BooleanField(default=False)
    notify_default_push = models.BooleanField(default=False)
    notify_default_sms = models.BooleanField(default=False)

    # ── Web Push subscription ─────────────────────────────────────────────────
    # JSON blob: {"endpoint": "...", "keys": {"p256dh": "...", "auth": "..."}}
    # Null means push notifications are not registered for this browser/device.
    push_subscription = models.JSONField(null=True, blank=True)

    # ── Access level ──────────────────────────────────────────────────────────
    # The app's authorisation tier (enforced via core.mixins.access_level & friends):
    #   basic — edits their own records; on an account they belong to may edit its fields
    #           and assign action items to its team, but may only add/remove *themselves*
    #           as an account member.
    #   pm    — additionally assigns anyone to accounts (and accounts to anyone).
    #   admin — full access, including other users' access levels and the staff data view.
    # Changed only through the Admin-only /team/profiles/<id>/access-level/ endpoint.
    ACCESS_BASIC, ACCESS_PM, ACCESS_ADMIN = "basic", "pm", "admin"
    ACCESS_LEVEL_CHOICES = [(ACCESS_BASIC, "Basic"), (ACCESS_PM, "PM"), (ACCESS_ADMIN, "Admin")]
    access_level = models.CharField(max_length=10, choices=ACCESS_LEVEL_CHOICES, default=ACCESS_BASIC)

    def save(self, *args, **kwargs):
        # A brand-new profile for a Django staff user starts as Admin, matching the data
        # migration — profiles are created lazily (first /me/ visit, fixtures, admin), and a
        # Basic default would otherwise silently demote every newly-provisioned staff user.
        # Existing rows are never touched: after creation the level is only ever what an
        # Admin set it to.
        if self._state.adding and self.access_level == self.ACCESS_BASIC and getattr(self.user, "is_staff", False):
            self.access_level = self.ACCESS_ADMIN
        super().save(*args, **kwargs)

    # ── Staff view mode ───────────────────────────────────────────────────────
    # When True (default), staff users see all records. When False, staff users
    # see only the records they are personally assigned to — same as a regular user.
    staff_view_override = models.BooleanField(
        default=True,
        help_text="Staff only: when disabled, restricts data visibility to personally assigned records.",
    )

    # ── Calendar colors ───────────────────────────────────────────────────────
    # Per-user calendar appearance, validated by UserProfileSerializer:
    #   {"categories": {"<event_category>|action_item": "#RRGGBB"},
    #    "important":  {"<event uid>": "#RRGGBB"}}
    # "categories" is the color per event type; "important" is a per-event override
    # set from the calendar's right-click menu. Empty dict means "use the defaults"
    # (DEFAULT_CATEGORY_COLORS in the frontend's lib/eventColors.ts).
    calendar_colors = models.JSONField(default=dict, blank=True)

    # ── Gmail watch configuration ──────────────────────────────────────────────
    # JSON blob controlling Gmail sync filtering and labeling:
    #   {"label_name": "Agent PM - Threads",
    #    "keywords": ["meeting notes", "account-name", ...],
    #    "block_keywords": ["personal", "spam", ...]}
    # Validated by UserProfileSerializer. Empty dict means default behavior (watch INBOX, no filters).
    gmail_watch_config = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"{self.user.email}"


class Tag(models.Model):
    """Reusable label that can be applied to team members, tasks, or events."""

    COLOR_CHOICES = [
        ("gray", "Gray"),
        ("red", "Red"),
        ("orange", "Orange"),
        ("yellow", "Yellow"),
        ("green", "Green"),
        ("blue", "Blue"),
        ("indigo", "Indigo"),
        ("purple", "Purple"),
        ("pink", "Pink"),
    ]

    name = models.CharField(max_length=80, unique=True)
    color = models.CharField(max_length=20, choices=COLOR_CHOICES, default="gray")
    description = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class TeamMember(models.Model):
    """
    Represents a person on the team — may or may not have a Django user account.
    Useful for tracking external collaborators or pre-onboarded members.
    """

    STATUS_CHOICES = [
        ("active", "Active"),
        ("inactive", "Inactive"),
        ("invited", "Invited"),
    ]

    user = models.OneToOneField(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="team_member",
    )
    full_name = models.CharField(max_length=200)
    email = models.EmailField(unique=True)
    title = models.CharField(max_length=150, blank=True)
    department = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="active")
    tags = models.ManyToManyField(Tag, blank=True, related_name="team_members")
    manager = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="direct_reports",
    )
    slack_handle = models.CharField(max_length=80, blank=True)
    avatar_url = models.URLField(blank=True)
    joined_at = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["full_name"]

    def __str__(self) -> str:
        return f"{self.full_name} <{self.email}>"


class TeamMemberDocument(models.Model):
    """
    A link to a document (e.g. an out-of-office coverage doc) shared on a team
    member's profile so anyone can look it up later. Visible to any authenticated
    user; only the member themselves or staff may add/edit/remove one.
    """

    team_member = models.ForeignKey(TeamMember, on_delete=models.CASCADE, related_name="documents")
    added_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="added_team_member_documents",
    )
    name = models.CharField(max_length=300)
    url = models.TextField()
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["position", "created_at"]

    def __str__(self) -> str:
        return f"{self.name} — {self.team_member.full_name}"
