from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('team', '0005_userprofile_calendar_colors'),
    ]

    operations = [
        migrations.AddField(
            model_name='userprofile',
            name='gmail_watch_config',
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
