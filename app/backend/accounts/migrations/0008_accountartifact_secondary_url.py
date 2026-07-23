from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0007_accountartifact_icon_key"),
    ]

    operations = [
        migrations.AddField(
            model_name="accountartifact",
            name="secondary_url",
            field=models.TextField(blank=True, default=""),
        ),
    ]
