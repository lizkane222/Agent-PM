"""
Voice-agent tools for people and their calendars: find_person, get_colleague_availability,
invite_to_meeting.

Everything here talks about *other people*, so the tests concentrate on the two things that go
wrong: privacy (another person's meeting titles must never reach the model) and picking the
wrong human (an ambiguous name must not silently choose, because a choice emails someone).

The tools run ORM work through sync_to_async(thread_sensitive=True), so plain TestCase data is
visible to them (unlike the older run_in_executor tools, which need TransactionTestCase).
"""

from datetime import datetime, timedelta, timezone
from django.utils.timezone import now as timezone_now
from unittest import mock

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from accounts.models import Account
from agents.mcp_server import mcp_server
from scheduler.models import CalendarEvent
from team.models import TeamMember, UserProfile

User = get_user_model()
UTC = timezone.utc


def run_confirmed(tool, user, **args):
    """As a caller who has just said yes: voice passes confirmed=True after the spoken gate."""
    return async_to_sync(mcp_server.dispatch)(tool, args, user=user, confirmed=True)


def run(tool, user, **args):
    # async_to_sync (not asyncio.run) so the tools' thread_sensitive ORM calls run on THIS thread,
    # inside the TestCase transaction, instead of a separate executor thread that sqlite locks out.
    return async_to_sync(mcp_server.dispatch)(tool, args, user=user)


def at(day, hour, minute=0):
    return datetime(2026, 10, day, hour, minute, tzinfo=UTC)


class _Base(TestCase):
    def setUp(self):
        self.me = User.objects.create_user("liz", email="liz@twilio.com", password="x")
        UserProfile.objects.create(user=self.me, timezone="UTC")
        self.me_m = TeamMember.objects.create(user=self.me, full_name="Liz Kane", email="liz@twilio.com")
        # Melissa has no login: her calendar can only come from Google free/busy.
        self.mel = TeamMember.objects.create(full_name="Melissa Ramirez", email="mramirez@twilio.com", title="SA")
        # Ana has a login, so her calendar comes from the app's own events.
        self.ana_user = User.objects.create_user("ana", email="ana@twilio.com", password="x")
        self.ana = TeamMember.objects.create(user=self.ana_user, full_name="Ana Diaz", email="ana@twilio.com")
        self.andrew_h = TeamMember.objects.create(full_name="Andrew Halaby", email="ah@twilio.com")
        self.andrew_s = TeamMember.objects.create(full_name="Andrew Stellwag", email="as@twilio.com")


class FindPersonTests(_Base):
    def test_resolves_a_full_name(self):
        r = run("find_person", self.me, name="Melissa Ramirez")
        self.assertEqual(r["status"], "found")
        self.assertEqual((r["person"]["name"], r["person"]["email"]), ("Melissa Ramirez", "mramirez@twilio.com"))

    def test_tolerates_a_misheard_name(self):
        self.assertEqual(run("find_person", self.me, name="Melisa Ramires")["person"]["name"], "Melissa Ramirez")

    def test_a_first_name_shared_by_two_people_is_not_guessed(self):
        r = run("find_person", self.me, name="Andrew")
        self.assertEqual(r["status"], "ambiguous")
        self.assertEqual({c["name"] for c in r["candidates"]}, {"Andrew Halaby", "Andrew Stellwag"})
        self.assertNotIn("person", r)

    def test_an_unknown_name_is_reported_not_invented(self):
        r = run("find_person", self.me, name="Zebulon Quux")
        self.assertEqual(r["status"], "not_found")

    def test_a_blank_name_is_an_error(self):
        self.assertEqual(run("find_person", self.me, name="  ")["status"], "error")

    def test_returns_only_directory_fields(self):
        person = run("find_person", self.me, name="Melissa Ramirez")["person"]
        self.assertEqual(set(person), {"name", "email", "title"})

    def test_a_person_with_no_email_cannot_be_used(self):
        TeamMember.objects.create(full_name="Noemail Person", email="")
        r = run("find_person", self.me, name="Noemail Person")
        self.assertEqual(r["status"], "no_email")

    def test_requires_a_user(self):
        self.assertEqual(run("find_person", None, name="Melissa Ramirez")["status"], "error")


