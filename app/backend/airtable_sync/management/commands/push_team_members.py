"""
Management command: push Django TeamMember records → Airtable "Team Members" table.

Usage:
    python manage.py push_team_members            # upsert all members
    python manage.py push_team_members --dry-run  # print what would happen, no writes
    python manage.py push_team_members --id 42    # sync a single member by Django PK

The command will:
1. Ensure all required fields exist in Airtable (create missing ones via the meta API).
2. Upsert every Django TeamMember into Airtable, matching on the "Django ID" field.
3. Report created / updated / failed counts.

Fields synced:
    Full Name, Email, Title, Department, Status, Slack Handle, Avatar URL,
    Joined At, Manager, Tags, Created At, Updated At, Django ID
"""

import logging
import time

import truststore
truststore.inject_into_ssl()

import requests
from django.conf import settings
from django.core.management.base import BaseCommand

logger = logging.getLogger(__name__)

# ── Field definitions we want to ensure exist in the Airtable table ───────────

_REQUIRED_FIELDS = [
    # Fields already present in the table (verified against live schema)
    # "Full Name"   — singleLineText
    # "Email"       — email
    # "Title"       — singleLineText
    # "Department"  — singleLineText
    # "Status"      — singleSelect
    # "Slack Handle"— singleLineText
    # "Avatar URL"  — url
    # "Joined At"   — date
    # "Django ID"   — number
    #
    # Fields we need to add if missing:
    {
        "name": "Manager",
        "type": "singleLineText",
        "description": "Full name of the direct manager (denormalised for simplicity).",
    },
    {
        "name": "Tags",
        "type": "multilineText",
        "description": "Comma-separated list of tag names from Django.",
    },
    {
        "name": "Created At",
        "type": "dateTime",
        "options": {
            "timeZone": "utc",
            "dateFormat": {"name": "iso"},
            "timeFormat": {"name": "24hour"},
        },
        "description": "Timestamp when this record was first created in Django.",
    },
    {
        "name": "Updated At",
        "type": "dateTime",
        "options": {
            "timeZone": "utc",
            "dateFormat": {"name": "iso"},
            "timeFormat": {"name": "24hour"},
        },
        "description": "Timestamp of the last Django update.",
    },
]

_STATUS_MAP = {
    "active": "active",
    "inactive": "inactive",
    "invited": "invited",
}


def _at_headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.AIRTABLE_API_KEY}",
        "Content-Type": "application/json",
    }


def _get_table_schema(table_id: str) -> list[dict]:
    """Return the list of field objects for the given table."""
    url = f"https://api.airtable.com/v0/meta/bases/{settings.AIRTABLE_BASE_ID}/tables"
    resp = requests.get(url, headers=_at_headers(), timeout=15)
    resp.raise_for_status()
    for tbl in resp.json().get("tables", []):
        if tbl["id"] == table_id:
            return tbl.get("fields", [])
    return []


def _create_field(table_id: str, field_def: dict) -> bool:
    """Create a single field in the Airtable table. Returns True on success."""
    url = f"https://api.airtable.com/v0/meta/bases/{settings.AIRTABLE_BASE_ID}/tables/{table_id}/fields"
    payload = {"name": field_def["name"], "type": field_def["type"]}
    if "options" in field_def:
        payload["options"] = field_def["options"]
    if "description" in field_def:
        payload["description"] = field_def["description"]
    resp = requests.post(url, headers=_at_headers(), json=payload, timeout=15)
    if resp.status_code in (200, 201):
        return True
    logger.warning("Failed to create field %r: %s — %s", field_def["name"], resp.status_code, resp.text)
    return False


def _patch_select_choices(table_id: str, field_id: str, field_name: str, required_choices: list[str]) -> bool:
    """Add any missing choices to a singleSelect field. Returns True on success."""
    url = f"https://api.airtable.com/v0/meta/bases/{settings.AIRTABLE_BASE_ID}/tables/{table_id}/fields/{field_id}"
    # Build full choices list; existing ones must be preserved by name
    choices = [{"name": c} for c in required_choices]
    payload = {"type": "singleSelect", "options": {"choices": choices}}
    resp = requests.patch(url, headers=_at_headers(), json=payload, timeout=15)
    if resp.status_code == 200:
        return True
    logger.warning("Failed to patch %r choices: %s — %s", field_name, resp.status_code, resp.text)
    return False


