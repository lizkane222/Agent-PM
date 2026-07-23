from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()

ITEM_TYPE_CHOICES = [
    ("applet", "Applet"),
    ("repo",   "GitHub Repo"),
]

CATEGORY_CHOICES = [
    ("Automation",   "Automation"),
    ("Dashboard",    "Dashboard"),
    ("Bot",          "Bot"),
    ("Integration",  "Integration"),
    ("Tool",         "Tool"),
    ("Game",         "Game"),
    ("Utility",      "Utility"),
]

class Applet(models.Model):
    type        = models.CharField(max_length=10, choices=ITEM_TYPE_CHOICES, default="applet")
    name        = models.CharField(max_length=200)
    description = models.TextField()
    url         = models.URLField(max_length=500)
    category    = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default="Tool")
    author      = models.CharField(max_length=200)
    tags        = models.JSONField(default=list, blank=True)
    airtable_id = models.CharField(max_length=50, blank=True, default="")
    submitted_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="submitted_applets",
    )
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Applet"
        verbose_name_plural = "Applets"

    def __str__(self):
        return self.name
