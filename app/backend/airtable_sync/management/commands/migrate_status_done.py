"""
Management command: migrate all action items with Status="Completed" → "Done" in Airtable
and the local database.

Usage:
    python manage.py migrate_status_done          # live run
    python manage.py migrate_status_done --dry-run  # preview only, no writes
"""

import logging

from django.conf import settings
from django.core.management.base import BaseCommand

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Change all action items with Status="Completed" to Status="Done" in Airtable and the local DB.'

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print what would change without making any writes.",
        )

    def handle(self, *args, **options):
        import truststore
        truststore.inject_into_ssl()

        import requests
        from airtable_sync.airtable_client import get_table, TABLE_ACTION_ITEMS
        from airtable_sync.models import AirtableActionItem

        dry_run = options["dry_run"]
        if dry_run:
            self.stdout.write(self.style.WARNING("DRY RUN — no changes will be written."))

        at_headers = {
            "Authorization": f"Bearer {settings.AIRTABLE_API_KEY}",
            "Content-Type": "application/json",
        }

        # ── 0. Ensure "Done" exists as a choice in the Status field ──────────────
        self.stdout.write("Fetching table schema from Airtable Meta API…")
        meta_url = f"https://api.airtable.com/v0/meta/bases/{settings.AIRTABLE_BASE_ID}/tables"
        resp = requests.get(meta_url, headers=at_headers, timeout=15)
        resp.raise_for_status()

        status_field_id = None
        existing_choices = []
        for tbl in resp.json().get("tables", []):
            if tbl.get("id") == TABLE_ACTION_ITEMS:
                for field in tbl.get("fields", []):
                    if field.get("name", "").lower() == "status":
                        status_field_id = field["id"]
                        existing_choices = [c["name"] for c in field.get("options", {}).get("choices", [])]
                        break
                break

        if not status_field_id:
            raise SystemExit("Could not find the Status field in the action items table.")

        self.stdout.write(f"Status field id: {status_field_id}")
        self.stdout.write(f"Current choices: {existing_choices}")

        if "Done" not in existing_choices:
            new_choices = existing_choices + ["Done"]
            self.stdout.write(f"  {'[DRY] ' if dry_run else ''}Adding 'Done' to Status field choices…")
            if not dry_run:
                patch_url = f"https://api.airtable.com/v0/meta/bases/{settings.AIRTABLE_BASE_ID}/tables/{TABLE_ACTION_ITEMS}/fields/{status_field_id}"
                patch_resp = requests.patch(
                    patch_url,
                    headers=at_headers,
                    json={"type": "singleSelect", "options": {"choices": [{"name": c} for c in new_choices]}},
                    timeout=15,
                )
                patch_resp.raise_for_status()
                self.stdout.write(self.style.SUCCESS("  'Done' added to Status field choices."))
        else:
            self.stdout.write("  'Done' already exists as a choice — skipping field update.")

        # ── 1. Find all Airtable records where Status = "Completed" ──────────────
        self.stdout.write("Fetching records from Airtable…")
        table = get_table(TABLE_ACTION_ITEMS)
        records = table.all(formula="{Status}='Completed'")
        self.stdout.write(f"Found {len(records)} record(s) with Status='Completed'.")

        if not records:
            self.stdout.write(self.style.SUCCESS("Nothing to migrate."))
            return

        # ── 2. Patch each record in Airtable ─────────────────────────────────────
        patched_at = 0
        failed_at = 0
        for record in records:
            rec_id = record["id"]
            task = record["fields"].get("Task", rec_id)
            self.stdout.write(f"  {'[DRY] ' if dry_run else ''}Patching Airtable record {rec_id}: {task!r}")
            if not dry_run:
                try:
                    table.update(rec_id, {"Status": "Done"})
                    patched_at += 1
                except Exception as exc:
                    self.stderr.write(f"  ERROR patching {rec_id}: {exc}")
                    failed_at += 1
            else:
                patched_at += 1

        # ── 3. Update the local database ─────────────────────────────────────────
        local_qs = AirtableActionItem.objects.filter(status="Complete")
        local_count = local_qs.count()
        self.stdout.write(f"Found {local_count} local DB row(s) with status='Complete'.")
        if not dry_run:
            updated_local = local_qs.update(status="Done")
            self.stdout.write(f"Updated {updated_local} local DB row(s) to status='Done'.")
        else:
            self.stdout.write(f"  [DRY] Would update {local_count} local DB row(s).")

        # ── Summary ───────────────────────────────────────────────────────────────
        if dry_run:
            self.stdout.write(self.style.WARNING(
                f"\nDry run complete. Would patch {patched_at} Airtable record(s) and {local_count} DB row(s)."
            ))
        else:
            if failed_at:
                self.stdout.write(self.style.WARNING(
                    f"\nDone. Patched {patched_at} Airtable record(s), {failed_at} failed. "
                    f"Updated {updated_local} local DB row(s)."
                ))
            else:
                self.stdout.write(self.style.SUCCESS(
                    f"\nDone. Patched {patched_at} Airtable record(s) and {updated_local} local DB row(s) to 'Done'."
                ))
