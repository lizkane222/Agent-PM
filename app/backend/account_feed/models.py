"""Per-account sync feed configuration and custom fields."""

from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()

AIRTABLE_FIELD_TYPES = [
    ("singleLineText", "Single line text"),
    ("multilineText", "Long text"),
    ("url", "URL"),
    ("number", "Number"),
    ("checkbox", "Checkbox"),
    ("date", "Date"),
    ("singleSelect", "Single select"),
    ("multipleSelects", "Multiple select"),
    ("multipleAttachments", "Attachment"),
]


class AccountFeedConfig(models.Model):
    """
    Per-account configuration that drives the sync matching engine.

    Standard fields (drive_folders, name_aliases, email_domains, etc.) are stored
    as JSON arrays. Custom fields are separate rows in AccountFeedCustomField.
    """

    account = models.OneToOneField(
        "accounts.Account", on_delete=models.CASCADE, related_name="feed_config"
    )
    drive_folders = models.JSONField(
        default=list, help_text='[{"url": "...", "label": "..."}]'
    )
    name_aliases = models.JSONField(
        default=list, help_text='["Acme Corp", "ACME", "acme.io"]'
    )
    email_domains = models.JSONField(
        default=list, help_text='["acme.com", "acme.io"]'
    )
    confluence_spaces = models.JSONField(default=list, help_text='["~spacekey"]')
    jira_projects = models.JSONField(default=list, help_text='["PROJ", "ENG"]')
    zendesk_groups = models.JSONField(default=list, help_text='[123, 456]')
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="created_feed_configs"
    )
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="updated_feed_configs"
    )

    def __str__(self):
        return f"Feed config for {self.account.company_name}"


class AccountFeedCustomField(models.Model):
    """
    A user-defined extra field on an account's feed config.
    If airtable_field_type is blank at save time, the Airtable field creation
    task determines the type via Claude and populates it afterwards.
    """

    feed_config = models.ForeignKey(
        AccountFeedConfig, on_delete=models.CASCADE, related_name="custom_fields"
    )
    name = models.CharField(max_length=256)
    value = models.TextField(blank=True, default="")
    airtable_field_type = models.CharField(
        max_length=64, choices=AIRTABLE_FIELD_TYPES, blank=True, default=""
    )
    airtable_field_id = models.CharField(
        max_length=64, blank=True, default="", help_text="Populated after Airtable field is created"
    )
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="created_feed_fields"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        unique_together = [("feed_config", "name")]

    def __str__(self):
        return f"{self.name} on {self.feed_config.account.company_name}"
