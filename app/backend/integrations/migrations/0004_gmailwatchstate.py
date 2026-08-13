from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("integrations", "0003_add_gmail_provider"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="GmailWatchState",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("history_id", models.CharField(blank=True, default="", max_length=64)),
                ("expiration", models.DateTimeField(blank=True, null=True)),
                ("pub_sub_topic", models.CharField(blank=True, default="", max_length=256)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("user", models.OneToOneField(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="gmail_watch_state",
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
        ),
    ]
