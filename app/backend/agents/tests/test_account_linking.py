"""
Spoken account names in the action-item / meeting tools.

Voice transcription turns "Archistrator" into "Orchestrator", so these tools must resolve
names fuzzily — and must never *silently* unlink a record when they cannot. They run DB work
in a bare executor thread, so these are TransactionTestCases (a TestCase's wrapping
transaction is invisible to that thread).
"""

import asyncio
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TransactionTestCase

from agents.mcp_server import mcp_server
from airtable_sync.models import AirtableAccount, AirtableActionItem, AirtableMeeting

User = get_user_model()


def run(tool, user, **args):
    return asyncio.run(mcp_server.dispatch(tool, args, user=user))


class _Base(TransactionTestCase):
    def setUp(self):
        self.user = User.objects.create_user("staffer", password="x", is_staff=True)
        for name in ("Archistrator", "Agent PM - FEATURES", "Siemens", "Berxi"):
            AirtableAccount.objects.create(airtable_id=f"rec{name[:4]}", name=name)
        self.push = patch("airtable_sync.write_back.push_action_item_create", return_value="recNEW1").start()
        patch("airtable_sync.write_back.push_action_item_update", return_value=True).start()
        patch("airtable_sync.sync.mirror_action_item_to_scheduler").start()
        self.addCleanup(patch.stopall)


class CreateActionItemAccountTests(_Base):
    def test_misheard_account_is_resolved_and_linked(self):
        r = run("create_action_item", self.user, task="t", account_name="Orchestrator")
        self.assertEqual(r["status"], "created", r)
        self.assertEqual(r["account_name"], "Archistrator")

    def test_partial_name_links_the_full_account(self):
        r = run("create_action_item", self.user, task="t", account_name="Agent PM")
        self.assertEqual((r["status"], r["account_name"]), ("created", "Agent PM - FEATURES"))

    def test_blank_account_still_creates_an_unlinked_item(self):
        r = run("create_action_item", self.user, task="t")
        self.assertEqual((r["status"], r["account_name"]), ("created", None))

    def test_unknown_account_falls_back_to_no_account_and_still_creates(self):
        r = run("create_action_item", self.user, task="t", account_name="Nonexistent Holdings")
        self.assertEqual(r["status"], "created", r)
        self.assertIsNone(r["account_name"])
        self.assertIn("No Account", r["account_fallback"])
        self.assertIn("Nonexistent Holdings", r["account_fallback"])
        self.assertEqual(r["account_candidates"], [])
        item = AirtableActionItem.objects.get(task="t")
        self.assertIsNone(item.account)
        self.push.assert_called_once()

    def test_ambiguous_account_falls_back_and_offers_the_candidates(self):
        AirtableAccount.objects.create(airtable_id="recE", name="Acme Corp East")
        AirtableAccount.objects.create(airtable_id="recW", name="Acme Corp West")
        r = run("create_action_item", self.user, task="t", account_name="Acme Corp")
        self.assertEqual((r["status"], r["account_name"]), ("created", None))
        self.assertEqual(set(r["account_candidates"]), {"Acme Corp East", "Acme Corp West"})

    def test_a_resolved_account_has_no_fallback_note(self):
        r = run("create_action_item", self.user, task="t", account_name="Orchestrator")
        self.assertNotIn("account_fallback", r)

    def test_airtable_still_receives_an_unlinked_item_on_fallback(self):
        run("create_action_item", self.user, task="t", account_name="Nonexistent Holdings")
        sent = self.push.call_args.args[0]
        self.assertIsNone(sent.account)


class UpdateActionItemAccountTests(_Base):
    def setUp(self):
        super().setUp()
        self.acct = AirtableAccount.objects.get(name="Siemens")
        self.item = AirtableActionItem.objects.create(airtable_id="recITEM", task="x", account=self.acct)

    def test_misheard_account_relinks(self):
        r = run("update_action_item", self.user, airtable_id="recITEM", account_name="Orchestrator")
        self.assertEqual(r["status"], "updated", r)
        self.item.refresh_from_db()
        self.assertEqual(self.item.account.name, "Archistrator")

    def test_unresolvable_name_does_not_unlink_the_item(self):
        # The old behaviour set account=None here, silently detaching the record.
        r = run("update_action_item", self.user, airtable_id="recITEM", account_name="Nonexistent Holdings")
        self.assertEqual(r["status"], "error")
        self.item.refresh_from_db()
        self.assertEqual(self.item.account, self.acct)

    def test_blank_name_still_clears_the_link_on_purpose(self):
        r = run("update_action_item", self.user, airtable_id="recITEM", account_name="")
        self.assertEqual(r["status"], "updated", r)
        self.item.refresh_from_db()
        self.assertIsNone(self.item.account)


