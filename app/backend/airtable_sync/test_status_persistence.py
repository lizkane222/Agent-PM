"""A status the user sets must survive the Airtable pull.

Regression for "marked Done but the Done column is nearly empty": the status endpoints wrote
"Done" to an Airtable whose option is "Completed" (rejected, swallowed), and "Backlogged" has no
Airtable option at all, so the 30-minute pull reverted every one of them.
"""
from unittest.mock import patch

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from .models import AirtableActionItem


class FakeAirtable:
    """Single-select Status with the real base's options; anything else is rejected."""

    OPTIONS = {"Not Started", "In Progress", "Blocked", "Ready", "Completed"}

    def __init__(self):
        self.records = {}  # id -> fields

    def update(self, rec_id, fields, **kw):
        status = fields.get("Status")
        if status is not None and status not in self.OPTIONS:
            raise RuntimeError(f"INVALID_MULTIPLE_CHOICE_OPTIONS {status}")
        self.records.setdefault(rec_id, {}).update(fields)
        return {"id": rec_id}

    def all(self, **kw):
        return [{"id": k, "fields": dict(v)} for k, v in self.records.items()]


class StatusSurvivesPullTests(APITestCase):
    def setUp(self):
        self.air = FakeAirtable()
        for target in ("airtable_sync.views.get_table", "airtable_sync.write_back.get_table",
                       "airtable_sync.sync.get_table"):
            p = patch(target, return_value=self.air)
            p.start()
            self.addCleanup(p.stop)
        self.user = User.objects.create_user("stat_user", password="x", is_staff=True)
        self.client.force_authenticate(self.user)
        self.item = AirtableActionItem.objects.create(airtable_id="recSTAT1", task="T", status="In Progress")
        self.air.records["recSTAT1"] = {"Task": "T", "Status": "In Progress"}

    def _pull(self):
        from .sync import sync_action_items
        sync_action_items()
        self.item.refresh_from_db()

    def _set(self, status, route="status"):
        url = f"/api/v1/airtable/action-items/recSTAT1/{route}/"
        body = {"status": status}
        return self.client.patch(url, body, format="json")

    def test_done_via_status_endpoint_survives_pull(self):
        self.assertEqual(self._set("Done").status_code, 200)
        self.assertEqual(self.air.records["recSTAT1"]["Status"], "Completed")
        self._pull()
        self.assertEqual(self.item.status, "Done")

    def test_done_via_fields_endpoint_survives_pull(self):
        self.assertEqual(self._set("Done", "fields").status_code, 200)
        self.assertEqual(self.air.records["recSTAT1"]["Status"], "Completed")
        self._pull()
        self.assertEqual(self.item.status, "Done")

    def test_backlogged_survives_pull(self):
        self.assertEqual(self._set("Backlogged").status_code, 200)
        self._pull()
        self._pull()
        self.assertEqual(self.item.status, "Backlogged")

    def test_blocked_survives_pull(self):
        self._set("Blocked")
        self._pull()
        self.assertEqual(self.item.status, "Blocked")

    def test_status_survives_pull_even_when_airtable_push_fails(self):
        with patch.object(FakeAirtable, "update", side_effect=RuntimeError("down")):
            self.assertEqual(self._set("Done").status_code, 200)
        self.assertTrue(AirtableActionItem.objects.get(pk=self.item.pk).status_locally_modified)
        # Airtable is reachable again on the pull: the unsent status is retried, not reverted.
        self._pull()
        self.assertEqual(self.item.status, "Done")
        self.assertEqual(self.air.records["recSTAT1"]["Status"], "Completed")
        self.assertFalse(self.item.status_locally_modified)

    def test_airtable_edits_still_apply_when_nothing_is_pending(self):
        self.air.records["recSTAT1"]["Status"] = "Blocked"
        self._pull()
        self.assertEqual(self.item.status, "Blocked")
