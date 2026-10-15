"""Tests for scheduler.ReminderViewSet — permission scoping and CRUD."""

from unittest import mock

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

    def test_edits_artifact_ids(self):
        resp = self.client.patch(
            details_url(self.event.pk), {"artifact_ids": [1, 2, 3]}, format="json"
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["artifact_ids"], [1, 2, 3])
        self.event.refresh_from_db()
        self.assertEqual(self.event.artifact_ids, [1, 2, 3])

    def test_clears_artifact_ids(self):
        self.event.artifact_ids = [1, 2]
        self.event.save(update_fields=["artifact_ids"])
        resp = self.client.patch(
            details_url(self.event.pk), {"artifact_ids": []}, format="json"
        )
        self.assertEqual(resp.status_code, 200)
        self.event.refresh_from_db()
        self.assertEqual(self.event.artifact_ids, [])

    def test_rejects_a_malformed_artifact_ids(self):
        for bad in ["not-a-list", {"a": 1}, [1, "two"], [1, True], 5]:
            with self.subTest(value=bad):
                resp = self.client.patch(
                    details_url(self.event.pk), {"artifact_ids": bad}, format="json"
                )
                self.assertEqual(resp.status_code, 400)
        self.event.refresh_from_db()
        self.assertEqual(self.event.artifact_ids, [])

    def test_artifact_ids_does_not_trigger_a_google_push(self):
        """Google has no concept of linked artifacts; excluded from the owned snapshot."""
        self.event.is_synced = True
        self.event.google_event_id = "gcal-abc"
        self.event.save(update_fields=["is_synced", "google_event_id"])
        with mock.patch(
            "scheduler.views.CalendarEventViewSet._update_in_google"
        ) as mocked_push:
            resp = self.client.patch(
                details_url(self.event.pk), {"artifact_ids": [1]}, format="json"
            )
        self.assertEqual(resp.status_code, 200)
        mocked_push.assert_not_called()


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


class CalendarEventGoogleBodyFormatTest(APITestCase):
    """`_push_to_google` / `_update_in_google` build the actual request body sent to
    Google. Every prior test in this file mocks these methods away entirely, so the
    two real bugs inside them — `_push_to_google` crashing on every call (a raw
    datetime.datetime is not subscriptable and has no len()), and both methods
    formatting `dateTime` as "...20 10:00:00+00:00" (a space, from str(datetime))
    instead of RFC3339's required "...20T10:00:00+00:00" — went undetected. Google's
    Calendar API rejects the space form with a generic 400 and no field-level detail.

    These call the real methods directly (not through perform_create/perform_update,
    which swallow the exception and log it) so a regression fails loudly here instead
    of silently in production.
    """

    def setUp(self):
        self.user = _make_user("google_body_user")
        from integrations.models import OAuthCredential

        OAuthCredential.objects.create(
            user=self.user,
            provider="google",
            access_token="tok",
            refresh_token="ref",
            scopes="https://www.googleapis.com/auth/calendar",
        )

    def _build_mock_service(self):
        """Returns (mock_build, captured) — captured['body'] holds the last insert/patch body."""
        from unittest.mock import MagicMock

        captured = {}

        def _insert(calendarId, body, **kwargs):
            captured["body"] = body
            call = MagicMock()
            call.execute.return_value = {"id": "g-new-1"}
            return call

        def _patch(calendarId, eventId, body, **kwargs):
            captured["body"] = body
            call = MagicMock()
            call.execute.return_value = {}
            return call

        events = MagicMock()
        events.insert.side_effect = _insert
        events.patch.side_effect = _patch
        service = MagicMock()
        service.events.return_value = events
        return service, captured

    def test_push_to_google_sends_rfc3339_datetimes_for_a_new_event(self):
        """Regression for both bugs: this used to crash with TypeError on every call."""
        from unittest.mock import patch as mock_patch

        event = CalendarEvent.objects.create(
            owner=self.user,
            title="Brand New",
            start_datetime="2026-08-20T10:00:00+00:00",
            end_datetime="2026-08-20T11:00:00+00:00",
        )
        # DRF's serializer would already have parsed these into real datetime
        # objects before .save() — a raw ORM .create() with a string does not,
        # so pull it back from the DB to match what perform_create actually sees.
        event.refresh_from_db()
        service, captured = self._build_mock_service()
        viewset = CalendarEventViewSet()
        with mock_patch("googleapiclient.discovery.build", return_value=service):
            viewset._push_to_google(event)

        self.assertEqual(captured["body"]["start"]["dateTime"], "2026-08-20T10:00:00+00:00")
        self.assertEqual(captured["body"]["end"]["dateTime"], "2026-08-20T11:00:00+00:00")
        event.refresh_from_db()
        self.assertEqual(event.google_event_id, "g-new-1")
        self.assertTrue(event.is_synced)

    def test_push_to_google_sends_a_date_only_value_for_an_all_day_event(self):
        from unittest.mock import patch as mock_patch

        event = CalendarEvent.objects.create(
            owner=self.user,
            title="All Day",
            start_datetime="2026-08-20T00:00:00+00:00",
            end_datetime="2026-08-21T00:00:00+00:00",
            all_day=True,
        )
        event.refresh_from_db()
        service, captured = self._build_mock_service()
        viewset = CalendarEventViewSet()
        with mock_patch("googleapiclient.discovery.build", return_value=service):
            viewset._push_to_google(event)

        self.assertEqual(captured["body"]["start"], {"date": "2026-08-20"})
        self.assertEqual(captured["body"]["end"], {"date": "2026-08-21"})

    def test_update_in_google_sends_rfc3339_datetimes(self):
        from unittest.mock import patch as mock_patch

        event = CalendarEvent.objects.create(
            owner=self.user,
            title="Existing",
            start_datetime="2026-08-20T16:00:00+00:00",
            end_datetime="2026-08-20T17:00:00+00:00",
            google_event_id="g-existing-1",
            is_synced=True,
        )
        event.refresh_from_db()
        service, captured = self._build_mock_service()
        viewset = CalendarEventViewSet()
        with mock_patch("googleapiclient.discovery.build", return_value=service):
            viewset._update_in_google(event)

        self.assertEqual(captured["body"]["start"]["dateTime"], "2026-08-20T16:00:00+00:00")
        self.assertEqual(captured["body"]["end"]["dateTime"], "2026-08-20T17:00:00+00:00")
        self.assertNotIn(" ", captured["body"]["start"]["dateTime"])


