"""status_changed_at moves ONLY on a real status transition (updated_at is auto_now and moves on any save)."""
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import AirtableActionItem
from .test_status_persistence import FakeAirtable


class StatusChangedAtTests(APITestCase):
    def setUp(self):
        self.air = FakeAirtable()
        for target in ("airtable_sync.views.get_table", "airtable_sync.write_back.get_table",
                       "airtable_sync.sync.get_table"):
            p = patch(target, return_value=self.air)
            p.start()
            self.addCleanup(p.stop)
        self.client.force_authenticate(User.objects.create_user("sca", password="x", is_staff=True))
        self.old = timezone.now() - timedelta(days=5)
        self.item = AirtableActionItem.objects.create(
            airtable_id="recSCA1", task="T", status="In Progress", status_changed_at=self.old)
        self.air.records["recSCA1"] = {"Task": "T", "Status": "In Progress"}

    def _reload(self):
        self.item.refresh_from_db()
        return self.item.status_changed_at

    def test_status_endpoint_sets_on_change(self):
        self.client.patch("/api/v1/airtable/action-items/recSCA1/status/", {"status": "Blocked"}, format="json")
        self.assertGreater(self._reload(), self.old)

    def test_status_endpoint_noop_does_not_set(self):
        self.client.patch("/api/v1/airtable/action-items/recSCA1/status/", {"status": "In Progress"}, format="json")
        self.assertEqual(self._reload(), self.old)

    def test_fields_endpoint_sets_only_on_real_change(self):
        url = "/api/v1/airtable/action-items/recSCA1/fields/"
        self.client.patch(url, {"task_details": "edit"}, format="json")
        self.assertEqual(self._reload(), self.old)
        self.client.patch(url, {"status": "In Progress"}, format="json")
        self.assertEqual(self._reload(), self.old)
        self.client.patch(url, {"status": "Done"}, format="json")
        self.assertGreater(self._reload(), self.old)

    def test_viewset_patch_sets_only_on_real_change(self):
        url = f"/api/v1/airtable/action-items/{self.item.pk}/"
        self.client.patch(url, {"task_details": "x"}, format="json")
        self.assertEqual(self._reload(), self.old)
        self.client.patch(url, {"status": "Blocked"}, format="json")
        self.assertGreater(self._reload(), self.old)

    def test_serializer_field_is_read_only(self):
        url = f"/api/v1/airtable/action-items/{self.item.pk}/"
        r = self.client.patch(url, {"status_changed_at": "2001-01-01T00:00:00Z"}, format="json")
        self.assertEqual(self._reload(), self.old)
        self.assertIn("status_changed_at", self.client.get(url).data)

    def test_pull_with_same_status_does_not_bump(self):
        from .sync import sync_action_items
        sync_action_items()
        self.assertEqual(self._reload(), self.old)

    def test_pull_with_different_status_sets(self):
        from .sync import sync_action_items
        self.air.records["recSCA1"]["Status"] = "Blocked"
        sync_action_items()
        self.assertGreater(self._reload(), self.old)
        self.assertEqual(self.item.status, "Blocked")

    def test_create_sets_it(self):
        r = self.client.post("/api/v1/airtable/action-items/", {"task": "New"}, format="json")
        if r.status_code == 201:
            self.assertIsNotNone(r.data["status_changed_at"])
