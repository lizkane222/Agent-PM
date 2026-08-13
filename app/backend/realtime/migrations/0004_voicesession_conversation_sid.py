from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("realtime", "0003_add_comment_reply_event_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="voicesession",
            name="conversation_sid",
            field=models.CharField(
                blank=True,
                help_text="Twilio Conversations SID (CH…) linked to this call.",
                max_length=34,
            ),
        ),
    ]
