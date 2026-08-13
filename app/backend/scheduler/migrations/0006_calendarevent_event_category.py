from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("scheduler", "0005_calendarevent_agentpm_airtable_id"),
    ]

    operations = [
        migrations.AddField(
            model_name="calendarevent",
            name="event_category",
            field=models.CharField(
                blank=True,
                choices=[
                    ("meeting", "Meeting"),
                    ("task", "Task"),
                    ("out_of_office", "Out of Office"),
                    ("focus_time", "Focus Time"),
                    ("working_location", "Working Location"),
                    ("appointment", "Appointment Schedule"),
                ],
                default="meeting",
                max_length=30,
            ),
        ),
    ]
