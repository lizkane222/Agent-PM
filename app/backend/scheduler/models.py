"""Models for calendar events, action items, and tasks."""

from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class CalendarEvent(models.Model):
    """A calendar event synced from or pushed to Google Calendar."""

    STATUS_CHOICES = [
        ("confirmed", "Confirmed"),
        ("tentative", "Tentative"),
        ("cancelled", "Cancelled"),
    ]

    EVENT_CATEGORY_CHOICES = [
        ("meeting", "Meeting"),
        ("task", "Task"),
        ("out_of_office", "Out of Office"),
        ("focus_time", "Focus Time"),
        ("working_location", "Working Location"),
        ("appointment", "Appointment Schedule"),
    ]

    owner = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="calendar_events",
    )
    account = models.ForeignKey(
        "accounts.Account",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="calendar_events",
    )
    google_event_id = models.CharField(max_length=255, blank=True, db_index=True)
    title = models.CharField(max_length=500)
    description = models.TextField(blank=True)
    location = models.CharField(max_length=500, blank=True)
    start_datetime = models.DateTimeField()
    end_datetime = models.DateTimeField()
    all_day = models.BooleanField(default=False)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="confirmed")
    attendees = models.JSONField(
        default=list,
        help_text="List of attendee objects: [{email, displayName, responseStatus}]",
    )
    meet_link = models.URLField(blank=True)
    calendar_id = models.CharField(max_length=255, default="primary")
    is_synced = models.BooleanField(default=False)
    event_category = models.CharField(
        max_length=30, choices=EVENT_CATEGORY_CHOICES, blank=True, default="meeting"
    )
    # For events pushed from AgentPM (action items), stores the originating Airtable record ID
    agentpm_airtable_id = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["start_datetime"]

    def __str__(self) -> str:
        return f"{self.title} ({self.start_datetime:%Y-%m-%d %H:%M})"


class ActionItem(models.Model):
    """
    A follow-up action identified by the agent from a meeting, email, or conversation.
    """

    PRIORITY_CHOICES = [
        ("urgent", "Urgent"),
        ("high", "High"),
        ("normal", "Normal"),
        ("low", "Low"),
    ]

    STATUS_CHOICES = [
        ("open", "Open"),
        ("in_progress", "In Progress"),
        ("done", "Done"),
        ("dismissed", "Dismissed"),
    ]

    assigned_to = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="action_items",
    )
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_action_items",
    )
    title = models.CharField(max_length=500)
    notes = models.TextField(blank=True)
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default="normal")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="open")
    due_date = models.DateField(null=True, blank=True)
    source_event = models.ForeignKey(
        CalendarEvent,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="action_items",
    )
    account = models.ForeignKey(
        "accounts.Account",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="action_items",
    )
    airtable_record_id = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-priority", "due_date"]

    def __str__(self) -> str:
        return f"[{self.priority.upper()}] {self.title}"


class Task(models.Model):
    """A discrete task that can be assigned to a team member and tracked."""

    STATUS_CHOICES = [
        ("backlog", "Backlog"),
        ("todo", "To Do"),
        ("in_progress", "In Progress"),
        ("review", "In Review"),
        ("done", "Done"),
        ("archived", "Archived"),
    ]

    PRIORITY_CHOICES = [
        ("urgent", "Urgent"),
        ("high", "High"),
        ("normal", "Normal"),
        ("low", "Low"),
    ]

    title = models.CharField(max_length=500)
    description = models.TextField(blank=True)
    assigned_to = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="tasks",
    )
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_tasks",
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="todo")
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default="normal")
    due_date = models.DateField(null=True, blank=True)
    tags = models.JSONField(default=list)
    action_item = models.OneToOneField(
        ActionItem,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="task",
    )
    airtable_record_id = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-priority", "due_date", "title"]

    def __str__(self) -> str:
        return f"{self.title} ({self.status})"


class Reminder(models.Model):
    """A user-created reminder that can link to any resource and notify via multiple channels."""

    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("sent", "Sent"),
        ("dismissed", "Dismissed"),
        ("snoozed", "Snoozed"),
    ]

    RESOURCE_TYPE_CHOICES = [
        ("account", "Account"),
        ("calendar_event", "Calendar Event"),
        ("action_item", "Action Item"),
        ("task", "Task"),
        ("general", "General"),
    ]

    created_by = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="reminders",
    )
    title = models.CharField(max_length=500)
    body = models.TextField(blank=True)

    # Generic resource link (optional)
    resource_type = models.CharField(
        max_length=30, choices=RESOURCE_TYPE_CHOICES, default="general", blank=True
    )
    resource_id = models.PositiveIntegerField(null=True, blank=True)
    resource_label = models.CharField(max_length=300, blank=True)  # display name of linked resource

    # Scheduling
    due_at = models.DateTimeField()

    # Notification channels
    notify_in_app = models.BooleanField(default=True)
    notify_slack = models.BooleanField(default=False)
    notify_push = models.BooleanField(default=False)
    notify_sms = models.BooleanField(default=False)

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["due_at"]

    def __str__(self) -> str:
        return f"[{self.status}] {self.title} @ {self.due_at:%Y-%m-%d %H:%M}"


class MeetingNote(models.Model):
    """A single bullet-point note attached to a calendar event, editable by multiple users."""

    event = models.ForeignKey(
        CalendarEvent,
        on_delete=models.CASCADE,
        related_name="notes",
    )
    author = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="meeting_notes",
    )
    # HTML content — bold/italic/links are stored as safe inline HTML
    html = models.TextField(blank=True)
    # Plain-text fallback for search / display
    text = models.TextField(blank=True)
    # Optional due date on this specific bullet
    due_date = models.DateField(null=True, blank=True)
    # Sort order so bullets stay in insertion order
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["position", "created_at"]

    def __str__(self) -> str:
        return f"Note on {self.event_id} by {self.author_id}: {self.text[:60]}"
