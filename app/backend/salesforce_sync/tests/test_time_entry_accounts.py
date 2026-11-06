"""
Which account a logged time entry belongs to — the data behind the profile page's Time Allocation.

The bug: entries were saved with no Cloud Coach project (Salesforce not synced) and nothing else
naming an account, so every entry showed as "No account". These tests pin the fix at each layer:
the resolver, the two write paths, the API, and the backfill for entries logged before the fix.
"""

from datetime import date, datetime, timedelta, timezone
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from rest_framework.test import APITestCase

from accounts.models import Account, AccountProject
from airtable_sync.models import AirtableAccount, AirtableActionItem
from scheduler.models import CalendarEvent
from team.models import TeamMember

from salesforce_sync.models import SalesforceAccount, SalesforceProject, SalesforceTimeEntry
from salesforce_sync.time_entry_accounts import (
    account_for_project_sf_id, entry_title, infer_account,
)

User = get_user_model()
DAY = date(2026, 10, 14)
LOG_TIME_URL = "/api/v1/salesforce/log-time/"
ENTRIES_URL = "/api/v1/salesforce/time-entries/"


class _Base(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user("liz", email="liz@example.com", password="x")
        self.member = TeamMember.objects.create(user=self.user, full_name="Liz", email="liz@example.com")

    def acct(self, name, mine=True, **kw):
        a = Account.objects.create(company_name=name, **kw)
        if mine:
            a.team_members.add(self.member)
        return a

    def entry(self, description, day=DAY, minutes=30, **kw):
        return SalesforceTimeEntry.objects.create(
            user=kw.pop("user", self.user), date=day, duration_minutes=minutes, description=description, **kw
        )


class EntryTitleTests(TestCase):
    def test_strips_the_duration_suffix_and_the_totals_line(self):
        self.assertEqual(entry_title("Siemens Email (15m)\nTotal: 0.25 hrs"), "Siemens Email")

    def test_keeps_parentheses_that_are_part_of_the_title(self):
        self.assertEqual(entry_title("Plan (draft) review (1h)"), "Plan (draft) review")

    def test_handles_empty(self):
        self.assertEqual(entry_title(""), "")


class AccountForProjectTests(_Base):
    def test_maps_a_project_id_to_its_account_through_account_projects(self):
        acme = self.acct("Acme")
        AccountProject.objects.create(account=acme, name="P", sf_project_id="a0B000000000001")
        self.assertEqual(account_for_project_sf_id("a0B000000000001"), acme)

    def test_maps_a_synced_cloud_coach_project_by_account_name(self):
        acme = self.acct("Acme")
        sf_acct = SalesforceAccount.objects.create(sf_id="001A", name="acme")
        SalesforceProject.objects.create(sf_id="a0B2", name="Rollout", account=sf_acct)
        self.assertEqual(account_for_project_sf_id("a0B2"), acme)

    def test_unknown_or_blank_ids_resolve_to_nothing(self):
        self.assertIsNone(account_for_project_sf_id("a0Bnope"))
        self.assertIsNone(account_for_project_sf_id(""))
        self.assertIsNone(account_for_project_sf_id("   "))


class InferAccountTests(_Base):
    def test_uses_a_same_titled_calendar_event_that_has_an_account(self):
        acme = self.acct("Acme")
        start = datetime(2026, 10, 14, 15, tzinfo=timezone.utc)
        CalendarEvent.objects.create(owner=self.user, title="Quarterly sync", account=acme,
                                     start_datetime=start, end_datetime=start + timedelta(hours=1))
        self.assertEqual(infer_account(self.user, DAY, "Quarterly sync (1h)"), acme)

    def test_ignores_an_event_more_than_a_day_away_or_another_users(self):
        acme = self.acct("Acme")
        other = User.objects.create_user("bob", email="b@example.com", password="x")
        far = datetime(2026, 10, 20, 15, tzinfo=timezone.utc)
        CalendarEvent.objects.create(owner=self.user, title="Quarterly sync", account=acme,
                                     start_datetime=far, end_datetime=far + timedelta(hours=1))
        near = datetime(2026, 10, 14, 15, tzinfo=timezone.utc)
        CalendarEvent.objects.create(owner=other, title="Quarterly sync", account=acme,
                                     start_datetime=near, end_datetime=near + timedelta(hours=1))
        self.assertIsNone(infer_account(self.user, DAY, "Quarterly sync (1h)"))

    def test_uses_an_action_item_with_the_same_title(self):
        acme = self.acct("Acme")
        at = AirtableAccount.objects.create(airtable_id="recA", name="Acme")
        AirtableActionItem.objects.create(airtable_id="recI", task="Write the deck", account=at)
        self.assertEqual(infer_account(self.user, DAY, "Write the deck (30m)"), acme)

    def test_uses_the_one_account_named_in_the_description(self):
        siemens = self.acct("Siemens")
        self.acct("Autodesk")
        self.assertEqual(infer_account(self.user, DAY, "Siemens Email (15m)"), siemens)

    def test_two_accounts_named_is_ambiguous_so_it_places_nothing(self):
        self.acct("Siemens")
        self.acct("Autodesk")
        self.assertIsNone(infer_account(self.user, DAY, "Siemens and Autodesk sync (1h)"))

    def test_matches_whole_words_only(self):
        self.acct("ABC")
        self.assertIsNone(infer_account(self.user, DAY, "Review the ABCD rollout (1h)"))
        self.assertIsNotNone(infer_account(self.user, DAY, "ABC kickoff (1h)"))

    def test_a_word_inside_a_longer_account_name_is_not_a_match(self):
        # "Segment" is in "Segment Data Deletion" and in many meeting titles; loose matching would
        # file Chase's office hours under it.
        self.acct("Segment Data Deletion")
        self.assertIsNone(infer_account(self.user, DAY, "Chase/Segment Engage Office Hours (30m)"))

    def test_never_picks_an_account_the_user_is_not_on(self):
        self.acct("Siemens", mine=False)
        self.assertIsNone(infer_account(self.user, DAY, "Siemens Email (15m)"))

    def test_never_files_work_in_the_admin_workspace(self):
        admin = Account.objects.create(company_name="Admin", is_admin_account=True, admin_owner=self.user)
        admin.team_members.add(self.member)
        self.assertIsNone(infer_account(self.user, DAY, "Admin tasks (1h)"))

    def test_an_alias_maps_a_phrase_to_one_of_the_users_accounts(self):
        fest = self.acct("Festival Foods & Schnucks")
        got = infer_account(self.user, DAY, "Schnucks/Segment: Monthly Check-In (30m)",
                            aliases={"schnucks": "Festival Foods & Schnucks"})
        self.assertEqual(got, fest)

    def test_an_alias_cannot_reach_an_account_the_user_is_not_on(self):
        self.acct("Festival Foods & Schnucks", mine=False)
        got = infer_account(self.user, DAY, "Schnucks sync (30m)", aliases={"schnucks": "Festival Foods & Schnucks"})
        self.assertIsNone(got)

    def test_empty_description_places_nothing(self):
        self.acct("Acme")
        self.assertIsNone(infer_account(self.user, DAY, ""))


class LoggingRecordsTheAccountTests(APITestCase):
    """The write path: logging time stores the account, even with no Cloud Coach project."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user("liz", email="liz@example.com", password="x")
        self.member = TeamMember.objects.create(user=self.user, full_name="Liz", email="liz@example.com")
        self.acme = Account.objects.create(company_name="Acme")
        self.acme.team_members.add(self.member)
        AccountProject.objects.create(account=self.acme, name="Rollout", sf_project_id="a0B000000000001")
        self.client.force_authenticate(self.user)

    def test_log_time_stores_the_account_from_the_project_id(self):
        resp = self.client.post(LOG_TIME_URL, {
            "project_sf_id": "a0B000000000001", "date": "2026-10-14",
            "duration_minutes": 45, "description": "Kickoff (45m)",
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        entry = SalesforceTimeEntry.objects.get()
        self.assertIsNone(entry.project)          # never synced from Salesforce
        self.assertEqual(entry.account, self.acme)  # but the account is still known
        self.assertEqual(resp.data["account_name"], "Acme")

    def test_log_time_falls_back_to_the_description_when_the_project_is_unknown(self):
        resp = self.client.post(LOG_TIME_URL, {
            "project_sf_id": "a0Bunknown", "date": "2026-10-14",
            "duration_minutes": 30, "description": "Acme Slack (30m)",
        }, format="json")
        self.assertEqual(resp.data["account_name"], "Acme")

    def test_log_time_with_nothing_to_go_on_still_saves_with_no_account(self):
        resp = self.client.post(LOG_TIME_URL, {
            "project_sf_id": "a0Bunknown", "date": "2026-10-14",
            "duration_minutes": 30, "description": "Misc (30m)",
        }, format="json")
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["account_name"], "")


class TimeEntrySerializerAccountNameTests(_Base):
    def _name(self, entry):
        from rest_framework.test import APIClient
        c = APIClient()
        c.force_authenticate(self.user)
        return {r["id"]: r["account_name"] for r in c.get(ENTRIES_URL).data["results"]}[entry.id]

    def test_prefers_the_recorded_app_account(self):
        acme = self.acct("Acme")
        sf_acct = SalesforceAccount.objects.create(sf_id="001A", name="Some Other Name")
        proj = SalesforceProject.objects.create(sf_id="a0B2", name="P", account=sf_acct)
        self.assertEqual(self._name(self.entry("x", account=acme, project=proj)), "Acme")

    def test_falls_back_to_a_synced_projects_account(self):
        sf_acct = SalesforceAccount.objects.create(sf_id="001A", name="Cloud Coach Co")
        proj = SalesforceProject.objects.create(sf_id="a0B2", name="P", account=sf_acct)
        self.assertEqual(self._name(self.entry("x", project=proj)), "Cloud Coach Co")

    def test_is_blank_when_nothing_is_known(self):
        self.assertEqual(self._name(self.entry("x")), "")

    def test_the_account_field_is_read_only_through_the_api(self):
        from rest_framework.test import APIClient
        e = self.entry("x")
        c = APIClient(); c.force_authenticate(self.user)
        self.assertEqual(c.patch(f"{ENTRIES_URL}{e.id}/", {"account": 1}, format="json").status_code, 405)


class BackfillCommandTests(_Base):
    def run_cmd(self, *args):
        out = StringIO()
        call_command("backfill_time_entry_accounts", *args, stdout=out)
        return out.getvalue()

    def test_a_dry_run_changes_nothing_and_says_what_it_would_do(self):
        siemens = self.acct("Siemens")
        e = self.entry("Siemens Email (15m)")
        out = self.run_cmd()
        e.refresh_from_db()
        self.assertIsNone(e.account)
        self.assertIn("would", out)
        self.assertIn("Siemens", out)
        self.assertIn("Dry run", out)
        self.assertEqual(siemens.time_entries.count(), 0)

    def test_commit_writes_the_account(self):
        siemens = self.acct("Siemens")
        e = self.entry("Siemens Email (15m)")
        self.run_cmd("--commit")
        e.refresh_from_db()
        self.assertEqual(e.account, siemens)

    def test_is_idempotent(self):
        self.acct("Siemens")
        self.entry("Siemens Email (15m)")
        self.run_cmd("--commit")
        self.assertIn("Attributed 0", self.run_cmd("--commit"))

    def test_leaves_unplaceable_entries_alone_and_reports_them(self):
        self.acct("Siemens")
        e = self.entry("Weekly planning (1h)")
        out = self.run_cmd("--commit")
        e.refresh_from_db()
        self.assertIsNone(e.account)
        self.assertIn("left", out)

    def test_skips_entries_that_already_have_an_account_or_a_project_account(self):
        acme, siemens = self.acct("Acme"), self.acct("Siemens")
        done = self.entry("Siemens Email (15m)", account=acme)
        sf_acct = SalesforceAccount.objects.create(sf_id="001A", name="Cloud Coach Co")
        proj = SalesforceProject.objects.create(sf_id="a0B2", name="P", account=sf_acct)
        via_project = self.entry("Siemens Email (15m)", project=proj)
        self.run_cmd("--commit")
        done.refresh_from_db(); via_project.refresh_from_db()
        self.assertEqual(done.account, acme)
        self.assertIsNone(via_project.account)

    def test_alias_places_an_otherwise_unplaceable_entry(self):
        fest = self.acct("Festival Foods & Schnucks")
        e = self.entry("Schnucks/Segment: Monthly Check-In (30m)")
        self.run_cmd("--commit", "--alias", "schnucks=Festival Foods & Schnucks")
        e.refresh_from_db()
        self.assertEqual(e.account, fest)

    def test_a_malformed_alias_is_an_error(self):
        with self.assertRaises(CommandError):
            self.run_cmd("--alias", "nonsense")

    def test_username_limits_it_to_one_user(self):
        siemens = self.acct("Siemens")
        other = User.objects.create_user("bob", email="b@example.com", password="x")
        om = TeamMember.objects.create(user=other, full_name="Bob", email="b@example.com")
        siemens.team_members.add(om)
        mine = self.entry("Siemens Email (15m)")
        theirs = self.entry("Siemens Email (15m)", user=other)
        self.run_cmd("--commit", "--username", "bob")
        mine.refresh_from_db(); theirs.refresh_from_db()
        self.assertIsNone(mine.account)
        self.assertEqual(theirs.account, siemens)
