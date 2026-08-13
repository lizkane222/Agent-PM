"""Models for the two-tier sync review queue."""

from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class SyncReviewItem(models.Model):
    """
    Staging record for content pulled from an external integration.

    Flow:
      1. Sync task creates a SyncReviewItem (status=pending_agent).
      2. run_agent_review Celery task scores confidence:
           >= 0.90 → accepted, writes the local record directly.
           0.50–0.89 → pending_human, suggested_account set.
           < 0.50 → unassigned.
      3. Human reviewer accepts/rejects via the API.
      4. If a reviewer later unlinks an accepted item, a SyncDeleteRequest
         is created and an account_owner must approve it.
    """

    STATUS_CHOICES = [
        ("pending_agent", "Pending Agent Review"),
        ("pending_human", "Pending Human Review"),
        ("accepted", "Accepted"),
        ("rejected", "Rejected"),
        ("unassigned", "Unassigned"),
    ]

    SOURCE_CHOICES = [
        ("gdrive", "Google Drive"),
        ("gmail", "Gmail"),
        ("confluence", "Confluence"),
        ("jira", "JIRA"),
        ("zendesk", "Zendesk"),
    ]

    CONTENT_TYPE_CHOICES = [
        ("document", "Document"),
        ("email", "Email"),
        ("ticket", "Ticket"),
        ("page", "Page"),
        ("internal_email", "Internal Email (sensitive)"),
    ]

    source = models.CharField(max_length=32, choices=SOURCE_CHOICES)
    source_id = models.CharField(max_length=256, help_text="External system record ID")
    source_url = models.TextField(blank=True, default="")
    content_type = models.CharField(max_length=32, choices=CONTENT_TYPE_CHOICES)
    raw_content = models.JSONField(default=dict, help_text="Snapshot of scraped data")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending_agent")

    suggested_account = models.ForeignKey(
        "accounts.Account",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sync_suggestions",
    )
    confidence_score = models.FloatField(null=True, blank=True, help_text="0.0–1.0, set by agent")
    claude_analysis = models.TextField(blank=True, default="")
    is_sensitive = models.BooleanField(
        default=False,
        help_text="True for internal-only emails; only included if explicitly approved",
    )

    reviewed_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="reviewed_sync_items"
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("source", "source_id")]
        ordering = ["-created_at"]

    def __str__(self):
        return f"[{self.source}] {self.source_id} — {self.status}"


class SyncDeleteRequest(models.Model):
    """
    Created when a sync_reviewer requests that an accepted item be removed from an account.
    An account_owner must approve; on approval Claude analyses the mismatch.
    """

    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("approved", "Approved"),
        ("rejected", "Rejected"),
    ]

    review_item = models.ForeignKey(
        SyncReviewItem, on_delete=models.CASCADE, related_name="delete_requests"
    )
    account = models.ForeignKey(
        "accounts.Account", on_delete=models.CASCADE, related_name="sync_delete_requests"
    )
    requested_by = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="requested_sync_deletions"
    )
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="pending")
    reviewed_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="resolved_sync_deletions"
    )
    reason = models.TextField(blank=True, default="")
    claude_mismatch_analysis = models.TextField(
        blank=True, default="", help_text="Populated by agent after approval"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Delete request for {self.review_item} by {self.requested_by.email}"