class GetColleagueAvailabilityTests(_Base):
    def _google(self, busy_by_email):
        service = mock.MagicMock()
        service.freebusy.return_value.query.return_value.execute.return_value = {
            "calendars": {e: {"busy": [{"start": s.isoformat(), "end": en.isoformat()} for s, en in b]}
                          for e, b in busy_by_email.items()}
        }
        return mock.patch("scheduler.availability._google_service_for", return_value=service)

    def _ask(self, **kw):
        kw.setdefault("names", ["Melissa Ramirez"])
        kw.setdefault("date_start", "2026-10-19")
        kw.setdefault("date_end", "2026-10-19")
        with mock.patch("agents.people_tools._now", return_value=at(1, 0)):
            return run("get_colleague_availability", self.me, **kw)

    def test_reports_a_google_only_colleagues_busy_time_and_shared_free_slots(self):
        with self._google({"mramirez@twilio.com": [(at(19, 10), at(19, 11))]}):
            r = self._ask()
        self.assertEqual(r["status"], "ok")
        person = r["people"][0]
        self.assertEqual(person["name"], "Melissa Ramirez")
        self.assertEqual(person["busy"], [{"start": "2026-10-19T10:00:00+00:00", "end": "2026-10-19T11:00:00+00:00"}])
        self.assertEqual([(s["start"][11:16], s["end"][11:16]) for s in r["free_slots"]], [("09:00", "10:00"), ("11:00", "17:00")])

    def test_my_own_busy_time_also_blocks_the_shared_slots(self):
        CalendarEvent.objects.create(owner=self.me, title="Mine", start_datetime=at(19, 13), end_datetime=at(19, 14))
        with self._google({"mramirez@twilio.com": []}):
            r = self._ask()
        self.assertEqual([(s["start"][11:16], s["end"][11:16]) for s in r["free_slots"]], [("09:00", "13:00"), ("14:00", "17:00")])

    def test_never_returns_meeting_titles_for_other_people(self):
        # Ana's meeting is on an account Liz is NOT on, so the title must stay hidden.
        private = Account.objects.create(company_name="Ana Only")
        private.team_members.add(self.ana)
        CalendarEvent.objects.create(owner=self.ana_user, title="SECRET acquisition", account=private,
                                     start_datetime=at(19, 10), end_datetime=at(19, 11))
        r = self._ask(names=["Ana Diaz"])
        self.assertNotIn("SECRET", str(r))
        self.assertEqual(set(r["people"][0]["busy"][0]), {"start", "end"})

    def test_names_are_resolved_fuzzily(self):
        with self._google({"mramirez@twilio.com": []}):
            self.assertEqual(self._ask(names=["Melisa Ramirez"])["people"][0]["name"], "Melissa Ramirez")

    def test_an_ambiguous_name_stops_and_asks_instead_of_guessing(self):
        r = self._ask(names=["Andrew"])
        self.assertEqual(r["status"], "ambiguous")
        self.assertEqual(r["name"], "Andrew")
        self.assertEqual({c["name"] for c in r["candidates"]}, {"Andrew Halaby", "Andrew Stellwag"})

    def test_an_unknown_name_stops_and_says_so(self):
        r = self._ask(names=["Zebulon Quux"])
        self.assertEqual((r["status"], r["name"]), ("not_found", "Zebulon Quux"))

    def test_google_not_connected_is_surfaced_not_treated_as_free(self):
        with mock.patch("scheduler.availability._google_service_for", return_value=None):
            r = self._ask()
        self.assertEqual(r["status"], "partial")
        self.assertEqual(r["people"][0]["unavailable_reason"], "not_connected")
        # Without Melissa's data the slots would be wrong, so none may be offered.
        self.assertEqual(r["free_slots"], [])

    def test_a_google_error_for_one_person_is_surfaced(self):
        service = mock.MagicMock()
        service.freebusy.return_value.query.return_value.execute.return_value = {
            "calendars": {"mramirez@twilio.com": {"busy": [], "errors": [{"reason": "notFound"}]}}}
        with mock.patch("scheduler.availability._google_service_for", return_value=service):
            r = self._ask()
        self.assertEqual((r["status"], r["people"][0]["unavailable_reason"]), ("partial", "notFound"))

    def test_the_callers_own_name_is_ignored_rather_than_listed(self):
        with self._google({"mramirez@twilio.com": []}):
            r = self._ask(names=["Liz Kane", "Melissa Ramirez"])
        self.assertEqual([p["name"] for p in r["people"]], ["Melissa Ramirez"])

    def test_requires_at_least_one_name(self):
        self.assertEqual(self._ask(names=[])["status"], "error")

    def test_caps_the_number_of_people(self):
        self.assertEqual(self._ask(names=[f"P{i}" for i in range(9)])["status"], "error")

    def test_rejects_unparseable_and_reversed_dates(self):
        self.assertEqual(self._ask(date_start="soon")["status"], "error")
        self.assertEqual(self._ask(date_start="2026-10-20", date_end="2026-10-19")["status"], "error")

    def test_a_range_wider_than_two_weeks_is_refused(self):
        self.assertEqual(self._ask(date_start="2026-10-01", date_end="2026-11-30")["status"], "error")

    def test_free_slots_use_the_callers_timezone(self):
        UserProfile.objects.filter(user=self.me).update(timezone="America/Los_Angeles")
        self.me.refresh_from_db()
        with self._google({"mramirez@twilio.com": []}):
            r = self._ask()
        # 9:00 in Los Angeles in October is 16:00 UTC; the answer is expressed in local time.
        self.assertTrue(r["free_slots"][0]["start"].startswith("2026-10-19T09:00:00"))
        self.assertIn("-07:00", r["free_slots"][0]["start"])

    def test_busy_blocks_are_in_the_callers_zone_like_the_free_slots(self):
        # They used to come back as raw UTC ("12:00Z") beside free slots in local time
        # ("-07:00"), and the model read 12:00Z as noon. That block is 5am in Los Angeles.
        UserProfile.objects.filter(user=self.me).update(timezone="America/Los_Angeles")
        self.me.refresh_from_db()
        with self._google({"mramirez@twilio.com": [(at(19, 12), at(19, 15))]}):
            r = self._ask()
        busy = r["people"][0]["busy"][0]
        self.assertEqual(busy, {"start": "2026-10-19T05:00:00-07:00", "end": "2026-10-19T08:00:00-07:00"})
        # And no raw-UTC marker anywhere in the answer the model reads.
        self.assertNotIn("Z\"", str(r["people"][0]["busy"]).replace("'", '"'))

    def test_a_typed_pst_profile_means_pacific_time_not_utc(self):
        # The real profile value. It used to be read as UTC, so the agent offered "9 to noon UTC".
        UserProfile.objects.filter(user=self.me).update(timezone="PST")
        self.me.refresh_from_db()
        with self._google({"mramirez@twilio.com": []}):
            r = self._ask()
        self.assertEqual(r["timezone"], "America/Los_Angeles")
        self.assertTrue(r["free_slots"][0]["start"].startswith("2026-10-19T09:00:00"))
        self.assertIn("-07:00", r["free_slots"][0]["start"])

    def test_requires_a_user(self):
        self.assertEqual(run("get_colleague_availability", None, names=["Melissa Ramirez"],
                             date_start="2026-10-19", date_end="2026-10-19")["status"], "error")


