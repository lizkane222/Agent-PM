"""Models for client accounts and activity notes."""

from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class Account(models.Model):
    STATUS_CHOICES = [
        ("prospect", "Prospect"),
        ("active", "Active"),
        ("inactive", "Inactive"),
        ("churned", "Churned"),
    ]

    company_name = models.CharField(max_length=300)
    airtable_id = models.CharField(max_length=64, blank=True, db_index=True)
    website = models.URLField(blank=True)
    industry = models.CharField(max_length=150, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="prospect")
    arr = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    # Slack channels the team uses for this account: a list of
    # {workspace, channel, url, type: customer_facing|account_team}. Validated in
    # accounts.slack_channels.clean_slack_channels.
    slack_channels = models.JSONField(default=list, blank=True)
    owner = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="owned_accounts",
    )
    primary_contact = models.ForeignKey(
        "team.TeamMember",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="accounts",
    )
    # Free-text primary contact (the starred customer contact). Distinct from the FK above,
    # which points at an internal TeamMember. Not pushed to Airtable.
    primary_contact_text = models.CharField(max_length=255, blank=True, default="")
    team_members = models.ManyToManyField(
        "team.TeamMember",
        blank=True,
        related_name="member_accounts",
    )
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_accounts",
    )
    # Personal admin account — one per user, always visible to that user only.
    is_admin_account = models.BooleanField(default=False, db_index=True)
    admin_owner = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="admin_account",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["company_name"]

    def __str__(self) -> str:
        return self.company_name


#: Reserved account name for the per-user personal workspace. Matched
#: case-insensitively — a shared account may never use it.
ADMIN_ACCOUNT_NAME = "Admin"


def get_or_create_admin_account(user):
    """Return `user`'s personal Admin account, creating it on first call.

    Admin accounts are per-user workspaces (`is_admin_account=True`,
    `admin_owner=user`) and are only ever visible to their owner. They are
    deliberately kept out of Airtable, so `airtable_id` stays blank.

    Also links the user's `TeamMember` row when one exists, so the account is
    reachable through the standard `team_members` filter as well as via
    `admin_owner`.
    """
    account, _created = Account.objects.get_or_create(
        admin_owner=user,
        defaults={
            "company_name": ADMIN_ACCOUNT_NAME,
            "is_admin_account": True,
            "status": "active",
            "created_by": user,
        },
    )

    from team.models import TeamMember  # local import to avoid circular deps

    member = TeamMember.objects.filter(user=user).first()
    if member and not account.team_members.filter(pk=member.pk).exists():
        account.team_members.add(member)

    return account


class AccountNote(models.Model):
    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name="notes")
    author = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="account_notes",
    )
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    # Rich references: list of {resource_type, resource_id, label, url} objects added via @# trigger
    references = models.JSONField(
        default=list,
        help_text="Records referenced via @# picker: [{resource_type, resource_id, label, url}]",
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Note on {self.account.company_name} by {self.author}"


class CustomerContact(models.Model):
    """A person from the customer side linked to an Account."""
    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name="contacts")
    name = models.CharField(max_length=300)
    role = models.CharField(max_length=200, blank=True, default="")
    description = models.TextField(blank=True, default="")
    email = models.EmailField(blank=True, default="")
    # Free-text name of the customer's INTERNAL team (not the app's Team feature).
    team = models.CharField(max_length=200, blank=True, default="")
    # Main point of contact. Several per account are allowed (one flag per contact).
    is_main_poc = models.BooleanField(default=False)
    # IANA zone name, e.g. "America/Chicago". Display-only (planning meeting times).
    timezone = models.CharField(max_length=64, blank=True, default="")
    airtable_id = models.CharField(max_length=64, blank=True, default="", db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return f"{self.name} ({self.account.company_name})"


class CustomerContactNote(models.Model):
    """Free-text notes on a CustomerContact."""
    contact = models.ForeignKey(CustomerContact, on_delete=models.CASCADE, related_name="notes")
    author = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="contact_notes"
    )
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Note on {self.contact.name}"


class AccountQuickLink(models.Model):
    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name="quick_links")
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="quick_links",
    )
    name = models.CharField(max_length=300)
    url = models.TextField()
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["position", "created_at"]

    def __str__(self) -> str:
        return f"{self.name} — {self.account.company_name}"


class AccountArtifact(models.Model):
    ARTIFACT_TYPE_CHOICES = [
        ("link", "Link"),
        ("file", "File"),
    ]

    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name="artifacts", null=True, blank=True)
    uploaded_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="account_artifacts"
    )
    artifact_type = models.CharField(max_length=10, choices=ARTIFACT_TYPE_CHOICES, default="link")
    name = models.CharField(max_length=300)        # display name / filename
    url = models.TextField(blank=True)             # for link type or served file URL (edit link for Lucidchart)
    secondary_url = models.TextField(blank=True, default="")  # optional second URL (published link for Lucidchart)
    icon_key = models.CharField(max_length=64, blank=True, default="")  # e.g. "google_docs", "slack"
    file = models.FileField(upload_to="account_artifacts/%Y/%m/", null=True, blank=True)
    mime_type = models.CharField(max_length=100, blank=True)
    file_size = models.PositiveIntegerField(null=True, blank=True)  # bytes
    # Optional user-supplied image shown in place of the icon. See accounts/artifact_images.py.
    custom_image = models.FileField(upload_to="artifact_images/%Y/%m/", null=True, blank=True)
    description = models.TextField(blank=True, default="")  # rich text (HTML)
    # Records referenced via @# picker inside the description: [{resource_type, resource_id, label, url}]
    references = models.JSONField(default=list, blank=True)
    # Who last edited the artifact (set by the viewset on update; null until edited).
    updated_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="updated_account_artifacts"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        account_name = self.account.company_name if self.account_id else "unassigned"
        return f"{self.name} ({self.artifact_type}) — {account_name}"