# ── Auto-link the action item's own account onto a work-tracking event ─────────

EVENTS_LIST_URL = "/api/v1/scheduler/events/"


class CalendarEventAccountAutolinkTest(APITestCase):
    """Dragging an action item into "Currently Tracking" (or Track/Auto-Track) creates
    a `work_tracking` CalendarEvent carrying only `agentpm_airtable_id` — no `account`.
    `account_name` then came back null, and the calendar grid's work_tracking fallback
    displayed the current user's own username instead of the account the action item
    is actually linked to. `_autolink_account_from_action_item` resolves and attaches
    the action item's own account via the same bridge `_resolve_scheduler_account`
    already uses for the Airtable sync path.
    """

    def setUp(self):
        cache.clear()
        self.user = _make_user("autolink_user")
        self.client.force_authenticate(user=self.user)

    def _create_event(self, **overrides):
        payload = {
            "title": "Work session",
            "description": "Work session — Acme Corp",
            "start_datetime": "2026-08-20T10:00:00Z",
            "end_datetime": "2026-08-20T11:00:00Z",
            "all_day": False,
            "status": "confirmed",
            "calendar_id": "work_tracking",
            "is_synced": False,
        }
        payload.update(overrides)
        return self.client.post(EVENTS_LIST_URL, payload, format="json")

    def test_autolinks_the_action_items_own_account_for_a_member(self):
        from accounts.models import Account
        from airtable_sync.models import AirtableAccount, AirtableActionItem
        from team.models import TeamMember

        member = TeamMember.objects.create(
            full_name="Autolink User", email="autolink_user@example.com", user=self.user
        )
        account = Account.objects.create(company_name="Acme Corp", airtable_id="recACME1")
        account.team_members.add(member)
        air_account = AirtableAccount.objects.create(airtable_id="recACME1", name="Acme Corp")
        air_item = AirtableActionItem.objects.create(
            airtable_id="recITEM1", account=air_account, task="Follow up with Acme",
        )

        resp = self._create_event(agentpm_airtable_id=air_item.airtable_id)
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["account"], account.id)
        self.assertEqual(resp.data["account_name"], "Acme Corp")

    def test_does_not_link_when_user_is_not_a_member_of_the_resolved_account(self):
        """Best-effort: an auto-link must never turn "start a timer" into a 403."""
        from airtable_sync.models import AirtableAccount, AirtableActionItem

        air_account = AirtableAccount.objects.create(airtable_id="recNOTMINE", name="Not Mine Corp")
        air_item = AirtableActionItem.objects.create(
            airtable_id="recITEM2", account=air_account, task="Someone else's item",
        )
        from accounts.models import Account
        Account.objects.create(company_name="Not Mine Corp", airtable_id="recNOTMINE")

        resp = self._create_event(agentpm_airtable_id=air_item.airtable_id)
        self.assertEqual(resp.status_code, 201)
        self.assertIsNone(resp.data["account"])

    def test_an_explicit_account_is_never_overridden(self):
        from accounts.models import Account
        from airtable_sync.models import AirtableAccount, AirtableActionItem
        from team.models import TeamMember

        member = TeamMember.objects.create(
            full_name="Autolink User", email="autolink_user@example.com", user=self.user
        )
        explicit_account = Account.objects.create(company_name="Explicit Corp")
        explicit_account.team_members.add(member)

        other_account = Account.objects.create(company_name="Resolved Corp", airtable_id="recOTHER")
        other_account.team_members.add(member)
        air_account = AirtableAccount.objects.create(airtable_id="recOTHER", name="Resolved Corp")
        air_item = AirtableActionItem.objects.create(
            airtable_id="recITEM3", account=air_account, task="Has an explicit account",
        )

        resp = self._create_event(account=explicit_account.id, agentpm_airtable_id=air_item.airtable_id)
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["account"], explicit_account.id)

    def test_no_airtable_id_is_a_no_op(self):
        resp = self._create_event()
        self.assertEqual(resp.status_code, 201)
        self.assertIsNone(resp.data["account"])

    def test_unresolvable_airtable_id_is_a_no_op(self):
        resp = self._create_event(agentpm_airtable_id="rec-does-not-exist")
        self.assertEqual(resp.status_code, 201)
        self.assertIsNone(resp.data["account"])

    def test_admin_account_routes_to_the_assignees_personal_admin_account(self):
        """The per-user "Admin" special case `_resolve_scheduler_account` already
        handles for the Airtable sync path — an Admin-account action item must
        resolve to *this* user's own personal Admin account, not a shared one."""
        from accounts.models import ADMIN_ACCOUNT_NAME, Account
        from airtable_sync.models import AirtableAccount, AirtableActionItem
        from team.models import TeamMember

        UserProfile.objects.create(user=self.user, airtable_collaborator_id="collabAutolink")
        TeamMember.objects.create(
            full_name="Autolink User", email="autolink_user@example.com", user=self.user
        )
        admin_air_account = AirtableAccount.objects.create(airtable_id="recADMIN", name=ADMIN_ACCOUNT_NAME)
        air_item = AirtableActionItem.objects.create(
            airtable_id="recITEM4",
            account=admin_air_account,
            task="Personal admin task",
            assignee_airtable_id="collabAutolink",
        )

        resp = self._create_event(agentpm_airtable_id=air_item.airtable_id)
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["account_name"], ADMIN_ACCOUNT_NAME)

        linked_account = Account.objects.get(pk=resp.data["account"])
        self.assertEqual(linked_account.admin_owner_id, self.user.id)

    def test_staff_gets_the_autolink_without_formal_membership(self):
        from accounts.models import Account
        from airtable_sync.models import AirtableAccount, AirtableActionItem

        staff = _make_user("autolink_staff", is_staff=True)
        self.client.force_authenticate(user=staff)

        account = Account.objects.create(company_name="Staff Reach Corp", airtable_id="recSTAFF")
        air_account = AirtableAccount.objects.create(airtable_id="recSTAFF", name="Staff Reach Corp")
        air_item = AirtableActionItem.objects.create(
            airtable_id="recITEM5", account=air_account, task="Staff can see everything",
        )

        resp = self._create_event(agentpm_airtable_id=air_item.airtable_id)
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["account"], account.id)


