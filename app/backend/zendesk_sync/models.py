from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class ZendeskConfig(models.Model):
    """Per-user Zendesk subdomain config, set on first connect."""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="zendesk_config")
    subdomain = models.CharField(max_length=128)
    last_synced = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.email} → {self.subdomain}.zendesk.com"


class ZendeskTicket(models.Model):
    """Mirror of a Zendesk ticket — dedup key is zendesk_id."""
    zendesk_id = models.BigIntegerField(unique=True)
    subdomain = models.CharField(max_length=128)
    subject = models.CharField(max_length=512)
    description = models.TextField(blank=True, default="")
    zendesk_status = models.CharField(max_length=32, blank=True, default="")
    zendesk_priority = models.CharField(max_length=32, blank=True, default="")
    requester_email = models.CharField(max_length=255, blank=True, default="")
    assignee_id = models.BigIntegerField(null=True, blank=True)
    ticket_created_at = models.DateTimeField(null=True, blank=True)
    ticket_updated_at = models.DateTimeField(null=True, blank=True)
    url = models.TextField(blank=True, default="")
    local_action_item = models.ForeignKey(
        "scheduler.ActionItem",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="zendesk_tickets",
    )
    last_synced = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-ticket_updated_at"]

    def __str__(self):
        return f"#{self.zendesk_id}: {self.subject}"
