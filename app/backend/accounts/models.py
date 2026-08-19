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
    name = models.CharField(max_length=512)
    description = models.TextField(blank=True, default="")
    position = models.PositiveSmallIntegerField(default=0)
    url = models.CharField(max_length=2048, blank=True, default="")
    action_ids = models.JSONField(default=list)
    meeting_ids = models.JSONField(default=list)
    goal_ids = models.JSONField(default=list)
    resources = models.JSONField(default=list)
    sf_data = models.JSONField(blank=True, default=dict)
    kind = models.CharField(max_length=20, choices=KIND_CHOICES, default="project")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position", "name"]

    def __str__(self):
        return f"{self.name} ({self.account.company_name})"


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
