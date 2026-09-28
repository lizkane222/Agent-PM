"""
Widen SalesforceTeamMember.sf_id from 32 to 128 characters.

`sync.sync_project_roles` mirrors the project role lookups into this model with a
synthesized key, `role:<18-char project id>:<field name>`. The longest configured role
field is `Solution_Architect_Secondary__c`, which makes the key 55 characters — over
the old 32. SQLite would have silently accepted it and PostgreSQL would have raised,
so the limit is raised rather than the key shortened (a hashed key would be
unreadable in the admin for no benefit).
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("salesforce_sync", "0002_logtimeday_assignment"),
    ]

    operations = [
        migrations.AlterField(
            model_name="salesforceteammember",
            name="sf_id",
            field=models.CharField(max_length=128, unique=True),
        ),
    ]
