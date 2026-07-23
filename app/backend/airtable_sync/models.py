from django.db import models
from django.conf import settings


class AirtableAccount(models.Model):
    airtable_id = models.CharField(max_length=64, unique=True)
    name = models.CharField(max_length=255)
    email_domain = models.CharField(max_length=255, blank=True, default="")
    health_score = models.CharField(max_length=64, blank=True, default="")
    next_meeting = models.DateTimeField(null=True, blank=True)
    open_ticket_count = models.IntegerField(default=0)
    time_budget = models.IntegerField(default=0)  # seconds
    total_meeting_duration = models.IntegerField(default=0)  # seconds
    salesforce_account_id = models.CharField(max_length=128, blank=True, default="")
    segment_workspaces = models.TextField(blank=True, default="")
    last_synced = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class AirtableMeeting(models.Model):
    airtable_id = models.CharField(max_length=64, unique=True)
    account = models.ForeignKey(
        AirtableAccount, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="meetings"
    )
    name = models.CharField(max_length=512, blank=True, default="")
    date = models.DateTimeField(null=True, blank=True)
    duration = models.IntegerField(default=0)  # seconds
    expected_topics = models.TextField(blank=True, default="")
    gong_notes = models.TextField(blank=True, default="")
    gong_url = models.URLField(blank=True, default="")
    customer_slack = models.URLField(blank=True, default="")
    account_team_slack = models.URLField(blank=True, default="")
    last_synced = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date"]

    def __str__(self):
        return self.name or self.airtable_id


class AirtableActionItem(models.Model):
    STATUS_CHOICES = [
        ("Open", "Open"),
        ("In Progress", "In Progress"),
        ("Done", "Done"),
        ("Blocked", "Blocked"),
        ("Backlogged", "Backlogged"),
    ]
    PRIORITY_CHOICES = [
        ("Low", "Low"),
        ("Medium", "Medium"),
        ("High", "High"),
        ("Critical", "Critical"),
    ]

    airtable_id = models.CharField(max_length=64, unique=True)
    account = models.ForeignKey(
        AirtableAccount, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="action_items"
    )
    task = models.CharField(max_length=512)
    task_details = models.TextField(blank=True, default="")
    status = models.CharField(max_length=64, choices=STATUS_CHOICES, default="Open")
    priority = models.CharField(max_length=64, choices=PRIORITY_CHOICES, default="Medium")
    due_date = models.DateTimeField(null=True, blank=True)
    estimated_time = models.IntegerField(default=0)  # seconds
    time_spent = models.IntegerField(default=0)  # seconds
    prep_time = models.IntegerField(default=0)  # seconds
    slack_thread_url = models.TextField(blank=True, default="")
    salesforce_task_id = models.CharField(max_length=128, blank=True, default="")
    assignee_airtable_id = models.CharField(max_length=64, blank=True, default="")
    assignee_name = models.CharField(max_length=255, blank=True, default="")
    # Linked reminder — set when the user schedules a reminder for this item
    reminder = models.ForeignKey(
        "scheduler.Reminder",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="action_items",
    )
    linked_meeting = models.ForeignKey(
        "AirtableMeeting",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="pinned_action_items",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    marked_done_at = models.DateTimeField(null=True, blank=True)
    last_synced = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["status", "due_date"]

    def __str__(self):
        return self.task


class ActionItemAttachment(models.Model):
    ARTIFACT_TYPE_CHOICES = [
        ("link", "Link"),
        ("file", "File"),
    ]

    action_item = models.ForeignKey(
        AirtableActionItem, on_delete=models.CASCADE, related_name="attachments"
    )
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="action_item_attachments"
    )
    artifact_type = models.CharField(max_length=10, choices=ARTIFACT_TYPE_CHOICES, default="link")
    name = models.CharField(max_length=300)
    url = models.TextField(blank=True)
    file = models.FileField(upload_to="action_item_attachments/%Y/%m/", null=True, blank=True)
    mime_type = models.CharField(max_length=100, blank=True)
    file_size = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} → {self.action_item.task}"


class ActionItemDependency(models.Model):
    """Records that `blocked_item` is waiting on `waiting_on_item` to be completed."""
    blocked_item = models.ForeignKey(
        AirtableActionItem, on_delete=models.CASCADE, related_name="waiting_on_deps"
    )
    waiting_on_item = models.ForeignKey(
        AirtableActionItem, on_delete=models.CASCADE, related_name="blocking_deps"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        unique_together = [("blocked_item", "waiting_on_item")]

    def __str__(self):
        return f"{self.blocked_item.task!r} waiting on {self.waiting_on_item.task!r}"


class CalendarEventAccountLink(models.Model):
    """Caches the result of account matching so we don't re-run on every load."""
    calendar_event_uid = models.CharField(max_length=512, unique=True)
    account = models.ForeignKey(
        AirtableAccount, on_delete=models.SET_NULL, null=True, blank=True
    )
    categorization = models.CharField(
        max_length=64, blank=True, default="",
        help_text="e.g. 'Internal Meeting', 'Admin', or empty when account-linked"
    )
    match_method = models.CharField(
        max_length=32, blank=True, default="",
        help_text="domain | title | fulltext | manual"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.calendar_event_uid} → {self.account or self.categorization}"
