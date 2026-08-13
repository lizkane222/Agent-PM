from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("accounts", "0014_accountrole"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="SyncReviewItem",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("source", models.CharField(
                    choices=[("gdrive", "Google Drive"), ("gmail", "Gmail"), ("confluence", "Confluence"),
                             ("jira", "JIRA"), ("zendesk", "Zendesk")],
                    max_length=32,
                )),
                ("source_id", models.CharField(max_length=256)),
                ("source_url", models.TextField(blank=True, default="")),
                ("content_type", models.CharField(
                    choices=[("document", "Document"), ("email", "Email"), ("ticket", "Ticket"),
                             ("page", "Page"), ("internal_email", "Internal Email (sensitive)")],
                    max_length=32,
                )),
                ("raw_content", models.JSONField(default=dict)),
                ("status", models.CharField(
                    choices=[("pending_agent", "Pending Agent Review"), ("pending_human", "Pending Human Review"),
                             ("accepted", "Accepted"), ("rejected", "Rejected"), ("unassigned", "Unassigned")],
                    default="pending_agent",
                    max_length=20,
                )),
                ("confidence_score", models.FloatField(blank=True, null=True)),
                ("claude_analysis", models.TextField(blank=True, default="")),
                ("is_sensitive", models.BooleanField(default=False)),
                ("reviewed_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("reviewed_by", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="reviewed_sync_items",
                    to=settings.AUTH_USER_MODEL,
                )),
                ("suggested_account", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="sync_suggestions",
                    to="accounts.account",
                )),
            ],
            options={"ordering": ["-created_at"], "unique_together": {("source", "source_id")}},
        ),
        migrations.CreateModel(
            name="SyncDeleteRequest",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("status", models.CharField(
                    choices=[("pending", "Pending"), ("approved", "Approved"), ("rejected", "Rejected")],
                    default="pending",
                    max_length=16,
                )),
                ("reason", models.TextField(blank=True, default="")),
                ("claude_mismatch_analysis", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("resolved_at", models.DateTimeField(blank=True, null=True)),
                ("account", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="sync_delete_requests",
                    to="accounts.account",
                )),
                ("requested_by", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="requested_sync_deletions",
                    to=settings.AUTH_USER_MODEL,
                )),
                ("review_item", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="delete_requests",
                    to="sync_review.syncreviewitem",
                )),
                ("reviewed_by", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="resolved_sync_deletions",
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={"ordering": ["-created_at"]},
        ),
    ]
