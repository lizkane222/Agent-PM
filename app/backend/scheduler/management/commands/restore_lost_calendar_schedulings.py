"""Rebuild calendar rows for action items whose scheduling was lost.

Scheduled action items used to live only in browser ``localStorage``. The Google Calendar
sync pushed them, then deleted the ``localStorage`` entry *before* confirming the pull had
replaced it with a database row — so whenever the round trip did not complete, the scheduling
existed nowhere. See the `_reconcile_missing_google_events` docstring in
``integrations/views.py`` for the three ways that happened.

The activity log is the surviving record. Every scheduling wrote an ``AgentActivityEvent``
titled ``"<task>" added to calendar for Tue, Sep 15, 11:00 AM (Account)`` with the Airtable
record id in ``metadata["resource"]["id"]``. That is enough to reconstruct the row.

Dry run is the default::

    python manage.py restore_lost_calendar_schedulings
    python manage.py restore_lost_calendar_schedulings --commit

Idempotent: a second run finds the rows the first one created and reports nothing to do.
Restored rows are deliberately ``is_synced=False`` with a blank ``google_event_id``, so the
next sync's PHASE 1b mirrors them to Google and PHASE 3 can never delete them.
"""

from __future__ import annotations

import datetime
import json
import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

# The activity-log title as the browser rendered it, e.g.
#   "Provision SQL Traits" added to calendar for Tue, Sep 15, 11:00 AM (Autodesk)
# The task itself is not captured here — it can contain quotes, colons and parentheses of its
# own, so it is taken from the Airtable record instead. Only the timestamp tail is parsed.
_TITLE_RE = re.compile(
    r"added to calendar for \w+, (?P<mon>\w{3})\w* (?P<day>\d{1,2}), "
    r"(?P<hour>\d{1,2}):(?P<minute>\d{2})\s*(?P<meridiem>AM|PM)",
    re.IGNORECASE,
)

#: The most common scheduled slot length among surviving rows (27 of 56 in the dev DB).
DEFAULT_DURATION_MINUTES = 15

#: Schedulings are reconciled against surviving rows **per (action item, calendar day) by
#: count**, not by matching timestamps. That is forced by two properties of the log:
#:
#:  * Dragging an event to a new time does **not** write a new "added to calendar" entry, so
#:    the log holds the time an item was first dropped while the row holds where it ended up.
#:    Matching on the minute therefore reads a *rescheduled* item as missing and restores a
#:    duplicate at its old time. (Observed: recVqthtzpebj8ATK logged 17:30/17:45, rows at
#:    18:00/18:15.)
#:  * The user does legitimately schedule one action item into several slots on one day
#:    (recnsHNdQNNQxgIru has three on 2026-09-09), so collapsing a day to "has a row" would
#:    under-restore.
#:
#: Counting distinct logged slots against surviving rows for the same day handles both: N
#: logged, M present ⇒ restore N−M, preferring the logged slots furthest from any existing row.

#: The log strings were produced by `toLocaleString` in the user's browser, so they are in the
#: user's wall-clock time, NOT `settings.TIME_ZONE` (which is UTC here). A real zone rather
#: than a fixed offset so DST is handled correctly across the restored date range.
DEFAULT_TIMEZONE = "America/Los_Angeles"


class Scheduling:
    """One reconstructed scheduling from the activity log."""

    __slots__ = ("log_id", "airtable_id", "local_naive", "logged_at", "raw_title")

    def __init__(self, log_id, airtable_id, local_naive, logged_at, raw_title):
        self.log_id = log_id
        self.airtable_id = airtable_id
        self.local_naive = local_naive
        self.logged_at = logged_at
        self.raw_title = raw_title

    def start_utc(self, tz):
        """The scheduled start as an aware UTC datetime, interpreting the log in `tz`."""
        return self.local_naive.replace(tzinfo=tz).astimezone(datetime.timezone.utc)


