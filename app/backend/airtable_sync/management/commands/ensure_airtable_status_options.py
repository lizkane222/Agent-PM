"""
Management command: make sure the Action Items table's Status single-select has an option
for every status the app uses (Not Started, In Progress, Completed, Blocked, Backlogged).

Usage:
    python manage.py ensure_airtable_status_options            # dry run (default): print the plan
    python manage.py ensure_airtable_status_options --commit   # apply

Only ADDS missing options. Existing options keep their id, name and color: the update sends
every current choice back with its id, and new ones without an id (Airtable assigns one).
Requires an Airtable token with the `schema.bases:write` scope; without it the command
reports what is needed and changes nothing.
"""
from django.core.management.base import BaseCommand, CommandError

from ...airtable_client import TABLE_ACTION_ITEMS, get_table
from ...write_back import _STATUS_TO_AT

# Colors for newly added options (Airtable's palette names).
NEW_OPTION_COLORS = {"Blocked": "redLight2", "Backlogged": "grayLight2"}


def required_options() -> list[str]:
    return sorted(set(_STATUS_TO_AT.values()))


def plan_choices(current: list[dict], required: list[str]) -> tuple[list[dict], list[str]]:
    """Return (full choices list to send, names being added). Existing entries untouched."""
    have = {c["name"] for c in current}
    choices = [dict(c) for c in current]
    added = []
    for name in required:
        if name in have:
            continue
        choice = {"name": name}
        if name in NEW_OPTION_COLORS:
            choice["color"] = NEW_OPTION_COLORS[name]
        choices.append(choice)
        added.append(name)
    return choices, added


class Command(BaseCommand):
    help = "Add missing Status options (e.g. Backlogged) to the Airtable Action Items table."

    def add_arguments(self, parser):
        parser.add_argument("--commit", action="store_true", help="Apply the change (default is a dry run).")

    def handle(self, *args, **options):
        table = get_table(TABLE_ACTION_ITEMS)
        try:
            schema = table.schema()
        except Exception as exc:
            raise CommandError(
                f"Could not read the table schema: {exc}\nThe token needs the 'schema.bases:read' scope."
            ) from exc
        field = next((f for f in schema.fields if f.name == "Status"), None)
        if field is None:
            raise CommandError("The Action Items table has no 'Status' field.")
        if field.type != "singleSelect":
            raise CommandError(f"'Status' is {field.type!r}, expected singleSelect; refusing to touch it.")

        current = [
            {"id": c.id, "name": c.name, **({"color": c.color} if getattr(c, "color", None) else {})}
            for c in field.options.choices
        ]
        self.stdout.write(f"Status field {field.id}; current options: {[c['name'] for c in current]}")
        choices, added = plan_choices(current, required_options())
        if not added:
            self.stdout.write(self.style.SUCCESS("Nothing to do - every required option exists."))
            return
        self.stdout.write(f"Plan: add {added}; keep {[c['name'] for c in current]} unchanged (ids preserved).")
        if not options["commit"]:
            self.stdout.write("Dry run - re-run with --commit to apply.")
            return
        try:
            table.api.request(
                "PATCH",
                f"{table.api.build_url('meta', 'bases', table.base.id, 'tables', table.id, 'fields', field.id)}",
                json={"options": {"choices": choices}},
            )
        except Exception as exc:
            raise CommandError(
                f"Failed to update the Status field: {exc}\n"
                "If this is a permissions error, the Airtable token needs the 'schema.bases:write' scope."
            ) from exc
        self.stdout.write(self.style.SUCCESS(f"Added {added}."))
