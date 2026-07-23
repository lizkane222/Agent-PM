import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='VoiceSession',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('call_sid', models.CharField(db_index=True, max_length=34, unique=True)),
                ('from_number', models.CharField(max_length=30)),
                ('to_number', models.CharField(max_length=30)),
                ('status', models.CharField(choices=[('ringing', 'Ringing'), ('in_progress', 'In Progress'), ('completed', 'Completed'), ('failed', 'Failed'), ('no_answer', 'No Answer')], default='ringing', max_length=20)),
                ('duration_seconds', models.PositiveIntegerField(default=0)),
                ('recording_url', models.URLField(blank=True)),
                ('transcript', models.TextField(blank=True)),
                ('started_at', models.DateTimeField(blank=True, null=True)),
                ('ended_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='voice_sessions', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-created_at']},
        ),
        migrations.CreateModel(
            name='AgentActivityEvent',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('event_type', models.CharField(choices=[('tool_call', 'Tool Call'), ('tool_result', 'Tool Result'), ('message', 'Message'), ('error', 'Error'), ('voice_transcript', 'Voice Transcript'), ('calendar_sync', 'Calendar Sync'), ('task_created', 'Task Created'), ('task_updated', 'Task Updated'), ('account', 'Account'), ('team', 'Team'), ('action_item', 'Action Item'), ('calendar', 'Calendar')], max_length=30)),
                ('title', models.CharField(max_length=300)),
                ('detail', models.TextField(blank=True)),
                ('metadata', models.JSONField(default=dict)),
                ('sync_document_id', models.CharField(blank=True, help_text='Twilio Sync document/list item ID if published.', max_length=100)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='activity_events', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-created_at']},
        ),
    ]
