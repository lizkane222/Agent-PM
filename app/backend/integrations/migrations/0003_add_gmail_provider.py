from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('integrations', '0002_add_new_oauth_providers'),
    ]

    operations = [
        migrations.AlterField(
            model_name='oauthcredential',
            name='provider',
            field=models.CharField(
                choices=[
                    ('google', 'Google'),
                    ('slack', 'Slack'),
                    ('airtable', 'Airtable'),
                    ('salesforce', 'Salesforce'),
                    ('gong', 'Gong'),
                    ('zoom', 'Zoom'),
                    ('lucidchart', 'Lucidchart'),
                    ('github', 'GitHub'),
                    ('google_drive', 'Google Drive / Docs / Sheets'),
                    ('notion', 'Notion'),
                    ('microsoft', 'Microsoft Teams'),
                    ('gmail', 'Gmail'),
                ],
                max_length=30,
            ),
        ),
    ]
