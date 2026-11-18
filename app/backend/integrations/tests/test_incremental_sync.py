"""
Incremental Google Calendar sync, the overlap lock, and token persistence.

The 5-minute job used to re-download ±90 days every run. It now asks Google only for what
changed (syncToken), and these tests pin the property the user asked for: past and future
weeks are preserved, and only the diff is applied.
"""

from datetime import datetime, timedelta, timezone as dt_tz
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from googleapiclient.errors import HttpError

from integrations import views as integrations_views
from integrations.models import OAuthCredential, SyncState
from scheduler.models import CalendarEvent

User = get_user_model()


def _http_error(status):
    resp = MagicMock(status=status)
    resp.reason = "x"
    return HttpError(resp, b"{}")


def _item(event_id, summary="Meeting", status="confirmed", days=1):
    start = timezone.now() + timedelta(days=days)
    return {
        "id": event_id, "summary": summary, "status": status,
        "start": {"dateTime": start.isoformat()},
        "end": {"dateTime": (start + timedelta(hours=1)).isoformat()},
    }


class _Base(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.user = User.objects.create_user("gsync", password="x")
        self.service = MagicMock()
        self.pages = []
        self.list_calls = []

        def list_(**params):
            self.list_calls.append(params)
            req = MagicMock()
            if self.pages and isinstance(self.pages[0], Exception):
                req.execute.side_effect = self.pages.pop(0)
            else:
                req.execute.return_value = self.pages.pop(0) if self.pages else {"items": []}
            return req

        self.service.events.return_value.list.side_effect = list_
        patch("googleapiclient.discovery.build", return_value=self.service).start()
        self.addCleanup(patch.stopall)

    def sync(self):
        return integrations_views._sync_google_calendar(self.user, MagicMock())

    def state(self):
        return SyncState.objects.get(user=self.user, provider="google", resource="calendar")

    def event(self, google_id, **kw):
        start = kw.pop("start", timezone.now() + timedelta(days=1))
        return CalendarEvent.objects.create(
            owner=self.user, google_event_id=google_id, title=kw.pop("title", "Local"),
            start_datetime=start, end_datetime=start + timedelta(hours=1), is_synced=True, **kw,
        )


class FullThenIncrementalTests(_Base):
    def test_first_sync_is_full_and_stores_the_change_token(self):
        self.pages = [{"items": [_item("g1")], "nextSyncToken": "TOKEN-1"}]
        result = self.sync()
        self.assertEqual(result["mode"], "full")
        self.assertIn("timeMin", self.list_calls[0])
        self.assertNotIn("syncToken", self.list_calls[0])
        self.assertEqual(self.state().sync_token, "TOKEN-1")

    def test_next_sync_sends_only_the_token(self):
        SyncState.objects.create(user=self.user, provider="google", resource="calendar",
                                 sync_token="TOKEN-1", last_synced_at=timezone.now())
        self.pages = [{"items": [], "nextSyncToken": "TOKEN-2"}]
        result = self.sync()
        self.assertEqual(result["mode"], "incremental")
        params = self.list_calls[0]
        self.assertEqual(params["syncToken"], "TOKEN-1")
        # Google rejects these alongside a syncToken.
        for forbidden in ("timeMin", "timeMax", "orderBy"):
            self.assertNotIn(forbidden, params)
        self.assertEqual(self.state().sync_token, "TOKEN-2")

    def test_token_only_comes_from_the_last_page(self):
        self.pages = [{"items": [_item("g1")], "nextPageToken": "p2"},
                      {"items": [_item("g2")], "nextSyncToken": "TOKEN-END"}]
        self.sync()
        self.assertEqual(self.list_calls[1]["pageToken"], "p2")
        self.assertEqual(self.state().sync_token, "TOKEN-END")


class IncrementalPreservesHistoryTests(_Base):
    def setUp(self):
        super().setUp()
        SyncState.objects.create(user=self.user, provider="google", resource="calendar",
                                 sync_token="T", last_synced_at=timezone.now())

    def test_events_absent_from_the_diff_are_untouched(self):
        past = self.event("g-past", title="Last month", start=timezone.now() - timedelta(days=40))
        future = self.event("g-future", title="Next month", start=timezone.now() + timedelta(days=40))
        # The diff mentions only one unrelated new event.
        self.pages = [{"items": [_item("g-new", summary="New")], "nextSyncToken": "T2"}]
        result = self.sync()
        self.assertEqual(result["created"], 1)
        self.assertEqual(result["deleted"], 0)
        self.assertTrue(CalendarEvent.objects.filter(pk=past.pk, title="Last month").exists())
        self.assertTrue(CalendarEvent.objects.filter(pk=future.pk, title="Next month").exists())

    def test_an_edit_in_google_updates_just_that_event(self):
        ev = self.event("g1", title="Old title")
        other = self.event("g2", title="Unchanged")
        self.pages = [{"items": [_item("g1", summary="New title")], "nextSyncToken": "T2"}]
        self.sync()
        ev.refresh_from_db(); other.refresh_from_db()
        self.assertEqual((ev.title, other.title), ("New title", "Unchanged"))

    def test_a_meeting_deleted_in_google_is_removed(self):
        ev = self.event("g-del")
        self.pages = [{"items": [{"id": "g-del", "status": "cancelled"}], "nextSyncToken": "T2"}]
        result = self.sync()
        self.assertEqual(result["deleted"], 1)
        self.assertFalse(CalendarEvent.objects.filter(pk=ev.pk).exists())

    def test_an_agentpm_block_deleted_in_google_is_kept_and_unlinked(self):
        """The DB is the original for scheduled action items; Google is only the copy."""
        block = self.event("g-block", calendar_id="work_tracking", agentpm_airtable_id="recA")
        self.pages = [{"items": [{"id": "g-block", "status": "cancelled"}], "nextSyncToken": "T2"}]
        with patch("integrations.views._push_new_agentpm_events"):
            result = self.sync()
        self.assertEqual(result["deleted"], 0)
        block.refresh_from_db()
        self.assertEqual((block.google_event_id, block.is_synced), ("", False))

    def test_another_users_event_with_the_same_google_id_is_never_touched(self):
        other = User.objects.create_user("someone", password="x")
        start = timezone.now() + timedelta(days=1)
        theirs = CalendarEvent.objects.create(owner=other, google_event_id="g-shared", title="Theirs",
                                              start_datetime=start, end_datetime=start + timedelta(hours=1))
        self.pages = [{"items": [{"id": "g-shared", "status": "cancelled"}], "nextSyncToken": "T2"}]
        self.sync()
        self.assertTrue(CalendarEvent.objects.filter(pk=theirs.pk).exists())

    def test_incremental_never_reconciles_by_absence(self):
        with patch("integrations.views._reconcile_missing_google_events") as reconcile:
            self.pages = [{"items": [_item("g1")], "nextSyncToken": "T2"}]
            self.sync()
        reconcile.assert_not_called()


class ExpiredTokenTests(_Base):
    def test_410_falls_back_to_a_full_sync(self):
        SyncState.objects.create(user=self.user, provider="google", resource="calendar",
                                 sync_token="STALE", last_synced_at=timezone.now())
        self.pages = [_http_error(410), {"items": [_item("g1")], "nextSyncToken": "FRESH"}]
        result = self.sync()
        self.assertEqual(result["mode"], "full")
        self.assertEqual(self.list_calls[0]["syncToken"], "STALE")
        self.assertIn("timeMin", self.list_calls[1])
        self.assertEqual(self.state().sync_token, "FRESH")

    def test_other_google_errors_still_raise(self):
        SyncState.objects.create(user=self.user, provider="google", resource="calendar",
                                 sync_token="T", last_synced_at=timezone.now())
        self.pages = [_http_error(500)]
        with self.assertRaises(HttpError):
            self.sync()
        self.assertEqual(self.state().sync_token, "T")  # kept for the next attempt

    def test_list_requests_use_googles_own_retry_policy(self):
        """429, 5xx and Google's rate-limit 403s are retried by googleapiclient itself."""
        requests = []
        original = self.service.events.return_value.list.side_effect

        def capture(**params):
            req = original(**params)
            requests.append(req)
            return req

        self.service.events.return_value.list.side_effect = capture
        self.pages = [{"items": [], "nextSyncToken": "T"}]
        self.sync()
        requests[0].execute.assert_called_once_with(num_retries=5)


class SyncLockAndCredentialTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.user = User.objects.create_user("glock", password="x")
        OAuthCredential.objects.create(
            user=self.user, provider="google", access_token="old-token", refresh_token="r",
            scopes="https://www.googleapis.com/auth/calendar",
            token_expiry=timezone.now() + timedelta(hours=1),
        )

    def test_overlapping_runs_are_skipped(self):
        from integrations.calendar_sync import _sync_lock_key, sync_user_calendar

        cache.add(_sync_lock_key(self.user), "schedule", timeout=60)
        with patch("integrations.views._sync_google_calendar") as run:
            result = sync_user_calendar(self.user, source="webhook")
        run.assert_not_called()
        self.assertEqual(result["skipped"], "already_running")

    def test_the_lock_is_released_after_a_failure(self):
        from integrations.calendar_sync import _sync_lock_key, sync_user_calendar

        with patch("integrations.views._sync_google_calendar", side_effect=RuntimeError("boom")):
            with self.assertRaises(RuntimeError):
                sync_user_calendar(self.user, source="schedule")
        self.assertIsNone(cache.get(_sync_lock_key(self.user)))

    def test_a_refreshed_token_is_saved_encrypted(self):
        from integrations.calendar_sync import sync_user_calendar

        def fake_sync(user, creds):
            creds.token = "new-token"  # what google-auth does on refresh
            creds.expiry = datetime.now(dt_tz.utc).replace(tzinfo=None) + timedelta(hours=1)
            return {"created": 0, "updated": 0, "deleted": 0, "unlinked": 0}

        with patch("integrations.views._sync_google_calendar", side_effect=fake_sync):
            sync_user_calendar(self.user, source="schedule")
        cred = OAuthCredential.objects.get(user=self.user)
        self.assertEqual(cred.access_token, "new-token")

    def test_a_revoked_grant_deactivates_the_connection(self):
        from google.auth.exceptions import RefreshError
        from integrations.calendar_sync import sync_user_calendar

        OAuthCredential.objects.filter(user=self.user).update(token_expiry=timezone.now() - timedelta(hours=1))
        with patch("google.oauth2.credentials.Credentials.refresh",
                   side_effect=RefreshError("invalid_grant: Token has been expired or revoked.")), \
             patch("integrations.views._sync_google_calendar") as run:
            result = sync_user_calendar(self.user, source="schedule")
        run.assert_not_called()
        self.assertEqual(result["skipped"], "google_disconnected")
        self.assertFalse(OAuthCredential.objects.get(user=self.user).is_active)

    def test_beat_job_skips_users_once_deactivated(self):
        from integrations.tasks import sync_all_google_calendars

        OAuthCredential.objects.filter(user=self.user).update(is_active=False)
        with patch("integrations.calendar_sync.sync_user_calendar") as run:
            sync_all_google_calendars()
        run.assert_not_called()


class SyncNeverEmailsGuestsTests(_Base):
    """
    The 5-minute sync runs forever and touches every event, so it is the one place a bug can
    email guests repeatedly. These tests pin that it never can: events it pulls are Google's
    (origin "google"), it never marks a send, and it never asks Google to notify.
    """

    GUESTS = [{"email": f"g{i}@x.com", "displayName": "", "responseStatus": "needsAction"} for i in range(10)]

    def _item_with_guests(self, event_id, **kw):
        item = _item(event_id, **kw)
        item["attendees"] = [{"email": a["email"]} for a in self.GUESTS]
        return item

    def test_an_event_pulled_from_google_is_created_with_google_origin(self):
        self.pages = [{"items": [self._item_with_guests("g-new")], "nextSyncToken": "T1"}]
        self.sync()
        ev = CalendarEvent.objects.get(google_event_id="g-new")
        self.assertEqual(ev.origin, "google")
        self.assertFalse(ev.invite_sent)
        self.assertEqual(len(ev.attendees), 10)

    def test_a_pulled_update_does_not_change_an_agentpm_events_origin(self):
        ev = self.event("g-mine", origin="agentpm", invite_sent=True)
        self.pages = [{"items": [_item("g-mine", summary="Renamed in Google")], "nextSyncToken": "T2"}]
        self.sync()
        ev.refresh_from_db()
        self.assertEqual((ev.title, ev.origin, ev.invite_sent), ("Renamed in Google", "agentpm", True))

    def test_a_pulled_update_never_resets_the_sent_flag(self):
        ev = self.event("g-sent", origin="agentpm", invite_sent=True, invite_sent_at=timezone.now())
        self.pages = [{"items": [self._item_with_guests("g-sent")], "nextSyncToken": "T2"}]
        self.sync()
        ev.refresh_from_db()
        self.assertTrue(ev.invite_sent)
        self.assertIsNotNone(ev.invite_sent_at)

    def test_pushing_recent_edits_back_to_google_never_notifies(self):
        # PHASE 1 pushes every recently-modified event on each run.
        state, _ = SyncState.objects.get_or_create(user=self.user, provider="google", resource="calendar")
        SyncState.objects.filter(pk=state.pk).update(last_synced_at=timezone.now() - timedelta(minutes=10),
                                                     sync_token="T1")
        ev = self.event("g-edit", origin="agentpm", attendees=self.GUESTS)
        CalendarEvent.objects.filter(pk=ev.pk).update(updated_at=timezone.now())
        self.pages = [{"items": [], "nextSyncToken": "T2"}]
        writes = []

        def record(**kw):
            writes.append(kw)
            req = MagicMock()
            req.execute.return_value = {"id": "g-edit"}
            return req

        self.service.events.return_value.patch.side_effect = record
        self.sync()
        self.assertTrue(writes, "the recent edit should still be pushed")
        self.assertEqual({w.get("sendUpdates") for w in writes}, {"none"})

    def test_a_hundred_sync_runs_send_no_notifications(self):
        ev = self.event("g-loop", origin="agentpm", attendees=self.GUESTS)
        state, _ = SyncState.objects.get_or_create(user=self.user, provider="google", resource="calendar")
        SyncState.objects.filter(pk=state.pk).update(sync_token="T1")
        writes = []

        def record(**kw):
            writes.append(kw)
            req = MagicMock()
            req.execute.return_value = {"id": "g-loop"}
            return req

        self.service.events.return_value.patch.side_effect = record
        self.service.events.return_value.insert.side_effect = record
        for _ in range(100):
            SyncState.objects.filter(pk=state.pk).update(last_synced_at=timezone.now() - timedelta(minutes=5))
            CalendarEvent.objects.filter(pk=ev.pk).update(updated_at=timezone.now())
            self.pages = [{"items": [self._item_with_guests("g-loop")], "nextSyncToken": "T1"}]
            self.sync()
        self.assertNotIn("all", [w.get("sendUpdates") for w in writes])
        from integrations.models import GoogleWriteLog
        self.assertFalse(GoogleWriteLog.objects.filter(send_updates="all").exists())


class SyncEchoLoopTests(_Base):
    """
    2026-11-03: ~710 pulled events were pushed straight back to Google, every 5 minutes, ~30
    times in a row (61,000 audited writes). Rows created by the pull got an ``updated_at`` after
    the sync's own ``now``, so the next run's PHASE 1 read them as "edited since last sync"; the
    pushes outlasted the Celery time limit, ``last_synced_at`` was never saved, and the next run
    started again. These tests pin both halves of the cure.
    """

    def _push_calls(self):
        return self.service.events.return_value.patch.call_count + \
            self.service.events.return_value.update.call_count

    def test_events_created_by_a_pull_are_not_pushed_back_on_the_next_run(self):
        SyncState.objects.create(user=self.user, provider="google", resource="calendar",
                                 sync_token="T", last_synced_at=timezone.now() - timedelta(minutes=5))
        self.pages = [{"items": [_item(f"g{i}") for i in range(40)], "nextSyncToken": "T2"}]
        self.assertEqual(self.sync()["created"], 40)

        self.pages = [{"items": [], "nextSyncToken": "T3"}]
        self.sync()
        self.assertEqual(self._push_calls(), 0, "a pulled event was echoed back to Google")

    def test_a_real_local_edit_after_the_pull_is_still_pushed(self):
        SyncState.objects.create(user=self.user, provider="google", resource="calendar",
                                 sync_token="T", last_synced_at=timezone.now() - timedelta(minutes=5))
        self.pages = [{"items": [_item("g1")], "nextSyncToken": "T2"}]
        self.sync()
        row = CalendarEvent.objects.get(google_event_id="g1")
        row.title = "Edited by the user"
        row.save()  # a genuine edit: auto_now moves updated_at past last_synced_at

        self.pages = [{"items": [], "nextSyncToken": "T3"}]
        with patch.object(integrations_views, "_push_event_to_google") as push:
            self.sync()
        self.assertEqual(push.call_count, 1)

    def test_a_mass_of_apparent_edits_is_refused_not_pushed(self):
        """The breaker: no 5-minute window holds hundreds of genuine edits."""
        SyncState.objects.create(user=self.user, provider="google", resource="calendar",
                                 sync_token="T", last_synced_at=timezone.now() - timedelta(minutes=5))
        for i in range(integrations_views.MAX_PUSH_PER_SYNC + 1):
            self.event(f"echo{i}")  # auto_now puts every one after last_synced_at
        self.pages = [{"items": [], "nextSyncToken": "T2"}]
        with patch.object(integrations_views, "_push_event_to_google") as push, \
                self.assertLogs("integrations.views", level="ERROR"):
            self.sync()
        push.assert_not_called()

    def test_a_normal_handful_of_edits_is_below_the_breaker(self):
        SyncState.objects.create(user=self.user, provider="google", resource="calendar",
                                 sync_token="T", last_synced_at=timezone.now() - timedelta(minutes=5))
        for i in range(5):
            self.event(f"edit{i}")
        self.pages = [{"items": [], "nextSyncToken": "T2"}]
        with patch.object(integrations_views, "_push_event_to_google") as push:
            self.sync()
        self.assertEqual(push.call_count, 5)


class SyncTwinGuardTests(_Base):
    """
    2026-11-16: two stale workers each inserted the same unpushed AgentPM block, so Google held
    two events for one row and the pull drew two identical blocks. The pull now removes the extra
    Google event (through the gateway) instead of importing it.
    """

    def setUp(self):
        super().setUp()
        SyncState.objects.create(user=self.user, provider="google", resource="calendar",
                                 sync_token="T", last_synced_at=timezone.now() - timedelta(minutes=5))
        self.start = (timezone.now() + timedelta(days=2)).replace(second=0, microsecond=0)

    def _marked(self, gid, airtable_id="rec1", start=None, source="action_item", **kw):
        start = start or self.start
        item = {
            "id": gid, "summary": kw.pop("summary", "⏲ Task"), "status": "confirmed",
            "start": {"dateTime": start.isoformat()},
            "end": {"dateTime": (start + timedelta(minutes=15)).isoformat()},
        }
        if airtable_id is not None:
            item["extendedProperties"] = {"private": {
                "agentpm_source": source, "agentpm_airtable_id": airtable_id}}
        return item

    def _original(self, gid="orig", **kw):
        return CalendarEvent.objects.create(
            owner=self.user, google_event_id=gid, title="⏲ Task", calendar_id="work_tracking",
            agentpm_airtable_id="rec1", start_datetime=self.start,
            end_datetime=self.start + timedelta(minutes=15), is_synced=True, origin="agentpm", **kw)

    def _deleted_ids(self):
        from integrations.models import GoogleWriteLog
        return list(GoogleWriteLog.objects.filter(action="delete").values_list("google_event_id", flat=True))

    def _run(self, items):
        self.pages = [{"items": items, "nextSyncToken": "T2"}]
        return self.sync()

    def test_a_twin_is_deleted_in_google_and_not_imported(self):
        orig = self._original()
        self._run([self._marked("twin")])
        self.assertEqual(CalendarEvent.objects.filter(owner=self.user, agentpm_airtable_id="rec1").count(), 1)
        self.assertEqual(self._deleted_ids(), ["twin"])
        delete = self.service.events.return_value.delete
        delete.assert_called_once()
        self.assertEqual(delete.call_args.kwargs["eventId"], "twin")
        self.assertEqual(delete.call_args.kwargs["sendUpdates"], "none")
        orig.refresh_from_db()
        self.assertEqual(orig.google_event_id, "orig")

    def test_the_linked_original_is_never_deleted(self):
        self._original()
        self._run([self._marked("orig")])
        self.assertEqual(self._deleted_ids(), [])
        self.assertEqual(CalendarEvent.objects.filter(google_event_id="orig").count(), 1)

    def test_an_unmarked_event_with_the_same_title_is_imported(self):
        self._original()
        self._run([self._marked("real", airtable_id=None, summary="⏲ Task")])
        self.assertEqual(self._deleted_ids(), [])
        self.assertTrue(CalendarEvent.objects.filter(google_event_id="real").exists())

    def test_two_schedulings_at_different_minutes_are_both_kept(self):
        self._original()
        later = self.start + timedelta(minutes=15)
        self._run([self._marked("second", start=later)])
        self.assertEqual(self._deleted_ids(), [])
        self.assertTrue(CalendarEvent.objects.filter(google_event_id="second").exists())

    def test_a_row_still_being_claimed_is_not_a_twin_original(self):
        self._original(gid="claiming:abc")
        self._run([self._marked("inflight")])
        self.assertEqual(self._deleted_ids(), [])
        self.assertTrue(CalendarEvent.objects.filter(google_event_id="inflight").exists())

    def test_another_users_row_is_not_an_original(self):
        other = User.objects.create_user("other", password="x")
        CalendarEvent.objects.create(
            owner=other, google_event_id="theirs", calendar_id="work_tracking", title="t",
            agentpm_airtable_id="rec1", start_datetime=self.start,
            end_datetime=self.start + timedelta(minutes=15))
        self._run([self._marked("mine")])
        self.assertEqual(self._deleted_ids(), [])
        self.assertTrue(CalendarEvent.objects.filter(owner=self.user, google_event_id="mine").exists())

    def test_idempotent_on_rerun(self):
        self._original()
        self._run([self._marked("twin")])
        self._run([self._marked("twin")])  # Google re-delivers the same twin
        self.assertEqual(CalendarEvent.objects.filter(owner=self.user, agentpm_airtable_id="rec1").count(), 1)
        self.assertEqual(self._deleted_ids().count("twin"), 2)  # retried harmlessly, never the original
        self.assertNotIn("orig", self._deleted_ids())

    def test_a_gateway_failure_is_non_fatal_and_leaves_both(self):
        self._original()
        self.service.events.return_value.delete.return_value.execute.side_effect = RuntimeError("boom")
        with self.assertLogs("integrations.views", level="ERROR"):
            result = self._run([self._marked("twin")])
        self.assertEqual(result["created"], 1)
        self.assertEqual(CalendarEvent.objects.filter(owner=self.user, agentpm_airtable_id="rec1").count(), 2)

    def test_the_per_sync_cap_stops_deleting(self):
        cap = integrations_views.MAX_TWIN_DELETES_PER_SYNC
        items = []
        for i in range(cap + 2):
            start = self.start + timedelta(minutes=15 * i)
            CalendarEvent.objects.create(
                owner=self.user, google_event_id=f"o{i}", calendar_id="work_tracking", title="t",
                agentpm_airtable_id="rec1", start_datetime=start, end_datetime=start + timedelta(minutes=15))
            items.append(self._marked(f"t{i}", start=start))
        self._run(items)
        self.assertEqual(len(self._deleted_ids()), cap)
