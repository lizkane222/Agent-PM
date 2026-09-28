"""
Tests for `salesforce_sync.log_week` — the resolution rules and the composite write.

The resolution order is the part of this feature most likely to be quietly broken by a
later edit, so every branch has a test that fails if the precedence changes:
did-not-attend, manual assignment, explicit `sf_project_id`, the role-checked name
fallback, and both skip reasons.
"""

from datetime import date, datetime, timedelta, timezone
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase

from accounts.models import Account, AccountProject
from scheduler.models import CalendarEvent

from salesforce_sync.log_week import (
    plan_week,
    round_up_to_quarter_hour,
    week_range_label,
    write_week,
)
from salesforce_sync.models import (
    LogTimeDayAssignment,
    SalesforceAccount,
    SalesforceConfig,
    SalesforceProject,
    SalesforceTeamMember,
    SalesforceTimeEntry,
)

from .fakes import full_org

User = get_user_model()

MONDAY = date(2026, 8, 31)
SF_USER_ID = "005000000000001AAA"


def _dt(day: date, hour: int, minute: int = 0):
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=timezone.utc)


class LogWeekTestBase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="liz", email="liz@example.com", password="pass"
        )
        SalesforceConfig.objects.create(
            user=self.user,
            instance_url="https://example.my.salesforce.com",
            sf_user_id=SF_USER_ID,
        )
        self.account = Account.objects.create(company_name="Acme")

    # ── fixtures ─────────────────────────────────────────────────────────────

    def event(self, *, day=MONDAY, hour=9, minutes=60, account=None, title="Kickoff", **kwargs):
        start = _dt(day, hour)
        return CalendarEvent.objects.create(
            owner=kwargs.pop("owner", self.user),
            account=account,
            title=title,
            start_datetime=start,
            end_datetime=start + timedelta(minutes=minutes),
            **kwargs,
        )

    def sf_project(self, name="Acme Rollout", sf_id="a0B000000000001", account_name="Acme", on_team=True):
        sf_account = SalesforceAccount.objects.create(
            sf_id=f"001{sf_id[-6:]}", name=account_name
        )
        project = SalesforceProject.objects.create(
            sf_id=sf_id, name=name, account=sf_account, start_date=MONDAY
        )
        if on_team:
            SalesforceTeamMember.objects.create(
                sf_id=f"role:{sf_id}:Project_Manager__c",
                project=project,
                sf_user_id=SF_USER_ID,
                name="",
                role="Project_Manager__c",
            )
        return project


class QuarterHourRoundingTest(TestCase):
    def test_rounds_up_never_down(self):
        self.assertEqual(round_up_to_quarter_hour(50), 60)
        self.assertEqual(round_up_to_quarter_hour(31), 45)
        self.assertEqual(round_up_to_quarter_hour(1), 15)

    def test_exact_multiples_are_unchanged(self):
        self.assertEqual(round_up_to_quarter_hour(30), 30)
        self.assertEqual(round_up_to_quarter_hour(60), 60)

    def test_zero_and_negative_are_zero(self):
        self.assertEqual(round_up_to_quarter_hour(0), 0)
        self.assertEqual(round_up_to_quarter_hour(-5), 0)