class _FakeGoogle:
    """A Google service that records every call, so tests can see what was really sent."""

    def __init__(self, result=None):
        self.calls, self._result = [], result or {"id": "g-new"}

    def events(self):
        return self

    def __getattr__(self, verb):
        def call(**kw):
            self.calls.append((verb, kw))
            outer = self

            class Req:
                def execute(self_inner, num_retries=0):
                    return outer._result
            return Req()
        return call

    @property
    def sent(self):
        return [kw.get("sendUpdates") for _, kw in self.calls]


@override_settings(GOOGLE_GUEST_NOTIFICATIONS=True, GOOGLE_INVITE_FRESHNESS_SECONDS=60,
                   GOOGLE_MAX_GUEST_EMAILS_PER_HOUR=50, GOOGLE_MAX_GUESTS_PER_NOTIFIED_EVENT=25)
class InviteToMeetingTests(_Base):
    """
    Goes through the real invite gate and gateway with only Google itself faked, because the
    behaviour that matters — was anyone actually emailed? — lives in the gateway's decision.
    """

    def setUp(self):
        super().setUp()
        # Relative to now, never a fixed date: the invite gate refuses past and far-future
        # events, so a hard-coded date silently turns these tests into "refused" tests the day
        # it passes (the same rot CLAUDE.md records for FUTURE_MEETING_DATE).
        soon = timezone_now() + timedelta(days=3)
        self.event = CalendarEvent.objects.create(
            owner=self.me, title="Siemens review", start_datetime=soon, end_datetime=soon + timedelta(minutes=15),
            calendar_id="primary", origin="agentpm")
        self.google = _FakeGoogle()
        self._patches = [
            mock.patch("integrations.google_api.credentials_for", return_value=object()),
            mock.patch("integrations.google_api.persist_refreshed"),
            mock.patch("googleapiclient.discovery.build", return_value=self.google),
        ]
        for p in self._patches:
            p.start()
            self.addCleanup(p.stop)
        from integrations.models import OAuthCredential
        OAuthCredential.objects.create(user=self.me, provider="google", access_token="a",
                                       refresh_token="r", scopes="x", is_active=True)

    def _invite(self, *, confirmed=True, **kw):
        kw.setdefault("event_id", self.event.pk)
        kw.setdefault("attendee_names", ["Melissa Ramirez"])
        return (run_confirmed if confirmed else run)("invite_to_meeting", self.me, **kw)

    def test_a_confirmed_invite_adds_the_attendee_and_emails_them_once(self):
        r = self._invite()
        self.assertEqual(r["status"], "invited", r)
        self.event.refresh_from_db()
        self.assertEqual([a["email"] for a in self.event.attendees], ["mramirez@twilio.com"])
        self.assertEqual(self.google.sent, ["all"])
        self.assertTrue(self.event.invite_sent)
        self.assertEqual(r["invited"], [{"name": "Melissa Ramirez", "email": "mramirez@twilio.com"}])

    def test_asking_twice_never_emails_twice(self):
        self._invite()
        r = self._invite()
        self.assertEqual(self.google.sent.count("all"), 1)
        self.assertEqual(r["status"], "added_not_emailed")
        self.assertIn("never sent twice", r["note"])

    def test_an_event_already_in_google_is_updated_not_duplicated(self):
        CalendarEvent.objects.filter(pk=self.event.pk).update(google_event_id="g123", is_synced=True)
        r = self._invite()
        self.assertEqual([v for v, _ in self.google.calls], ["patch"])
        self.assertEqual(r["status"], "invited", r)

    # --- approval ------------------------------------------------------------------------------------

    def test_an_unconfirmed_call_is_refused_before_anything_happens(self):
        # invite_to_meeting needs the user's approval on every surface, so an unconfirmed call
        # never reaches the tool: no attendee is added and nothing reaches Google.
        r = self._invite(confirmed=False)
        self.assertEqual(r.get("error_code"), "confirmation_required", r)
        self.assertEqual(self.google.calls, [])
        self.event.refresh_from_db()
        self.assertEqual(self.event.attendees, [])
        self.assertFalse(self.event.invite_sent)

    def test_approval_does_not_leak_into_the_next_call(self):
        self._invite()
        ev2 = CalendarEvent.objects.create(owner=self.me, title="Other", start_datetime=timezone_now() + timedelta(days=4),
                                           end_datetime=timezone_now() + timedelta(days=4, hours=1),
                                           calendar_id="primary", origin="agentpm")
        google2 = _FakeGoogle()
        with mock.patch("googleapiclient.discovery.build", return_value=google2):
            r = self._invite(confirmed=False, event_id=ev2.pk)
        self.assertEqual(r.get("error_code"), "confirmation_required")
        self.assertEqual(google2.calls, [])

    def test_an_event_that_came_from_google_is_never_emailed_even_when_approved(self):
        CalendarEvent.objects.filter(pk=self.event.pk).update(origin="google", google_event_id="g9", is_synced=True)
        r = self._invite()
        self.assertNotIn("all", self.google.sent)
        self.assertEqual(r["status"], "added_not_emailed")

    @override_settings(GOOGLE_GUEST_NOTIFICATIONS=False)
    def test_the_global_switch_off_means_no_email_even_when_approved(self):
        r = self._invite()
        self.assertNotIn("all", self.google.sent)
        self.assertEqual(r["status"], "added_not_emailed")

    # --- failures and honesty --------------------------------------------------------------------------

    def test_google_not_connected_still_records_the_attendee_but_says_no_email_went(self):
        from integrations.models import OAuthCredential
        OAuthCredential.objects.filter(user=self.me).delete()
        with mock.patch("integrations.google_api.credentials_for", return_value=None):
            r = self._invite()
        self.assertEqual(r["status"], "added_not_emailed")
        self.event.refresh_from_db()
        self.assertEqual(len(self.event.attendees), 1)

    def test_a_google_failure_is_reported_and_the_local_event_survives(self):
        with mock.patch("integrations.google_calendar_gateway.write_event", side_effect=RuntimeError("boom")):
            r = self._invite()
        self.assertEqual(r["status"], "added_not_emailed")
        self.assertNotIn("boom", str(r))
        self.assertTrue(CalendarEvent.objects.filter(pk=self.event.pk).exists())

    def test_the_tool_never_claims_an_email_went_out_that_did_not(self):
        # "invited" must mean the gateway actually recorded a send, not merely that no error was raised.
        with mock.patch("integrations.google_calendar_gateway.write_event", return_value={"id": "x"}):
            r = self._invite()
        self.assertEqual(r["status"], "added_not_emailed")

    # --- people ------------------------------------------------------------------------------------------

    def test_keeps_existing_attendees_and_does_not_duplicate_one(self):
        CalendarEvent.objects.filter(pk=self.event.pk).update(
            attendees=[{"email": "mramirez@twilio.com", "displayName": "Melissa Ramirez"}, {"email": "x@y.com"}])
        self._invite()
        self.event.refresh_from_db()
        self.assertEqual(sorted(a["email"] for a in self.event.attendees), ["mramirez@twilio.com", "x@y.com"])

    def test_an_ambiguous_name_invites_nobody(self):
        r = self._invite(attendee_names=["Andrew"])
        self.assertEqual(r["status"], "ambiguous")
        self.assertEqual(self.google.calls, [])
        self.event.refresh_from_db()
        self.assertEqual(self.event.attendees, [])

    def test_one_unresolvable_name_invites_nobody_at_all(self):
        r = self._invite(attendee_names=["Melissa Ramirez", "Zebulon Quux"])
        self.assertEqual((r["status"], r["name"]), ("not_found", "Zebulon Quux"))
        self.assertEqual(self.google.calls, [])
        self.event.refresh_from_db()
        self.assertEqual(self.event.attendees, [])

    def test_cannot_invite_people_to_someone_elses_event(self):
        other = CalendarEvent.objects.create(owner=self.ana_user, title="Ana's", start_datetime=at(19, 9),
                                             end_datetime=at(19, 10), origin="agentpm")
        r = self._invite(event_id=other.pk)
        self.assertEqual(r["status"], "error")
        self.assertEqual(self.google.calls, [])

    def test_an_unknown_event_is_an_error(self):
        self.assertEqual(self._invite(event_id=999999)["status"], "error")

    def test_requires_at_least_one_attendee(self):
        self.assertEqual(self._invite(attendee_names=[])["status"], "error")

    def test_requires_a_user(self):
        self.assertEqual(run_confirmed("invite_to_meeting", None, event_id=self.event.pk,
                                       attendee_names=["Melissa Ramirez"])["status"], "error")


