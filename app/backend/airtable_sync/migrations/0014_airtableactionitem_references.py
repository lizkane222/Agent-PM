# Generated migration: add references JSONField to AirtableActionItem

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("airtable_sync", "0013_airtablemeeting_zoom_notes_airtablemeeting_zoom_url"),
    ]

    operations = [
        migrations.AddField(
            model_name="airtableactionitem",
            name="references",
            field=models.JSONField(
                default=list,
                help_text="Records referenced via @# picker: [{resource_type, resource_id, label, url}]",
            ),
        ),
    ]