class ResolutionOrderTest(LogWeekTestBase):
    def test_explicit_sf_project_id_on_the_account_wins(self):
        AccountProject.objects.create(
            account=self.account, name="Acme Phase 1", sf_project_id="a0BEXPLICIT00001"
        )
        self.event(account=self.account)

        plan = plan_week(self.user, MONDAY)

        self.assertEqual(len(plan.entries), 1)
        self.assertEqual(plan.entries[0].project_sf_id, "a0BEXPLICIT00001")
        self.assertEqual(plan.entries[0].project_name, "Acme Phase 1")
        self.assertEqual(plan.entries[0].source, "auto")

    def test_falls_back_to_a_cloud_coach_project_matched_by_account_name(self):
        self.sf_project()
        self.event(account=self.account)

        plan = plan_week(self.user, MONDAY)

        self.assertEqual(len(plan.entries), 1)
        self.assertEqual(plan.entries[0].project_sf_id, "a0B000000000001")

    def test_name_fallback_requires_the_user_to_hold_a_role(self):
        # Without the role check, a name match would file time onto a colleague's
        # project just because the account names happen to agree.
        self.sf_project(on_team=False)
        self.event(account=self.account)

        plan = plan_week(self.user, MONDAY)

        self.assertEqual(plan.entries, [])
        self.assertEqual(len(plan.account_without_project), 1)
        self.assertEqual(plan.account_without_project[0].reason, "no_cloud_coach_project")

    def test_a_manual_day_assignment_beats_the_accounts_own_project(self):
        AccountProject.objects.create(
            account=self.account, name="Auto Choice", sf_project_id="a0BAUTO000000001"
        )
        manual = self.sf_project(name="Manual Choice", sf_id="a0BMANUAL0000001")
        LogTimeDayAssignment.objects.create(user=self.user, date=MONDAY, project=manual)
        self.event(account=self.account)

        plan = plan_week(self.user, MONDAY)

        self.assertEqual(len(plan.entries), 1)
        self.assertEqual(plan.entries[0].project_sf_id, "a0BMANUAL0000001")
        self.assertEqual(plan.entries[0].source, "manual")

    def test_a_manual_assignment_covers_an_event_with_no_account(self):
        manual = self.sf_project(name="Manual Choice", sf_id="a0BMANUAL0000001")
        LogTimeDayAssignment.objects.create(user=self.user, date=MONDAY, project=manual)
        self.event(account=None)

        plan = plan_week(self.user, MONDAY)

        self.assertEqual(len(plan.entries), 1)
        self.assertEqual(plan.unlinked_events, [])

    def test_several_manual_projects_on_one_day_defer_to_the_client(self):
        # The per-event split lives in the panel's localStorage, so guessing here would
        # put hours on the wrong project.
        a = self.sf_project(name="A", sf_id="a0BAAAAAAAAAAA1")
        b = self.sf_project(name="B", sf_id="a0BBBBBBBBBBBB1", account_name="Beta")
        LogTimeDayAssignment.objects.create(user=self.user, date=MONDAY, project=a, position=0)
        LogTimeDayAssignment.objects.create(user=self.user, date=MONDAY, project=b, position=1)
        self.event(account=self.account)

        plan = plan_week(self.user, MONDAY)

        self.assertEqual(plan.entries, [])

    def test_an_event_with_no_account_is_reported_as_unlinked(self):
        self.event(account=None, title="Mystery sync")

        plan = plan_week(self.user, MONDAY)

        self.assertEqual(plan.entries, [])
        self.assertEqual(len(plan.unlinked_events), 1)
        self.assertEqual(plan.unlinked_events[0].reason, "no_account_linked")
        self.assertEqual(plan.unlinked_events[0].title, "Mystery sync")


class AttendanceTest(LogWeekTestBase):
    def test_did_not_attend_is_skipped_and_reported(self):
        AccountProject.objects.create(
            account=self.account, name="P", sf_project_id="a0B000000000001"
        )
        self.event(account=self.account, attended=False, title="Skipped standup")

        plan = plan_week(self.user, MONDAY)

        self.assertEqual(plan.entries, [])
        self.assertEqual(len(plan.not_attended_events), 1)
        self.assertEqual(plan.not_attended_events[0].reason, "did_not_attend")

    def test_unrecorded_attendance_is_still_logged(self):
        # `attended=None` means "never recorded", which the calendar renders as
        # attended — so it must log, or every untouched meeting would vanish.
        AccountProject.objects.create(
            account=self.account, name="P", sf_project_id="a0B000000000001"
        )
        event = self.event(account=self.account)
        self.assertIsNone(event.attended)

        plan = plan_week(self.user, MONDAY)

        self.assertEqual(len(plan.entries), 1)
        self.assertEqual(plan.not_attended_events, [])

    def test_explicitly_attended_is_logged(self):
        AccountProject.objects.create(
            account=self.account, name="P", sf_project_id="a0B000000000001"
        )
        self.event(account=self.account, attended=True)

        self.assertEqual(len(plan_week(self.user, MONDAY).entries), 1)


