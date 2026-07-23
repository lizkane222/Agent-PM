from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class SalesforceConfig(models.Model):
    """Per-user Salesforce connection config — namespace discovered on first connect."""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="sf_config")
    instance_url = models.URLField()
    namespace = models.CharField(
        max_length=32, blank=True, default="cc4sf",
        help_text="Cloud Coach package namespace, auto-discovered on connect."
    )
    sf_user_id = models.CharField(max_length=64, blank=True, default="")
    sf_user_email = models.CharField(max_length=255, blank=True, default="")
    last_synced = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.email} → {self.instance_url}"


class SalesforceAccount(models.Model):
    sf_id = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=255)
    website = models.URLField(blank=True, default="")
    industry = models.CharField(max_length=128, blank=True, default="")
    account_type = models.CharField(max_length=64, blank=True, default="")
    phone = models.CharField(max_length=64, blank=True, default="")
    billing_city = models.CharField(max_length=128, blank=True, default="")
    billing_country = models.CharField(max_length=128, blank=True, default="")
    owner_sf_id = models.CharField(max_length=32, blank=True, default="")
    owner_name = models.CharField(max_length=255, blank=True, default="")
    last_synced = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class SalesforceProject(models.Model):
    """Cloud Coach Project (cc4sf__Project__c)."""
    sf_id = models.CharField(max_length=32, unique=True)
    account = models.ForeignKey(
        SalesforceAccount, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="projects"
    )
    name = models.CharField(max_length=512)
    status = models.CharField(max_length=64, blank=True, default="")
    description = models.TextField(blank=True, default="")
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    owner_sf_id = models.CharField(max_length=32, blank=True, default="")
    owner_name = models.CharField(max_length=255, blank=True, default="")
    last_synced = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-start_date", "name"]

    def __str__(self):
        return self.name


class SalesforceTeamMember(models.Model):
    """Cloud Coach Project Member — maps to a local TeamMember."""
    sf_id = models.CharField(max_length=32, unique=True)
    project = models.ForeignKey(
        SalesforceProject, on_delete=models.CASCADE, related_name="members"
    )
    sf_user_id = models.CharField(max_length=32, blank=True, default="")
    name = models.CharField(max_length=255)
    email = models.EmailField(blank=True, default="")
    role = models.CharField(max_length=128, blank=True, default="")
    # Linked local team member (created/found on sync)
    local_member_id = models.IntegerField(null=True, blank=True)
    last_synced = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} on {self.project.name}"


class SalesforceTask(models.Model):
    """Cloud Coach Task (cc4sf__Task__c) — synced as action items."""
    sf_id = models.CharField(max_length=32, unique=True)
    project = models.ForeignKey(
        SalesforceProject, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="tasks"
    )
    account = models.ForeignKey(
        SalesforceAccount, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="tasks"
    )
    subject = models.CharField(max_length=512)
    status = models.CharField(max_length=64, blank=True, default="")
    priority = models.CharField(max_length=64, blank=True, default="")
    due_date = models.DateField(null=True, blank=True)
    description = models.TextField(blank=True, default="")
    assigned_to_sf_id = models.CharField(max_length=32, blank=True, default="")
    assigned_to_name = models.CharField(max_length=255, blank=True, default="")
    last_synced = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["due_date", "subject"]

    def __str__(self):
        return self.subject


class LogTimeDayAssignment(models.Model):
    """Persists which SF projects a user has assigned to a specific calendar day for time logging."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="log_time_assignments")
    date = models.DateField()
    project = models.ForeignKey(
        SalesforceProject, on_delete=models.CASCADE, related_name="day_assignments"
    )
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["date", "position"]
        unique_together = [["user", "date", "project"]]

    def __str__(self):
        return f"{self.user} — {self.project.name} on {self.date}"


class SalesforceTimeEntry(models.Model):
    """
    Local record of a time entry written back to Salesforce Cloud Coach.
    Kept for audit / retry on failure.
    """
    sf_id = models.CharField(max_length=32, blank=True, default="")
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    project = models.ForeignKey(
        SalesforceProject, on_delete=models.SET_NULL, null=True, blank=True
    )
    task = models.ForeignKey(
        SalesforceTask, on_delete=models.SET_NULL, null=True, blank=True
    )
    date = models.DateField()
    duration_minutes = models.IntegerField()
    description = models.TextField(blank=True, default="")
    synced_to_sf = models.BooleanField(default=False)
    sync_error = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-created_at"]

    def __str__(self):
        return f"{self.user} — {self.duration_minutes}m on {self.date}"