class UpdateMeetingNotesOnlyTests(_Base):
    """
    update_meeting edits the Gong / Zoom summary and nothing else, matching the app.

    It used to re-file a meeting onto any account by (fuzzy) name. The app has no way to
    do that, so the agent no longer can either; an account_name argument is now refused
    by schema validation rather than silently moving the meeting.
    """

    def setUp(self):
        super().setUp()
        self.meeting = AirtableMeeting.objects.create(airtable_id="recMEET", name="Sync")

    def test_account_name_is_no_longer_accepted(self):
        r = run("update_meeting", self.user, airtable_id="recMEET", notes="x", account_name="Seamens")
        self.assertEqual(r["error_code"], "invalid_arguments")
        self.assertIn("account_name", r["message"])
        self.meeting.refresh_from_db()
        self.assertIsNone(self.meeting.account)

    def test_rename_and_redate_are_no_longer_accepted(self):
        for extra in ({"name": "Renamed"}, {"date": "2026-01-01T00:00:00"}):
            with self.subTest(extra=extra):
                r = run("update_meeting", self.user, airtable_id="recMEET", notes="x", **extra)
                self.assertEqual(r["error_code"], "invalid_arguments")
        self.meeting.refresh_from_db()
        self.assertEqual(self.meeting.name, "Sync")


class AirtableFailureReasonTests(_Base):
    def test_airtable_reason_is_returned_to_the_agent(self):
        self.push.return_value = None
        with patch("airtable_sync.write_back.last_airtable_error",
                   return_value='INVALID_MULTIPLE_CHOICE_OPTIONS: no select option "X"'):
            r = run("create_action_item", self.user, task="t")
        self.assertEqual(r["status"], "error")
        self.assertIn("INVALID_MULTIPLE_CHOICE_OPTIONS", r["error"])
        self.assertEqual(AirtableActionItem.objects.count(), 0)

    def test_failure_without_a_reason_keeps_the_generic_message(self):
        self.push.return_value = None
        with patch("airtable_sync.write_back.last_airtable_error", return_value=""):
            r = run("create_action_item", self.user, task="t")
        self.assertEqual(r["error"], "Airtable write failed — item not created.")


class CreateCalendarEventDateGuardTests(_Base):
    """
    A voice agent with no clock created "Monday, October 19th" in 2025. The row existed and the
    agent reported success, but it was a year in the past, so the caller never saw it.
    """

    def _create(self, start, end, **kw):
        return run("create_calendar_event", self.user, title="Review", start_datetime=start,
                   end_datetime=end, **kw)

    def _now(self, iso):
        from datetime import datetime, timezone
        return patch("agents.mcp_server._now", return_value=datetime.fromisoformat(iso).replace(tzinfo=timezone.utc))

    def test_a_meeting_a_year_in_the_past_is_refused_and_not_saved(self):
        from scheduler.models import CalendarEvent
        with self._now("2026-10-16T18:00:00"):
            r = self._create("2025-10-19T12:00:00", "2025-10-19T12:15:00")
        self.assertEqual(r["status"], "error")
        self.assertIn("past", r["error"])
        self.assertIn("2026-10-16", r["error"])  # tells the model today's date so it can correct itself
        self.assertEqual(CalendarEvent.objects.count(), 0)

    def test_a_future_meeting_is_created(self):
        from scheduler.models import CalendarEvent
        with self._now("2026-10-16T18:00:00"):
            r = self._create("2026-10-19T12:00:00", "2026-10-19T12:15:00")
        self.assertEqual(r["status"], "created", r)
        self.assertEqual(CalendarEvent.objects.count(), 1)

    def test_a_meeting_later_today_is_created(self):
        with self._now("2026-10-16T18:00:00"):
            self.assertEqual(self._create("2026-10-16T19:00:00", "2026-10-16T19:30:00")["status"], "created")

    def test_logging_something_that_already_happened_earlier_today_is_allowed(self):
        # Within the same day is a legitimate "I just had a call at 10" log, not a year slip.
        with self._now("2026-10-16T18:00:00"):
            self.assertEqual(self._create("2026-10-16T10:00:00", "2026-10-16T10:30:00")["status"], "created")

    def test_yesterday_is_still_allowed_for_backfilling(self):
        with self._now("2026-10-16T18:00:00"):
            self.assertEqual(self._create("2026-10-15T10:00:00", "2026-10-15T10:30:00")["status"], "created")

    def test_more_than_a_week_back_is_refused(self):
        with self._now("2026-10-16T18:00:00"):
            self.assertEqual(self._create("2026-10-01T10:00:00", "2026-10-01T10:30:00")["status"], "error")

    def test_an_end_before_the_start_is_refused(self):
        with self._now("2026-10-16T18:00:00"):
            r = self._create("2026-10-19T13:00:00", "2026-10-19T12:00:00")
        self.assertEqual(r["status"], "error")
        self.assertIn("after", r["error"])


