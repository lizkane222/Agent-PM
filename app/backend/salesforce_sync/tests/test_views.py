"""
Tests for `POST /api/v1/salesforce/log-week/` and the widened project queryset.

`cache.clear()` in setUp for the same reason `realtime.tests.test_views` does it: the
process-wide throttle bucket is shared across the suite, so a full-suite run can
exhaust it and fail these tests in a way a single-module run never reproduces.
"""

from datetime import date, datetime, timedelta, timezone
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APITestCase

from accounts.models import Account, AccountProject
from scheduler.models import CalendarEvent

from salesforce_sync.models import (
    SalesforceAccount,
    SalesforceConfig,
    SalesforceProject,
    SalesforceTeamMember,
    SalesforceTimeEntry,
)

from .fakes import full_org

User = get_user_model()

LOG_WEEK_URL = "/api/v1/salesforce/log-week/"
PROJECTS_URL = "/api/v1/salesforce/projects/"
MONDAY = date(2026, 8, 31)
SF_USER_ID = "005000000000001AAA"


class LogWeekUnauthenticatedTest(APITestCase):
    def setUp(self):
        cache.clear()

    def test_requires_auth(self):
        resp = self.client.post(LOG_WEEK_URL, {"week_start": "2026-08-31"}, format="json")
        self.assertEqual(resp.status_code, 401)


class LogWeekViewTest(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            username="liz", email="liz@example.com", password="pass"
        )
        SalesforceConfig.objects.create(
            user=self.user,
            instance_url="https://example.my.salesforce.com",
            sf_user_id=SF_USER_ID,
        )
        self.account = Account.objects.create(company_name="Acme")
        AccountProject.objects.create(
            account=self.account, name="Acme Phase 1", sf_project_id="a0B000000000001"
        )
        self.client.force_authenticate(self.user)
        self.sf = full_org(
            query_results={"FROM Resource__c": {"records": [{"Id": "a0R000000000001"}]}}
        )

    # `_UNSET`, not None — `account=None` has to mean "no account linked", which is
    # exactly the case the warning modal is about.
    _UNSET = object()

    def _event(self, *, day=MONDAY, hour=9, minutes=60, owner=None, account=_UNSET, **kwargs):
        start = datetime(day.year, day.month, day.day, hour, tzinfo=timezone.utc)
        return CalendarEvent.objects.create(
            owner=owner or self.user,
            account=self.account if account is self._UNSET else account,
            title=kwargs.pop("title", "Kickoff"),
            start_datetime=start,
            end_datetime=start + timedelta(minutes=minutes),
            **kwargs,
        )

    def _post(self, body):
        with mock.patch("salesforce_sync.client.get_client", return_value=self.sf):
            return self.client.post(LOG_WEEK_URL, body, format="json")

    # ── dry run ──────────────────────────────────────────────────────────────

    def test_dry_run_reports_the_plan_and_writes_nothing(self):
        self._event()

        resp = self._post({"week_start": "2026-08-31", "dry_run": True})

        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data["dry_run"])
        self.assertEqual(resp.data["entry_count"], 1)
        self.assertEqual(resp.data["logged"], 0)
        self.assertEqual(self.sf.composite_call_count, 0)
        self.assertEqual(SalesforceTimeEntry.objects.count(), 0)

    def test_dry_run_reports_the_two_warning_categories(self):
        self._event(account=None, hour=9, title="Unlinked call")
        self._event(hour=11, attended=False, title="Skipped standup")

        resp = self._post({"week_start": "2026-08-31", "dry_run": True})

        self.assertEqual(resp.data["unlinked_count"], 1)
        self.assertEqual(resp.data["not_attended_count"], 1)
        self.assertEqual(resp.data["unlinked_events"][0]["title"], "Unlinked call")
        self.assertEqual(resp.data["not_attended_events"][0]["title"], "Skipped standup")

    # ── real write ───────────────────────────────────────────────────────────

    def test_write_uses_one_composite_call_and_returns_what_landed(self):
        self._event(hour=9)
        self._event(hour=11, day=MONDAY + timedelta(days=1))

        resp = self._post({"week_start": "2026-08-31"})

        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data["dry_run"])
        self.assertEqual(resp.data["logged"], 2)
        self.assertEqual(self.sf.composite_call_count, 1)
        self.assertEqual(SalesforceTimeEntry.objects.filter(synced_to_sf=True).count(), 2)

    def test_a_blank_week_start_defaults_to_the_current_week(self):
        resp = self._post({"dry_run": True})

        self.assertEqual(resp.status_code, 200)
        from salesforce_sync.cloudcoach import week_bounds
        self.assertEqual(resp.data["week_start"], week_bounds()[0].isoformat())

    def test_client_entries_are_written_verbatim(self):
        resp = self._post({
            "week_start": "2026-08-31",
            "entries": [{
                "date": "2026-08-31",
                "project_sf_id": "a0BCLIENT0000001",
                "project_name": "Client Choice",
                "minutes": 195,
                "description": "hand-edited",
            }],
        })

        self.assertEqual(resp.data["logged"], 1)
        body = self.sf.composite_bodies[0]
        self.assertEqual(body["Total_Hours__c"], 3.25)
        self.assertEqual(body["project_cloud__Description__c"], "hand-edited")

    def test_account_name_scopes_the_write(self):
        beta = Account.objects.create(company_name="Beta")
        AccountProject.objects.create(account=beta, name="BP", sf_project_id="a0B000000000002")
        self._event(hour=9, title="Acme call")
        self._event(hour=11, account=beta, title="Beta call")

        resp = self._post({"week_start": "2026-08-31", "account_name": "Acme", "dry_run": True})

        self.assertEqual(resp.data["entry_count"], 1)
        self.assertEqual(resp.data["entries"][0]["project_sf_id"], "a0B000000000001")

    # ── scoping and errors ───────────────────────────────────────────────────

    def test_another_users_events_are_never_planned(self):
        other = User.objects.create_user(username="bob", email="bob@example.com", password="p")
        self._event(owner=other)

        resp = self._post({"week_start": "2026-08-31", "dry_run": True})

        self.assertEqual(resp.data["entry_count"], 0)

    def test_a_malformed_week_start_is_a_400(self):
        resp = self._post({"week_start": "last tuesday"})

        self.assertEqual(resp.status_code, 400)
        self.assertIn("ISO date", resp.data["detail"])

    def test_a_malformed_entry_is_a_400(self):
        resp = self._post({
            "entries": [{"date": "2026-08-31", "minutes": -5, "project_sf_id": "a0B1"}],
        })

        self.assertEqual(resp.status_code, 400)

    def test_a_disconnected_salesforce_is_a_400_not_a_502(self):
        self._event()

        with mock.patch(
            "salesforce_sync.client.get_client",
            side_effect=PermissionError("Salesforce not connected for this user."),
        ):
            resp = self.client.post(LOG_WEEK_URL, {"week_start": "2026-08-31"}, format="json")

        self.assertEqual(resp.status_code, 400)
        self.assertIn("not connected", resp.data["detail"])

    def test_a_rejected_write_is_a_502_carrying_no_salesforce_detail(self):
        self._event()
        sf = full_org(composite_response={"compositeResponse": [
            {"referenceId": "log_1", "httpStatusCode": 400,
             "body": [{"message": "INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY"}]},
        ]})

        with mock.patch("salesforce_sync.client.get_client", return_value=sf):
            resp = self.client.post(LOG_WEEK_URL, {"week_start": "2026-08-31"}, format="json")

        self.assertEqual(resp.status_code, 502)
        self.assertNotIn("INSUFFICIENT_ACCESS", resp.data["detail"])

    def test_an_unexpected_failure_is_a_502_with_a_fixed_message(self):
        self._event()

        with mock.patch(
            "salesforce_sync.client.get_client", side_effect=RuntimeError("token boom")
        ):
            resp = self.client.post(LOG_WEEK_URL, {"week_start": "2026-08-31"}, format="json")

        self.assertEqual(resp.status_code, 502)
        self.assertNotIn("token boom", resp.data["detail"])


