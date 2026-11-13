from unittest import mock

from django.core.cache import cache
from rest_framework.test import APITestCase

from accounts.models import AccountArtifact
from accounts.tests.test_views import _make_account, _make_artifact, _make_user


class ArtifactUpdateAndUpdatedByTest(APITestCase):
    def setUp(self):
        cache.clear()
        self.owner = _make_user("art_owner")
        self.other = _make_user("art_other")
        self.acct = _make_account("Acme", admin_owner=self.owner)
        self.artifact = _make_artifact(self.acct, self.owner, "Doc")
        self.url = f"/api/v1/accounts/artifacts/{self.artifact.id}/"

    def test_unauthenticated_is_401(self):
        self.assertEqual(self.client.patch(self.url, {"name": "x"}, format="json").status_code, 401)

    def test_new_artifact_has_no_updater(self):
        self.client.force_authenticate(self.owner)
        data = self.client.get(f"/api/v1/accounts/accounts/{self.acct.id}/artifacts/").data[0]
        self.assertIsNone(data["updated_by"])
        self.assertIsNone(data["updated_by_username"])

    def test_owner_update_sets_and_exposes_updated_by(self):
        self.owner.first_name, self.owner.last_name = "Ada", "Lovelace"
        self.owner.save()
        self.client.force_authenticate(self.owner)
        resp = self.client.patch(
            self.url,
            {"name": "Renamed", "url": "https://example.com/new", "description": "<p>d</p>", "icon_key": "slack"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["name"], "Renamed")
        self.assertEqual(resp.data["updated_by"], self.owner.id)
        self.assertEqual(resp.data["updated_by_username"], "Ada Lovelace")
        self.artifact.refresh_from_db()
        self.assertEqual(self.artifact.updated_by_id, self.owner.id)
        self.assertEqual(self.artifact.icon_key, "slack")

    def test_updated_by_cannot_be_forged_by_client(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.patch(self.url, {"name": "n", "updated_by": self.other.id}, format="json")
        self.assertEqual(resp.data["updated_by"], self.owner.id)

    def test_other_user_cannot_update(self):
        self.client.force_authenticate(self.other)
        resp = self.client.patch(self.url, {"name": "Hacked"}, format="json")
        self.assertIn(resp.status_code, (403, 404))
        self.artifact.refresh_from_db()
        self.assertEqual(self.artifact.name, "Doc")
        self.assertIsNone(self.artifact.updated_by_id)

    def test_staff_update_records_staff_as_updater(self):
        staff = _make_user("art_staff", is_staff=True)
        self.client.force_authenticate(staff)
        with mock.patch("accounts.views._staff_sees_all", return_value=True):
            resp = self.client.patch(self.url, {"name": "Staffed"}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["updated_by"], staff.id)
        self.assertEqual(AccountArtifact.objects.get(pk=self.artifact.pk).uploaded_by_id, self.owner.id)


class ArtifactAirtableUpdatedByTest(APITestCase):
    def setUp(self):
        self.owner = _make_user("art_at_owner")
        self.acct = _make_account("Acme", admin_owner=self.owner)
        self.artifact = _make_artifact(self.acct, self.owner, "Doc")
        self.artifact.updated_by = self.owner
        self.artifact.save()

    def test_push_includes_updated_by(self):
        from airtable_sync import write_back
        table = mock.Mock()
        with mock.patch.object(write_back, "TABLE_ARTIFACTS", "tbl"), \
             mock.patch.object(write_back, "get_table", return_value=table), \
             mock.patch.object(write_back, "_airtable_call", side_effect=lambda f, *a, **k: f(*a, **k)):
            self.assertTrue(write_back.push_artifact_upsert(self.artifact))
        fields = table.batch_upsert.call_args[0][0][0]["fields"]
        self.assertEqual(fields["Updated By"], "art_at_owner")

    def test_push_retries_without_field_when_column_missing(self):
        from airtable_sync import write_back
        table = mock.Mock()
        table.batch_upsert.side_effect = [Exception("UNKNOWN_FIELD_NAME"), None]
        with mock.patch.object(write_back, "TABLE_ARTIFACTS", "tbl"), \
             mock.patch.object(write_back, "get_table", return_value=table), \
             mock.patch.object(write_back, "_airtable_call", side_effect=lambda f, *a, **k: f(*a, **k)):
            self.assertTrue(write_back.push_artifact_upsert(self.artifact))
        self.assertEqual(table.batch_upsert.call_count, 2)
        self.assertNotIn("Updated By", table.batch_upsert.call_args[0][0][0]["fields"])
