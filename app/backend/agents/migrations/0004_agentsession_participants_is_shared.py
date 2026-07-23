from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("agents", "0003_remove_claude_skill"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="agentsession",
            name="is_shared",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="agentsession",
            name="participants",
            field=models.ManyToManyField(
                blank=True,
                related_name="shared_sessions",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
