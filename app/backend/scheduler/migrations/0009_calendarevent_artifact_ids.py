# Generated migration: add artifact_ids JSONField to CalendarEvent

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("scheduler", "0008_calendarevent_references"),
    ]

    operations = [
        migrations.AddField(
            model_name="calendarevent",
            name="artifact_ids",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
