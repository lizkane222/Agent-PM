from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("airtable_sync", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="airtableactionitem",
            name="task_details",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="airtableactionitem",
            name="assignee_airtable_id",
            field=models.CharField(max_length=64, blank=True, default=""),
        ),
        migrations.AddField(
            model_name="airtableactionitem",
            name="assignee_name",
            field=models.CharField(max_length=255, blank=True, default=""),
        ),
    ]
