# Generated migration: add references JSONField to AirtableMeeting

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("airtable_sync", "0014_airtableactionitem_references"),
    ]

    operations = [
        migrations.AddField(
            model_name="airtablemeeting",
            name="references",
            field=models.JSONField(
                default=list,
                help_text="Records referenced via @# picker: [{resource_type, resource_id, label, url}]",
            ),
        ),
    ]
