# Generated manually

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('airtable_sync', '0010_add_backlogged_status'),
    ]

    operations = [
        migrations.CreateModel(
            name='ActionItemStep',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(max_length=512)),
                ('status', models.CharField(
                    choices=[('Open', 'Open'), ('Done', 'Done'), ('Blocked', 'Blocked'), ('Archived', 'Archived')],
                    default='Open',
                    max_length=20,
                )),
                ('order', models.PositiveIntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('action_item', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='steps',
                    to='airtable_sync.airtableactionitem',
                )),
            ],
            options={
                'ordering': ['order', 'created_at'],
            },
        ),
    ]
