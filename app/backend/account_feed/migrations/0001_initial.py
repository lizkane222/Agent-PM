from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("accounts", "0014_accountrole"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="AccountFeedConfig",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("drive_folders", models.JSONField(default=list)),
                ("name_aliases", models.JSONField(default=list)),
                ("email_domains", models.JSONField(default=list)),
                ("confluence_spaces", models.JSONField(default=list)),
                ("jira_projects", models.JSONField(default=list)),
                ("zendesk_groups", models.JSONField(default=list)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("account", models.OneToOneField(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="feed_config",
                    to="accounts.account",
                )),
                ("created_by", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="created_feed_configs",
                    to=settings.AUTH_USER_MODEL,
                )),
                ("updated_by", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="updated_feed_configs",
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
        ),
        migrations.CreateModel(
            name="AccountFeedCustomField",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=256)),
                ("value", models.TextField(blank=True, default="")),
                ("airtable_field_type", models.CharField(
                    blank=True,
                    choices=[
                        ("singleLineText", "Single line text"),
                        ("multilineText", "Long text"),
                        ("url", "URL"),
                        ("number", "Number"),
                        ("checkbox", "Checkbox"),
                        ("date", "Date"),
                        ("singleSelect", "Single select"),
                        ("multipleSelects", "Multiple select"),
                        ("multipleAttachments", "Attachment"),
                    ],
                    default="",
                    max_length=64,
                )),
                ("airtable_field_id", models.CharField(blank=True, default="", max_length=64)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("created_by", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="created_feed_fields",
                    to=settings.AUTH_USER_MODEL,
                )),
                ("feed_config", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="custom_fields",
                    to="account_feed.accountfeedconfig",
                )),
            ],
            options={"ordering": ["name"], "unique_together": {("feed_config", "name")}},
        ),
    ]
