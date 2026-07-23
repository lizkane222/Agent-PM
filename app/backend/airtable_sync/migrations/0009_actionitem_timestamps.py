from django.db import migrations, models
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        ("airtable_sync", "0008_alter_actionitemdependency_blocked_item_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="airtableactionitem",
            name="created_at",
            field=models.DateTimeField(auto_now_add=True, default=django.utils.timezone.now),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="airtableactionitem",
            name="updated_at",
            field=models.DateTimeField(auto_now=True),
        ),
        migrations.AddField(
            model_name="airtableactionitem",
            name="marked_done_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
