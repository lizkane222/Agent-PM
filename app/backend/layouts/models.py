from django.conf import settings
from django.db import models


class PageLayout(models.Model):
    name = models.CharField(max_length=255)
    creator = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_layouts",
    )
    forked_from = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="forks",
    )
    # The full canvas node tree serialized as JSON
    nodes = models.JSONField(default=list)
    is_public = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.name

    @property
    def heart_count(self):
        return self.interactions.filter(hearted=True).count()

    @property
    def fork_count(self):
        return self.forks.count()


class LayoutInteraction(models.Model):
    """Tracks per-user heart and pin state for a layout."""
    layout = models.ForeignKey(
        PageLayout,
        on_delete=models.CASCADE,
        related_name="interactions",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="layout_interactions",
    )
    hearted = models.BooleanField(default=False)
    pinned = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("layout", "user")]
        ordering = ["-updated_at"]

    def __str__(self):
        return f"{self.user} / {self.layout.name}"


class WorkingSession(models.Model):
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="working_sessions",
    )
    name = models.CharField(max_length=255)
    canvas_nodes = models.JSONField(default=list)
    record_refs = models.JSONField(default=list)
    airtable_id = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return self.name


class UserPageNote(models.Model):
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="page_notes",
    )
    content = models.TextField(blank=True)
    account_ref_label = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return f"{self.owner} note"
