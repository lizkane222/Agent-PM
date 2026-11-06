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


class GoogleWriteLog(models.Model):
    """
    One row for every attempt to write to a user's Google Calendar.

    Added after a customer received 2,000+ invitations from one meeting move and there was no
    record of what the app had sent, to whom, or why. It is written *before* the Google call
    (outcome "attempted") and finished after, so a crash mid-call still leaves evidence.
    Append-only by convention: nothing in the app updates or deletes these rows except to
    complete the outcome of the attempt that created them.
    """

    OUTCOME_ATTEMPTED = "attempted"
    OUTCOME_OK = "ok"
    OUTCOME_FAILED = "failed"
    OUTCOME_BLOCKED = "blocked"
    OUTCOME_CHOICES = [
        (OUTCOME_ATTEMPTED, "Attempted"),
        (OUTCOME_OK, "Succeeded"),
        (OUTCOME_FAILED, "Failed"),
        (OUTCOME_BLOCKED, "Blocked before reaching Google"),
    ]

    user = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name="google_write_logs")
    # The calendar event this concerned; kept as plain values so the row survives its deletion.
    event_pk = models.IntegerField(null=True, blank=True, db_index=True)
    google_event_id = models.CharField(max_length=255, blank=True)
    action = models.CharField(max_length=20)          # insert / patch / update / delete
    source = models.CharField(max_length=60)          # which code path asked for it
    send_updates = models.CharField(max_length=10)    # "none" or "all": what Google was told
    guest_count = models.IntegerField(default=0)
    guests = models.JSONField(default=list)           # the addresses; capped when written
    decision_reason = models.CharField(max_length=40, blank=True)
    outcome = models.CharField(max_length=10, choices=OUTCOME_CHOICES, default=OUTCOME_ATTEMPTED)
    error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "send_updates", "created_at"])]

    def __str__(self) -> str:
        return f"{self.action} {self.event_pk} sendUpdates={self.send_updates} {self.outcome}"


class GmailWatchState(models.Model):
    """
    Tracks the active Gmail push-notification watch() for a user.
    Populated by integrations.tasks.register_gmail_watch; historyId is the
    cursor sync_gmail_history_for_user resumes from.
    """

    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name="gmail_watch_state",
    )
    history_id = models.CharField(max_length=64, blank=True, default="")
    expiration = models.DateTimeField(null=True, blank=True)
    pub_sub_topic = models.CharField(max_length=256, blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"{self.user.email} — Gmail watch (expires {self.expiration})"


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


class IntegrationVote(models.Model):
    """A user's YES / "Not now" vote on an integration that isn't configured yet.

    One row per (user, provider); re-voting overwrites. Feeds the future-integrations
    backlog — the Settings page shows it instead of a dead OAuth link.
    """

    VOTE_CHOICES = [("yes", "Yes"), ("not_now", "Not now")]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="integration_votes")
    provider = models.CharField(max_length=40)
    vote = models.CharField(max_length=10, choices=VOTE_CHOICES)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("user", "provider")]
        ordering = ["provider"]

    def __str__(self):
        return f"{self.user} · {self.provider} · {self.vote}"
