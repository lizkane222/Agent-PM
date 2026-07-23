from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('realtime', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='agentactivityevent',
            name='client_id',
            field=models.CharField(
                blank=True,
                db_index=True,
                default='',
                help_text='Opaque ID assigned by the frontend so duplicates can be detected.',
                max_length=64,
            ),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='agentactivityevent',
            name='client_ts',
            field=models.BigIntegerField(
                blank=True,
                null=True,
                help_text='Frontend Date.now() timestamp in ms when the event was created.',
            ),
        ),
    ]
