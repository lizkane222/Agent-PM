from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("realtime", "0002_add_client_id_and_ts"),
    ]

    operations = [
        migrations.AlterField(
            model_name="agentactivityevent",
            name="event_type",
            field=models.CharField(
                choices=[
                    ("tool_call", "Tool Call"),
                    ("tool_result", "Tool Result"),
                    ("message", "Message"),
                    ("error", "Error"),
                    ("voice_transcript", "Voice Transcript"),
                    ("calendar_sync", "Calendar Sync"),
                    ("task_created", "Task Created"),
                    ("task_updated", "Task Updated"),
                    ("account", "Account"),
                    ("team", "Team"),
                    ("action_item", "Action Item"),
                    ("calendar", "Calendar"),
                    ("comment_reply", "Comment Reply"),
                ],
                max_length=30,
            ),
        ),
    ]
