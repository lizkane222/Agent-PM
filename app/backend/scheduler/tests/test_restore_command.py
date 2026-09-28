"""Tests for `manage.py restore_lost_calendar_schedulings`.

The command reconstructs calendar rows for action-item schedulings destroyed by the old
Google-sync behaviour, reading the `AgentActivityEvent` log as the surviving record.
"""

import datetime
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import CommandError, call_command
from django.test import TestCase

from realtime.models import AgentActivityEvent
from scheduler.models import CalendarEvent

User = get_user_model()

UTC = datetime.timezone.utc
#: 2026-06-26 is inside PDT (UTC-7), so 10:45 AM local is 17:45 UTC.
PDT_OFFSET = datetime.timedelta(hours=7)


class RestoreLostSchedulingsTest(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username="restore_user", password="{PASSWORD}")

    def tearDown(self):
        cache.clear()

    # -- fixtures ---------------------------------------------------------------

    def _log(self, task, airtable_id, when_local, logged_at=None):
        """An "added to calendar" activity entry, as the browser wrote it."""
        label = when_local.strftime("%a, %b %-d, %-I:%M %p")
        event = AgentActivityEvent.objects.create(
            user=self.user,
            event_type="calendar",
            title=f'"{task}" added to calendar for {label} (Acme)',
            metadata={"resource": {"type": "action_item", "id": airtable_id}},
        )
        # created_at is auto_now_add; the command reads it to infer the year.
        AgentActivityEvent.objects.filter(pk=event.pk).update(
            created_at=logged_at or when_local.replace(tzinfo=UTC)
        )
        return event

    def _row(self, airtable_id, start_utc, title="Existing"):
        return CalendarEvent.objects.create(
            owner=self.user,
            title=title,
            start_datetime=start_utc,
            end_datetime=start_utc + datetime.timedelta(minutes=15),
            calendar_id="work_tracking",
            agentpm_airtable_id=airtable_id,
        )

    def _run(self, *args):
        out = StringIO()
        call_command("restore_lost_calendar_schedulings", *args, stdout=out, stderr=out)
        return out.getvalue()

    def _restored(self):
        return CalendarEvent.objects.filter(
            owner=self.user, description__startswith="Restored"
        )

    # -- dry run ----------------------------------------------------------------

    def test_dry_run_is_the_default_and_writes_nothing(self):
        self._log("Composite Keys", "recAAA", datetime.datetime(2026, 6, 26, 10, 45))
        output = self._run()

        self.assertEqual(self._restored().count(), 0)
        self.assertIn("Dry run", output)
        self.assertIn("1 row(s) would be created", output)

    def test_commit_creates_the_row_at_the_logged_time(self):
        self._log("Composite Keys", "recAAA", datetime.datetime(2026, 6, 26, 10, 45))
        self._run("--commit")

        restored = self._restored().get()
        self.assertEqual(
            restored.start_datetime,
            datetime.datetime(2026, 6, 26, 17, 45, tzinfo=UTC),
            "10:45 AM PDT should land at 17:45 UTC",
        )
        self.assertEqual(restored.agentpm_airtable_id, "recAAA")
        self.assertEqual(restored.calendar_id, "work_tracking")

    def test_a_restored_row_is_unsynced_so_the_sync_pushes_it_and_cannot_delete_it(self):
        """PHASE 1b keys off a blank google_event_id; PHASE 3 never deletes one."""
        self._log("Composite Keys", "recAAA", datetime.datetime(2026, 6, 26, 10, 45))
        self._run("--commit")

        restored = self._restored().get()
        self.assertEqual(restored.google_event_id, "")
        self.assertFalse(restored.is_synced)

    def test_the_default_block_is_fifteen_minutes(self):
        self._log("Composite Keys", "recAAA", datetime.datetime(2026, 6, 26, 10, 45))
        self._run("--commit")

        restored = self._restored().get()
        self.assertEqual(restored.end_datetime - restored.start_datetime,
                         datetime.timedelta(minutes=15))

    def test_duration_is_overridable(self):
        self._log("Composite Keys", "recAAA", datetime.datetime(2026, 6, 26, 10, 45))
        self._run("--commit", "--duration-minutes", "45")

        restored = self._restored().get()
        self.assertEqual(restored.end_datetime - restored.start_datetime,
                         datetime.timedelta(minutes=45))

    def test_a_zero_duration_is_rejected(self):
        self._log("Composite Keys", "recAAA", datetime.datetime(2026, 6, 26, 10, 45))
        with self.assertRaises(CommandError):
            self._run("--commit", "--duration-minutes", "0")

    # -- idempotency ------------------------------------------------------------

    def test_running_twice_does_not_duplicate(self):
        self._log("Composite Keys", "recAAA", datetime.datetime(2026, 6, 26, 10, 45))
        self._run("--commit")
        output = self._run("--commit")

        self.assertEqual(self._restored().count(), 1)
        self.assertIn("Nothing to restore", output)

    def test_a_scheduling_that_still_has_its_row_is_skipped(self):
        self._log("Composite Keys", "recAAA", datetime.datetime(2026, 6, 26, 10, 45))
        self._row("recAAA", datetime.datetime(2026, 6, 26, 17, 45, tzinfo=UTC))
        self._run("--commit")

        self.assertEqual(self._restored().count(), 0)

    # -- the two log properties that forced count-based reconciliation ---------

    def test_a_rescheduled_item_is_not_restored_at_its_old_time(self):
        """Dragging an event writes no new log entry, so the log time goes stale.

        Matching on the minute would read this as missing and duplicate it at 17:45.
        """
        self._log("Slack Suresh", "recMOVED", datetime.datetime(2026, 6, 26, 10, 45))
        self._row("recMOVED", datetime.datetime(2026, 6, 26, 18, 15, tzinfo=UTC))
        self._run("--commit")

        self.assertEqual(self._restored().count(), 0, "a moved event must not be duplicated")

    def test_several_slots_on_one_day_restore_all_but_the_ones_that_survived(self):
        """The user does schedule one item into several slots on a single day."""
        for hour, minute in ((11, 45), (14, 45), (16, 45)):
            self._log("Create Diagram", "recTHREE", datetime.datetime(2026, 9, 9, hour, minute))
        # Only the 14:45 local (21:45 UTC) block survived.
        self._row("recTHREE", datetime.datetime(2026, 9, 9, 21, 45, tzinfo=UTC))
        self._run("--commit")

        starts = sorted(self._restored().values_list("start_datetime", flat=True))
        self.assertEqual(len(starts), 2, "two of the three slots are genuinely missing")
        self.assertEqual(
            starts,
            [
                datetime.datetime(2026, 9, 9, 18, 45, tzinfo=UTC),
                datetime.datetime(2026, 9, 9, 23, 45, tzinfo=UTC),
            ],
        )

    def test_duplicate_log_entries_for_one_slot_restore_one_row(self):
        """The log double-writes on occasion; each artifact must not become a block."""
        for _ in range(3):
            self._log("Slack Suresh", "recDUP", datetime.datetime(2026, 6, 26, 10, 45))
        self._run("--commit")

        self.assertEqual(self._restored().count(), 1)

    # -- timezone safety --------------------------------------------------------

    def test_a_wrong_timezone_is_refused_rather_than_guessed(self):
        """Getting the zone wrong shifts every block by hours with nothing to flag it."""
        self._log("Composite Keys", "recAAA", datetime.datetime(2026, 6, 26, 10, 45))
        # A surviving row proves the real offset is PDT, so UTC must be rejected.
        self._log("Other", "recCAL", datetime.datetime(2026, 6, 26, 9, 0))
        self._row("recCAL", datetime.datetime(2026, 6, 26, 16, 0, tzinfo=UTC))

        with self.assertRaises(CommandError):
            self._run("--commit", "--tz", "UTC")
        self.assertEqual(self._restored().count(), 0, "nothing may be written after a refusal")

    def test_an_unknown_timezone_is_rejected(self):
        self._log("Composite Keys", "recAAA", datetime.datetime(2026, 6, 26, 10, 45))
        with self.assertRaises(CommandError):
            self._run("--tz", "Mars/Olympus_Mons")

    def test_a_matching_timezone_is_reported_as_validated(self):
        self._log("Other", "recCAL", datetime.datetime(2026, 6, 26, 9, 0))
        self._row("recCAL", datetime.datetime(2026, 6, 26, 16, 0, tzinfo=UTC))
        self.assertIn("validated", self._run())

    # -- parsing edge cases -----------------------------------------------------

    def test_an_entry_with_no_resource_id_is_ignored(self):
        AgentActivityEvent.objects.create(
            user=self.user, event_type="calendar",
            title='"Orphan" added to calendar for Fri, Jun 26, 10:45 AM',
            metadata={},
        )
        self._run("--commit")
        self.assertEqual(self._restored().count(), 0)

    def test_unrelated_activity_entries_are_ignored(self):
        AgentActivityEvent.objects.create(
            user=self.user, event_type="calendar",
            title='Account "Acme" linked to event "Lunch"', metadata={},
        )
        self.assertIn("0 row(s) would be created", self._run())

    def test_a_scheduling_whose_action_item_is_gone_is_still_restored_and_flagged(self):
        """'Restore all' was explicit, so an orphan is restored — but reported."""
        self._log("Deleted item", "recGONE", datetime.datetime(2026, 6, 26, 10, 45))
        output = self._run("--commit")

        restored = self._restored().get()
        self.assertEqual(restored.title, "Deleted item", "falls back to the logged title")
        self.assertIn("no longer exists", output)

    def test_the_title_comes_from_the_airtable_record_when_it_exists(self):
        from airtable_sync.models import AirtableActionItem

        AirtableActionItem.objects.create(
            airtable_id="recREAL", task="Real current task name", status="In Progress"
        )
        self._log("Stale logged name", "recREAL", datetime.datetime(2026, 6, 26, 10, 45))
        self._run("--commit")

        self.assertEqual(self._restored().get().title, "Real current task name")

    # -- scoping ----------------------------------------------------------------

    def test_another_users_log_entries_are_not_restored_onto_this_user(self):
        other = User.objects.create_user(username="restore_other", password="{PASSWORD}")
        self._log("Mine", "recMINE", datetime.datetime(2026, 6, 26, 10, 45))
        AgentActivityEvent.objects.create(
            user=other, event_type="calendar",
            title='"Theirs" added to calendar for Fri, Jun 26, 11:45 AM',
            metadata={"resource": {"type": "action_item", "id": "recTHEIRS"}},
        )
        self._run("--commit", "--user", "restore_user")

        self.assertEqual(
            list(self._restored().values_list("agentpm_airtable_id", flat=True)), ["recMINE"]
        )
        self.assertFalse(CalendarEvent.objects.filter(owner=other).exists())

    def test_an_unknown_username_is_rejected(self):
        with self.assertRaises(CommandError):
            self._run("--user", "nobody")