# ── Scheduling onto the calendar creates a row that records what it links to ───

class CalendarEventSourceLinkCreateTest(APITestCase):
    """`perform_create` persists `agentpm_airtable_id` and `reminder`.

    Both are `read_only` on the serializer, so handing them to `serializer.save()` was
    silently dropped while still returning 201 — the worst kind of failure. Every
    work-tracking row created by the timer path therefore had a blank link, and a scheduled
    action item could not be told apart from an untitled block of time.

    This is what makes "drop an action item on the calendar" durable rather than a
    localStorage-only overlay that the Google sync deletes.
    """

    URL = "/api/v1/scheduler/events/"

    def setUp(self):
        cache.clear()
        self.user = _make_user("sched_link_user")
        self.other = _make_user("sched_link_other")
        self.client.force_authenticate(self.user)

    def tearDown(self):
        cache.clear()

    def _payload(self, **extra):
        body = {
            "title": "Provision SQL Traits",
            "start_datetime": "2026-09-15T18:00:00Z",
            "end_datetime": "2026-09-15T19:00:00Z",
            "calendar_id": "work_tracking",
        }
        body.update(extra)
        return body

    def test_agentpm_airtable_id_is_stored(self):
        resp = self.client.post(
            self.URL, self._payload(agentpm_airtable_id="rec9AwGLeyC2jMn2I"), format="json"
        )
        self.assertEqual(resp.status_code, 201, resp.data)

        event = CalendarEvent.objects.get(pk=resp.data["id"])
        self.assertEqual(event.agentpm_airtable_id, "rec9AwGLeyC2jMn2I")

    def test_the_stored_link_is_returned_in_the_response(self):
        """The client relies on this to render the new row without a refetch."""
        resp = self.client.post(
            self.URL, self._payload(agentpm_airtable_id="recXYZ"), format="json"
        )
        self.assertEqual(resp.data["agentpm_airtable_id"], "recXYZ")

    def test_a_reminder_the_caller_owns_is_stored(self):
        reminder = Reminder.objects.create(
            created_by=self.user, title="Call back", due_at="2026-09-15T18:00:00Z"
        )
        resp = self.client.post(
            self.URL,
            self._payload(calendar_id="reminders", reminder=reminder.pk),
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)

        event = CalendarEvent.objects.get(pk=resp.data["id"])
        self.assertEqual(event.reminder_id, reminder.pk)

    def test_another_users_reminder_is_ignored_not_attached(self):
        """`Reminder` has no object-permission check on this path, so scope it here."""
        theirs = Reminder.objects.create(
            created_by=self.other, title="Not yours", due_at="2026-09-15T18:00:00Z"
        )
        resp = self.client.post(
            self.URL,
            self._payload(calendar_id="reminders", reminder=theirs.pk),
            format="json",
        )
        # Still created — the block of time is legitimate; only the bogus link is dropped.
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertIsNone(CalendarEvent.objects.get(pk=resp.data["id"]).reminder_id)

    def test_a_nonexistent_reminder_is_ignored(self):
        resp = self.client.post(
            self.URL, self._payload(calendar_id="reminders", reminder=999999), format="json"
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertIsNone(CalendarEvent.objects.get(pk=resp.data["id"]).reminder_id)

    def test_omitting_both_links_still_creates_a_plain_event(self):
        resp = self.client.post(self.URL, self._payload(calendar_id="primary"), format="json")
        self.assertEqual(resp.status_code, 201, resp.data)

        event = CalendarEvent.objects.get(pk=resp.data["id"])
        self.assertEqual(event.agentpm_airtable_id, "")
        self.assertIsNone(event.reminder_id)

    def test_a_scheduled_row_starts_unsynced_so_the_sync_will_push_it(self):
        """PHASE 1b keys off `google_event_id=""`, so a fresh row must not claim to be synced."""
        resp = self.client.post(
            self.URL, self._payload(agentpm_airtable_id="recPUSHME"), format="json"
        )
        event = CalendarEvent.objects.get(pk=resp.data["id"])
        self.assertEqual(event.google_event_id, "")
        self.assertFalse(event.is_synced)

    def test_a_work_tracking_create_is_not_pushed_to_google_at_create_time(self):
        """The sync owns mirroring these; pushing here would double-create."""
        with mock.patch.object(CalendarEventViewSet, "_push_to_google") as pushed:
            self.client.post(
                self.URL, self._payload(agentpm_airtable_id="recNOPUSH"), format="json"
            )
        pushed.assert_not_called()


class MeetingInviteGooglePushTest(APITestCase):
    """Creating/editing a meeting with guests must ask Google to email them.

    Google's `sendUpdates` defaults to "none": attendees were added to the event but
    nobody was notified, which is why invitees never received anything.
    """

    def setUp(self):
        from integrations.models import OAuthCredential
        cache.clear()
        self.user = _make_user("organiser")
        self.client.force_authenticate(user=self.user)
        OAuthCredential.objects.create(
            user=self.user, provider="google", is_active=True,
            access_token="tok", refresh_token="ref", scopes="https://www.googleapis.com/auth/calendar",
        )
        self.service = mock.MagicMock()
        self.service.events.return_value.insert.return_value.execute.return_value = {
            "id": "g-new-1", "hangoutLink": "https://meet.google.com/abc-defg-hij",
        }
        patcher = mock.patch("googleapiclient.discovery.build", return_value=self.service)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _create(self, **extra):
        body = {
            "title": "Kickoff",
            "start_datetime": "2026-10-20T16:00:00Z",
            "end_datetime": "2026-10-20T17:00:00Z",
            "calendar_id": "primary",
            "attendees": [
                {"email": "ana@example.com", "displayName": "Ana", "responseStatus": "needsAction"},
                {"email": "ben@example.com", "displayName": "Ben", "responseStatus": "needsAction"},
            ],
        }
        body.update(extra)
        return self.client.post("/api/v1/scheduler/events/", body, format="json")

    def _insert_kwargs(self):
        return self.service.events.return_value.insert.call_args.kwargs

    def test_guests_are_emailed_when_send_invites_is_true(self):
        resp = self._create(send_invites=True)
        self.assertEqual(resp.status_code, 201, resp.data)
        kwargs = self._insert_kwargs()
        self.assertEqual(kwargs["sendUpdates"], "all")
        self.assertEqual(
            [a["email"] for a in kwargs["body"]["attendees"]], ["ana@example.com", "ben@example.com"]
        )
        self.assertEqual(resp.data["google_sync"], {"status": "ok", "invites_sent": True})

    def test_send_invites_false_adds_guests_without_emailing(self):
        resp = self._create(send_invites=False)
        self.assertEqual(self._insert_kwargs()["sendUpdates"], "none")
        self.assertEqual(resp.data["google_sync"]["invites_sent"], False)

    def test_omitted_flag_defaults_to_sending_when_there_are_guests(self):
        self._create()
        self.assertEqual(self._insert_kwargs()["sendUpdates"], "all")

    def test_organiser_is_not_invited_to_their_own_meeting(self):
        self._create(send_invites=True, attendees=[
            {"email": "organiser@example.com"}, {"email": "ana@example.com"}, {"email": "ANA@example.com"},
        ])
        self.assertEqual([a["email"] for a in self._insert_kwargs()["body"]["attendees"]], ["ana@example.com"])

    def test_meet_placeholder_requests_a_real_conference(self):
        resp = self._create(send_invites=True, meet_link="https://meet.google.com/new")
        kwargs = self._insert_kwargs()
        self.assertEqual(kwargs["conferenceDataVersion"], 1)
        self.assertEqual(
            kwargs["body"]["conferenceData"]["createRequest"]["conferenceSolutionKey"], {"type": "hangoutsMeet"}
        )
        event = CalendarEvent.objects.get(pk=resp.data["id"])
        self.assertEqual(event.meet_link, "https://meet.google.com/abc-defg-hij")
        self.assertEqual(event.google_event_id, "g-new-1")

    def test_no_google_connection_is_reported_not_silent(self):
        from integrations.models import OAuthCredential
        OAuthCredential.objects.filter(user=self.user).delete()
        resp = self._create(send_invites=True)
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["google_sync"], {"status": "not_connected", "invites_sent": False})
        self.service.events.return_value.insert.assert_not_called()

    def test_google_failure_is_reported_and_the_event_is_kept(self):
        self.service.events.return_value.insert.return_value.execute.side_effect = RuntimeError("boom")
        resp = self._create(send_invites=True)
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["google_sync"], {"status": "failed", "invites_sent": False})
        self.assertTrue(CalendarEvent.objects.filter(pk=resp.data["id"]).exists())

    def test_non_primary_create_has_no_google_sync_key(self):
        resp = self.client.post("/api/v1/scheduler/events/", {
            "title": "Block", "start_datetime": "2026-10-20T16:00:00Z",
            "end_datetime": "2026-10-20T16:15:00Z", "calendar_id": "work_tracking",
        }, format="json")
        self.assertEqual(resp.status_code, 201)
        self.assertNotIn("google_sync", resp.data)

    def test_reschedule_notifies_guests(self):
        event = CalendarEvent.objects.create(
            owner=self.user, title="Sync", start_datetime="2026-10-20T16:00:00Z",
            end_datetime="2026-10-20T17:00:00Z", google_event_id="g-1", is_synced=True,
            attendees=[{"email": "ana@example.com"}],
        )
        resp = self.client.patch(f"/api/v1/scheduler/events/{event.pk}/", {
            "start_datetime": "2026-10-20T18:00:00Z", "end_datetime": "2026-10-20T19:00:00Z",
        }, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        kwargs = self.service.events.return_value.patch.call_args.kwargs
        self.assertEqual(kwargs["sendUpdates"], "all")
        self.assertEqual(kwargs["body"]["attendees"], [{"email": "ana@example.com"}])

    def test_adding_a_guest_is_pushed(self):
        event = CalendarEvent.objects.create(
            owner=self.user, title="Sync", start_datetime="2026-10-20T16:00:00Z",
            end_datetime="2026-10-20T17:00:00Z", google_event_id="g-2", is_synced=True,
            attendees=[{"email": "ana@example.com"}],
        )
        self.client.patch(f"/api/v1/scheduler/events/{event.pk}/", {
            "attendees": [{"email": "ana@example.com"}, {"email": "cy@example.com"}],
        }, format="json")
        kwargs = self.service.events.return_value.patch.call_args.kwargs
        self.assertEqual([a["email"] for a in kwargs["body"]["attendees"]], ["ana@example.com", "cy@example.com"])


class CalendarEventSearchTest(APITestCase):
    """`?search=` powers the calendar search box. Owner scoping still applies."""

    def setUp(self):
        from accounts.models import Account
        cache.clear()
        self.user = _make_user("searcher")
        self.other = _make_user("someone_else")
        self.client.force_authenticate(user=self.user)
        acme = Account.objects.create(company_name="Acme Corp")
        CalendarEvent.objects.create(owner=self.user, title="Quarterly review", start_datetime="2026-10-01T16:00:00Z",
                                     end_datetime="2026-10-01T17:00:00Z", account=acme)
        CalendarEvent.objects.create(owner=self.user, title="Dentist", location="Main St",
                                     start_datetime="2026-10-02T16:00:00Z", end_datetime="2026-10-02T17:00:00Z")
        CalendarEvent.objects.create(owner=self.other, title="Dentist (theirs)",
                                     start_datetime="2026-10-02T16:00:00Z", end_datetime="2026-10-02T17:00:00Z")

    def _titles(self, q):
        resp = self.client.get("/api/v1/scheduler/events/", {"search": q})
        self.assertEqual(resp.status_code, 200)
        return sorted(e["title"] for e in resp.data)

    def test_matches_title_and_location(self):
        self.assertEqual(self._titles("dentist"), ["Dentist"])
        self.assertEqual(self._titles("main st"), ["Dentist"])

    def test_matches_account_name(self):
        self.assertEqual(self._titles("acme"), ["Quarterly review"])

    def test_never_returns_another_users_events(self):
        self.assertNotIn("Dentist (theirs)", self._titles("dentist"))

    def test_unauthenticated_is_rejected(self):
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get("/api/v1/scheduler/events/", {"search": "x"}).status_code, 401)


