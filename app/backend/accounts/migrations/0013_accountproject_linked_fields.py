from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0012_add_account_project'),
    ]

    operations = [
        migrations.AddField(
            model_name='accountproject',
            name='url',
            field=models.CharField(blank=True, default='', max_length=2048),
        ),
        migrations.AddField(
            model_name='accountproject',
            name='action_ids',
            field=models.JSONField(default=list),
        ),
        migrations.AddField(
            model_name='accountproject',
            name='meeting_ids',
            field=models.JSONField(default=list),
        ),
        migrations.AddField(
            model_name='accountproject',
            name='goal_ids',
            field=models.JSONField(default=list),
        ),
        migrations.AddField(
            model_name='accountproject',
            name='resources',
            field=models.JSONField(default=list),
        ),
    ]
