from django.db import migrations, models
from django.db.models import F


def backfill(apps, schema_editor):
    Item = apps.get_model("airtable_sync", "AirtableActionItem")
    Item.objects.filter(status="Done", marked_done_at__isnull=False).update(status_changed_at=F("marked_done_at"))
    Item.objects.filter(status_changed_at__isnull=True).update(status_changed_at=F("updated_at"))


class Migration(migrations.Migration):

    dependencies = [("airtable_sync", "0018_live_tracking_sessions")]

    operations = [
        migrations.AddField(
            model_name="airtableactionitem",
            name="status_changed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
