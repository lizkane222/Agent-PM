from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("salesforce_sync", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="LogTimeDayAssignment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("date", models.DateField()),
                ("position", models.PositiveSmallIntegerField(default=0)),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="day_assignments", to="salesforce_sync.salesforceproject")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="log_time_assignments", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "ordering": ["date", "position"],
                "unique_together": {("user", "date", "project")},
            },
        ),
    ]
