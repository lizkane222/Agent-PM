import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("agents", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="ClaudeSkill",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=100, unique=True)),
                ("description", models.TextField()),
                ("code", models.TextField()),
                ("review_feedback", models.TextField(blank=True)),
                ("review_suggestions", models.TextField(blank=True)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending_review", "Pending Review"),
                            ("reviewing", "Reviewing"),
                            ("approved", "Approved"),
                            ("rejected", "Rejected"),
                            ("disabled", "Disabled"),
                        ],
                        default="pending_review",
                        max_length=20,
                    ),
                ),
                ("input_schema", models.JSONField(blank=True, default=dict)),
                ("invocation_count", models.PositiveIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "submitted_by",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="submitted_skills",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ["-created_at"]},
        ),
    ]