class EventFilteringTest(LogWeekTestBase):
    def setUp(self):
        super().setUp()
        AccountProject.objects.create(
            account=self.account, name="P", sf_project_id="a0B000000000001"
        )

    def test_all_day_cancelled_and_work_tracking_events_are_ignored(self):
        self.event(account=self.account, all_day=True, hour=8)
        self.event(account=self.account, status="cancelled", hour=10)
        self.event(account=self.account, calendar_id="work_tracking", hour=11)

        plan = plan_week(self.user, MONDAY)

        self.assertEqual(plan.entries, [])
        # None of them are reported as skipped either — they are not timesheet activity.
        self.assertEqual(plan.unlinked_events, [])
        self.assertEqual(plan.not_attended_events, [])

    def test_another_users_events_never_appear(self):
        other = User.objects.create_user(username="bob", email="bob@example.com", password="p")
        self.event(account=self.account, owner=other)

        self.assertEqual(plan_week(self.user, MONDAY).entries, [])

    def test_events_outside_the_week_are_ignored(self):
        self.event(account=self.account, day=MONDAY - timedelta(days=1))
        self.event(account=self.account, day=MONDAY + timedelta(days=7))

        self.assertEqual(plan_week(self.user, MONDAY).entries, [])

    def test_a_mid_week_date_resolves_to_the_whole_week(self):
        self.event(account=self.account, day=MONDAY + timedelta(days=3))

        plan = plan_week(self.user, MONDAY + timedelta(days=2))

        self.assertEqual(plan.week_start, MONDAY)
        self.assertEqual(len(plan.entries), 1)

    def test_zero_length_events_are_dropped(self):
        self.event(account=self.account, minutes=0)

        self.assertEqual(plan_week(self.user, MONDAY).entries, [])

    def test_account_name_scope_excludes_other_accounts(self):
        beta = Account.objects.create(company_name="Beta")
        AccountProject.objects.create(account=beta, name="BP", sf_project_id="a0B000000000002")
        self.event(account=self.account, title="Acme call", hour=9)
        self.event(account=beta, title="Beta call", hour=11)

        plan = plan_week(self.user, MONDAY, account_name="acme")

        self.assertEqual(len(plan.entries), 1)
        self.assertEqual(plan.entries[0].titles, ["Acme call"])

    def test_a_scoped_run_still_reports_events_with_no_account(self):
        # The per-account panel must still warn about unlinked items: an event with no
        # account cannot belong to another account either, so filtering it out would
        # hide exactly what the modal exists to show.
        self.event(account=self.account, hour=9, title="Acme call")
        self.event(account=None, hour=11, title="Mystery sync")

        plan = plan_week(self.user, MONDAY, account_name="Acme")

        self.assertEqual(len(plan.unlinked_events), 1)
        self.assertEqual(plan.unlinked_events[0].title, "Mystery sync")

    def test_a_scoped_run_drops_another_accounts_events_silently(self):
        beta = Account.objects.create(company_name="Beta")
        self.event(account=beta, title="Beta call")

        plan = plan_week(self.user, MONDAY, account_name="Acme")

        self.assertEqual(plan.entries, [])
        self.assertEqual(plan.unlinked_events, [])
        self.assertEqual(plan.account_without_project, [])


class AggregationTest(LogWeekTestBase):
    def setUp(self):
        super().setUp()
        AccountProject.objects.create(
            account=self.account, name="P", sf_project_id="a0B000000000001"
        )

    def test_several_events_on_one_day_become_one_entry(self):
        self.event(account=self.account, hour=9, minutes=30, title="Standup")
        self.event(account=self.account, hour=11, minutes=50, title="Design review")

        plan = plan_week(self.user, MONDAY)

        self.assertEqual(len(plan.entries), 1)
        entry = plan.entries[0]
        # 80 raw minutes rounds up to 90 (1.5h), not 80.
        self.assertEqual(entry.minutes, 90)
        self.assertEqual(entry.hours, 1.5)
        self.assertEqual(entry.titles, ["Standup", "Design review"])

    def test_the_description_lists_titles_and_a_total(self):
        self.event(account=self.account, hour=9, minutes=45, title="Standup")

        description = plan_week(self.user, MONDAY).entries[0].description

        self.assertEqual(description, "Standup\nTotal: 0.75 hrs")

    def test_different_days_produce_separate_entries(self):
        self.event(account=self.account, day=MONDAY)
        self.event(account=self.account, day=MONDAY + timedelta(days=1))

        plan = plan_week(self.user, MONDAY)

        self.assertEqual(len(plan.entries), 2)
        self.assertEqual(plan.total_minutes, 120)


