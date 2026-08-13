from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class ConfluenceConfig(models.Model):
    """Per-user Atlassian cloud site info for Confluence, discovered on first connect."""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="confluence_config")
    cloud_id = models.CharField(max_length=64)
    cloud_name = models.CharField(max_length=255, blank=True, default="")
    atlassian_email = models.EmailField(blank=True, default="")
    last_synced = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.email} → {self.cloud_name or self.cloud_id}"


class ConfluencePage(models.Model):
    """Mirror of a Confluence page — dedup key is page_id."""
    page_id = models.CharField(max_length=64, unique=True)
    cloud_id = models.CharField(max_length=64)
    title = models.CharField(max_length=512)
    space_key = models.CharField(max_length=64, blank=True, default="")
    space_name = models.CharField(max_length=255, blank=True, default="")
    url = models.TextField(blank=True, default="")
    last_modified = models.DateTimeField(null=True, blank=True)
    local_note = models.ForeignKey(
        "accounts.AccountNote",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="confluence_pages",
    )
    local_artifact = models.ForeignKey(
        "accounts.AccountArtifact",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="confluence_pages",
    )
    last_synced = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-last_modified"]

    def __str__(self):
        return self.title