class CalendarToolsLocalTimeTests(_Base):
    """
    A caller says "noon". The voice agent passes 2026-10-19T12:00:00 with no offset, and the
    server (TIME_ZONE = UTC) used to store that as noon UTC, i.e. 5am in Los Angeles, so the
    meeting appeared at the wrong hour. A time with no offset means the *caller's* local time.
    """

    def setUp(self):
        super().setUp()
        from team.models import UserProfile
        UserProfile.objects.create(user=self.user, timezone="PST")  # the real stored value
        self.user.refresh_from_db()

    def _now(self):
        from datetime import datetime, timezone
        return patch("agents.mcp_server._now", return_value=datetime(2026, 10, 16, 18, 0, tzinfo=timezone.utc))

    def test_a_naive_time_is_the_callers_local_time(self):
        from scheduler.models import CalendarEvent
        with self._now():
            r = run("create_calendar_event", self.user, title="Noon", start_datetime="2026-10-19T12:00:00",
                    end_datetime="2026-10-19T12:15:00")
        self.assertEqual(r["status"], "created", r)
        ev = CalendarEvent.objects.get(pk=r["id"])
        self.assertEqual(ev.start_datetime.isoformat(), "2026-10-19T19:00:00+00:00")  # noon PDT is 19:00Z
        self.assertEqual(ev.end_datetime.isoformat(), "2026-10-19T19:15:00+00:00")

    def test_an_explicit_offset_is_respected_not_reinterpreted(self):
        from scheduler.models import CalendarEvent
        with self._now():
            r = run("create_calendar_event", self.user, title="Zulu", start_datetime="2026-10-19T12:00:00Z",
                    end_datetime="2026-10-19T12:15:00Z")
        self.assertEqual(CalendarEvent.objects.get(pk=r["id"]).start_datetime.isoformat(), "2026-10-19T12:00:00+00:00")

    def test_the_result_reports_the_time_in_the_callers_zone(self):
        with self._now():
            r = run("create_calendar_event", self.user, title="Noon", start_datetime="2026-10-19T12:00:00",
                    end_datetime="2026-10-19T12:15:00")
        self.assertIn("12:00", r["start"])
        self.assertIn("-07:00", r["start"])

    def test_a_user_with_no_profile_still_works_as_utc(self):
        from team.models import UserProfile
        UserProfile.objects.filter(user=self.user).delete()
        self.user.refresh_from_db()
        with self._now():
            r = run("create_calendar_event", self.user, title="Noon", start_datetime="2026-10-19T12:00:00",
                    end_datetime="2026-10-19T12:15:00")
        self.assertEqual(r["status"], "created", r)

    def test_get_calendar_events_reads_a_local_day_in_the_callers_zone(self):
        from datetime import datetime, timezone
        from scheduler.models import CalendarEvent
        CalendarEvent.objects.create(owner=self.user, title="Local noon", calendar_id="primary",
                                     start_datetime=datetime(2026, 10, 19, 19, 0, tzinfo=timezone.utc),
                                     end_datetime=datetime(2026, 10, 19, 19, 30, tzinfo=timezone.utc))
        r = run("get_calendar_events", self.user, date_start="2026-10-19T00:00:00", date_end="2026-10-19T23:59:59")
        self.assertEqual([e["title"] for e in r], ["Local noon"])


class CreatedEventOriginTests(_Base):
    """
    Whether Google may email an event's guests turns on where the event came from, and the model
    default is "google" (fail closed). An event the voice agent creates is made *in AgentPM*, so
    it must say so — or `invite_to_meeting`, the very next step, would refuse it forever.
    """

    def test_a_voice_created_event_is_marked_as_agentpm_origin(self):
        from datetime import datetime, timezone
        from scheduler.models import CalendarEvent
        with patch("agents.mcp_server._now", return_value=datetime(2026, 10, 16, 18, 0, tzinfo=timezone.utc)):
            r = run("create_calendar_event", self.user, title="Review", start_datetime="2026-10-19T12:00:00Z",
                    end_datetime="2026-10-19T12:15:00Z")
        self.assertEqual(r["status"], "created", r)
        ev = CalendarEvent.objects.get(pk=r["id"])
        self.assertEqual(ev.origin, "agentpm")
        self.assertFalse(ev.invite_sent)

    def test_a_voice_created_event_with_no_guests_reaches_google_silently(self):
        # create_calendar_event now goes through the real REST view, which pushes primary events
        # to Google. It must do so without emailing anyone: the voice tool never passes approval.
        from datetime import datetime, timezone
        from unittest import mock
        from integrations.models import GoogleWriteLog, OAuthCredential
        OAuthCredential.objects.create(user=self.user, provider="google", access_token="a",
                                       refresh_token="r", scopes="x", is_active=True)

        class G:
            calls = []

            def events(self_inner):
                return self_inner

            def insert(self_inner, **kw):
                G.calls.append(kw)

                class R:
                    def execute(_s, num_retries=0):
                        return {"id": "g-voice"}
                return R()

        with patch("agents.mcp_server._now", return_value=datetime(2026, 10, 16, 18, 0, tzinfo=timezone.utc)), \
             mock.patch("integrations.google_api.credentials_for", return_value=object()), \
             mock.patch("integrations.google_api.persist_refreshed"), \
             mock.patch("googleapiclient.discovery.build", return_value=G()):
            r = run("create_calendar_event", self.user, title="Review", start_datetime="2026-10-19T12:00:00Z",
                    end_datetime="2026-10-19T12:15:00Z")
        self.assertEqual(r["status"], "created", r)
        self.assertEqual([c.get("sendUpdates") for c in G.calls], ["none"])
        self.assertEqual(GoogleWriteLog.objects.get().send_updates, "none")
