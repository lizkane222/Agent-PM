from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("scheduler", "0004_add_account_fk"),
    ]

    operations = [
        migrations.AddField(
            model_name="calendarevent",
            name="agentpm_airtable_id",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
    ]
