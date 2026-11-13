"""
Management command: re-mark as Done the action items the activity log says the user marked
Done but whose status was later reverted (by the Airtable pull that could not hold it).

Usage:
    python manage.py restore_logged_done_items            # dry run (default)
    python manage.py restore_logged_done_items --commit   # set Done locally + write Completed to Airtable

For each action item, only the LATEST logged status change counts. If that change is to
Done and the item is not Done now, it is restored (marked_done_at = the log time). An item
the user later reopened (latest change is not Done) is left alone. Idempotent.
"""
import re

from django.core.management.base import BaseCommand

from ...models import AirtableActionItem

STATUS_RE = re.compile(r"Status:\s*(.+?)\s*→\s*([A-Za-z ]+?)\s*(?:;|$)")


def latest_logged_status_changes(events) -> dict:
    """{airtable_id: (new_status, created_at)} from events ordered oldest -> newest."""
    latest = {}
    for ev in events:
        rid = ((ev.metadata or {}).get("resource") or {}).get("id")
        m = STATUS_RE.search(ev.title or "")
        if not rid or not m or str(rid).startswith("local-"):
            continue
        latest[rid] = (m.group(2).strip(), ev.created_at)
    return latest


def find_restorable(events) -> list:
    out = []
    for rid, (status, when) in latest_logged_status_changes(events).items():
        if status != "Done":
            continue
        item = AirtableActionItem.objects.filter(airtable_id=rid).first()
        if item and item.status != "Done":
            out.append((item, when))
    return out


class Command(BaseCommand):
    help = "Restore action items the activity log shows were marked Done but reverted."

    def add_arguments(self, parser):
        parser.add_argument("--commit", action="store_true", help="Apply (default is a dry run).")

    def handle(self, *args, **options):
        from realtime.models import AgentActivityEvent

        events = AgentActivityEvent.objects.filter(event_type="action_item").order_by("created_at", "id")
        todo = find_restorable(events)
        self.stdout.write(f"{len(todo)} item(s) to restore" + ("" if options["commit"] else " (dry run)"))
        from ...write_back import push_action_item_status

        pushed_ok = 0
        for item, when in todo:
            self.stdout.write(f"  {item.airtable_id}  {item.status!r} -> 'Done'  at {when:%Y-%m-%d %H:%M}  {item.task[:60]}")
            if not options["commit"]:
                continue
            item.status = "Done"
            item.marked_done_at = when
            item.save(update_fields=["status", "marked_done_at"])
            ok = push_action_item_status(item)
            # A failed push stays flagged so the next pull retries it instead of reverting.
            AirtableActionItem.objects.filter(pk=item.pk).update(status_locally_modified=not ok)
            pushed_ok += ok
            if not ok:
                self.stdout.write(self.style.WARNING("    Airtable write failed; will retry on next pull"))
        if options["commit"]:
            self.stdout.write(self.style.SUCCESS(f"Restored {len(todo)}; written to Airtable {pushed_ok}."))
