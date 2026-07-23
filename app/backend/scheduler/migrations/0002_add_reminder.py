"""Add Reminder model to scheduler app."""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("scheduler", "0001_initial_fake"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Reminder",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False)),
                ("title", models.CharField(max_length=500)),
                ("body", models.TextField(blank=True)),
                ("resource_type", models.CharField(
                    blank=True,
                    choices=[
                        ("account", "Account"),
                        ("calendar_event", "Calendar Event"),
                        ("action_item", "Action Item"),
                        ("task", "Task"),
                        ("general", "General"),
                    ],
                    default="general",
                    max_length=30,
                )),
                ("resource_id", models.PositiveIntegerField(blank=True, null=True)),
                ("resource_label", models.CharField(blank=True, max_length=300)),
                ("due_at", models.DateTimeField()),
                ("notify_in_app", models.BooleanField(default=True)),
                ("notify_slack", models.BooleanField(default=False)),
                ("notify_push", models.BooleanField(default=False)),
                ("notify_sms", models.BooleanField(default=False)),
                ("status", models.CharField(
                    choices=[
                        ("pending", "Pending"),
                        ("sent", "Sent"),
                        ("dismissed", "Dismissed"),
                        ("snoozed", "Snoozed"),
                    ],
                    default="pending",
                    max_length=20,
                )),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="reminders",
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={"ordering": ["due_at"]},
        ),
    ]