class Command(BaseCommand):
    help = "Restore calendar rows for action-item schedulings lost by the Google sync."

    def add_arguments(self, parser):
        parser.add_argument(
            "--commit",
            action="store_true",
            help="Actually write the rows. Without this the command only reports.",
        )
        parser.add_argument(
            "--tz",
            default=DEFAULT_TIMEZONE,
            help=(
                "Timezone the activity-log timestamps were written in "
                f"(default {DEFAULT_TIMEZONE}). Validated against known-good rows."
            ),
        )
        parser.add_argument(
            "--duration-minutes",
            type=int,
            default=DEFAULT_DURATION_MINUTES,
            help=f"Length of a restored block (default {DEFAULT_DURATION_MINUTES}).",
        )
        parser.add_argument(
            "--user",
            default=None,
            help="Only process one username. Default: every user with matching log entries.",
        )

    def handle(self, *args, **options):
        from django.contrib.auth import get_user_model
        from realtime.models import AgentActivityEvent

        commit = options["commit"]
        duration = datetime.timedelta(minutes=options["duration_minutes"])
        if duration <= datetime.timedelta(0):
            raise CommandError("--duration-minutes must be positive.")

        try:
            tz = ZoneInfo(options["tz"])
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise CommandError(f"Unknown --tz {options['tz']!r}: {exc}") from exc

        User = get_user_model()
        users = User.objects.all()
        if options["user"]:
            users = users.filter(username=options["user"])
            if not users.exists():
                raise CommandError(f"No user named {options['user']!r}.")

        total_restored = 0
        for user in users:
            logs = AgentActivityEvent.objects.filter(
                user=user, title__contains="added to calendar"
            ).order_by("id")
            if not logs.exists():
                continue
            total_restored += self._process_user(user, logs, tz, duration, commit)

        if not commit:
            self.stdout.write(self.style.WARNING(
                f"\nDry run — nothing was written. {total_restored} row(s) would be created.\n"
                "Re-run with --commit to apply (back up db.sqlite3 first)."
            ))
        else:
            self.stdout.write(self.style.SUCCESS(
                f"\nRestored {total_restored} calendar row(s)."
            ))

    # -- per user ---------------------------------------------------------------

    def _process_user(self, user, logs, tz, duration, commit):
        from scheduler.models import CalendarEvent

        schedulings = [s for s in (self._parse(log) for log in logs) if s is not None]
        if not schedulings:
            return 0

        self.stdout.write(self.style.MIGRATE_HEADING(f"\n=== {user.username} ==="))
        self.stdout.write(f"{len(schedulings)} scheduling(s) in the activity log")

        existing = list(
            CalendarEvent.objects.filter(
                owner=user, calendar_id="work_tracking"
            ).exclude(agentpm_airtable_id="").values_list("agentpm_airtable_id", "start_datetime")
        )

        self._verify_timezone(schedulings, existing, tz)

        missing = self._unaccounted_for(schedulings, existing, tz)
        if not missing:
            self.stdout.write(self.style.SUCCESS("Nothing to restore — every scheduling has a row."))
            return 0

        self.stdout.write(f"{len(missing)} have no calendar row:\n")
        planned = []
        for s in missing:
            task, status, account = self._action_item_facts(s.airtable_id)
            start_utc = s.start_utc(tz)
            flag = "" if task else "  ⚠ no Airtable record"
            self.stdout.write(
                f"  log#{s.log_id:<5} {start_utc:%Y-%m-%d %H:%M} UTC  "
                f"{s.airtable_id:<20} [{status or '—':<12}] {(task or s.raw_title)[:46]}{flag}"
            )
            planned.append((s, start_utc, task, account))

        orphans = sum(1 for _s, _st, task, _a in planned if not task)
        if orphans:
            self.stdout.write(self.style.WARNING(
                f"\n  {orphans} row(s) reference an action item that no longer exists. They are "
                "restored as titled blocks (per 'restore all'), but cannot be opened as an "
                "action item — delete them from the calendar if unwanted."
            ))

        if not commit:
            return len(planned)

        created = 0
        with transaction.atomic():
            for s, start_utc, task, account in planned:
                CalendarEvent.objects.create(
                    owner=user,
                    account=account,
                    title=task or s.raw_title or "Restored action item",
                    start_datetime=start_utc,
                    end_datetime=start_utc + duration,
                    calendar_id="work_tracking",
                    agentpm_airtable_id=s.airtable_id,
                    # Blank + unsynced on purpose: PHASE 1b of the sync will mirror these to
                    # Google, and PHASE 3 never deletes a row with no google_event_id.
                    google_event_id="",
                    is_synced=False,
                    description="Restored from the activity log after a sync data loss.",
                )
                created += 1
        self.stdout.write(self.style.SUCCESS(f"\nCreated {created} row(s) for {user.username}."))
        return created

    # -- parsing / matching -----------------------------------------------------

    def _parse(self, log):
        """A Scheduling from one log row, or None if it is not a parseable scheduling."""
        match = _TITLE_RE.search(log.title or "")
        if not match:
            return None

        try:
            metadata = log.metadata if isinstance(log.metadata, dict) else json.loads(log.metadata or "{}")
        except (TypeError, ValueError):
            return None
        airtable_id = ((metadata or {}).get("resource") or {}).get("id") or ""
        if not airtable_id:
            return None

        hour = int(match["hour"]) % 12
        if match["meridiem"].upper() == "PM":
            hour += 12
        try:
            month = datetime.datetime.strptime(match["mon"].title(), "%b").month
        except ValueError:
            return None

        # The log records no year. It is taken from when the entry was written, which is
        # within hours of the scheduling in every observed case, then nudged if that lands
        # implausibly far away — the only real case being a late-December entry scheduling
        # into January.
        logged_at = timezone.localtime(log.created_at, ZoneInfo("UTC"))
        year = logged_at.year
        try:
            local_naive = datetime.datetime(year, month, int(match["day"]), hour, int(match["minute"]))
        except ValueError:
            return None
        delta_days = (local_naive.date() - logged_at.date()).days
        if delta_days > 180:
            local_naive = local_naive.replace(year=year - 1)
        elif delta_days < -180:
            local_naive = local_naive.replace(year=year + 1)

        raw_title = (log.title or "").split('" added to calendar')[0].lstrip('"')
        return Scheduling(log.id, airtable_id, local_naive, logged_at, raw_title)

    def _unaccounted_for(self, schedulings, existing, tz):
        """The schedulings with no surviving row, reconciled by count per (item, day).

        See the MATCH_TOLERANCE comment block above for why this counts rather than matching
        timestamps. Returns them in log order so the report reads chronologically.
        """
        # Collapse duplicate log entries for the same item + same minute. The log double-writes
        # on occasion (ids 155/156 and 160/178 are identical pairs), and each artifact would
        # otherwise restore an extra block.
        deduped = {}
        for s in schedulings:
            deduped.setdefault((s.airtable_id, s.local_naive), s)

        # Existing rows bucketed by (item, local calendar day).
        rows_by_day = {}
        for airtable_id, start in existing:
            local_day = start.astimezone(tz).date()
            rows_by_day.setdefault((airtable_id, local_day), []).append(start)

        logged_by_day = {}
        for s in deduped.values():
            logged_by_day.setdefault((s.airtable_id, s.local_naive.date()), []).append(s)

        keep = set()
        for key, logged in logged_by_day.items():
            present = rows_by_day.get(key, [])
            shortfall = len(logged) - len(present)
            if shortfall <= 0:
                continue
            # Restore the logged slots furthest from any surviving row: if the user moved one
            # of three blocks, the two untouched times are the ones genuinely missing.
            def distance(s, present=present):
                if not present:
                    return datetime.timedelta.max
                target = s.start_utc(tz)
                return min(abs(start - target) for start in present)

            for s in sorted(logged, key=distance, reverse=True)[:shortfall]:
                keep.add(s.log_id)

        return [s for s in deduped.values() if s.log_id in keep]

    def _verify_timezone(self, schedulings, existing, tz):
        """Refuse to run if some whole-hour shift explains the surviving rows better than `tz`.

        Getting the zone wrong moves every restored block by a whole number of hours, and
        nothing downstream would notice. Rows that survived are the calibration.

        Scored by counting *exact* (item, time) hits per candidate offset rather than by
        averaging a nearest-row residual: when one action item holds several slots on a day and
        only some survived, the nearest row to a missing slot is a different slot entirely, so
        residuals are noise. A tie is accepted — only a strictly better offset is evidence the
        assumed zone is wrong.
        """
        rows = {(airtable_id, start) for airtable_id, start in existing}
        if not rows:
            self.stdout.write(self.style.WARNING(
                f"Could not validate --tz {tz.key} against any surviving row — "
                "check one restored time on the calendar before trusting the rest."
            ))
            return

        def score(offset_hours):
            shift = datetime.timedelta(hours=offset_hours)
            return sum(
                1 for s in schedulings
                if (s.airtable_id, s.start_utc(tz) + shift) in rows
            )

        baseline = score(0)
        better = [(o, score(o)) for o in range(-12, 15) if o != 0 and score(o) > baseline]

        if not better:
            self.stdout.write(self.style.SUCCESS(
                f"--tz {tz.key} validated: {baseline} scheduling(s) land exactly on a "
                f"surviving row, and no other offset does better."
            ))
            return

        offset, count = max(better, key=lambda pair: pair[1])
        self.stdout.write(self.style.ERROR(
            f"--tz {tz.key} looks wrong: shifting by {offset:+d}h matches {count} surviving "
            f"row(s) against {baseline} for {tz.key}. Pass the correct --tz — restoring now "
            "would put every block at the wrong time."
        ))
        raise CommandError("Timezone validation failed; refusing to guess.")

    def _action_item_facts(self, airtable_id):
        """(task, status, Account|None) for an Airtable id, or ("", "", None) if it is gone."""
        from airtable_sync.models import AirtableActionItem
        from airtable_sync.sync import _resolve_scheduler_account

        item = (
            AirtableActionItem.objects.filter(airtable_id=airtable_id)
            .select_related("account")
            .first()
        )
        if item is None:
            return "", "", None
        try:
            account = _resolve_scheduler_account(item)
        except Exception:  # noqa: BLE001 — a restore must not die on account resolution
            account = None
        return item.task or "", item.status or "", account
