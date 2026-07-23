from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("skills", "0005_add_agentskill"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="agentskill",
            name="pinned_to_roles",
            field=models.JSONField(
                blank=True, default=list,
                help_text="Role labels this skill is pinned to, e.g. ['Solutions Architect'].",
            ),
        ),
        migrations.AddField(
            model_name="agentskill",
            name="pinned_to_users",
            field=models.ManyToManyField(
                blank=True,
                help_text="Users who have pinned this skill to their profile.",
                related_name="pinned_agent_skills",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