class AvailabilityTest(APITestCase):
    """Compare calendars: busy blocks for everyone, titles only on shared accounts."""

    URL = "/api/v1/scheduler/availability/"
    RANGE = {"start": "2026-10-19T00:00:00Z", "end": "2026-10-24T00:00:00Z"}

    def setUp(self):
        from accounts.models import Account
        from team.models import TeamMember
        cache.clear()
        self.me = _make_user("viewer")
        self.ana = _make_user("ana")
        self.client.force_authenticate(user=self.me)
        me_m = TeamMember.objects.create(user=self.me, full_name="Viewer", email=self.me.email)
        ana_m = TeamMember.objects.create(user=self.ana, full_name="Ana Diaz", email=self.ana.email)
        self.shared = Account.objects.create(company_name="Shared Co")
        self.shared.team_members.add(me_m, ana_m)
        self.private = Account.objects.create(company_name="Ana Only")
        self.private.team_members.add(ana_m)

        def ev(title, h, **kw):
            return CalendarEvent.objects.create(
                owner=self.ana, title=title, start_datetime=f"2026-10-20T{h:02d}:00:00Z",
                end_datetime=f"2026-10-20T{h + 1:02d}:00:00Z", **kw)
        ev("Shared QBR", 15, account=self.shared)
        ev("Ana private deal", 16, account=self.private)
        ev("Dentist", 17)
        ev("Cancelled thing", 18, status="cancelled")
        ev("Skipped", 19, attended=False)
        ev("Tracking block", 20, calendar_id="work_tracking")
        CalendarEvent.objects.create(owner=self.ana, title="Next month", start_datetime="2026-11-20T15:00:00Z",
                                     end_datetime="2026-11-20T16:00:00Z")

    def _get(self, **params):
        return self.client.get(self.URL, {**self.RANGE, **params})

    def test_app_user_busy_is_masked_except_on_shared_accounts(self):
        resp = self._get(emails=self.ana.email)
        self.assertEqual(resp.status_code, 200, resp.data)
        person = resp.data["people"][0]
        self.assertEqual((person["source"], person["name"]), ("app", "Ana Diaz"))
        self.assertEqual([b["title"] for b in person["busy"]], ["Shared QBR", "Busy", "Busy"])
        self.assertEqual([b["title_visible"] for b in person["busy"]], [True, False, False])

    def test_never_leaks_details(self):
        busy = self._get(emails=self.ana.email).data["people"][0]["busy"]
        for block in busy:
            self.assertEqual(set(block), {"start", "end", "all_day", "title", "title_visible"})

    def test_excludes_non_blocking_and_out_of_range_events(self):
        titles = [b["title"] for b in self._get(emails=self.ana.email).data["people"][0]["busy"]]
        self.assertEqual(len(titles), 3)

    def test_viewer_is_skipped(self):
        self.assertEqual(self._get(emails=self.me.email).data["people"], [])

    def test_non_app_users_go_through_google_freebusy(self):
        service = mock.MagicMock()
        service.freebusy.return_value.query.return_value.execute.return_value = {"calendars": {
            "zed@twilio.com": {"busy": [{"start": "2026-10-21T15:00:00Z", "end": "2026-10-21T16:00:00Z"}]},
            "nobody@else.com": {"busy": [], "errors": [{"reason": "notFound"}]},
        }}
        with mock.patch("scheduler.availability._google_service_for", return_value=service):
            resp = self._get(emails="zed@twilio.com,nobody@else.com")
        people = {p["email"]: p for p in resp.data["people"]}
        self.assertEqual(people["zed@twilio.com"]["busy"][0]["title"], "Busy")
        self.assertEqual(people["zed@twilio.com"]["source"], "google")
        self.assertEqual(people["nobody@else.com"]["error"], "notFound")
        body = service.freebusy.return_value.query.call_args.kwargs["body"]
        self.assertEqual([i["id"] for i in body["items"]], ["zed@twilio.com", "nobody@else.com"])

    def test_google_not_connected_is_reported(self):
        with mock.patch("scheduler.availability._google_service_for", return_value=None):
            person = self._get(emails="zed@twilio.com").data["people"][0]
        self.assertEqual(person["error"], "not_connected")

    def test_validation(self):
        self.assertEqual(self.client.get(self.URL, {"emails": self.ana.email}).status_code, 400)
        self.assertEqual(self._get().status_code, 400)
        many = ",".join(f"p{i}@x.com" for i in range(9))
        self.assertEqual(self._get(emails=many).status_code, 400)
        self.assertEqual(self.client.get(self.URL, {
            "emails": self.ana.email, "start": "2026-01-01T00:00:00Z", "end": "2026-06-01T00:00:00Z",
        }).status_code, 400)

    def test_unauthenticated_is_rejected(self):
        self.client.force_authenticate(user=None)
        self.assertEqual(self._get(emails=self.ana.email).status_code, 401)


