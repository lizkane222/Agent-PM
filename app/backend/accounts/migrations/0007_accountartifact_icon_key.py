from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0006_accountquicklink"),
    ]

    operations = [
        migrations.AddField(
            model_name="accountartifact",
            name="icon_key",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
    ]
