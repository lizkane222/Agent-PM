from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("team", "0003_add_notification_defaults_and_push_subscription"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="staff_view_override",
            field=models.BooleanField(
                default=True,
                help_text="Staff only: when disabled, restricts data visibility to personally assigned records.",
            ),
        ),
    ]
