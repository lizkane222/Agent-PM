# Generated migration: add references JSONField to AccountNote

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0017_merge_orphan_admin_accounts"),
    ]

    operations = [
        migrations.AddField(
            model_name="accountnote",
            name="references",
            field=models.JSONField(
                default=list,
                help_text="Records referenced via @# picker: [{resource_type, resource_id, label, url}]",
            ),
        ),
    ]
