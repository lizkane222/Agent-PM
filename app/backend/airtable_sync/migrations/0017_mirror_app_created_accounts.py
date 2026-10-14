"""Backfill AirtableAccount mirrors for app-created accounts.

Before `airtable_sync.account_mirror` existed, an account created in the app got an
`airtable_id` but no AirtableAccount row until the next pull sync, so action items
could not be linked to it. Idempotent; reverse is a no-op.
"""
from django.db import migrations


def forwards(apps, schema_editor):
    Account = apps.get_model("accounts", "Account")
    AirtableAccount = apps.get_model("airtable_sync", "AirtableAccount")
    existing = set(AirtableAccount.objects.values_list("airtable_id", flat=True))
    for acct in Account.objects.filter(is_admin_account=False).exclude(airtable_id=""):
        if acct.airtable_id in existing:
            continue
        AirtableAccount.objects.create(airtable_id=acct.airtable_id, name=acct.company_name)
        existing.add(acct.airtable_id)


class Migration(migrations.Migration):
    dependencies = [
        ("airtable_sync", "0016_actionitemattachment_source_artifact"),
        ("accounts", "0021_accountartifact_description_references"),
    ]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