class TestNotificationsEndpointTest(APITestCase):
    URL = "/api/v1/scheduler/notifications/test/"

    def setUp(self):
        cache.clear()
        self.user = _make_user("notif_user")
        self.profile = UserProfile.objects.create(user=self.user, phone_number="+14155550123")
        self.client.force_authenticate(user=self.user)

    def _post(self, channels):
        return self.client.post(self.URL, {"channels": channels}, format="json")

    def _by_channel(self, resp):
        return {r["channel"]: r for r in resp.data["results"]}

    @mock.patch("scheduler.tasks._send_sms")
    def test_sms_uses_the_reminder_sender(self, send_sms):
        with self.settings(TWILIO_ACCOUNT_SID="AC1", TWILIO_AUTH_TOKEN="t", TWILIO_PHONE_NUMBER="+15550000000"):
            resp = self._post(["sms"])
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self._by_channel(resp)["sms"]["status"], "sent")
        send_sms.assert_called_once()

    @mock.patch("scheduler.tasks._send_sms")
    def test_missing_phone_is_skipped_with_a_reason(self, send_sms):
        self.profile.phone_number = ""
        self.profile.save()
        with self.settings(TWILIO_ACCOUNT_SID="AC1", TWILIO_AUTH_TOKEN="t", TWILIO_PHONE_NUMBER="+15550000000"):
            result = self._by_channel(self._post(["sms"]))["sms"]
        self.assertEqual(result["status"], "skipped")
        self.assertIn("phone number", result["detail"])
        send_sms.assert_not_called()

    def test_push_without_a_registered_browser_is_skipped(self):
        with self.settings(VAPID_PRIVATE_KEY="k", VAPID_PUBLIC_KEY="p"):
            result = self._by_channel(self._post(["push"]))["push"]
        self.assertEqual(result["status"], "skipped")

    def test_slack_without_bot_token_is_skipped(self):
        with self.settings(SLACK_BOT_TOKEN=""):
            self.assertEqual(self._by_channel(self._post(["slack"]))["slack"]["status"], "skipped")

    def test_email_is_reported_unavailable(self):
        self.assertEqual(self._by_channel(self._post(["email"]))["email"]["status"], "skipped")

    @mock.patch("scheduler.tasks._send_in_app", side_effect=RuntimeError("secret detail"))
    def test_failure_is_reported_without_exception_text(self, _send):
        result = self._by_channel(self._post(["in_app"]))["in_app"]
        self.assertEqual(result["status"], "failed")
        self.assertNotIn("secret", result["detail"])

    @mock.patch("scheduler.tasks._send_in_app")
    def test_in_app_is_sent(self, send):
        self.assertEqual(self._by_channel(self._post(["in_app"]))["in_app"]["status"], "sent")
        send.assert_called_once()

    def test_validation(self):
        self.assertEqual(self._post([]).status_code, 400)
        self.assertEqual(self._post(["fax"]).status_code, 400)

    def test_unauthenticated_is_rejected(self):
        self.client.force_authenticate(user=None)
        self.assertEqual(self._post(["in_app"]).status_code, 401)