class AlreadyLoggedTest(LogWeekTestBase):
    def test_a_synced_entry_for_the_same_project_and_day_is_not_written_twice(self):
        project = self.sf_project()
        AccountProject.objects.create(
            account=self.account, name="P", sf_project_id=project.sf_id
        )
        self.event(account=self.account)
        SalesforceTimeEntry.objects.create(
            user=self.user, project=project, date=MONDAY,
            duration_minutes=60, synced_to_sf=True, sf_id="a0X1",
        )

        plan = plan_week(self.user, MONDAY)

        self.assertEqual(plan.entries, [])
        self.assertEqual(len(plan.already_logged), 1)

    def test_a_failed_previous_attempt_does_not_block_a_retry(self):
        project = self.sf_project()
        AccountProject.objects.create(
            account=self.account, name="P", sf_project_id=project.sf_id
        )
        self.event(account=self.account)
        SalesforceTimeEntry.objects.create(
            user=self.user, project=project, date=MONDAY,
            duration_minutes=60, synced_to_sf=False, sync_error="boom",
        )

        self.assertEqual(len(plan_week(self.user, MONDAY).entries), 1)


class ClientEntriesTest(LogWeekTestBase):
    def test_client_entries_are_used_verbatim(self):
        # The panel holds hour overrides and row removals in localStorage; recomputing
        # the week server-side would silently discard them.
        self.event(account=self.account, minutes=60)

        plan = plan_week(self.user, MONDAY, entries=[{
            "date": "2026-08-31",
            "project_sf_id": "a0BCLIENT0000001",
            "project_name": "Client Choice",
            "minutes": 195,
            "description": "hand-edited",
            "titles": ["Edited"],
        }])

        self.assertEqual(len(plan.entries), 1)
        self.assertEqual(plan.entries[0].minutes, 195)
        self.assertEqual(plan.entries[0].description, "hand-edited")
        self.assertEqual(plan.entries[0].source, "client")

    def test_client_entries_still_get_the_skip_report(self):
        self.event(account=None, title="Unlinked")

        plan = plan_week(self.user, MONDAY, entries=[{
            "date": "2026-08-31", "project_sf_id": "a0BCLIENT0000001",
            "project_name": "P", "minutes": 60,
        }])

        self.assertEqual(len(plan.entries), 1)
        self.assertEqual(len(plan.unlinked_events), 1)

    def test_pseudo_project_ids_are_dropped(self):
        plan = plan_week(self.user, MONDAY, entries=[
            {"date": "2026-08-31", "project_sf_id": "local-7", "minutes": 60},
            {"date": "2026-08-31", "project_sf_id": "admin-pseudo-2", "minutes": 60},
            {"date": "2026-08-31", "project_sf_id": "a0BREAL000000001", "minutes": 60},
        ])

        self.assertEqual([e.project_sf_id for e in plan.entries], ["a0BREAL000000001"])

    def test_zero_minute_and_malformed_entries_are_dropped(self):
        plan = plan_week(self.user, MONDAY, entries=[
            {"date": "2026-08-31", "project_sf_id": "a0BREAL000000001", "minutes": 0},
            {"date": "not-a-date", "project_sf_id": "a0BREAL000000002", "minutes": 60},
        ])

        self.assertEqual(plan.entries, [])

    def test_a_date_object_is_accepted(self):
        # DRF's serializer hands the view `date` objects, not strings.
        plan = plan_week(self.user, MONDAY, entries=[
            {"date": MONDAY, "project_sf_id": "a0BREAL000000001", "minutes": 60},
        ])

        self.assertEqual(plan.entries[0].entry_date, MONDAY)

    def test_a_description_is_built_when_the_client_omits_one(self):
        plan = plan_week(self.user, MONDAY, entries=[
            {"date": MONDAY, "project_sf_id": "a0BREAL000000001",
             "minutes": 90, "titles": ["A", "B"]},
        ])

        self.assertEqual(plan.entries[0].description, "A\nB\nTotal: 1.50 hrs")


