"""
Time Allocation: logged time where it exists, calendar events where it does not, and never a
meeting the user marked "did not attend".
"""

from datetime import date, datetime, timedelta, timezone

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Account
from airtable_sync.models import AirtableAccount, AirtableActionItem
from scheduler.models import CalendarEvent
from team.models import TeamMember, UserProfile

from salesforce_sync.models import SalesforceTimeEntry
from salesforce_sync.time_allocation import build_allocation, line_minutes

User = get_user_model()
UTC = timezone.utc
NOW = datetime(2026, 11, 5, 18, 0, tzinfo=UTC)
D = date(2026, 10, 14)
URL = "/api/v1/salesforce/time-allocation/"


def at(day, hour=15, minute=0):
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=UTC)


class _Base(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user("liz", email="liz@example.com", password="x")
        UserProfile.objects.create(user=self.user, timezone="UTC")
        self.member = TeamMember.objects.create(user=self.user, full_name="Liz", email="liz@example.com")
        self.acme = self.account("Acme")
        self.globex = self.account("Globex")

    def account(self, name, mine=True):
        a = Account.objects.create(company_name=name)
        if mine:
            a.team_members.add(self.member)
        return a

    def event(self, title="Sync", day=D, hour=15, minutes=60, account=None, **kw):
        start = at(day, hour)
        return CalendarEvent.objects.create(
            owner=kw.pop("owner", self.user), title=title, account=account,
            start_datetime=start, end_datetime=start + timedelta(minutes=minutes), **kw,
        )

    def logged(self, minutes, account=None, day=D, description="x", **kw):
        return SalesforceTimeEntry.objects.create(
            user=kw.pop("user", self.user), date=day, duration_minutes=minutes,
            account=account, description=description, **kw,
        )

    def run_alloc(self, start=D, end=D, now=NOW):
        return build_allocation(self.user, start, end, now)

    def rows(self, **kw):
        return {(r["date"], r["account"], r["source"]): r["minutes"] for r in self.run_alloc(**kw)["rows"]}


class LineMinutesTests(TestCase):
    def test_parses_the_duration_suffix(self):
        self.assertEqual(line_minutes("Siemens Email (15m)"), 15)
        self.assertEqual(line_minutes("JPMC Func Build (1h 45m)"), 105)
        self.assertEqual(line_minutes("Weekly sync (2h)"), 120)

    def test_no_duration_means_zero(self):
        self.assertEqual(line_minutes("Just a title"), 0)
        self.assertEqual(line_minutes("Total: 1.75 hrs"), 0)
        self.assertEqual(line_minutes("Plan (draft)"), 0)


class DidNotAttendTests(_Base):
    def test_a_meeting_marked_did_not_attend_is_not_counted_at_all(self):
        self.event(account=self.acme, attended=False)
        self.assertEqual(self.rows(), {})

    def test_attended_true_and_never_recorded_both_count(self):
        self.event("A", account=self.acme, attended=True)
        self.event("B", hour=17, account=self.acme)  # attended is None
        self.assertEqual(self.rows(), {("2026-10-14", "Acme", "calendar"): 120})

    def test_it_is_not_counted_as_unlinked_time_either(self):
        self.event(account=self.acme, attended=False)
        self.assertEqual(self.run_alloc()["unlinked_calendar_minutes"], 0)

    def test_it_is_subtracted_from_an_already_logged_entry_that_contains_it(self):
        # Logged before the meeting was marked did-not-attend: 90m = 30m + 60m.
        self.logged(90, self.acme, description="Standup (30m)\nVendor demo (1h)\nTotal: 1.50 hrs")
        self.event("Vendor demo", account=self.acme, attended=False)
        self.assertEqual(self.rows(), {("2026-10-14", "Acme", "logged"): 30})

    def test_a_title_match_is_case_and_spacing_insensitive(self):
        self.logged(60, self.acme, description="Vendor   Demo (1h)\nTotal: 1.00 hrs")
        self.event("vendor demo", account=self.acme, attended=False)
        self.assertEqual(self.rows(), {})

    def test_only_the_skipped_meetings_line_is_removed(self):
        self.logged(90, self.acme, description="Standup (30m)\nVendor demo (1h)")
        self.event("Some other meeting", account=self.acme, attended=False)
        self.assertEqual(self.rows(), {("2026-10-14", "Acme", "logged"): 90})

    def test_a_did_not_attend_on_another_day_does_not_touch_this_days_entry(self):
        self.logged(60, self.acme, description="Vendor demo (1h)")
        self.event("Vendor demo", day=D + timedelta(days=1), account=self.acme, attended=False)
        self.assertEqual(self.rows(), {("2026-10-14", "Acme", "logged"): 60})

    def test_never_subtracts_below_zero(self):
        self.logged(30, self.acme, description="Vendor demo (1h)")
        self.event("Vendor demo", account=self.acme, attended=False)
        self.assertEqual(self.rows(), {})

    def test_a_fully_removed_logged_day_does_not_fall_back_to_the_calendar(self):
        # The day was logged. Re-adding its calendar events would count meetings the user dropped.
        self.logged(60, self.acme, description="Vendor demo (1h)")
        self.event("Vendor demo", account=self.acme, attended=False)
        self.event("Another Acme meeting", hour=17, account=self.acme)
        self.assertEqual(self.rows(), {})


class WhatCountsTests(_Base):
    def test_cancelled_all_day_and_non_work_blocks_are_ignored(self):
        self.event("c", account=self.acme, status="cancelled")
        self.event("a", account=self.acme, all_day=True)
        for cat in ("out_of_office", "working_location", "focus_time"):
            self.event(cat, hour=11, account=self.acme, event_category=cat)
        self.assertEqual(self.rows(), {})

    def test_zero_length_events_are_ignored(self):
        self.event(account=self.acme, minutes=0)
        self.assertEqual(self.rows(), {})

    def test_events_that_have_not_started_yet_are_not_counted(self):
        self.event(day=NOW.date(), hour=19, account=self.acme)  # starts after NOW
        self.assertEqual(self.rows(start=NOW.date(), end=NOW.date()), {})

    def test_an_event_in_progress_counts_only_up_to_now(self):
        self.event(day=NOW.date(), hour=17, minutes=120, account=self.acme)  # 17:00-19:00, now 18:00
        self.assertEqual(self.rows(start=NOW.date(), end=NOW.date()), {(NOW.date().isoformat(), "Acme", "calendar"): 60})

    def test_other_users_events_and_entries_never_appear(self):
        other = User.objects.create_user("bob", email="b@example.com", password="x")
        self.event(account=self.acme, owner=other)
        self.logged(60, self.acme, user=other)
        self.assertEqual(self.rows(), {})

    def test_events_outside_the_range_are_excluded(self):
        self.event(day=D - timedelta(days=1), account=self.acme)
        self.event(day=D + timedelta(days=1), account=self.acme)
        self.assertEqual(self.rows(), {})

    def test_work_tracking_blocks_for_an_action_item_count_under_its_account(self):
        at_acct = AirtableAccount.objects.create(airtable_id="recA", name="Acme")
        AirtableActionItem.objects.create(airtable_id="recI", task="Write deck", account=at_acct)
        self.event("Write deck", calendar_id="work_tracking", agentpm_airtable_id="recI", minutes=45)
        self.assertEqual(self.rows(), {("2026-10-14", "Acme", "calendar"): 45})


class AccountAttributionTests(_Base):
    def test_a_linked_event_shows_under_its_account(self):
        self.event(account=self.globex, minutes=30)
        self.assertEqual(self.rows(), {("2026-10-14", "Globex", "calendar"): 30})

    def test_an_unlinked_event_whose_title_names_exactly_one_of_my_accounts_uses_it(self):
        self.event("Acme weekly sync", minutes=45)
        result = self.run_alloc()
        self.assertEqual(self.rows(), {("2026-10-14", "Acme", "calendar"): 45})
        self.assertEqual(result["inferred_minutes"], 45)

    def test_a_linked_event_is_not_counted_as_inferred(self):
        self.event("Acme weekly sync", account=self.acme)
        self.assertEqual(self.run_alloc()["inferred_minutes"], 0)

    def test_a_title_naming_two_accounts_is_not_guessed(self):
        self.event("Acme and Globex joint call")
        self.assertEqual(self.rows(), {})

    def test_an_account_the_user_is_not_on_is_never_inferred(self):
        self.account("Initech", mine=False)
        self.event("Initech kickoff")
        self.assertEqual(self.rows(), {})

    def test_an_event_that_names_nothing_is_left_out_but_counted(self):
        self.event("1:1 with manager", minutes=30)
        r = self.run_alloc()
        self.assertEqual(r["rows"], [])
        self.assertEqual(r["unlinked_calendar_minutes"], 30)

    def test_the_link_wins_over_a_different_account_named_in_the_title(self):
        self.event("Globex stuff", account=self.acme)
        self.assertEqual(self.rows(), {("2026-10-14", "Acme", "calendar"): 60})


class LoggedBeatsCalendarTests(_Base):
    def test_logged_time_is_used_instead_of_the_calendar_for_that_day_and_account(self):
        self.logged(45, self.acme)
        self.event(account=self.acme, minutes=120)
        self.assertEqual(self.rows(), {("2026-10-14", "Acme", "logged"): 45})

    def test_the_calendar_fills_in_other_accounts_the_same_day(self):
        self.logged(45, self.acme)
        self.event("g", account=self.globex, minutes=30)
        self.assertEqual(self.rows(), {
            ("2026-10-14", "Acme", "logged"): 45, ("2026-10-14", "Globex", "calendar"): 30,
        })

    def test_an_unlogged_day_uses_the_calendar_even_between_logged_days(self):
        self.logged(60, self.acme, day=D)
        self.event(day=D + timedelta(days=1), account=self.acme, minutes=90)
        self.assertEqual(self.rows(end=D + timedelta(days=1)), {
            ("2026-10-14", "Acme", "logged"): 60, ("2026-10-15", "Acme", "calendar"): 90,
        })

    def test_the_current_week_shows_even_though_nothing_is_logged(self):
        today = NOW.date()
        self.event(day=today, hour=9, account=self.acme, minutes=60)
        self.event(day=today - timedelta(days=1), account=self.globex, minutes=30)
        rows = self.rows(start=today - timedelta(days=3), end=today)
        self.assertEqual(rows, {
            (today.isoformat(), "Acme", "calendar"): 60,
            ((today - timedelta(days=1)).isoformat(), "Globex", "calendar"): 30,
        })

    def test_unattributed_logged_time_is_kept_as_no_account(self):
        self.logged(30, None)
        self.assertEqual(self.rows(), {("2026-10-14", "", "logged"): 30})

    def test_totals_split_logged_from_calendar(self):
        self.logged(60, self.acme)
        self.event("g", account=self.globex, minutes=30)
        r = self.run_alloc()
        self.assertEqual((r["logged_minutes"], r["calendar_minutes"]), (60, 30))


class TimezoneTests(_Base):
    def test_days_are_the_users_local_days(self):
        self.user.profile.timezone = "America/Los_Angeles"
        self.user.profile.save()
        # 02:00 UTC on the 15th is 19:00 on the 14th in Los Angeles.
        self.event(day=date(2026, 10, 15), hour=2, account=self.acme, minutes=60)
        rows = self.rows(start=date(2026, 10, 14), end=date(2026, 10, 15))
        self.assertEqual(rows, {("2026-10-14", "Acme", "calendar"): 60})


class EndpointTests(_Base):
    def setUp(self):
        super().setUp()
        self.client = APIClient()

    def test_requires_auth(self):
        self.assertEqual(self.client.get(URL, {"start": "2026-10-01", "end": "2026-10-02"}).status_code, 401)

    def test_returns_the_callers_rows(self):
        self.client.force_authenticate(self.user)
        self.event(account=self.acme)
        resp = self.client.get(URL, {"start": "2026-10-14", "end": "2026-10-14"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual([r["account"] for r in resp.data["rows"]], ["Acme"])
        for key in ("logged_minutes", "calendar_minutes", "inferred_minutes", "unlinked_calendar_minutes"):
            self.assertIn(key, resp.data)

    def test_staff_get_only_their_own_data(self):
        staff = User.objects.create_user("boss", email="boss@example.com", password="x", is_staff=True)
        self.event(account=self.acme)
        self.client.force_authenticate(staff)
        resp = self.client.get(URL, {"start": "2026-10-14", "end": "2026-10-14"})
        self.assertEqual(resp.data["rows"], [])

    def test_rejects_missing_malformed_and_reversed_dates(self):
        self.client.force_authenticate(self.user)
        for params in ({}, {"start": "2026-10-01"}, {"start": "nope", "end": "2026-10-02"},
                       {"start": "2026-10-05", "end": "2026-10-01"}):
            with self.subTest(params=params):
                self.assertEqual(self.client.get(URL, params).status_code, 400)

    def test_caps_the_range(self):
        self.client.force_authenticate(self.user)
        resp = self.client.get(URL, {"start": "2026-01-01", "end": "2026-12-31"})
        self.assertEqual(resp.status_code, 400)
