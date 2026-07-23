from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Applet',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('type', models.CharField(choices=[('applet', 'Applet'), ('repo', 'GitHub Repo')], default='applet', max_length=10)),
                ('name', models.CharField(max_length=200)),
                ('description', models.TextField()),
                ('url', models.URLField(max_length=500)),
                ('category', models.CharField(choices=[('Automation', 'Automation'), ('Dashboard', 'Dashboard'), ('Bot', 'Bot'), ('Integration', 'Integration'), ('Tool', 'Tool'), ('Game', 'Game'), ('Utility', 'Utility')], default='Tool', max_length=20)),
                ('author', models.CharField(max_length=200)),
                ('tags', models.JSONField(blank=True, default=list)),
                ('airtable_id', models.CharField(blank=True, default='', max_length=50)),
                ('submitted_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='submitted_applets', to=settings.AUTH_USER_MODEL)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name': 'Applet',
                'verbose_name_plural': 'Applets',
                'ordering': ['-created_at'],
            },
        ),
    ]
