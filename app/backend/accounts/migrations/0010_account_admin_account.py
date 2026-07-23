from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0009_accountartifact_secondary_url_default'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='account',
            name='is_admin_account',
            field=models.BooleanField(default=False, db_index=True),
        ),
        migrations.AddField(
            model_name='account',
            name='admin_owner',
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='admin_account',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
