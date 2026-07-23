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
    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name="projects")
    name = models.CharField(max_length=512)
    description = models.TextField(blank=True, default="")
    position = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position", "name"]

    def __str__(self):
        return f"{self.name} ({self.account.company_name})"
