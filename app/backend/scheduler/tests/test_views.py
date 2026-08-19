"""Tests for scheduler.ReminderViewSet — permission scoping and CRUD."""

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APITestCase

from scheduler.models import CalendarEvent, MeetingNote, Reminder
from scheduler.views import CalendarEventViewSet
from team.models import UserProfile

User = get_user_model()

REMINDERS_LIST_URL = "/api/v1/scheduler/reminders/"


def reminder_detail_url(pk):
    return f"/api/v1/scheduler/reminders/{pk}/"


def reminder_action_url(pk, action):
    return f"/api/v1/scheduler/reminders/{pk}/{action}/"


def _make_user(username, is_staff=False):
    user = User.objects.create_user(
        username=username, email=f"{username}@example.com", password="pass"
    )
    user.is_staff = is_staff
    user.save()
    if is_staff:
        UserProfile.objects.create(user=user, staff_view_override=True)
    return user


def _make_reminder(user, title="Test Reminder", status="pending"):
    return Reminder.objects.create(
        created_by=user,
        title=title,
        body="",
        resource_type="general",
        due_at="2026-08-01T09:00:00Z",
        status=status,
    )


class ReminderViewSetTest(APITestCase):

    def setUp(self):
        self.staff = _make_user("staffuser", is_staff=True)
        self.user1 = _make_user("user1")
        self.user2 = _make_user("user2")

        self.r1 = _make_reminder(self.user1, "User1 Reminder A")
        self.r2 = _make_reminder(self.user1, "User1 Reminder B")
        self.r3 = _make_reminder(self.user2, "User2 Reminder")

    # ── LIST ───────────────────────────────────────────────────────────────────

    def test_unauthenticated_list_returns_401(self):
        resp = self.client.get(REMINDERS_LIST_URL)
        self.assertEqual(resp.status_code, 401)

    def test_non_staff_sees_only_own_reminders(self):
        self.client.force_authenticate(user=self.user1)
        resp = self.client.get(REMINDERS_LIST_URL)
        self.assertEqual(resp.status_code, 200)
        ids = [r["id"] for r in resp.data["results"]]
        self.assertIn(self.r1.id, ids)
        self.assertIn(self.r2.id, ids)
        self.assertNotIn(self.r3.id, ids)

    def test_staff_sees_all_reminders(self):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.get(REMINDERS_LIST_URL)
        self.assertEqual(resp.status_code, 200)
        # Staff's get_queryset still filters by created_by=request.user.
        # The ReminderViewSet does NOT use _staff_sees_all — it always scopes by owner.
        # This tests that staff users see THEIR OWN reminders (they have none in setUp).
        ids = [r["id"] for r in resp.data["results"]]
        self.assertNotIn(self.r1.id, ids)
        self.assertNotIn(self.r3.id, ids)

    def test_status_filter_returns_matching_reminders(self):
        dismissed = _make_reminder(self.user1, "Dismissed", status="dismissed")
        self.client.force_authenticate(user=self.user1)
        resp = self.client.get(REMINDERS_LIST_URL, {"status": "dismissed"})
        ids = [r["id"] for r in resp.data["results"]]
        self.assertIn(dismissed.id, ids)
        self.assertNotIn(self.r1.id, ids)

    # ── CREATE ─────────────────────────────────────────────────────────────────

    def test_create_sets_correct_owner(self):
        self.client.force_authenticate(user=self.user1)
        resp = self.client.post(REMINDERS_LIST_URL, {
            "title": "New Reminder",
            "body": "",
            "resource_type": "general",
            "due_at": "2026-09-01T09:00:00Z",
            "notify_in_app": True,
            "notify_slack": False,
            "notify_push": False,
            "notify_sms": False,
        }, format="json")
        self.assertEqual(resp.status_code, 201)
        created = Reminder.objects.get(pk=resp.data["id"])
        self.assertEqual(created.created_by, self.user1)

    def test_create_unauthenticated_returns_401(self):
        resp = self.client.post(REMINDERS_LIST_URL, {
            "title": "x", "due_at": "2026-09-01T09:00:00Z",
        }, format="json")
        self.assertEqual(resp.status_code, 401)

    # ── UPDATE ─────────────────────────────────────────────────────────────────

    def test_owner_can_update_own_reminder(self):
        self.client.force_authenticate(user=self.user1)
        resp = self.client.patch(reminder_detail_url(self.r1.id), {"title": "Updated"}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.r1.refresh_from_db()
        self.assertEqual(self.r1.title, "Updated")

    def test_non_owner_cannot_update_others_reminder(self):
        self.client.force_authenticate(user=self.user2)
        resp = self.client.patch(reminder_detail_url(self.r1.id), {"title": "Hack"}, format="json")
        # r1 is not in user2's queryset — 404
        self.assertEqual(resp.status_code, 404)

    # ── DELETE ─────────────────────────────────────────────────────────────────

    def test_owner_can_delete_own_reminder(self):
        self.client.force_authenticate(user=self.user1)
        resp = self.client.delete(reminder_detail_url(self.r1.id))
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(Reminder.objects.filter(pk=self.r1.id).exists())

    def test_non_owner_cannot_delete_others_reminder(self):
        self.client.force_authenticate(user=self.user2)
        resp = self.client.delete(reminder_detail_url(self.r1.id))
        self.assertEqual(resp.status_code, 404)
        self.assertTrue(Reminder.objects.filter(pk=self.r1.id).exists())

    # ── DISMISS action ─────────────────────────────────────────────────────────

    def test_owner_can_dismiss_reminder(self):
        self.client.force_authenticate(user=self.user1)
        resp = self.client.post(reminder_action_url(self.r1.id, "dismiss"))
        self.assertEqual(resp.status_code, 200)
        self.r1.refresh_from_db()
        self.assertEqual(self.r1.status, "dismissed")

    def test_non_owner_cannot_dismiss_others_reminder(self):
        self.client.force_authenticate(user=self.user2)
        resp = self.client.post(reminder_action_url(self.r1.id, "dismiss"))
        self.assertEqual(resp.status_code, 404)
        self.r1.refresh_from_db()
        self.assertNotEqual(self.r1.status, "dismissed")


# ── MeetingNoteViewSet — batched ?event= filter ────────────────────────────────


MEETING_NOTES_URL = "/api/v1/scheduler/meeting-notes/"


def _make_event(owner, title="Event", airtable_id=""):
    return CalendarEvent.objects.create(
        owner=owner,
        title=title,
        start_datetime="2026-08-01T09:00:00Z",
        end_datetime="2026-08-01T10:00:00Z",
        agentpm_airtable_id=airtable_id,
    )


def _make_note(event, author, text):
    return MeetingNote.objects.create(event=event, author=author, html=text, text=text)


class MeetingNoteBatchedEventFilterTest(APITestCase):
    """?event= accepts a comma-separated batch so callers fetch notes for many
    events in one request instead of one request per event (which tripped the
    DRF user throttle)."""

    def setUp(self):
        # These tests issue several list calls; clear DRF's throttle counters so a
        # full-suite run doesn't leak 429s into these assertions.
        cache.clear()
        self.user1 = _make_user("notes_user1")
        self.user2 = _make_user("notes_user2")
        self.staff = _make_user("notes_staff", is_staff=True)

        self.ev1 = _make_event(self.user1, "Event One")
        self.ev2 = _make_event(self.user1, "Event Two")
        self.ev3 = _make_event(self.user1, "Event Three")
        self.other_ev = _make_event(self.user2, "Other User Event")

        self.n1 = _make_note(self.ev1, self.user1, "note on one")
        self.n2 = _make_note(self.ev2, self.user1, "note on two")
        self.n3 = _make_note(self.ev2, self.user1, "second note on two")
        self.n4 = _make_note(self.ev3, self.user1, "note on three")
        self.other_note = _make_note(self.other_ev, self.user2, "other user note")

    def test_unauthenticated_returns_401(self):
        resp = self.client.get(MEETING_NOTES_URL, {"event": f"{self.ev1.id},{self.ev2.id}"})
        self.assertEqual(resp.status_code, 401)

    def test_single_event_filter_unchanged(self):
        """The pre-existing single-value form must keep behaving identically."""
        self.client.force_authenticate(user=self.user1)
        resp = self.client.get(MEETING_NOTES_URL, {"event": str(self.ev1.id)})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual([n["id"] for n in resp.data["results"]], [self.n1.id])

    def test_batched_filter_returns_notes_for_all_listed_events(self):
        self.client.force_authenticate(user=self.user1)
        resp = self.client.get(
            MEETING_NOTES_URL, {"event": f"{self.ev1.id},{self.ev2.id}"}
        )
        self.assertEqual(resp.status_code, 200)
        ids = {n["id"] for n in resp.data["results"]}
        self.assertEqual(ids, {self.n1.id, self.n2.id, self.n3.id})
        # Excluded event's notes must not leak in.
        self.assertNotIn(self.n4.id, ids)

    def test_batched_results_carry_event_id_for_client_side_grouping(self):
        """Callers group the flat response by `event` — that field must be present."""
        self.client.force_authenticate(user=self.user1)
        resp = self.client.get(
            MEETING_NOTES_URL, {"event": f"{self.ev1.id},{self.ev2.id}"}
        )
        by_event = {}
        for note in resp.data["results"]:
            by_event.setdefault(note["event"], []).append(note["id"])
        self.assertEqual(by_event[self.ev1.id], [self.n1.id])
        self.assertEqual(sorted(by_event[self.ev2.id]), sorted([self.n2.id, self.n3.id]))

    def test_batched_filter_does_not_widen_owner_scoping(self):
        """The security guard: batching must not expose another owner's event notes,
        even when their event ID is named explicitly in the batch."""
        self.client.force_authenticate(user=self.user1)
        resp = self.client.get(
            MEETING_NOTES_URL, {"event": f"{self.ev1.id},{self.other_ev.id}"}
        )
        self.assertEqual(resp.status_code, 200)
        ids = {n["id"] for n in resp.data["results"]}
        self.assertEqual(ids, {self.n1.id})
        self.assertNotIn(self.other_note.id, ids)

    def test_staff_sees_all_events_in_batch(self):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.get(
            MEETING_NOTES_URL, {"event": f"{self.ev1.id},{self.other_ev.id}"}
        )
        self.assertEqual(resp.status_code, 200)
        ids = {n["id"] for n in resp.data["results"]}
        self.assertEqual(ids, {self.n1.id, self.other_note.id})

    def test_whitespace_and_empty_tokens_are_tolerated(self):
        self.client.force_authenticate(user=self.user1)
        resp = self.client.get(
            MEETING_NOTES_URL, {"event": f" {self.ev1.id} ,,{self.ev2.id},"}
        )
        self.assertEqual(resp.status_code, 200)
        ids = {n["id"] for n in resp.data["results"]}
        self.assertEqual(ids, {self.n1.id, self.n2.id, self.n3.id})

    def test_unparseable_event_filter_returns_empty_not_everything(self):
        """A present-but-garbage filter must narrow to nothing rather than falling
        through and returning every note the caller can see."""
        self.client.force_authenticate(user=self.user1)
        resp = self.client.get(MEETING_NOTES_URL, {"event": "not-an-id"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["results"], [])

    def test_page_size_now_takes_effect_for_large_batches(self):
        """The viewset carries ClientPageSizePagination so a batch spanning many
        events isn't silently truncated at the project default of 50."""
        self.client.force_authenticate(user=self.user1)
        for i in range(60):
            _make_note(self.ev1, self.user1, f"bulk note {i}")
        resp = self.client.get(
            MEETING_NOTES_URL, {"event": str(self.ev1.id), "page_size": "500"}
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data["results"]), 61)


# ── Meeting attendance ────────────────────────────────────────────────────────

def attendance_url(pk):
    return f"/api/v1/scheduler/events/{pk}/attendance/"


def _make_event(user, title="Q3 Planning", **kwargs):
    return CalendarEvent.objects.create(
        owner=user,
        title=title,
        start_datetime="2026-08-20T10:00:00Z",
        end_datetime="2026-08-20T11:00:00Z",
        **kwargs,
    )


class CalendarEventAttendanceTest(APITestCase):
    """`CalendarEvent.attended` — the owner's Attended / Did not attend record.

    This lived only in CalendarPage's `absentEventIds` useState, so it evaporated on
    navigation and refresh. It is now a tri-state column: None (never recorded, shown
    as Attended), True, or False.

    Written through a dedicated owner-scoped action rather than the generic PATCH,
    which runs RequireAccountMembershipMixin and would 403 a user marking their own
    meeting when it is linked to an account they aren't a member of.
    """

    def setUp(self):
        cache.clear()
        self.user = _make_user("attend_user")
        self.other = _make_user("attend_other")
        self.event = _make_event(self.user)
        self.client.force_authenticate(user=self.user)

    def test_requires_auth(self):
        self.client.force_authenticate(user=None)
        resp = self.client.patch(attendance_url(self.event.pk), {"attended": False}, format="json")
        self.assertEqual(resp.status_code, 401)

    def test_defaults_to_none(self):
        self.assertIsNone(self.event.attended)
        resp = self.client.get("/api/v1/scheduler/events/")
        self.assertIsNone(resp.data[0]["attended"])

    def test_mark_did_not_attend(self):
        resp = self.client.patch(attendance_url(self.event.pk), {"attended": False}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data["attended"])
        self.event.refresh_from_db()
        self.assertIs(self.event.attended, False)

    def test_mark_attended(self):
        resp = self.client.patch(attendance_url(self.event.pk), {"attended": True}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.event.refresh_from_db()
        self.assertIs(self.event.attended, True)

    def test_clear_attendance(self):
        self.client.patch(attendance_url(self.event.pk), {"attended": False}, format="json")
        resp = self.client.patch(attendance_url(self.event.pk), {"attended": None}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.event.refresh_from_db()
        self.assertIsNone(self.event.attended)

    def test_toggling_back_and_forth_persists_each_time(self):
        for value in (False, True, False):
            self.client.patch(attendance_url(self.event.pk), {"attended": value}, format="json")
            self.event.refresh_from_db()
            self.assertIs(self.event.attended, value)

    def test_survives_a_relist(self):
        """The regression: the status must still be there on the next page load."""
        self.client.patch(attendance_url(self.event.pk), {"attended": False}, format="json")
        resp = self.client.get("/api/v1/scheduler/events/")
        self.assertEqual(resp.status_code, 200)
        self.assertIs(resp.data[0]["attended"], False)

    def test_rejects_a_non_boolean(self):
        for bad in ["yes", 1, 0, "false", {}]:
            with self.subTest(value=bad):
                resp = self.client.patch(attendance_url(self.event.pk), {"attended": bad}, format="json")
                self.assertEqual(resp.status_code, 400)

    def test_requires_the_field(self):
        resp = self.client.patch(attendance_url(self.event.pk), {}, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_cannot_touch_another_users_event(self):
        theirs = _make_event(self.other, title="Their meeting")
        resp = self.client.patch(attendance_url(theirs.pk), {"attended": False}, format="json")
        self.assertEqual(resp.status_code, 404)
        theirs.refresh_from_db()
        self.assertIsNone(theirs.attended)

    def test_works_on_an_event_linked_to_a_non_member_account(self):
        """The reason this is an action and not the generic PATCH."""
        from accounts.models import Account

        account = Account.objects.create(company_name="Someone Else Corp")
        event = _make_event(self.user, title="Linked", account=account)
        resp = self.client.patch(attendance_url(event.pk), {"attended": False}, format="json")
        self.assertEqual(resp.status_code, 200)
        event.refresh_from_db()
        self.assertIs(event.attended, False)

    def test_generic_patch_cannot_set_attended(self):
        """`attended` is read-only on the serializer — only the action writes it."""
        resp = self.client.patch(
            f"/api/v1/scheduler/events/{self.event.pk}/", {"attended": False}, format="json"
        )
        self.assertIn(resp.status_code, (200, 403))
        self.event.refresh_from_db()
        self.assertIsNone(self.event.attended)

    def test_google_resync_does_not_clobber_attendance(self):
        """A re-sync must not silently mark a skipped meeting as attended again."""
        from unittest.mock import MagicMock, patch as mock_patch
        from integrations import views as integrations_views

        event = _make_event(self.user, google_event_id="g-attend-1")
        self.client.patch(attendance_url(event.pk), {"attended": False}, format="json")

        service = MagicMock()
        service.events.return_value.list.return_value.execute.return_value = {
            "items": [{
                "id": "g-attend-1",
                "summary": "Q3 Planning",
                "status": "confirmed",
                "start": {"dateTime": "2026-08-20T10:00:00+00:00"},
                "end": {"dateTime": "2026-08-20T11:00:00+00:00"},
            }],
            "nextPageToken": None,
        }
        with mock_patch("googleapiclient.discovery.build", return_value=service):
            integrations_views._sync_google_calendar(self.user, MagicMock())

        event.refresh_from_db()
        self.assertIs(event.attended, False)


# ── Event details editing ─────────────────────────────────────────────────────

def details_url(pk):
    return f"/api/v1/scheduler/events/{pk}/details/"


class CalendarEventDetailsUpdateTest(APITestCase):
    """`PATCH /events/<pk>/details/` — the owner editing their own event.

    Before this, the calendar's right-click "Edit" opened a panel with no edit form and
    no save path for an ordinary event; `event_category` was write-once at creation.

    A dedicated action rather than the generic PATCH for the same reason `attendance` is
    one: the generic path runs RequireAccountMembershipMixin, which resolves the account
    off the existing instance and so 403s a user editing their *own* meeting whenever it
    is linked to an account they are not a team member of.
    """

    def setUp(self):
        cache.clear()
        self.user = _make_user("details_user")
        self.other = _make_user("details_other")
        self.event = _make_event(self.user)
        self.client.force_authenticate(user=self.user)

    def test_requires_auth(self):
        self.client.force_authenticate(user=None)
        resp = self.client.patch(details_url(self.event.pk), {"title": "Nope"}, format="json")
        self.assertEqual(resp.status_code, 401)

    def test_edits_title_description_and_location(self):
        resp = self.client.patch(
            details_url(self.event.pk),
            {"title": "Renamed", "description": "Notes here", "location": "Room 4"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["title"], "Renamed")
        self.event.refresh_from_db()
        self.assertEqual(self.event.title, "Renamed")
        self.assertEqual(self.event.description, "Notes here")
        self.assertEqual(self.event.location, "Room 4")

    def test_edits_times(self):
        resp = self.client.patch(
            details_url(self.event.pk),
            {"start_datetime": "2026-08-20T14:00:00Z", "end_datetime": "2026-08-20T15:00:00Z"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.event.refresh_from_db()
        self.assertEqual(self.event.start_datetime.hour, 14)

    def test_converts_the_event_type(self):
        resp = self.client.patch(
            details_url(self.event.pk), {"event_category": "task"}, format="json"
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["event_category"], "task")
        self.event.refresh_from_db()
        self.assertEqual(self.event.event_category, "task")

    def test_accepts_every_model_category(self):
        for value, _label in CalendarEvent.EVENT_CATEGORY_CHOICES:
            with self.subTest(category=value):
                resp = self.client.patch(
                    details_url(self.event.pk), {"event_category": value}, format="json"
                )
                self.assertEqual(resp.status_code, 200)
                self.event.refresh_from_db()
                self.assertEqual(self.event.event_category, value)

    def test_rejects_an_unknown_category(self):
        """`action_item` is a frontend-only colorable type, not a DB category."""
        for bad in ["action_item", "reminder", "Task", "", "nonsense"]:
            with self.subTest(category=bad):
                resp = self.client.patch(
                    details_url(self.event.pk), {"event_category": bad}, format="json"
                )
                self.assertEqual(resp.status_code, 400)
        self.event.refresh_from_db()
        self.assertEqual(self.event.event_category, "meeting")

    def test_rejects_end_before_start(self):
        resp = self.client.patch(
            details_url(self.event.pk),
            {"start_datetime": "2026-08-20T15:00:00Z", "end_datetime": "2026-08-20T14:00:00Z"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.event.refresh_from_db()
        self.assertEqual(self.event.start_datetime.hour, 10)

    def test_rejects_a_new_start_after_the_existing_end(self):
        """A one-sided patch is still checked against the value already stored."""
        resp = self.client.patch(
            details_url(self.event.pk), {"start_datetime": "2026-08-20T23:00:00Z"}, format="json"
        )
        self.assertEqual(resp.status_code, 400)

    def test_rejects_a_non_boolean_all_day(self):
        for bad in [1, 0, "yes", {}]:
            with self.subTest(value=bad):
                resp = self.client.patch(
                    details_url(self.event.pk), {"all_day": bad}, format="json"
                )
                self.assertEqual(resp.status_code, 400)

    def test_ignores_fields_outside_the_whitelist(self):
        resp = self.client.patch(
            details_url(self.event.pk),
            {"title": "Kept", "owner": self.other.pk, "is_synced": True, "attended": False},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.event.refresh_from_db()
        self.assertEqual(self.event.title, "Kept")
        self.assertEqual(self.event.owner, self.user)
        self.assertFalse(self.event.is_synced)
        self.assertIsNone(self.event.attended)

    def test_requires_at_least_one_editable_field(self):
        resp = self.client.patch(details_url(self.event.pk), {"nope": 1}, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_cannot_touch_another_users_event(self):
        theirs = _make_event(self.other, title="Their meeting")
        resp = self.client.patch(details_url(theirs.pk), {"title": "Hijacked"}, format="json")
        self.assertEqual(resp.status_code, 404)
        theirs.refresh_from_db()
        self.assertEqual(theirs.title, "Their meeting")

    def test_works_on_an_event_linked_to_a_non_member_account(self):
        """The reason this is an action and not the generic PATCH.

        Google-synced meetings get auto-linked to accounts, so a user editing their own
        meeting hits this constantly — it is the common case, not an edge case.
        """
        from accounts.models import Account

        account = Account.objects.create(company_name="Someone Else Corp")
        event = _make_event(self.user, title="Linked", account=account)
        resp = self.client.patch(details_url(event.pk), {"title": "Edited"}, format="json")
        self.assertEqual(resp.status_code, 200)
        event.refresh_from_db()
        self.assertEqual(event.title, "Edited")

    def test_generic_patch_still_403s_on_a_non_member_account(self):
        """Documents why the action exists — remove this and the action is pointless."""
        from accounts.models import Account

        account = Account.objects.create(company_name="Not Mine Corp")
        event = _make_event(self.user, title="Linked", account=account)
        resp = self.client.patch(
            f"/api/v1/scheduler/events/{event.pk}/", {"title": "Edited"}, format="json"
        )
        self.assertEqual(resp.status_code, 403)

    def test_records_the_action_item_link(self):
        """"Convert to action item" keeps the event and stores the new item's id."""
        resp = self.client.patch(
            details_url(self.event.pk), {"agentpm_airtable_id": "recABC123"}, format="json"
        )
        self.assertEqual(resp.status_code, 200)
        self.event.refresh_from_db()
        self.assertEqual(self.event.agentpm_airtable_id, "recABC123")


class CalendarEventGooglePushTest(APITestCase):
    """When a local edit is pushed back to Google.

    `_sync_google_calendar` rewrites title/description/location/times/status from Google
    on every sync, so an edit that is not pushed is silently reverted the next time the
    sync runs. `perform_update` used to push only when the *times* changed.
    """

    def setUp(self):
        cache.clear()
        self.user = _make_user("push_user")
        self.client.force_authenticate(user=self.user)
        self.synced = _make_event(
            self.user, title="Synced", google_event_id="g-push-1", is_synced=True
        )

    def _patch_details(self, body, event=None):
        from unittest.mock import patch as mock_patch

        target = event or self.synced
        with mock_patch.object(
            CalendarEventViewSet, "_update_in_google"
        ) as push:
            resp = self.client.patch(details_url(target.pk), body, format="json")
        return resp, push

    def test_pushes_a_title_change(self):
        resp, push = self._patch_details({"title": "Renamed in app"})
        self.assertEqual(resp.status_code, 200)
        push.assert_called_once()

    def test_pushes_a_description_change(self):
        _resp, push = self._patch_details({"description": "New agenda"})
        push.assert_called_once()

    def test_pushes_a_time_change(self):
        _resp, push = self._patch_details(
            {"start_datetime": "2026-08-20T16:00:00Z", "end_datetime": "2026-08-20T17:00:00Z"}
        )
        push.assert_called_once()

    def test_does_not_push_a_category_only_change(self):
        """Google has no category field, and the sync already preserves ours."""
        resp, push = self._patch_details({"event_category": "focus_time"})
        self.assertEqual(resp.status_code, 200)
        push.assert_not_called()

    def test_does_not_push_the_action_item_link(self):
        """`agentpm_airtable_id` lives in extendedProperties, which the push omits."""
        _resp, push = self._patch_details({"agentpm_airtable_id": "recXYZ"})
        push.assert_not_called()

    def test_does_not_push_a_no_op_edit(self):
        _resp, push = self._patch_details({"title": "Synced"})
        push.assert_not_called()

    def test_does_not_push_an_unsynced_event(self):
        local = _make_event(self.user, title="Local only")
        _resp, push = self._patch_details({"title": "Renamed"}, event=local)
        push.assert_not_called()

    def test_a_google_failure_does_not_lose_the_local_edit(self):
        from unittest.mock import patch as mock_patch

        with mock_patch.object(
            CalendarEventViewSet, "_update_in_google", side_effect=RuntimeError("Google down")
        ):
            resp = self.client.patch(
                details_url(self.synced.pk), {"title": "Saved anyway"}, format="json"
            )
        self.assertEqual(resp.status_code, 200)
        self.synced.refresh_from_db()
        self.assertEqual(self.synced.title, "Saved anyway")

    def test_generic_patch_now_pushes_a_content_only_change(self):
        """The widened condition: it used to push only on a time change."""
        from unittest.mock import patch as mock_patch

        with mock_patch.object(CalendarEventViewSet, "_update_in_google") as push:
            resp = self.client.patch(
                f"/api/v1/scheduler/events/{self.synced.pk}/",
                {"title": "Via generic patch"},
                format="json",
            )
        self.assertEqual(resp.status_code, 200)
        push.assert_called_once()
