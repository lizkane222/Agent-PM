"""
Management command: create the Zoom Notes / Zoom URL columns in the Airtable Meetings
table if they are missing.

Usage:
    python manage.py ensure_airtable_zoom_fields            # create missing fields
    python manage.py ensure_airtable_zoom_fields --dry-run  # report only, no writes

Why this exists as a command rather than a migration: the target is a third-party
system, not the Django database. A migration would run inside `migrate`, fail on any
machine without Airtable credentials, and record itself as applied even though the
remote change is per-base rather than per-deployment.

Idempotent — an existing field is reported and left alone, so this is safe to re-run.
The Zoom pair deliberately mirrors the types Airtable already uses for the Gong pair
(`Gong Notes` is richText, `Gong URL` is url) so the two read identically in the UI.

Requires an Airtable token with the `schema.bases:write` scope.
"""

from django.core.management.base import BaseCommand, CommandError

from ...airtable_client import TABLE_MEETINGS, get_table

# name → (Airtable field type, description). Matched to the Gong equivalents.
REQUIRED_FIELDS: dict[str, tuple[str, str]] = {
    "Zoom Notes": (
        "richText",
        "AI meeting summary from Zoom (Zoom AI Companion). Mirrors Gong Notes; a "
        "meeting recorded by both providers holds both, and the app prefers Gong for "
        "display with a toggle to switch.",
    ),
    "Zoom URL": ("url", "Link to the Zoom recording or recap for this meeting."),
}


class Command(BaseCommand):
    help = "Create the Zoom Notes / Zoom URL fields in the Airtable Meetings table if missing."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would be created without writing to Airtable.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]

        try:
            table = get_table(TABLE_MEETINGS)
            schema = table.schema()
        except Exception as exc:
            raise CommandError(f"Could not read the Airtable Meetings schema: {exc}") from exc

        existing = {field.name: field for field in schema.fields}
        self.stdout.write(f"Table: {schema.name} ({schema.id}) — {len(existing)} fields")

        created, skipped = [], []
        for name, (field_type, description) in REQUIRED_FIELDS.items():
            if name in existing:
                found = existing[name]
                skipped.append(name)
                self.stdout.write(f"  = {name!r} already exists (type: {found.type})")
                if found.type != field_type:
                    # Not fatal: write_back sends a plain string either way. Worth
                    # flagging because a mismatched type can render oddly in Airtable.
                    self.stdout.write(self.style.WARNING(
                        f"    expected type {field_type!r}, found {found.type!r}"
                    ))
                continue

            if dry_run:
                self.stdout.write(f"  + would create {name!r} ({field_type})")
                created.append(name)
                continue

            try:
                field = table.create_field(name, field_type, description=description)
            except Exception as exc:
                raise CommandError(
                    f"Failed to create {name!r}: {exc}\n"
                    "If this is a permissions error, the Airtable token needs the "
                    "'schema.bases:write' scope."
                ) from exc
            created.append(name)
            self.stdout.write(self.style.SUCCESS(f"  + created {name!r} ({field.type}) id={field.id}"))

        verb = "would create" if dry_run else "created"
        self.stdout.write(
            self.style.SUCCESS(f"Done — {verb} {len(created)}, already present {len(skipped)}.")
        )
        if created and not dry_run:
            self.stdout.write(
                "Zoom notes now mirror to Airtable via write_back.push_meeting_zoom_notes."
            )