class WriteWeekTest(LogWeekTestBase):
    def setUp(self):
        super().setUp()
        self.project = self.sf_project()
        AccountProject.objects.create(
            account=self.account, name="P", sf_project_id=self.project.sf_id
        )

    def _write(self, sf=None, **plan_kwargs):
        sf = sf or full_org(
            query_results={"FROM Resource__c": {"records": [{"Id": "a0R000000000001"}]}}
        )
        plan = plan_week(self.user, MONDAY, **plan_kwargs)
        with mock.patch("salesforce_sync.client.get_client", return_value=sf):
            result = write_week(self.user, plan)
        return sf, result

    def test_writes_hours_not_minutes_in_one_composite_call(self):
        self.event(account=self.account, minutes=90)

        sf, result = self._write()

        self.assertEqual(sf.composite_call_count, 1)
        self.assertEqual(result["logged"], 1)
        body = sf.composite_bodies[0]
        self.assertEqual(body["Total_Hours__c"], 1.5)
        self.assertEqual(body["Project__c"], self.project.sf_id)
        self.assertEqual(body["project_cloud__Date__c"], "2026-08-31")
        self.assertEqual(body["Resource__c"], "a0R000000000001")

    def test_a_full_week_is_still_one_request(self):
        for offset in range(5):
            self.event(account=self.account, day=MONDAY + timedelta(days=offset))

        sf, result = self._write()

        self.assertEqual(sf.composite_call_count, 1)
        self.assertEqual(result["logged"], 5)

    def test_audit_rows_are_created_and_marked_synced(self):
        self.event(account=self.account)

        self._write()

        entry = SalesforceTimeEntry.objects.get(user=self.user)
        self.assertTrue(entry.synced_to_sf)
        self.assertTrue(entry.sf_id)
        self.assertEqual(entry.duration_minutes, 60)
        self.assertEqual(entry.project, self.project)

    def test_the_resource_field_is_omitted_and_reported_when_unresolved(self):
        self.event(account=self.account)
        sf = full_org(query_results={"FROM Resource__c": {"records": []}})

        sf, result = self._write(sf=sf)

        self.assertNotIn("Resource__c", sf.composite_bodies[0])
        self.assertIn("Resource__c", result["fields_skipped"])

    def test_a_rejected_write_records_the_error_and_raises(self):
        from salesforce_sync.cloudcoach import CloudCoachError

        self.event(account=self.account)
        sf = full_org(composite_response={"compositeResponse": [
            {"referenceId": "log_1", "httpStatusCode": 400, "body": [{"message": "boom"}]},
        ]})

        with self.assertRaises(CloudCoachError):
            self._write(sf=sf)

        entry = SalesforceTimeEntry.objects.get(user=self.user)
        self.assertFalse(entry.synced_to_sf)
        self.assertTrue(entry.sync_error)

    def test_an_empty_plan_touches_neither_salesforce_nor_the_database(self):
        sf, result = self._write()

        self.assertEqual(sf.composite_call_count, 0)
        self.assertEqual(result["logged"], 0)
        self.assertEqual(SalesforceTimeEntry.objects.count(), 0)

    def test_plan_week_alone_makes_no_salesforce_call(self):
        # This is what lets the same function serve the modal preview and the agent's
        # read-back step without a network round trip.
        self.event(account=self.account)
        with mock.patch("salesforce_sync.client.get_client") as get_client:
            plan_week(self.user, MONDAY)
        get_client.assert_not_called()


class ReportShapeTest(LogWeekTestBase):
    def test_as_dict_carries_counts_the_modal_needs(self):
        self.event(account=None, hour=9)
        self.event(account=None, hour=10, attended=False)

        report = plan_week(self.user, MONDAY).as_dict()

        self.assertEqual(report["unlinked_count"], 1)
        self.assertEqual(report["not_attended_count"], 1)
        self.assertEqual(report["entry_count"], 0)
        self.assertEqual(report["total_hours"], 0)
        self.assertEqual(report["week_start"], "2026-08-31")
        self.assertEqual(report["week_end"], "2026-09-07")

    def test_week_range_label_is_inclusive(self):
        self.assertEqual(week_range_label(MONDAY), "Mon 31 Aug – Sun 06 Sep")
