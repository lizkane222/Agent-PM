"""
Fake initial migration — CalendarEvent, ActionItem, and Task tables were
created before migration tracking was enabled for this app.
"""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="CalendarEvent",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False)),
                ("google_event_id", models.CharField(blank=True, db_index=True, max_length=255)),
                ("title", models.CharField(max_length=500)),
                ("description", models.TextField(blank=True)),
                ("location", models.CharField(blank=True, max_length=500)),
                ("start_datetime", models.DateTimeField()),
                ("end_datetime", models.DateTimeField()),
                ("all_day", models.BooleanField(default=False)),
                ("status", models.CharField(choices=[("confirmed","Confirmed"),("tentative","Tentative"),("cancelled","Cancelled")], default="confirmed", max_length=20)),
                ("attendees", models.JSONField(default=list)),
                ("meet_link", models.URLField(blank=True)),
                ("calendar_id", models.CharField(default="primary", max_length=255)),
                ("is_synced", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("owner", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="calendar_events", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["start_datetime"]},
        ),
        migrations.CreateModel(
            name="ActionItem",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False)),
                ("title", models.CharField(max_length=500)),
                ("notes", models.TextField(blank=True)),
                ("priority", models.CharField(choices=[("urgent","Urgent"),("high","High"),("normal","Normal"),("low","Low")], default="normal", max_length=20)),
                ("status", models.CharField(choices=[("open","Open"),("in_progress","In Progress"),("done","Done"),("dismissed","Dismissed")], default="open", max_length=20)),
                ("due_date", models.DateField(blank=True, null=True)),
                ("airtable_record_id", models.CharField(blank=True, max_length=100)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("assigned_to", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="action_items", to=settings.AUTH_USER_MODEL)),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_action_items", to=settings.AUTH_USER_MODEL)),
                ("source_event", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="action_items", to="scheduler.calendarevent")),
            ],
            options={"ordering": ["-priority", "due_date"]},
        ),
        migrations.CreateModel(
            name="Task",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False)),
                ("title", models.CharField(max_length=500)),
                ("description", models.TextField(blank=True)),
                ("status", models.CharField(choices=[("backlog","Backlog"),("todo","To Do"),("in_progress","In Progress"),("review","In Review"),("done","Done"),("archived","Archived")], default="todo", max_length=20)),
                ("priority", models.CharField(choices=[("urgent","Urgent"),("high","High"),("normal","Normal"),("low","Low")], default="normal", max_length=20)),
                ("due_date", models.DateField(blank=True, null=True)),
                ("tags", models.JSONField(default=list)),
                ("airtable_record_id", models.CharField(blank=True, max_length=100)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("action_item", models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="task", to="scheduler.actionitem")),
                ("assigned_to", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="tasks", to=settings.AUTH_USER_MODEL)),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_tasks", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-priority", "due_date", "title"]},
        ),
    ]
