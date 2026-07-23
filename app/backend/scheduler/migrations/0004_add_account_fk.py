import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0004_add_account_artifact"),
        ("scheduler", "0003_add_meeting_note"),
    ]

    operations = [
        migrations.AddField(
            model_name="calendarevent",
            name="account",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="calendar_events",
                to="accounts.account",
            ),
        ),
        migrations.AddField(
            model_name="actionitem",
            name="account",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="action_items",
                to="accounts.account",
            ),
        ),
    ]
