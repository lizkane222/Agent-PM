from django.db import migrations, models


class Migration(migrations.Migration):
    """Re-declare secondary_url with an explicit DB-level default so SQLite
    stores it as a column default, preventing NOT NULL constraint failures
    when the field is omitted from an INSERT."""

    dependencies = [
        ("accounts", "0008_accountartifact_secondary_url"),
    ]

    operations = [
        migrations.AlterField(
            model_name="accountartifact",
            name="secondary_url",
            field=models.TextField(blank=True, default="", db_default=""),
        ),
    ]
