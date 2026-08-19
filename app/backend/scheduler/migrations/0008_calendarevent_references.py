# Generated migration: add references JSONField to CalendarEvent

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("scheduler", "0007_calendarevent_attended"),
    ]

    operations = [
        migrations.AddField(
            model_name="calendarevent",
            name="references",
            field=models.JSONField(
                default=list,
                help_text="Records referenced via @# picker: [{resource_type, resource_id, label, url}]",
            ),
        ),
    ]