class ProjectLookupViewTest(APITestCase):
    URL = "/api/v1/salesforce/projects/lookup/"

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            username="liz", email="liz@example.com", password="pw-not-a-secret"
        )
        SalesforceConfig.objects.create(
            user=self.user,
            instance_url="https://example.my.salesforce.com",
            sf_user_id=SF_USER_ID,
        )
        self.client.force_authenticate(self.user)

    def _sf(self, records):
        from .fakes import FULL_PROJECT_FIELDS, FakeSalesforce
        return FakeSalesforce(
            describes={"project_cloud__Project__c": FULL_PROJECT_FIELDS},
            query_results={"FROM project_cloud__Project__c": {"records": records}},
        )

    def _get(self, sf, **params):
        with mock.patch("salesforce_sync.client.get_client", return_value=sf):
            return self.client.get(self.URL, params)

    def test_resolves_before_the_router_detail_route(self):
        # DRF's default pk regex is `[^/.]+`, so without the urls.py ordering this path
        # would resolve as the projects detail route with pk="lookup".
        resp = self._get(self._sf([]), name="acme")

        self.assertEqual(resp.status_code, 200)
        self.assertIn("projects", resp.data)

    def test_returns_matches_with_the_callers_roles(self):
        sf = self._sf([{
            "Id": "a0B000000000001", "Name": "Acme Rollout",
            "ccpe_ocp__Account__c": "0011",
            "ccpe_ocp__Account__r": {"Name": "Acme"},
            "Project_Manager__c": SF_USER_ID,
        }])

        resp = self._get(sf, name="acme")

        self.assertEqual(resp.data["count"], 1)
        project = resp.data["projects"][0]
        self.assertEqual(project["accountName"], "Acme")
        self.assertTrue(project["isMember"])
        self.assertEqual(project["myRoles"], ["Project_Manager__c"])

    def test_finds_projects_the_caller_is_not_on(self):
        # "Does a project called X exist" and "am I on X" both need unfiltered results —
        # a self-scoped search cannot answer the second in the negative.
        sf = self._sf([{
            "Id": "a0B2", "Name": "Someone Elses", "Project_Manager__c": "005000000000999AAA",
        }])

        resp = self._get(sf, name="someone")

        self.assertEqual(resp.data["count"], 1)
        self.assertFalse(resp.data["projects"][0]["isMember"])

    def test_a_blank_name_is_a_400(self):
        resp = self._get(self._sf([]), name="  ")

        self.assertEqual(resp.status_code, 400)

    def test_a_missing_name_is_a_400(self):
        with mock.patch("salesforce_sync.client.get_client", return_value=self._sf([])):
            resp = self.client.get(self.URL)

        self.assertEqual(resp.status_code, 400)

    def test_wildcards_in_the_search_term_are_escaped(self):
        # An unescaped `%` would turn "find the project called %" into "match everything".
        sf = self._sf([])

        self._get(sf, name="100% margin_x")

        self.assertIn("100\\% margin\\_x", sf.queries[0])

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        resp = self.client.get(self.URL, {"name": "acme"})
        self.assertEqual(resp.status_code, 401)

    def test_a_disconnected_salesforce_is_a_400(self):
        with mock.patch(
            "salesforce_sync.client.get_client", side_effect=PermissionError("nope")
        ):
            resp = self.client.get(self.URL, {"name": "acme"})

        self.assertEqual(resp.status_code, 400)

    def test_a_search_failure_is_a_502_with_no_salesforce_detail(self):
        sf = self._sf([])
        sf.query = mock.Mock(side_effect=RuntimeError("MALFORMED_QUERY: unexpected token"))

        resp = self._get(sf, name="acme")

        self.assertEqual(resp.status_code, 502)
        self.assertNotIn("MALFORMED_QUERY", resp.data["detail"])