class AccountProject(models.Model):
    """A project/initiative belonging to an account, created and tracked in-app."""
    KIND_CHOICES = [
        ("project", "Project"),
        ("goal", "Goal"),
    ]

    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name="projects")
    # blank=True is load-bearing, not cosmetic: "+ Add Goal" creates the row first and
    # lets the user type the name into the card afterwards. While this was required,
    # DRF rejected every one of those POSTs with 400 "This field may not be blank",
    # the frontend discarded the error, and no goal ever persisted.
    name = models.CharField(max_length=512, blank=True, default="")
    description = models.TextField(blank=True, default="")
    position = models.PositiveSmallIntegerField(default=0)
    url = models.CharField(max_length=2048, blank=True, default="")
    action_ids = models.JSONField(default=list)
    meeting_ids = models.JSONField(default=list)
    goal_ids = models.JSONField(default=list)
    resources = models.JSONField(default=list)
    # Linked (not copied) notes: [{kind, id, meetingId?, label}]. See AccountProjectSerializer.
    note_refs = models.JSONField(blank=True, default=list)
    sf_data = models.JSONField(blank=True, default=dict)
    # Salesforce Cloud Coach project Id (e.g. "a0B..."). Required key for the
    # "fetch remaining fields from Salesforce" action — kept as a real column
    # (rather than inside sf_data) because it's looked up by, not just stored.
    sf_project_id = models.CharField(max_length=32, blank=True, default="", db_index=True)
    kind = models.CharField(max_length=20, choices=KIND_CHOICES, default="project")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position", "name"]

    def __str__(self):
        return f"{self.name} ({self.account.company_name})"


class ProjectMember(models.Model):
    """A team member linked to a specific project (not just its account).

    A `team.TeamMember` can be assigned to multiple `AccountProject`s under the
    same account — that per-project scoping doesn't exist anywhere else in the
    schema, so this is its own join table rather than reusing `Account.team_members`.
    """

    project = models.ForeignKey(AccountProject, on_delete=models.CASCADE, related_name="members")
    team_member = models.ForeignKey(
        "team.TeamMember", on_delete=models.CASCADE, related_name="project_memberships"
    )
    role = models.CharField(max_length=150, blank=True, default="")
    added_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        unique_together = [("project", "team_member")]

    def __str__(self):
        return f"{self.team_member.full_name} on {self.project.name}"


class AccountRole(models.Model):
    """A user's role on a specific account (e.g. sync_reviewer, account_owner)."""
    ROLE_CHOICES = [
        ("sync_reviewer", "Sync Reviewer"),
        ("account_owner", "Account Owner"),
    ]

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="account_roles"
    )
    account = models.ForeignKey(
        Account, on_delete=models.CASCADE, related_name="account_roles"
    )
    role = models.CharField(max_length=32, choices=ROLE_CHOICES)
    assigned_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="assigned_account_roles",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["account", "role"]
        unique_together = [("user", "account", "role")]

    def __str__(self):
        return f"{self.user} — {self.role} on {self.account}"


class AccountTicket(models.Model):
    """A JIRA / Zendesk ticket or product gap tied to an account.

    Created by hand, by pasting a link, or by the Gmail ticket scanner
    (``integrations/ticket_scan.py``). The scanner files an unmatched email as
    ``review_state="needs_review"`` with ``account=None``, visible only to ``found_by``.
    """

    KIND_CHOICES = [("jira", "JIRA"), ("zendesk", "Zendesk"), ("product_gap", "Product Gap")]
    STATUS_CHOICES = [
        ("open", "Open"), ("in_progress", "In Progress"), ("waiting", "Waiting"),
        ("resolved", "Resolved"), ("closed", "Closed"),
    ]
    REVIEW_CHOICES = [("confirmed", "Confirmed"), ("needs_review", "Needs review")]

    account = models.ForeignKey(Account, on_delete=models.CASCADE, null=True, blank=True, related_name="tickets")
    kind = models.CharField(max_length=20, choices=KIND_CHOICES, db_index=True)
    url = models.URLField(max_length=1000, blank=True, default="")
    external_key = models.CharField(max_length=100, blank=True, default="")
    title = models.CharField(max_length=500, blank=True, default="")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="open")
    notes = models.TextField(blank=True, default="")
    source_created_at = models.DateTimeField(null=True, blank=True)
    source_updated_at = models.DateTimeField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="created_account_tickets")
    review_state = models.CharField(max_length=20, choices=REVIEW_CHOICES, default="confirmed", db_index=True)
    found_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="found_account_tickets")
    source_message_id = models.CharField(max_length=200, blank=True, default="")
    source_subject = models.CharField(max_length=500, blank=True, default="")
    source_sender = models.CharField(max_length=300, blank=True, default="")
    source_snippet = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-source_updated_at", "-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["found_by", "source_message_id"],
                condition=~models.Q(source_message_id=""),
                name="uniq_ticket_found_by_message",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.kind} {self.external_key or self.title}"
