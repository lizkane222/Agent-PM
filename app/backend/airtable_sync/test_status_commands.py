from datetime import timedelta
from io import StringIO
from types import SimpleNamespace as NS
from unittest.mock import MagicMock, patch

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from realtime.models import AgentActivityEvent

from .management.commands.ensure_airtable_status_options import plan_choices, required_options
from .models import AirtableActionItem
from .test_status_persistence import FakeAirtable


class PlanChoicesTests(TestCase):
    CUR = [
        {"id": "s1", "name": "Not Started", "color": "yellowLight2"},
        {"id": "s2", "name": "In Progress", "color": "cyanLight2"},
        {"id": "s3", "name": "Blocked", "color": "redLight2"},
        {"id": "s4", "name": "Ready", "color": "greenLight2"},
        {"id": "s5", "name": "Completed", "color": "blueLight2"},
    ]

    def test_required_covers_every_app_status(self):
        self.assertEqual(set(required_options()), {"Not Started", "In Progress", "Completed", "Blocked", "Backlogged"})

    def test_adds_only_missing_and_keeps_existing_untouched(self):
        choices, added = plan_choices(self.CUR, required_options())
        self.assertEqual(added, ["Backlogged"])
        self.assertEqual(choices[:5], self.CUR)  # ids/colors/order preserved
        self.assertEqual(len(choices), 6)
        self.assertNotIn("id", choices[5])

    def test_idempotent(self):
        choices, _ = plan_choices(self.CUR, required_options())
        with_ids = [dict(c, id=c.get("id", "new")) for c in choices]
        self.assertEqual(plan_choices(with_ids, required_options())[1], [])


class EnsureCommandTests(TestCase):
    def _table(self):
        choices = [NS(id=f"s{i}", name=n, color="grayLight2") for i, n in
                   enumerate(["Not Started", "In Progress", "Blocked", "Ready", "Completed"])]
        field = NS(id="fld1", name="Status", type="singleSelect", options=NS(choices=choices))
        t = MagicMock()
        t.schema.return_value = NS(fields=[field])
        t.api.build_url.return_value = "http://x"
        return t

    def _run(self, table, *args):
        out = StringIO()
        with patch("airtable_sync.management.commands.ensure_airtable_status_options.get_table", return_value=table):
            call_command("ensure_airtable_status_options", *args, stdout=out)
        return out.getvalue()

    def test_dry_run_writes_nothing(self):
        t = self._table()
        self.assertIn("Dry run", self._run(t))
        t.api.request.assert_not_called()

    def test_commit_sends_all_existing_choices_plus_new(self):
        t = self._table()
        self._run(t, "--commit")
        body = t.api.request.call_args.kwargs["json"]["options"]["choices"]
        self.assertEqual([c["name"] for c in body], ["Not Started", "In Progress", "Blocked", "Ready", "Completed", "Backlogged"])
        self.assertTrue(all("id" in c for c in body[:5]))


class RestoreLoggedDoneTests(TestCase):
    def setUp(self):
        self.air = FakeAirtable()
        p = patch("airtable_sync.write_back.get_table", return_value=self.air)
        p.start()
        self.addCleanup(p.stop)
        self.t0 = timezone.now() - timedelta(days=5)

    def _log(self, rid, old, new, minutes):
        AgentActivityEvent.objects.create(
            user=None if False else self._user(), event_type="action_item",
            title=f'"T" — Status: {old} → {new}', metadata={"resource": {"type": "action_item", "id": rid}},
        )
        AgentActivityEvent.objects.filter(pk=AgentActivityEvent.objects.latest("id").pk).update(
            created_at=self.t0 + timedelta(minutes=minutes))

    def _user(self):
        from django.contrib.auth.models import User
        return User.objects.get_or_create(username="u")[0]

    def _item(self, rid, status):
        return AirtableActionItem.objects.create(airtable_id=rid, task=rid, status=status)

    def _run(self, *a):
        out = StringIO()
        call_command("restore_logged_done_items", *a, stdout=out)
        return out.getvalue()

    def test_dry_run_changes_nothing(self):
        self._item("recA", "In Progress")
        self._log("recA", "In Progress", "Done", 1)
        self.assertIn("1 item(s)", self._run())
        self.assertEqual(AirtableActionItem.objects.get(airtable_id="recA").status, "In Progress")
        self.assertEqual(self.air.records, {})

    def test_commit_restores_and_writes_completed(self):
        self._item("recA", "In Progress")
        self._log("recA", "In Progress", "Done", 1)
        self._run("--commit")
        it = AirtableActionItem.objects.get(airtable_id="recA")
        self.assertEqual(it.status, "Done")
        self.assertEqual(it.marked_done_at, self.t0 + timedelta(minutes=1))
        self.assertEqual(self.air.records["recA"]["Status"], "Completed")
        self.assertFalse(it.status_locally_modified)

    def test_reopened_later_is_left_alone(self):
        self._item("recB", "Open")
        self._log("recB", "Open", "Done", 1)
        self._log("recB", "Done", "Open", 2)
        self._run("--commit")
        self.assertEqual(AirtableActionItem.objects.get(airtable_id="recB").status, "Open")
        self.assertEqual(self.air.records, {})

    def test_already_done_and_local_ids_skipped(self):
        self._item("recC", "Done")
        self._log("recC", "Open", "Done", 1)
        self._log("local-1", "Open", "Done", 2)
        self.assertIn("0 item(s)", self._run("--commit"))

    def test_failed_push_flags_for_retry(self):
        self._item("recD", "Open")
        self._log("recD", "Open", "Done", 1)
        with patch.object(FakeAirtable, "update", side_effect=RuntimeError("down")):
            self._run("--commit")
        it = AirtableActionItem.objects.get(airtable_id="recD")
        self.assertEqual(it.status, "Done")
        self.assertTrue(it.status_locally_modified)
