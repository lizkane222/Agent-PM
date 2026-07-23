from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("airtable_sync", "0006_actionitemdependency"),
    ]

    operations = [
        migrations.AddField(
            model_name="airtableactionitem",
            name="linked_meeting",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="pinned_action_items",
                to="airtable_sync.airtablemeeting",
            ),
        ),
    ]
