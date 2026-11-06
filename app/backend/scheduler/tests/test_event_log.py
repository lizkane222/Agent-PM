"""The Activity Log's Events tab lists changes made to events, never the events themselves."""

from datetime import timedelta

from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from realtime.models import AgentActivityEvent
from scheduler.event_log import changed_labels, snapshot
from scheduler.models import CalendarEvent

User = get_user_model()
FEED = "/api/v1/realtime/activity/event-updates/"
EVENTS = "/api/v1/scheduler/events/"


def _event(owner, title="Q3 Planning", days_ahead=2):
    start = timezone.now() + timedelta(days=days_ahead)
    return CalendarEvent.objects.create(
        owner=owner, title=title, start_datetime=start, end_datetime=start + timedelta(hours=1),
    )


def _entries(user, action=None):
    qs = AgentActivityEvent.objects.filter(user=user, event_type__startswith="calendar_event.")
    if action:
        qs = qs.filter(event_type=f"calendar_event.{action}")
    return list(qs)


class EventChangeRecordingTest(APITestCase):
    def setUp(self):
        patcher = mock.patch("realtime.sync._get_sync_client", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)
        cache.clear()
        self.user = User.objects.create_user("elog_user", password="{PASSWORD}")
        self.client.force_authenticate(user=self.user)

    def test_creating_an_event_is_recorded_with_its_title_and_id(self):
        start = timezone.now() + timedelta(days=3)
        resp = self.client.post(EVENTS, {
            "title": "Kickoff", "start_datetime": start.isoformat(),
            "end_datetime": (start + timedelta(hours=1)).isoformat(),
        }, format="json")
        self.assertEqual(resp.status_code, 201)

        (entry,) = _entries(self.user, "created")
        self.assertEqual(entry.title, 'Event created: "Kickoff"')
        self.assertEqual(entry.metadata["resource"], {"type": "calendar_event", "id": resp.data["id"]})
        self.assertEqual(entry.metadata["event_title"], "Kickoff")

    def test_an_edit_names_what_changed(self):
        ev = _event(self.user)
        resp = self.client.patch(f"{EVENTS}{ev.pk}/details/", {"title": "Renamed", "location": "Zoom"}, format="json")
        self.assertEqual(resp.status_code, 200)

        (entry,) = _entries(self.user, "updated")
        self.assertEqual(entry.title, 'Event updated: "Renamed" (title, location)')
        self.assertEqual(entry.metadata["changes"], ["title", "location"])

    def test_moving_an_event_via_the_generic_patch_is_recorded_as_a_time_change(self):
        ev = _event(self.user)
        new_start = ev.start_datetime + timedelta(hours=3)
        resp = self.client.patch(f"{EVENTS}{ev.pk}/", {
            "start_datetime": new_start.isoformat(),
            "end_datetime": (new_start + timedelta(hours=1)).isoformat(),
        }, format="json")
        self.assertEqual(resp.status_code, 200)

        (entry,) = _entries(self.user, "updated")
        self.assertEqual(entry.metadata["changes"], ["time"])

    def test_a_save_that_changes_nothing_logs_nothing(self):
        ev = _event(self.user)
        self.client.patch(f"{EVENTS}{ev.pk}/details/", {"title": ev.title}, format="json")
        self.assertEqual(_entries(self.user, "updated"), [])

    def test_deleting_keeps_the_title_after_the_row_is_gone(self):
        ev = _event(self.user, title="Old sync")
        pk = ev.pk
        resp = self.client.delete(f"{EVENTS}{pk}/")
        self.assertEqual(resp.status_code, 204)

        (entry,) = _entries(self.user, "deleted")
        self.assertEqual(entry.title, 'Event deleted: "Old sync"')
        self.assertEqual(entry.metadata["resource"]["id"], pk)
        self.assertTrue(entry.metadata["event_start"])

    def test_marking_attendance_is_recorded_but_clearing_it_is_not(self):
        ev = _event(self.user)
        self.client.patch(f"{EVENTS}{ev.pk}/attendance/", {"attended": False}, format="json")
        self.client.patch(f"{EVENTS}{ev.pk}/attendance/", {"attended": None}, format="json")

        (entry,) = _entries(self.user, "attendance")
        self.assertEqual(entry.title, 'Marked did not attend: "Q3 Planning"')
        self.assertIs(entry.metadata["attended"], False)

    def test_changed_labels_collapses_start_and_end_into_one_time_label(self):
        ev = _event(self.user)
        before = snapshot(ev)
        ev.start_datetime += timedelta(hours=1)
        ev.end_datetime += timedelta(hours=1)
        self.assertEqual(changed_labels(before, ev), ["time"])


class EventUpdatesFeedTest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("feed_user", password="{PASSWORD}")
        self.other = User.objects.create_user("feed_other", password="{PASSWORD}")

    def _make(self, user, event_type, title="x"):
        return AgentActivityEvent.objects.create(user=user, event_type=event_type, title=title)

    def test_requires_auth(self):
        self.assertEqual(self.client.get(FEED).status_code, 401)

    def test_lists_only_event_changes_and_notes_not_other_activity(self):
        for t in ("calendar_event.created", "calendar_event.updated", "calendar_event.deleted",
                  "calendar_event.attendance", "calendar_event.time_logged", "meeting_notes"):
            self._make(self.user, t, title=t)
        self._make(self.user, "action_item.updated", title="not an event")
        self._make(self.user, "comment_reply", title="not an event either")
        self.client.force_authenticate(user=self.user)

        titles = {e["title"] for e in self.client.get(FEED).data["results"]}
        self.assertEqual(len(titles), 6)
        self.assertNotIn("not an event", titles)
        self.assertNotIn("not an event either", titles)

    def test_never_lists_events_that_merely_exist(self):
        _event(self.user, title="Far future", days_ahead=170)
        self.client.force_authenticate(user=self.user)
        self.assertEqual(self.client.get(FEED).data["results"], [])

    def test_is_scoped_to_the_caller(self):
        self._make(self.other, "calendar_event.created", title="theirs")
        self._make(self.user, "calendar_event.created", title="mine")
        self.client.force_authenticate(user=self.user)
        self.assertEqual([e["title"] for e in self.client.get(FEED).data["results"]], ["mine"])

    def test_newest_first(self):
        first = self._make(self.user, "calendar_event.created", title="first")
        second = self._make(self.user, "calendar_event.deleted", title="second")
        AgentActivityEvent.objects.filter(pk=first.pk).update(created_at=timezone.now() - timedelta(hours=1))
        self.client.force_authenticate(user=self.user)
        self.assertEqual([e["title"] for e in self.client.get(FEED).data["results"]], ["second", "first"])
        self.assertEqual(second.pk, self.client.get(FEED).data["results"][0]["id"])