class ProjectQuerysetTest(APITestCase):
    """The viewset must return projects the user holds a *role* on, not just owns."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            username="liz", email="liz@example.com", password="pass"
        )
        SalesforceConfig.objects.create(
            user=self.user,
            instance_url="https://example.my.salesforce.com",
            sf_user_id=SF_USER_ID,
        )
        self.sf_account = SalesforceAccount.objects.create(sf_id="0011", name="Acme")
        self.client.force_authenticate(self.user)

    def _project(self, sf_id, name, owner_sf_id=""):
        return SalesforceProject.objects.create(
            sf_id=sf_id, name=name, account=self.sf_account, owner_sf_id=owner_sf_id
        )

    def test_a_role_link_makes_a_project_visible(self):
        project = self._project("a0B1", "Role Project")
        SalesforceTeamMember.objects.create(
            sf_id=f"role:{project.sf_id}:Project_Manager__c",
            project=project, sf_user_id=SF_USER_ID, name="", role="Project_Manager__c",
        )

        resp = self.client.get(PROJECTS_URL)

        self.assertEqual(resp.status_code, 200)
        self.assertEqual([p["name"] for p in resp.data["results"]], ["Role Project"])

    def test_ownership_still_makes_a_project_visible(self):
        self._project("a0B2", "Owned Project", owner_sf_id=SF_USER_ID)

        resp = self.client.get(PROJECTS_URL)

        self.assertEqual([p["name"] for p in resp.data["results"]], ["Owned Project"])

    def test_a_project_the_user_has_no_link_to_stays_hidden(self):
        project = self._project("a0B3", "Someone Elses")
        SalesforceTeamMember.objects.create(
            sf_id=f"role:{project.sf_id}:Project_Manager__c",
            project=project, sf_user_id="005000000000999AAA", name="", role="Project_Manager__c",
        )

        resp = self.client.get(PROJECTS_URL)

        self.assertEqual(resp.data["results"], [])

    def test_two_role_links_do_not_duplicate_the_project(self):
        project = self._project("a0B4", "Two Hats")
        for field in ("Project_Manager__c", "Solution_Architect_Primary__c"):
            SalesforceTeamMember.objects.create(
                sf_id=f"role:{project.sf_id}:{field}",
                project=project, sf_user_id=SF_USER_ID, name="", role=field,
            )

        resp = self.client.get(PROJECTS_URL)

        self.assertEqual(len(resp.data["results"]), 1)

    def test_the_synthesized_role_key_fits_the_column(self):
        # `role:` + an 18-char id + `:` + `Solution_Architect_Secondary__c` is 55 chars,
        # which is why migration 0003 widened sf_id from 32.
        project = self._project("a0B500000000000001", "Long Key")
        key = f"role:{project.sf_id}:Solution_Architect_Secondary__c"
        self.assertGreater(len(key), 32)
        SalesforceTeamMember.objects.create(
            sf_id=key, project=project, sf_user_id=SF_USER_ID, name="",
            role="Solution_Architect_Secondary__c",
        )
        self.assertEqual(SalesforceTeamMember.objects.get(sf_id=key).project, project)