def _member_fields(member) -> dict:
    """Map a Django TeamMember instance → Airtable field dict."""
    fields: dict = {
        "Full Name": member.full_name,
        "Email": member.email,
        "Django ID": member.pk,
    }
    if member.title:
        fields["Title"] = member.title
    if member.department:
        fields["Department"] = member.department
    if member.status:
        fields["Status"] = _STATUS_MAP.get(member.status, member.status.capitalize())
    if member.slack_handle:
        fields["Slack Handle"] = member.slack_handle
    if member.avatar_url:
        fields["Avatar URL"] = member.avatar_url
    if member.joined_at:
        fields["Joined At"] = member.joined_at.isoformat()
    if member.manager:
        fields["Manager"] = member.manager.full_name
    tag_names = [t.name for t in member.tags.all()]
    if tag_names:
        fields["Tags"] = ", ".join(tag_names)
    fields["Created At"] = member.created_at.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    fields["Updated At"] = member.updated_at.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    return fields


class Command(BaseCommand):
    help = "Push Django TeamMember records to the Airtable 'Team Members' table."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print what would be synced without writing to Airtable.",
        )
        parser.add_argument(
            "--id",
            type=int,
            dest="member_id",
            help="Sync only the TeamMember with this Django PK.",
        )

    def handle(self, *args, **options):
        from team.models import TeamMember
        from airtable_sync.airtable_client import get_api

        dry_run: bool = options["dry_run"]
        member_id: int | None = options["member_id"]

        api = get_api()
        table_id: str = settings.AIRTABLE_TABLE_TEAM_MEMBERS
        if not table_id:
            self.stderr.write(self.style.ERROR(
                "AIRTABLE_TABLE_TEAM_MEMBERS is not set in your .env file."
            ))
            return

        table = api.table(settings.AIRTABLE_BASE_ID, table_id)

        # ── 1. Ensure all required fields exist ───────────────────────────────
        self.stdout.write("Checking Airtable field schema…")
        try:
            schema_fields = _get_table_schema(table_id)
        except Exception as exc:
            self.stderr.write(self.style.ERROR(f"Could not fetch table schema: {exc}"))
            return

        existing_field_names = {f["name"] for f in schema_fields}

        for field_def in _REQUIRED_FIELDS:
            if field_def["name"] in existing_field_names:
                continue
            self.stdout.write(f"  Creating missing field: {field_def['name']!r}")
            if not dry_run:
                ok = _create_field(table_id, field_def)
                if ok:
                    self.stdout.write(self.style.SUCCESS(f"  ✓ Created {field_def['name']!r}"))
                else:
                    self.stderr.write(self.style.WARNING(f"  ✗ Failed to create {field_def['name']!r} — continuing anyway"))
                time.sleep(0.3)  # brief pause to avoid rate-limiting the meta API

        # ── 2. Build a lookup: Django ID → existing Airtable record ID ────────
        self.stdout.write("Fetching existing Airtable records…")
        try:
            existing_records = table.all(fields=["Django ID"])
        except Exception as exc:
            self.stderr.write(self.style.ERROR(f"Could not fetch existing records: {exc}"))
            return

        django_id_to_at_id: dict[int, str] = {}
        for rec in existing_records:
            did = rec.get("fields", {}).get("Django ID")
            if did is not None:
                django_id_to_at_id[int(did)] = rec["id"]

        self.stdout.write(f"  {len(django_id_to_at_id)} existing Airtable records found.")

        # ── 3. Fetch Django members ────────────────────────────────────────────
        qs = TeamMember.objects.select_related("manager").prefetch_related("tags").all()
        if member_id is not None:
            qs = qs.filter(pk=member_id)
            if not qs.exists():
                self.stderr.write(self.style.ERROR(f"No TeamMember with pk={member_id}"))
                return

        total = qs.count()
        self.stdout.write(f"Syncing {total} team member(s) to Airtable…")

        created = updated = failed = 0

        for member in qs:
            fields = _member_fields(member)
            at_id = django_id_to_at_id.get(member.pk)
            action = "UPDATE" if at_id else "CREATE"

            if dry_run:
                self.stdout.write(f"  [DRY RUN] {action} — {member.full_name} <{member.email}>")
                self.stdout.write(f"    fields: {fields}")
                continue

            try:
                if at_id:
                    table.update(at_id, fields)
                    updated += 1
                    self.stdout.write(f"  ↻ Updated  {member.full_name} ({at_id})")
                else:
                    record = table.create(fields)
                    created += 1
                    self.stdout.write(f"  + Created  {member.full_name} ({record['id']})")
            except Exception as exc:
                failed += 1
                self.stderr.write(self.style.WARNING(
                    f"  ✗ Failed   {member.full_name} <{member.email}>: {exc}"
                ))

            # Airtable rate limit: 5 req/s per base → stay under it
            time.sleep(0.22)

        if not dry_run:
            self.stdout.write(self.style.SUCCESS(
                f"\nDone. Created: {created}  Updated: {updated}  Failed: {failed}"
            ))
        else:
            self.stdout.write(self.style.SUCCESS(f"\n[DRY RUN] Would process {total} member(s)."))
