from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0013_accountproject_linked_fields"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="AccountRole",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("role", models.CharField(
                    choices=[("sync_reviewer", "Sync Reviewer"), ("account_owner", "Account Owner")],
                    max_length=32,
                )),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("account", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="account_roles",
                    to="accounts.account",
                )),
                ("assigned_by", models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="assigned_account_roles",
                    to=settings.AUTH_USER_MODEL,
                )),
                ("user", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="account_roles",
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                "ordering": ["account", "role"],
                "unique_together": {("user", "account", "role")},
            },
        ),
    ]
