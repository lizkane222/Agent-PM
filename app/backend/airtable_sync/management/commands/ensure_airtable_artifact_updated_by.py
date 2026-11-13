"""
Management command: add the "Updated By" column to the Airtable Artifacts table.

    python manage.py ensure_airtable_artifact_updated_by            # dry run (default)
    python manage.py ensure_airtable_artifact_updated_by --commit   # create the field

Add-only and idempotent: an existing field is reported and left alone; nothing is ever
altered or removed. Requires a token with the `schema.bases:write` scope.
Mirrors "Uploaded By" (plain single-line text) written by write_back._artifact_fields.
"""
from django.core.management.base import BaseCommand, CommandError

from ...airtable_client import get_table
from ...write_back import TABLE_ARTIFACTS

FIELD_NAME = "Updated By"
FIELD_TYPE = "singleLineText"
DESCRIPTION = "Name of the AgentPM user who last edited this artifact."


class Command(BaseCommand):
    help = 'Add the "Updated By" field to the Airtable Artifacts table if missing (dry run by default).'

    def add_arguments(self, parser):
        parser.add_argument("--commit", action="store_true", help="Actually create the field.")

    def handle(self, *args, **options):
        if not TABLE_ARTIFACTS:
            raise CommandError("AIRTABLE_TABLE_ARTIFACTS is not configured.")
        try:
            table = get_table(TABLE_ARTIFACTS)
            schema = table.schema()
        except Exception as exc:
            raise CommandError(f"Could not read the Airtable Artifacts schema: {exc}") from exc
        existing = {f.name: f for f in schema.fields}
        self.stdout.write(f"Table: {schema.name} ({schema.id}) - {len(existing)} fields")
        if FIELD_NAME in existing:
            self.stdout.write(f"  = {FIELD_NAME!r} already exists (type: {existing[FIELD_NAME].type})")
            return
        if not options["commit"]:
            self.stdout.write(f"  + would create {FIELD_NAME!r} ({FIELD_TYPE}); re-run with --commit")
            return
        try:
            field = table.create_field(FIELD_NAME, FIELD_TYPE, description=DESCRIPTION)
        except Exception as exc:
            raise CommandError(
                f"Failed to create {FIELD_NAME!r}: {exc}\nThe token may need the 'schema.bases:write' scope."
            ) from exc
        self.stdout.write(self.style.SUCCESS(f"  + created {FIELD_NAME!r} ({field.type}) id={field.id}"))
