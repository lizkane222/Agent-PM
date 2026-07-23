from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("skills", "0004_add_roles_to_skill"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="AgentSkill",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(help_text="kebab-case, unique per team.", max_length=100, unique=True)),
                ("description", models.TextField(help_text="What it does AND when to use it. This is the auto-trigger signal.")),
                ("instructions", models.TextField(help_text="Markdown steps Claude follows when this skill is active.")),
                ("allowed_tools", models.JSONField(blank=True, default=list, help_text="Whitelist of platform tool names this skill may reference.")),
                ("scripts", models.JSONField(blank=True, default=list, help_text="List of {filename, language, code} objects for deterministic computation.")),
                ("references", models.JSONField(blank=True, default=list, help_text="Supporting docs loaded on demand.")),
                ("status", models.CharField(choices=[("draft", "Draft"), ("pending_review", "Pending Review"), ("approved", "Approved"), ("rejected", "Rejected")], default="draft", max_length=20)),
                ("visibility", models.CharField(choices=[("private", "Private"), ("team", "Team"), ("public", "Public")], default="private", max_length=20)),
                ("review_verdict", models.CharField(blank=True, default="", max_length=20)),
                ("review_findings", models.JSONField(blank=True, default=dict)),
                ("reviewed_at", models.DateTimeField(blank=True, null=True)),
                ("version", models.PositiveIntegerField(default=1)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="agent_skills", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "verbose_name": "Agent Skill",
                "verbose_name_plural": "Agent Skills",
                "ordering": ["-created_at"],
            },
        ),
    ]
