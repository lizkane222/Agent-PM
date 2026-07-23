"""Models for storing OAuth credentials and integration connection state."""

from django.contrib.auth import get_user_model
from django.db import models
from encrypted_model_fields.fields import EncryptedTextField

User = get_user_model()


class OAuthCredential(models.Model):
    """
    Stores an OAuth2 token set for a given provider and user.
    access_token and refresh_token are encrypted at rest using a key
    stored in FIELD_ENCRYPTION_KEY (never in the database).
    """

    PROVIDER_CHOICES = [
        ("google", "Google"),
        ("slack", "Slack"),
        ("airtable", "Airtable"),
        ("salesforce", "Salesforce"),
        ("gong", "Gong"),
        ("zoom", "Zoom"),
        ("lucidchart", "Lucidchart"),
        ("github", "GitHub"),
        ("google_drive", "Google Drive / Docs / Sheets"),
        ("notion", "Notion"),
        ("microsoft", "Microsoft Teams"),
        ("gmail", "Gmail"),
    ]

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="oauth_credentials",
    )
    provider = models.CharField(max_length=30, choices=PROVIDER_CHOICES)
    access_token = EncryptedTextField()
    refresh_token = EncryptedTextField(blank=True, default="")
    token_expiry = models.DateTimeField(null=True, blank=True)
    scopes = models.TextField(blank=True, help_text="Space-separated list of granted scopes.")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("user", "provider")]
        ordering = ["provider"]

    def __str__(self) -> str:
        return f"{self.user.email} — {self.get_provider_display()}"


class WebhookLog(models.Model):
    """Records inbound webhook payloads from third-party services for debugging."""

    SOURCE_CHOICES = [
        ("twilio", "Twilio"),
        ("slack", "Slack"),
        ("google", "Google"),
        ("airtable", "Airtable"),
    ]

    source = models.CharField(max_length=30, choices=SOURCE_CHOICES)
    event_type = models.CharField(max_length=100, blank=True)
    payload = models.JSONField(default=dict)
    headers = models.JSONField(default=dict)
    processed = models.BooleanField(default=False)
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.source} webhook — {self.event_type} ({self.created_at:%Y-%m-%d %H:%M})"


class SyncState(models.Model):
    """Tracks the last-synced cursor/token for incremental sync operations."""

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="sync_states",
    )
    provider = models.CharField(max_length=30)
    resource = models.CharField(max_length=100, help_text="e.g. 'calendar', 'inbox'")
    sync_token = models.TextField(blank=True)
    last_synced_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("user", "provider", "resource")]
        ordering = ["provider", "resource"]

    def __str__(self) -> str:
        return f"{self.user.username} — {self.provider}/{self.resource}"