class RegistrationTests(TestCase):
    def test_all_three_tools_are_registered(self):
        for name in ("find_person", "get_colleague_availability", "invite_to_meeting"):
            self.assertIn(name, mcp_server.list_tools())

    def test_none_are_available_to_skill_authors(self):
        safe = set(mcp_server.skill_safe_tools())
        for name in ("find_person", "get_colleague_availability", "invite_to_meeting"):
            self.assertNotIn(name, safe)


@override_settings(GOOGLE_GUEST_NOTIFICATIONS=True, GOOGLE_INVITE_FRESHNESS_SECONDS=60,
                   GOOGLE_MAX_GUEST_EMAILS_PER_HOUR=50, GOOGLE_MAX_GUESTS_PER_NOTIFIED_EVENT=25,
                   GOOGLE_INVITE_HORIZON_DAYS=14)
class InviteNoteExplainsWhyTests(_Base):
    """The agent reads the tool's note aloud, so it must say WHY no email went out."""

    def setUp(self):
        super().setUp()
        self.google = _FakeGoogle()
        for p in (mock.patch("integrations.google_api.credentials_for", return_value=object()),
                  mock.patch("integrations.google_api.persist_refreshed"),
                  mock.patch("googleapiclient.discovery.build", return_value=self.google)):
            p.start()
            self.addCleanup(p.stop)
        from integrations.models import OAuthCredential
        OAuthCredential.objects.create(user=self.me, provider="google", access_token="a",
                                       refresh_token="r", scopes="x", is_active=True)

    def _make(self, **kw):
        base = timezone_now() + timedelta(days=3)
        defaults = dict(owner=self.me, title="T", start_datetime=base, end_datetime=base + timedelta(hours=1),
                        calendar_id="primary", origin="agentpm")
        defaults.update(kw)
        return CalendarEvent.objects.create(**defaults)

    def _note(self, event):
        return run_confirmed("invite_to_meeting", self.me, event_id=event.pk,
                             attendee_names=["Melissa Ramirez"]).get("note", "")

    def test_a_meeting_too_far_ahead_says_so(self):
        note = self._note(self._make(start_datetime=timezone_now() + timedelta(days=400),
                                     end_datetime=timezone_now() + timedelta(days=400, hours=1)))
        self.assertIn("14 days", note)
        self.assertIn("60 days", note)
        self.assertIn("no invitation was emailed", note.lower())

    def test_a_past_meeting_says_so(self):
        note = self._note(self._make(start_datetime=timezone_now() - timedelta(days=2),
                                     end_datetime=timezone_now() - timedelta(days=2, hours=-1)))
        self.assertIn("already", note.lower())

    def test_a_recurring_instance_says_the_series_handles_it(self):
        note = self._note(self._make(google_event_id="series1_20260710T160000Z"))
        self.assertIn("recurring", note.lower())

    def test_an_already_announced_event_says_so(self):
        note = self._note(self._make(invite_sent=True, invited_emails=["x@y.com"]))
        self.assertIn("already", note.lower())

    @override_settings(GOOGLE_GUEST_NOTIFICATIONS=False)
    def test_the_switch_being_off_says_so(self):
        note = self._note(self._make())
        self.assertIn("switched off", note.lower())

    def test_a_google_origin_event_says_google_owns_it(self):
        note = self._note(self._make(origin="google"))
        self.assertIn("google", note.lower())
