from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("skills", "0003_add_command_to_skill"),
    ]

    operations = [
        migrations.AddField(
            model_name="claudeskill",
            name="roles",
            field=models.JSONField(
                blank=True,
                default=list,
                help_text="Role tags this skill appears under, e.g. ['Solutions Architect', 'CSM'].",
            ),
        ),
    ]
