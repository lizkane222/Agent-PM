from datetime import timedelta
from io import StringIO
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from integrations.models import GoogleWriteLog
from scheduler.management.commands.dedupe_agentpm_calendar_twins import Command
from scheduler.models import CalendarEvent

User = get_user_model()


class DedupeTwinsTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("twinuser", password="x")
        self.start = (timezone.now() + timedelta(days=1)).replace(second=0, microsecond=0)
        self.service = MagicMock()
        p = patch.object(Command, "_service_for", return_value=self.service)
        p.start()
        self.addCleanup(p.stop)

    def ev(self, gid, origin="agentpm", owner=None, airtable="rec1", start=None, cal="work_tracking"):
        start = start or self.start
        return CalendarEvent.objects.create(
            owner=owner or self.user, google_event_id=gid, title="⏲ Task", calendar_id=cal,
            agentpm_airtable_id=airtable, origin=origin, start_datetime=start + timedelta(seconds=7),
            end_datetime=start + timedelta(minutes=15), is_synced=True)

    def run_cmd(self, *args):
        out = StringIO()
        call_command("dedupe_agentpm_calendar_twins", *args, stdout=out)
        return out.getvalue()

    def test_dry_run_writes_nothing_and_prints_the_pair(self):
        a, b = self.ev("g1"), self.ev("g2", origin="google")
        out = self.run_cmd()
        self.assertIn(f"#{b.pk}", out)
        self.assertEqual(CalendarEvent.objects.count(), 2)
        self.service.events.return_value.delete.assert_not_called()
        self.assertEqual(GoogleWriteLog.objects.count(), 0)

    def test_commit_keeps_the_agentpm_row_and_removes_the_twin_after_google(self):
        twin = self.ev("g2", origin="google")
        keeper = self.ev("g1")  # created later but origin=agentpm, so it wins over a lower pk
        self.run_cmd("--commit")
        self.assertEqual(list(CalendarEvent.objects.values_list("pk", flat=True)), [keeper.pk])
        d = self.service.events.return_value.delete
        d.assert_called_once()
        self.assertEqual(d.call_args.kwargs["eventId"], "g2")
        self.assertEqual(d.call_args.kwargs["sendUpdates"], "none")
        log = GoogleWriteLog.objects.get()
        self.assertEqual((log.action, log.source, log.send_updates), ("delete", "command.dedupe_twin", "none"))
        self.assertNotEqual(twin.pk, keeper.pk)

    def test_google_failure_keeps_the_row_and_reports(self):
        self.ev("g1")
        self.ev("g2", origin="google")
        self.service.events.return_value.delete.return_value.execute.side_effect = RuntimeError("boom")
        out = self.run_cmd("--commit")
        self.assertEqual(CalendarEvent.objects.count(), 2)
        self.assertIn("1 kept after failure", out)

    def test_idempotent(self):
        self.ev("g1")
        self.ev("g2", origin="google")
        self.run_cmd("--commit")
        out = self.run_cmd("--commit")
        self.assertIn("0 duplicate(s) found", out)
        self.assertEqual(CalendarEvent.objects.count(), 1)

    def test_different_minutes_blank_ids_and_unmarked_rows_are_untouched(self):
        self.ev("g1")
        self.ev("g2", start=self.start + timedelta(minutes=15))  # legitimate second slot
        self.ev("u1", airtable="")
        self.ev("u2", airtable="", origin="google")
        self.ev("c1", cal="reminders")
        self.run_cmd("--commit")
        self.assertEqual(CalendarEvent.objects.count(), 5)
        self.service.events.return_value.delete.assert_not_called()

    def test_in_flight_claim_is_never_touched(self):
        self.ev("g1")
        self.ev("claiming:abc", origin="google")
        self.run_cmd("--commit")
        self.assertEqual(CalendarEvent.objects.count(), 2)

    def test_never_deletes_every_row_of_a_group(self):
        for g in ("a", "b", "c"):
            self.ev(g, origin="google")
        self.run_cmd("--commit")
        self.assertEqual(CalendarEvent.objects.count(), 1)

    def test_scoped_per_user(self):
        other = User.objects.create_user("otheru", password="x")
        self.ev("g1")
        self.ev("g2", origin="google", owner=other)  # same action item id, different user
        self.run_cmd("--commit")
        self.assertEqual(CalendarEvent.objects.count(), 2)
        self.ev("g3", origin="google")
        self.run_cmd("--commit", "--username", "otheru")
        self.assertEqual(CalendarEvent.objects.count(), 3)
        self.run_cmd("--commit", "--username", "twinuser")
        self.assertEqual(CalendarEvent.objects.count(), 2)

    def test_no_google_connection_keeps_row(self):
        self.ev("g1")
        self.ev("g2", origin="google")
        with patch.object(Command, "_service_for", return_value=None):
            self.run_cmd("--commit")
        self.assertEqual(CalendarEvent.objects.count(), 2)
