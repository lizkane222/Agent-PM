"""
Tests for the ported Cloud Coach schema and its describe-gated SOQL builders.

The defaults come from `timesheeter/src/Schema.js`, which was filled in by probing the
real Twilio org. Pinning them here means a future edit that "tidies" a mixed-namespace
name back to a uniform prefix fails loudly instead of silently 400ing at runtime.
"""

from datetime import date
from unittest import mock

from django.test import SimpleTestCase

from salesforce_sync.cloudcoach import (
    CloudCoachError,
    available_fields,
    build_time_log_payload,
    composite_create,
    gate_fields,
    is_sf_id,
    my_projects_for_week,
    parse_week_start,
    resolve_resource_id,
    soql_string,
    week_bounds,
)
from salesforce_sync.cloudcoach_schema import (
    SCHEMA_DEFAULTS,
    SCHEMA_ENV_VAR,
    account_relationship,
    get_schema,
)

from .fakes import FULL_PROJECT_FIELDS, FakeSalesforce, full_org


class SchemaDefaultsTest(SimpleTestCase):
    """The names below are what the live org actually uses — do not "normalise" them."""

    def test_project_object_and_fields_match_timesheeter(self):
        p = SCHEMA_DEFAULTS["project"]
        self.assertEqual(p["object"], "project_cloud__Project__c")
        self.assertEqual(p["accountField"], "ccpe_ocp__Account__c")
        self.assertEqual(p["startField"], "project_cloud__Start__c")
        self.assertEqual(p["endField"], "project_cloud__End__c")

    def test_time_log_records_hours_not_minutes(self):
        tl = SCHEMA_DEFAULTS["timeLog"]
        self.assertEqual(tl["object"], "project_cloud__Expense__c")
        self.assertEqual(tl["hoursField"], "Total_Hours__c")
        self.assertNotIn("Minutes", tl["hoursField"])

    def test_ten_user_role_fields(self):
        roles = SCHEMA_DEFAULTS["project"]["userRoleFields"]
        self.assertEqual(len(roles), 10)
        self.assertIn("Project_Manager__c", roles)
        self.assertIn("Solution_Architect_Primary__c", roles)

    def test_account_relationship_swaps_the_suffix(self):
        self.assertEqual(account_relationship("ccpe_ocp__Account__c"), "ccpe_ocp__Account__r")
        self.assertEqual(account_relationship("AccountId"), "AccountId")


class SchemaOverrideTest(SimpleTestCase):
    def test_no_env_var_returns_defaults(self):
        with mock.patch.dict("os.environ", {SCHEMA_ENV_VAR: ""}):
            self.assertEqual(get_schema(), SCHEMA_DEFAULTS)

    def test_partial_override_leaves_siblings_alone(self):
        with mock.patch.dict("os.environ", {SCHEMA_ENV_VAR: '{"timeLog": {"hoursField": "Hours__c"}}'}):
            schema = get_schema()
        self.assertEqual(schema["timeLog"]["hoursField"], "Hours__c")
        # Sibling keys in the same sub-dict survive the merge.
        self.assertEqual(schema["timeLog"]["object"], "project_cloud__Expense__c")
        # And so does an untouched top-level section.
        self.assertEqual(schema["project"]["object"], "project_cloud__Project__c")

    def test_list_override_replaces_rather_than_appends(self):
        with mock.patch.dict(
            "os.environ",
            {SCHEMA_ENV_VAR: '{"project": {"userRoleFields": ["Only_One__c"]}}'},
        ):
            schema = get_schema()
        self.assertEqual(schema["project"]["userRoleFields"], ["Only_One__c"])

    def test_invalid_json_falls_back_to_defaults(self):
        with mock.patch.dict("os.environ", {SCHEMA_ENV_VAR: "{not json"}):
            self.assertEqual(get_schema(), SCHEMA_DEFAULTS)

    def test_non_object_json_falls_back_to_defaults(self):
        with mock.patch.dict("os.environ", {SCHEMA_ENV_VAR: '["a", "b"]'}):
            self.assertEqual(get_schema(), SCHEMA_DEFAULTS)

    def test_override_does_not_mutate_the_defaults(self):
        with mock.patch.dict("os.environ", {SCHEMA_ENV_VAR: '{"timeLog": {"object": "X__c"}}'}):
            get_schema()
        self.assertEqual(SCHEMA_DEFAULTS["timeLog"]["object"], "project_cloud__Expense__c")


class WeekMathTest(SimpleTestCase):
    def test_monday_start_and_exclusive_end(self):
        # 2026-08-31 is a Monday.
        start, end = week_bounds(date(2026, 8, 31))
        self.assertEqual(start, date(2026, 8, 31))
        self.assertEqual(end, date(2026, 9, 7))

    def test_sunday_belongs_to_the_week_that_started_six_days_earlier(self):
        # The JS original needed a special case here because Date.getDay() is Sunday=0.
        start, _ = week_bounds(date(2026, 9, 6))  # Sunday
        self.assertEqual(start, date(2026, 8, 31))

    def test_midweek_snaps_back_to_monday(self):
        start, _ = week_bounds(date(2026, 9, 3))  # Thursday
        self.assertEqual(start, date(2026, 8, 31))

    def test_parse_week_start_snaps_and_defaults(self):
        self.assertEqual(parse_week_start("2026-09-03"), date(2026, 8, 31))
        self.assertEqual(parse_week_start(""), week_bounds()[0])
        self.assertEqual(parse_week_start(None), week_bounds()[0])

    def test_parse_week_start_rejects_garbage(self):
        with self.assertRaises(ValueError):
            parse_week_start("last tuesday")


