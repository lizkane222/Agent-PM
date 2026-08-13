from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("confluence_sync", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="confluenceconfig",
            name="atlassian_email",
            field=models.EmailField(blank=True, default="", max_length=254),
        ),
    ]
