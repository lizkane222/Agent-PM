"""Remove duplicate calendar blocks created when one AgentPM scheduling was inserted twice.

2026-11-16: two Celery workers (one stale, running pre-fix code) each inserted the same
unpushed block into Google, so an action item dropped once appeared twice. A pair is two
`CalendarEvent` rows for the same user with the same `agentpm_airtable_id`, the same
`calendar_id`, the same start MINUTE and different `google_event_id`s. (Two schedulings of one
item at *different* minutes are legitimate and never touched.)

The row the app created (`origin="agentpm"`, lowest pk) is kept. For each extra: its Google event
is deleted through `integrations.google_calendar_gateway.delete_by_id` (audited, `sendUpdates`
always "none", never emails), THEN the local row. If the Google delete fails the row is kept and
reported. Rows without an `agentpm_airtable_id`, and rows whose insert is still in flight
(`claiming:...`), are never considered. Never deletes every row of a group.

Dry run is the default::

    python manage.py dedupe_agentpm_calendar_twins [--username NAME]
    python manage.py dedupe_agentpm_calendar_twins --commit
"""

from __future__ import annotations

from collections import defaultdict

from django.core.management.base import BaseCommand
from django.db import transaction

SOURCE = "command.dedupe_twin"


class Command(BaseCommand):
    help = "Find (dry run) or remove (--commit) duplicate AgentPM calendar blocks."

    def add_arguments(self, parser):
        parser.add_argument("--commit", action="store_true", help="Write changes (default is a dry run).")
        parser.add_argument("--username", help="Only this user's events.")

    # Overridable in tests; returns a Google Calendar service for the user, or None.
    def _service_for(self, user):
        from googleapiclient.discovery import build

        from integrations.google_api import credentials_for

        creds = credentials_for(user)
        if creds is None:
            return None
        return build("calendar", "v3", credentials=creds, cache_discovery=False)

    def _groups(self, username):
        from scheduler.models import CalendarEvent

        qs = (CalendarEvent.objects.exclude(agentpm_airtable_id="")
              .exclude(google_event_id__startswith="claiming:")
              .select_related("owner").order_by("pk"))
        if username:
            qs = qs.filter(owner__username=username)
        groups = defaultdict(list)
        for ev in qs:
            minute = ev.start_datetime.replace(second=0, microsecond=0)
            groups[(ev.owner_id, ev.agentpm_airtable_id, ev.calendar_id, minute)].append(ev)
        return [g for g in groups.values() if len(g) > 1]

    def handle(self, *args, **opts):
        commit = opts["commit"]
        found = removed = failed = 0
        services = {}
        for group in self._groups(opts.get("username")):
            keeper = next((e for e in group if e.origin == "agentpm"), group[0])
            for twin in group:
                # Same Google id (or same row) is not a Google-level twin; a keeper is never a twin.
                if twin.pk == keeper.pk or (twin.google_event_id and twin.google_event_id == keeper.google_event_id):
                    continue
                found += 1
                self.stdout.write(
                    f"{twin.owner.username}: keep #{keeper.pk} [{keeper.google_event_id or '-'}] "
                    f"{'DELETE' if commit else 'would delete'} #{twin.pk} [{twin.google_event_id or '-'}] "
                    f"{twin.title!r} {twin.start_datetime.isoformat()}"
                )
                if not commit:
                    continue
                if twin.google_event_id:
                    from integrations import google_calendar_gateway

                    if twin.owner_id not in services:
                        services[twin.owner_id] = self._service_for(twin.owner)
                    service = services[twin.owner_id]
                    if service is None:
                        failed += 1
                        self.stdout.write("  kept: user has no active Google connection")
                        continue
                    try:
                        google_calendar_gateway.delete_by_id(
                            service, twin.owner, twin.google_event_id, source=SOURCE,
                            event_pk=twin.pk, calendar_id="primary")
                    except Exception as exc:  # noqa: BLE001 - report, keep the row, move on
                        if getattr(getattr(exc, "resp", None), "status", None) not in (404, 410):
                            failed += 1
                            self.stdout.write(f"  kept: Google delete failed ({type(exc).__name__})")
                            continue
                        # 404/410: already gone in Google, so the local row is the only copy left.
                with transaction.atomic():
                    type(twin).objects.filter(pk=twin.pk).delete()
                removed += 1
        verb = "removed" if commit else "would remove"
        self.stdout.write(f"{found} duplicate(s) found; {removed if commit else found} {verb}; {failed} kept after failure.")