class MeetingNotesByActionItemTest(APITestCase):
    """?action_item= lists notes from every calendar block of that action item."""

    URL = "/api/v1/scheduler/meeting-notes/"

    def setUp(self):
        from airtable_sync.models import AirtableActionItem
        cache.clear()
        self.me = _make_user("ainotes_me")
        self.mate = _make_user("ainotes_mate")
        AirtableActionItem.objects.create(airtable_id="recNOTE1", task="Shared task")
        mine = _make_event(self.me, "Block 1", agentpm_airtable_id="recNOTE1")
        theirs = _make_event(self.mate, "Block 2", agentpm_airtable_id="recNOTE1")
        other = _make_event(self.me, "Unrelated", agentpm_airtable_id="recOTHER")
        _make_note(mine, self.me, "my note")
        _make_note(theirs, self.mate, "teammate note")
        _make_note(other, self.me, "elsewhere")
        self.client.force_authenticate(user=self.me)

    def _texts(self, **params):
        resp = self.client.get(self.URL, params)
        self.assertEqual(resp.status_code, 200)
        return sorted(n["text"] for n in resp.data["results"])

    def test_includes_every_block_including_teammates(self):
        self.assertEqual(self._texts(action_item="recNOTE1"), ["my note", "teammate note"])

    def test_unknown_item_returns_nothing(self):
        self.assertEqual(self._texts(action_item="recNOPE"), [])

    def test_private_admin_item_is_hidden(self):
        from airtable_sync.models import AirtableAccount, AirtableActionItem
        admin = AirtableAccount.objects.create(airtable_id="recADM", name="Admin")
        AirtableActionItem.objects.filter(airtable_id="recNOTE1").update(account=admin, assignee_airtable_id="usrSOMEONE")
        self.assertEqual(self._texts(action_item="recNOTE1"), [])

    def test_without_the_filter_owner_scoping_is_unchanged(self):
        self.assertEqual(self._texts(), ["elsewhere", "my note"])
