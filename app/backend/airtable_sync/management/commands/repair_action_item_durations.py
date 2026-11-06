"""Repair action-item durations corrupted by the old minutes/seconds mismatch.

Airtable's Time Spent / Estimated Time / Prep Time are `duration` fields (seconds), but
the pull used to multiply by 60 and the push divided by 60, so values drifted on every
round trip. The local columns are treated as authoritative except for explicit
``--set <airtable_id>=<seconds>`` corrections; ``--commit`` then writes those and pushes
every item's durations to Airtable in seconds, making this app the single source.

Dry run by default.
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from airtable_sync.airtable_client import TABLE_ACTION_ITEMS, get_table
from airtable_sync.models import AirtableActionItem

FIELDS = (("time_spent", "Time Spent"), ("estimated_time", "Estimated Time"), ("prep_time", "Prep Time"))


def _hm(seconds) -> str:
    if seconds is None:
        return "-"
    seconds = int(seconds)
    return f"{seconds // 3600}:{(seconds % 3600) // 60:02d}"


def parse_overrides(values: list[str]) -> dict[str, int]:
    out: dict[str, int] = {}
    for raw in values:
        rec, sep, secs = raw.partition("=")
        if not sep or not rec.startswith("rec") or not secs.isdigit():
            raise CommandError(f"--set expects recXXXX=<seconds>, got {raw!r}")
        out[rec] = int(secs)
    return out


class Command(BaseCommand):
    help = "Repair action-item duration fields and push them to Airtable in seconds."

    def add_arguments(self, parser):
        parser.add_argument("--set", action="append", default=[], dest="overrides",
                            help="recXXXX=<seconds> correction for time_spent (repeatable)")
        parser.add_argument("--commit", action="store_true", help="Write changes (default: dry run)")

    def handle(self, *args, overrides, commit, **options):
        corrections = parse_overrides(overrides)
        unknown = set(corrections) - set(
            AirtableActionItem.objects.filter(airtable_id__in=corrections).values_list("airtable_id", flat=True)
        )
        if unknown:
            raise CommandError(f"Unknown action items: {', '.join(sorted(unknown))}")

        table = get_table(TABLE_ACTION_ITEMS)
        remote = {r["id"]: r.get("fields", {}) for r in table.all()}

        plan = []
        for item in AirtableActionItem.objects.exclude(airtable_id="").exclude(airtable_id__startswith="local-"):
            new_spent = corrections.get(item.airtable_id, item.time_spent)
            local = {"time_spent": new_spent, "estimated_time": item.estimated_time, "prep_time": item.prep_time}
            at = remote.get(item.airtable_id)
            if at is None:
                continue  # deleted in Airtable; nothing to push to
            push = {name: local[attr] or 0 for attr, name in FIELDS
                    if (at.get(name) or 0) != (local[attr] or 0)}
            if new_spent != item.time_spent or push:
                plan.append((item, new_spent, push, at))

        for item, new_spent, push, at in plan:
            local_note = (f"local {_hm(item.time_spent)} → {_hm(new_spent)}"
                          if new_spent != item.time_spent else f"local {_hm(item.time_spent)}")
            remote_note = ", ".join(f"{k} {_hm(at.get(k))} → {_hm(v)}" for k, v in push.items()) or "Airtable ok"
            self.stdout.write(f"{item.airtable_id}  {(item.task or '')[:32]:32}  {local_note}  |  {remote_note}")

        if not commit:
            self.stdout.write(self.style.WARNING(f"Dry run: {len(plan)} item(s) would change. Re-run with --commit."))
            return

        failures = 0
        for item, new_spent, push, _ in plan:
            if new_spent != item.time_spent:
                with transaction.atomic():
                    AirtableActionItem.objects.filter(pk=item.pk).update(time_spent=new_spent)
            if push:
                try:
                    table.update(item.airtable_id, push)
                except Exception as exc:  # keep going; report at the end
                    failures += 1
                    self.stderr.write(f"Airtable update failed for {item.airtable_id}: {exc}")
        msg = f"Repaired {len(plan) - failures} item(s)."
        if failures:
            raise CommandError(f"{msg} {failures} Airtable update(s) failed — re-run to retry.")
        self.stdout.write(self.style.SUCCESS(msg))
