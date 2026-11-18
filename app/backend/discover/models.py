from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()

ITEM_TYPE_CHOICES = [
    ("applet", "Applet"),
    ("repo",   "Repo"),
    ("tool",   "Tool"),
    ("site",   "Site"),
    ("doc",    "Doc"),
]

CATEGORY_CHOICES = [
    ("Automation",   "Automation"),
    ("Dashboard",    "Dashboard"),
    ("Bot",          "Bot"),
    ("Integration",  "Integration"),
    ("Tool",         "Tool"),
    ("Game",         "Game"),
    ("Utility",      "Utility"),
    ("Documentation", "Documentation"),
    ("Reference",    "Reference"),
    ("Reporting",    "Reporting"),
    ("Communication", "Communication"),
    ("Data",         "Data"),
    ("AI",           "AI"),
    ("Security",     "Security"),
    ("Productivity", "Productivity"),
]

class Applet(models.Model):
    type        = models.CharField(max_length=10, choices=ITEM_TYPE_CHOICES, default="applet")
    name        = models.CharField(max_length=200)
    description = models.TextField()
    url         = models.URLField(max_length=500)
    category    = models.CharField(max_length=30, choices=CATEGORY_CHOICES, default="Tool")
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


class AppletPin(models.Model):
    """A user's pin of an applet/tool/repo.

    `account` null = a pin on the user's own profile (private to them). An account pin
    is visible to everyone on that account; one pin per (applet, account), whoever made it.
    """
    applet = models.ForeignKey(Applet, on_delete=models.CASCADE, related_name="pins")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="applet_pins")
    account = models.ForeignKey(
        "accounts.Account", on_delete=models.CASCADE, null=True, blank=True,
        related_name="applet_pins",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["applet", "user", "account"], name="uniq_applet_user_account_pin"),
            models.UniqueConstraint(
                fields=["applet", "account"], condition=models.Q(account__isnull=False),
                name="uniq_applet_account_pin",
            ),
            models.UniqueConstraint(
                fields=["applet", "user"], condition=models.Q(account__isnull=True),
                name="uniq_applet_profile_pin",
            ),
        ]

    def __str__(self):
        return f"{self.applet_id} pinned by {self.user_id} to {self.account_id or 'profile'}"
