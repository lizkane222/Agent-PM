from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("airtable_sync", "0005_actionitemattachment"),
    ]

    operations = [
        migrations.CreateModel(
            name="ActionItemDependency",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("blocked_item", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="waiting_on_deps",
                    to="airtable_sync.airtableactionitem",
                    help_text="The item that is waiting.",
                )),
                ("waiting_on_item", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="blocking_deps",
                    to="airtable_sync.airtableactionitem",
                    help_text="The item that must be completed first.",
                )),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "ordering": ["created_at"],
                "unique_together": {("blocked_item", "waiting_on_item")},
            },
        ),
    ]
