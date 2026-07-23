from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("airtable_sync", "0004_add_segment_workspaces"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="ActionItemAttachment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("action_item", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="attachments",
                    to="airtable_sync.airtableactionitem",
                )),
                ("uploaded_by", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="action_item_attachments",
                    to=settings.AUTH_USER_MODEL,
                )),
                ("artifact_type", models.CharField(
                    choices=[("link", "Link"), ("file", "File")],
                    default="link", max_length=10,
                )),
                ("name", models.CharField(max_length=300)),
                ("url", models.TextField(blank=True)),
                ("file", models.FileField(blank=True, null=True, upload_to="action_item_attachments/%Y/%m/")),
                ("mime_type", models.CharField(blank=True, max_length=100)),
                ("file_size", models.PositiveIntegerField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ["-created_at"]},
        ),
    ]