class SoqlSafetyTest(SimpleTestCase):
    def test_is_sf_id_accepts_15_and_18_char_ids(self):
        self.assertTrue(is_sf_id("005000000000001"))
        self.assertTrue(is_sf_id("005000000000001AAA"))

    def test_is_sf_id_rejects_pseudo_project_ids(self):
        # These are the ids the Log Time panel invents for local/admin rows.
        self.assertFalse(is_sf_id("local-7"))
        self.assertFalse(is_sf_id("admin-pseudo-2"))
        self.assertFalse(is_sf_id(""))

    def test_soql_string_escapes_quotes(self):
        self.assertEqual(soql_string("O'Brien"), "O\\'Brien")


class DescribeGatingTest(SimpleTestCase):
    def test_available_fields_reads_the_describe(self):
        sf = FakeSalesforce(describes={"Thing__c": ["Id", "Name"]})
        self.assertEqual(available_fields(sf, "Thing__c"), {"Id", "Name"})

    def test_undescribable_object_gates_nothing(self):
        # An empty set means "don't gate" — the subsequent query then fails with a real
        # Salesforce message rather than being silently narrowed to nothing.
        sf = FakeSalesforce(describes={})
        self.assertEqual(available_fields(sf, "Nope__c"), set())
        present, skipped = gate_fields(set(), ["A__c", "B__c"])
        self.assertEqual(present, ["A__c", "B__c"])
        self.assertEqual(skipped, [])

    def test_gate_fields_splits_present_from_absent(self):
        present, skipped = gate_fields({"A__c"}, ["A__c", "B__c"])
        self.assertEqual(present, ["A__c"])
        self.assertEqual(skipped, ["B__c"])


class MyProjectsForWeekTest(SimpleTestCase):
    WEEK = date(2026, 8, 31)

    def _sf(self, records, fields=None):
        return FakeSalesforce(
            describes={"project_cloud__Project__c": fields or FULL_PROJECT_FIELDS},
            query_results={"FROM project_cloud__Project__c": {"records": records}},
        )

    def test_builds_an_or_clause_over_every_role_field(self):
        sf = self._sf([])
        my_projects_for_week(sf, "005000000000001AAA", self.WEEK)
        soql = sf.queries[0]
        self.assertIn("Project_Manager__c = '005000000000001AAA'", soql)
        self.assertIn("Solution_Architect_Secondary__c = '005000000000001AAA'", soql)
        self.assertIn(" OR ", soql)

    def test_date_window_tolerates_null_project_dates(self):
        sf = self._sf([])
        my_projects_for_week(sf, "005000000000001AAA", self.WEEK)
        soql = sf.queries[0]
        self.assertIn("project_cloud__End__c = NULL OR project_cloud__End__c >= 2026-08-31", soql)
        # The start bound uses the inclusive last day of the week, not the exclusive end.
        self.assertIn("project_cloud__Start__c <= 2026-09-06", soql)

    def test_maps_records_and_sorts_by_account_then_project(self):
        sf = self._sf([
            {"Id": "a0B2", "Name": "Zeta Migration",
             "ccpe_ocp__Account__c": "0012", "ccpe_ocp__Account__r": {"Name": "Beta"}},
            {"Id": "a0B1", "Name": "Alpha Rollout",
             "ccpe_ocp__Account__c": "0011", "ccpe_ocp__Account__r": {"Name": "Acme"}},
        ])
        result = my_projects_for_week(sf, "005000000000001AAA", self.WEEK)
        self.assertEqual(
            [p["accountName"] for p in result["projects"]], ["Acme", "Beta"]
        )
        self.assertEqual(result["projects"][0]["projectId"], "a0B1")

    def test_missing_role_fields_are_reported_not_fatal(self):
        sf = self._sf([], fields=["Id", "Name", "Project_Manager__c"])
        result = my_projects_for_week(sf, "005000000000001AAA", self.WEEK)
        self.assertIn("Delivery_Manager__c", result["roles_skipped"])
        self.assertIn("Project_Manager__c", sf.queries[0])
        self.assertNotIn("Delivery_Manager__c", sf.queries[0])

    def test_no_role_fields_at_all_returns_empty_without_querying(self):
        sf = self._sf([], fields=["Id", "Name"])
        result = my_projects_for_week(sf, "005000000000001AAA", self.WEEK)
        self.assertEqual(result["projects"], [])
        self.assertEqual(sf.queries, [])

    def test_a_non_id_user_returns_empty(self):
        sf = self._sf([])
        self.assertEqual(my_projects_for_week(sf, "", self.WEEK)["projects"], [])

    def test_query_failure_raises_cloudcoach_error(self):
        sf = self._sf([])
        sf.query = mock.Mock(side_effect=RuntimeError("MALFORMED_QUERY"))
        with self.assertRaises(CloudCoachError):
            my_projects_for_week(sf, "005000000000001AAA", self.WEEK)


