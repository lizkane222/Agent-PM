"""
Tests for the schema-driven `sync_projects`, the new `sync_project_roles`, and
`sync_all`'s per-step error isolation.

`sync_projects` previously queried `{ns}__Project__c` with `AccountId` and
`{ns}__Start_Date__c`. None of those exist in the org `timesheeter` probed, so the
query 400'd, `SalesforceProject` stayed empty and every step after it died with it.
The SOQL assertions below are what keep that from regressing.
"""

from datetime import date
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase

from salesforce_sync.models import (
    SalesforceAccount,
    SalesforceConfig,
    SalesforceProject,
    SalesforceTeamMember,
)
from salesforce_sync.sync import (
    _get_or_create_config,
    sync_all,
    sync_project_roles,
    sync_projects,
)

from .fakes import FULL_PROJECT_FIELDS, FakeSalesforce

User = get_user_model()

SF_USER_ID = "005000000000001AAA"

PROJECT_RECORD = {
    "Id": "a0B000000000001",
    "Name": "Acme Rollout",
    "OwnerId": "005000000000009AAA",
    "Owner": {"Name": "Owner Person"},
    "ccpe_ocp__Account__c": "001000000000001",
    "ccpe_ocp__Account__r": {"Name": "Acme"},
    "project_cloud__Start__c": "2026-08-01",
    "project_cloud__End__c": "2026-12-31",
    "project_cloud__Status__c": "In Flight",
    "project_cloud__Description__c": "Segment migration",
    "Project_Manager__c": SF_USER_ID,
    "Solution_Architect_Primary__c": "005000000000002AAA",
}


def _sf(records=(PROJECT_RECORD,), fields=None):
    return FakeSalesforce(
        describes={"project_cloud__Project__c": fields or FULL_PROJECT_FIELDS},
        query_results={"FROM project_cloud__Project__c": {"records": list(records)}},
    )


class SyncProjectsTest(TestCase):
    def test_queries_the_orgs_real_object_and_fields(self):
        sf = _sf()

        sync_projects(sf, "cc4sf")

        soql = sf.queries[0]
        self.assertIn("FROM project_cloud__Project__c", soql)
        self.assertIn("ccpe_ocp__Account__c", soql)
        self.assertIn("ccpe_ocp__Account__r.Name", soql)
        self.assertIn("project_cloud__Start__c", soql)
        # The old, non-existent names must not reappear.
        self.assertNotIn("AccountId", soql)
        self.assertNotIn("Start_Date__c", soql)

    def test_ignores_the_namespace_argument(self):
        # `ns` is kept only for the existing call signature — the schema decides.
        sf = _sf()
        sync_projects(sf, "totally_wrong_ns")
        self.assertNotIn("totally_wrong_ns", sf.queries[0])

    def test_maps_the_record_onto_the_model(self):
        sync_projects(_sf(), "cc4sf")

        project = SalesforceProject.objects.get(sf_id="a0B000000000001")
        self.assertEqual(project.name, "Acme Rollout")
        self.assertEqual(project.status, "In Flight")
        self.assertEqual(project.description, "Segment migration")
        self.assertEqual(project.start_date, date(2026, 8, 1))
        self.assertEqual(project.end_date, date(2026, 12, 31))
        self.assertEqual(project.owner_name, "Owner Person")

    def test_links_an_already_synced_account(self):
        SalesforceAccount.objects.create(sf_id="001000000000001", name="Acme")

        sync_projects(_sf(), "cc4sf")

        self.assertEqual(
            SalesforceProject.objects.get(sf_id="a0B000000000001").account.name, "Acme"
        )

    def test_mirrors_an_account_outside_the_synced_window(self):
        # sync_accounts pulls 500 rows; a project can reference one outside that window.
        # Dropping the link would leave log_week's by-name fallback nothing to match on.
        self.assertEqual(SalesforceAccount.objects.count(), 0)

        sync_projects(_sf(), "cc4sf")

        account = SalesforceProject.objects.get(sf_id="a0B000000000001").account
        self.assertEqual(account.name, "Acme")
        self.assertEqual(account.sf_id, "001000000000001")

    def test_a_field_missing_from_the_org_is_skipped_not_fatal(self):
        sf = _sf(fields=["Id", "Name", "OwnerId", "ccpe_ocp__Account__c", "Project_Manager__c"])

        count = sync_projects(sf, "cc4sf")

        self.assertEqual(count, 1)
        self.assertNotIn("project_cloud__Status__c", sf.queries[0])
        self.assertEqual(SalesforceProject.objects.get(sf_id="a0B000000000001").status, "")

    def test_order_by_is_dropped_when_the_start_field_is_absent(self):
        sf = _sf(fields=["Id", "Name", "OwnerId"])

        sync_projects(sf, "cc4sf")

        self.assertNotIn("ORDER BY", sf.queries[0])

    def test_resyncing_updates_rather_than_duplicates(self):
        sync_projects(_sf(), "cc4sf")
        sync_projects(_sf(), "cc4sf")

        self.assertEqual(SalesforceProject.objects.count(), 1)


