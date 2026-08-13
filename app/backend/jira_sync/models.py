from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class JiraConfig(models.Model):
    """Per-user Atlassian cloud site info for JIRA, discovered on first connect."""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="jira_config")
    cloud_id = models.CharField(max_length=64)
    cloud_name = models.CharField(max_length=255, blank=True, default="")
    last_synced = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.email} → {self.cloud_name or self.cloud_id}"


class JiraTicket(models.Model):
    """Mirror of a JIRA issue — dedup key is jira_key (e.g. PROJ-123)."""
    jira_key = models.CharField(max_length=64, unique=True)
    cloud_id = models.CharField(max_length=64)
    issue_id = models.CharField(max_length=64, blank=True, default="")
    summary = models.CharField(max_length=512)
    description = models.TextField(blank=True, default="")
    issue_type = models.CharField(max_length=64, blank=True, default="")
    jira_status = models.CharField(max_length=64, blank=True, default="")
    jira_priority = models.CharField(max_length=64, blank=True, default="")
    assignee_email = models.CharField(max_length=255, blank=True, default="")
    due_date = models.DateField(null=True, blank=True)
    url = models.TextField(blank=True, default="")
    local_action_item = models.ForeignKey(
        "scheduler.ActionItem",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="jira_tickets",
    )
    last_synced = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-last_synced"]

    def __str__(self):
        return f"{self.jira_key}: {self.summary}"