class ResolveResourceIdTest(SimpleTestCase):
    def test_returns_the_user_id_when_the_field_references_user(self):
        sf = FakeSalesforce(describes={
            "project_cloud__Expense__c": [{"name": "Resource__c", "referenceTo": ["User"]}],
        })
        self.assertEqual(resolve_resource_id(sf, "005000000000001AAA"), "005000000000001AAA")

    def test_resolves_a_resource_record_when_the_field_references_resource(self):
        sf = full_org(query_results={"FROM Resource__c": {"records": [{"Id": "a0R000000000001"}]}})
        self.assertEqual(resolve_resource_id(sf, "005000000000001AAA"), "a0R000000000001")

    def test_returns_blank_when_no_resource_record_exists(self):
        # Blank is a supported outcome: `build_time_log_payload` then omits the field,
        # exactly as ccLogWeek did when tl.userField was falsy.
        sf = full_org(query_results={"FROM Resource__c": {"records": []}})
        self.assertEqual(resolve_resource_id(sf, "005000000000001AAA"), "")

    def test_returns_blank_when_the_field_does_not_exist(self):
        sf = FakeSalesforce(describes={"project_cloud__Expense__c": ["Id", "Total_Hours__c"]})
        self.assertEqual(resolve_resource_id(sf, "005000000000001AAA"), "")

    def test_returns_blank_when_the_object_cannot_be_described(self):
        sf = FakeSalesforce(describes={})
        self.assertEqual(resolve_resource_id(sf, "005000000000001AAA"), "")


class TimeLogPayloadTest(SimpleTestCase):
    def test_payload_uses_the_orgs_field_names_and_decimal_hours(self):
        payload = build_time_log_payload(
            project_sf_id="a0B000000000001",
            entry_date=date(2026, 8, 31),
            hours=1.75,
            description="Kickoff",
            resource_id="a0R000000000001",
        )
        self.assertEqual(payload, {
            "Project__c": "a0B000000000001",
            "project_cloud__Date__c": "2026-08-31",
            "Total_Hours__c": 1.75,
            "project_cloud__Description__c": "Kickoff",
            "Resource__c": "a0R000000000001",
        })

    def test_resource_field_is_omitted_when_unresolved(self):
        payload = build_time_log_payload(
            project_sf_id="a0B000000000001",
            entry_date=date(2026, 8, 31),
            hours=1.0,
            description="",
            resource_id="",
        )
        self.assertNotIn("Resource__c", payload)


class CompositeCreateTest(SimpleTestCase):
    BODY = {"Project__c": "a0B000000000001", "Total_Hours__c": 1.0}

    def test_writes_every_record_in_a_single_call(self):
        sf = full_org()
        ids = composite_create(sf, [self.BODY, self.BODY, self.BODY])
        self.assertEqual(sf.composite_call_count, 1)
        self.assertEqual(len(ids), 3)

    def test_posts_all_or_none_so_a_retry_cannot_double_log(self):
        sf = full_org()
        composite_create(sf, [self.BODY])
        _, _, payload = sf.restful_calls[-1]
        self.assertTrue(payload["allOrNone"])
        self.assertEqual(payload["compositeRequest"][0]["referenceId"], "log_1")
        self.assertIn("project_cloud__Expense__c", payload["compositeRequest"][0]["url"])

    def test_empty_input_sends_no_request(self):
        sf = full_org()
        self.assertEqual(composite_create(sf, []), [])
        self.assertEqual(sf.composite_call_count, 0)

    def test_a_rejected_sub_request_raises_rather_than_reporting_success(self):
        sf = full_org(composite_response={"compositeResponse": [
            {"referenceId": "log_1", "httpStatusCode": 201, "body": {"id": "a0X1"}},
            {"referenceId": "log_2", "httpStatusCode": 400,
             "body": [{"message": "REQUIRED_FIELD_MISSING"}]},
        ]})
        with self.assertRaises(CloudCoachError) as ctx:
            composite_create(sf, [self.BODY, self.BODY])
        self.assertIn("rejected 1 of 2", str(ctx.exception))

    def test_error_message_carries_no_salesforce_detail(self):
        sf = full_org(composite_response={"compositeResponse": [
            {"referenceId": "log_1", "httpStatusCode": 400,
             "body": [{"message": "INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY"}]},
        ]})
        with self.assertRaises(CloudCoachError) as ctx:
            composite_create(sf, [self.BODY])
        self.assertNotIn("INSUFFICIENT_ACCESS", str(ctx.exception))

    def test_transport_failure_raises_cloudcoach_error(self):
        sf = full_org()
        sf.restful = mock.Mock(side_effect=RuntimeError("connection reset"))
        with self.assertRaises(CloudCoachError):
            composite_create(sf, [self.BODY])