class SyncProjectRolesTest(TestCase):
    def setUp(self):
        sync_projects(_sf(), "cc4sf")

    def test_creates_one_member_row_per_populated_role_field(self):
        count = sync_project_roles(_sf())

        self.assertEqual(count, 2)
        roles = set(SalesforceTeamMember.objects.values_list("role", flat=True))
        self.assertEqual(roles, {"Project_Manager__c", "Solution_Architect_Primary__c"})

    def test_the_key_is_stable_so_a_resync_updates_in_place(self):
        sync_project_roles(_sf())
        sync_project_roles(_sf())

        self.assertEqual(SalesforceTeamMember.objects.count(), 2)
        self.assertTrue(
            SalesforceTeamMember.objects.filter(
                sf_id="role:a0B000000000001:Project_Manager__c"
            ).exists()
        )

    def test_blank_and_non_id_role_values_are_ignored(self):
        record = {**PROJECT_RECORD, "Project_Manager__c": "", "Delivery_Manager__c": "n/a"}

        sync_project_roles(_sf(records=[record]))

        self.assertEqual(
            list(SalesforceTeamMember.objects.values_list("role", flat=True)),
            ["Solution_Architect_Primary__c"],
        )

    def test_role_fields_absent_from_the_org_are_skipped(self):
        sf = _sf(fields=["Id", "Project_Manager__c"])

        sync_project_roles(sf)

        self.assertNotIn("Delivery_Manager__c", sf.queries[0])
        self.assertEqual(SalesforceTeamMember.objects.count(), 1)

    def test_no_role_fields_at_all_returns_zero_without_querying(self):
        sf = _sf(fields=["Id", "Name"])

        self.assertEqual(sync_project_roles(sf), 0)
        self.assertEqual(sf.queries, [])

    def test_a_project_not_in_the_local_mirror_is_skipped(self):
        SalesforceProject.objects.all().delete()

        self.assertEqual(sync_project_roles(_sf()), 0)


class SyncAllTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="liz", email="liz@example.com", password="pass"
        )

    def _run(self, sf):
        with mock.patch("salesforce_sync.sync.get_client", return_value=sf):
            return sync_all(self.user)

    def test_a_failing_step_does_not_take_the_others_down(self):
        # This is the actual production symptom: sync_projects 400'd on the wrong field
        # names, and because every step ran unguarded, accounts, members and tasks
        # never ran either. Failure is forced here rather than relying on the fake org
        # rejecting a query, so the test is about the isolation and nothing else.
        sf = _sf()
        sf.query_results["FROM Account"] = {"records": [
            {"Id": "001000000000001", "Name": "Acme", "Owner": {"Id": "005", "Name": "O"}},
        ]}

        with mock.patch(
            "salesforce_sync.sync.sync_tasks",
            side_effect=RuntimeError("INVALID_FIELD: no such column"),
        ):
            result = self._run(sf)

        self.assertEqual(result["accounts"], 1)
        self.assertEqual(result["projects"], 1)
        self.assertEqual(result["project_roles"], 2)
        self.assertEqual(result["tasks"], 0)
        self.assertIn("tasks", result["errors"])
        self.assertIn("INVALID_FIELD", result["errors"]["tasks"])

    def test_a_fully_working_org_reports_no_errors(self):
        result = self._run(_sf())

        self.assertNotIn("errors", result)
        self.assertEqual(result["projects"], 1)

    def test_sync_never_overwrites_the_stored_instance_url(self):
        # The OAuth callback owns instance_url — it stores the value from the token
        # response, which is the only authoritative source. Reading it back off the client
        # here would be circular, because the client's base_url is built *from* this row.
        SalesforceConfig.objects.create(
            user=self.user, instance_url="https://twlo--jarvisdc.sandbox.my.salesforce.com"
        )
        sf = _sf()
        sf.base_url = "https://wrong.my.salesforce.com/services/data/v59.0/"

        _get_or_create_config(self.user, sf)

        config = SalesforceConfig.objects.get(user=self.user)
        self.assertEqual(
            config.instance_url, "https://twlo--jarvisdc.sandbox.my.salesforce.com"
        )

    def test_the_sf_user_id_is_captured_for_role_matching(self):
        _get_or_create_config(self.user, _sf())

        self.assertEqual(
            SalesforceConfig.objects.get(user=self.user).sf_user_id, "005000000000001AAA"
        )


class IdentityResolutionTest(TestCase):
    """
    `sf_user_id` is load-bearing far beyond its size: a blank one disables the
    role-matched project fallback in `log_week._role_project_ids`, empties
    `SalesforceProjectViewSet`, and drops `Resource__c` off every time entry — so the
    week logs successfully and belongs to nobody.
    """

    def setUp(self):
        self.user = User.objects.create_user(
            username="liz", email="liz@example.com", password="pass"
        )

    def _config(self):
        return SalesforceConfig.objects.get(user=self.user)

    def test_chatter_is_preferred_when_available(self):
        sf = _sf()
        _get_or_create_config(self.user, sf)

        self.assertEqual(self._config().sf_user_id, SF_USER_ID)
        # The fallback costs a request, so it must not fire when Chatter answered.
        self.assertEqual(sf.userinfo_urls, [])

    def test_userinfo_covers_an_org_with_chatter_disabled(self):
        sf = _sf()
        sf.chatter_enabled = False
        sf.userinfo = {"user_id": SF_USER_ID, "email": "liz@twilio.com"}

        _get_or_create_config(self.user, sf)

        config = self._config()
        self.assertEqual(config.sf_user_id, SF_USER_ID)
        self.assertEqual(config.sf_user_email, "liz@twilio.com")

    def test_userinfo_is_requested_outside_the_versioned_data_api_path(self):
        # sf.base_url is ".../services/data/v59.0/"; userinfo is not under it, so building
        # the URL by appending to base_url would 404.
        sf = _sf()
        sf.chatter_enabled = False
        sf.userinfo = {"user_id": SF_USER_ID}

        _get_or_create_config(self.user, sf)

        self.assertEqual(
            sf.userinfo_urls,
            ["https://example.my.salesforce.com/services/oauth2/userinfo"],
        )

    def test_a_previously_stored_id_survives_both_paths_failing(self):
        # The OAuth callback derives sf_user_id from the token response with no API call at
        # all, so it can be present before any sync runs. A sync in an org where neither
        # identity endpoint answers must not blank it.
        SalesforceConfig.objects.create(
            user=self.user, instance_url="https://x.my.salesforce.com", sf_user_id=SF_USER_ID
        )
        sf = _sf()
        sf.chatter_enabled = False
        sf.userinfo = None

        _get_or_create_config(self.user, sf)

        self.assertEqual(self._config().sf_user_id, SF_USER_ID)

    def test_a_malformed_identity_payload_is_not_stored(self):
        sf = _sf()
        sf.chatter_enabled = False
        sf.userinfo = {"user_id": "not-an-id"}

        _get_or_create_config(self.user, sf)

        self.assertEqual(self._config().sf_user_id, "")
