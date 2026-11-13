"""
A reminder is on the calendar any number of times, each a 15-minute block, and each block
notifies at its own start.
"""

import importlib
from datetime import timedelta
from unittest import mock

from django.apps import apps as django_apps
from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import Account
from team.models import Notification, TeamMember, UserProfile

from ..models import CalendarEvent, Reminder
from ..tasks import deliver_due_reminders

URL = "/api/v1/scheduler/reminders/"
QUARTER = timedelta(minutes=15)


def blocks(reminder=None):
    qs = CalendarEvent.objects.filter(calendar_id="reminders")
    return qs.filter(reminder=reminder) if reminder is not None else qs


class _Base(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user("liz", email="liz@example.com", password="x")
        UserProfile.objects.create(user=self.user)
        self.member = TeamMember.objects.create(user=self.user, full_name="Liz", email="liz@example.com")
        self.account = Account.objects.create(company_name="Acme")
        self.account.team_members.add(self.member)
        self.client.force_authenticate(user=self.user)
        self.due = (timezone.now() + timedelta(days=1)).replace(second=0, microsecond=0)

    def create(self, **extra):
        body = {"title": "Call Acme", "due_at": self.due.isoformat(), "notify_in_app": True}
        body.update(extra)
        resp = self.client.post(URL, body, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        return resp.data["id"]

    def add(self, rid, start):
        return self.client.post(f"{URL}{rid}/occurrences/", {"start": start.isoformat()}, format="json")


class FirstOccurrenceTests(_Base):
    def test_creating_a_reminder_adds_it_to_the_calendar_at_its_due_time_for_15_minutes(self):
        rid = self.create()
        [b] = blocks(Reminder.objects.get(pk=rid))
        self.assertEqual(b.start_datetime, self.due)
        self.assertEqual(b.end_datetime, self.due + QUARTER)
        self.assertEqual((b.title, b.owner, b.all_day), ("Call Acme", self.user, False))

    def test_the_block_belongs_to_the_linked_account(self):
        rid = self.create(resource_type="account", resource_id=self.account.pk, resource_label="Acme")
        self.assertEqual(blocks(Reminder.objects.get(pk=rid)).get().account, self.account)
        self.assertIsNone(blocks(Reminder.objects.get(pk=self.create(title="Solo"))).get().account)

    def test_the_api_lists_every_time_the_reminder_is_on_the_calendar(self):
        rid = self.create()
        later = self.due + timedelta(hours=3)
        self.add(rid, later)
        resp = self.client.get(f"{URL}{rid}/")
        starts = [o["start"] for o in resp.data["occurrences"]]
        self.assertEqual(len(starts), 2)
        self.assertEqual(starts, sorted(starts))

    def test_a_calendar_failure_never_blocks_saving_the_reminder(self):
        with mock.patch("scheduler.reminder_calendar._sync", side_effect=RuntimeError("db hiccup")):
            rid = self.create()
        self.assertTrue(Reminder.objects.filter(pk=rid).exists())

    def test_the_events_api_returns_a_15_minute_block(self):
        self.create()
        events = self.client.get("/api/v1/scheduler/events/", {
            "start": (self.due - timedelta(days=1)).isoformat(), "end": (self.due + timedelta(days=1)).isoformat(),
        }).data
        [row] = [e for e in events if e["calendar_id"] == "reminders"]
        self.assertEqual(
            timezone.datetime.fromisoformat(row["end_datetime"].replace("Z", "+00:00"))
            - timezone.datetime.fromisoformat(row["start_datetime"].replace("Z", "+00:00")),
            QUARTER,
        )


class MultipleOccurrencesTests(_Base):
    def setUp(self):
        super().setUp()
        self.rid = self.create()
        self.reminder = Reminder.objects.get(pk=self.rid)

    def test_a_reminder_can_be_added_to_the_calendar_again_at_another_time(self):
        later = self.due + timedelta(days=2, hours=1)
        resp = self.add(self.rid, later)
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(blocks(self.reminder).count(), 2)
        new = blocks(self.reminder).get(start_datetime=later)
        self.assertEqual(new.end_datetime, later + QUARTER, "added blocks are 15 minutes too")
        self.assertEqual(len(resp.data["occurrences"]), 2)

    def test_it_can_be_added_many_times(self):
        for hours in (2, 4, 6):
            self.assertEqual(self.add(self.rid, self.due + timedelta(hours=hours)).status_code, 201)
        self.assertEqual(blocks(self.reminder).count(), 4)

    def test_the_same_minute_twice_is_one_block(self):
        later = self.due + timedelta(hours=2)
        self.add(self.rid, later)
        resp = self.add(self.rid, later + timedelta(seconds=20))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(blocks(self.reminder).count(), 2)

    def test_adding_does_not_change_the_due_time(self):
        self.add(self.rid, self.due + timedelta(hours=5))
        self.reminder.refresh_from_db()
        self.assertEqual(self.reminder.due_at, self.due)

    def test_a_bad_start_is_refused(self):
        for bad in ("", "tomorrow", None):
            resp = self.client.post(f"{URL}{self.rid}/occurrences/", {"start": bad}, format="json")
            self.assertEqual(resp.status_code, 400)
        self.assertEqual(blocks(self.reminder).count(), 1)

    def test_a_dismissed_reminder_cannot_be_added(self):
        self.client.post(f"{URL}{self.rid}/dismiss/")
        self.assertEqual(self.add(self.rid, self.due + timedelta(hours=1)).status_code, 400)

    def test_another_user_cannot_add_to_my_reminder(self):
        other = User.objects.create_user("ana", email="ana@example.com", password="x")
        self.client.force_authenticate(user=other)
        self.assertEqual(self.add(self.rid, self.due + timedelta(hours=1)).status_code, 404)
        self.assertEqual(blocks(self.reminder).count(), 1)

    def test_a_block_added_to_a_moment_already_past_does_not_notify(self):
        past = timezone.now() - timedelta(hours=1)
        self.add(self.rid, past)
        self.assertIsNotNone(blocks(self.reminder).get(start_datetime=past).reminder_notified_at)

    def test_moving_one_block_leaves_the_others(self):
        extra = self.due + timedelta(hours=2)
        self.add(self.rid, extra)
        block = blocks(self.reminder).get(start_datetime=extra)
        new = self.due + timedelta(hours=9)
        resp = self.client.patch(f"{URL}{self.rid}/occurrences/{block.pk}/", {"start": new.isoformat()}, format="json")
        self.assertEqual(resp.status_code, 200)
        block.refresh_from_db()
        self.assertEqual((block.start_datetime, block.end_datetime), (new, new + QUARTER))
        self.reminder.refresh_from_db()
        self.assertEqual(self.reminder.due_at, self.due, "an extra block moving does not change the due time")
        self.assertEqual(blocks(self.reminder).filter(start_datetime=self.due).count(), 1)

    def test_moving_the_block_at_the_due_time_moves_the_due_time(self):
        first = blocks(self.reminder).get()
        new = self.due + timedelta(hours=3)
        self.client.patch(f"{URL}{self.rid}/occurrences/{first.pk}/", {"start": new.isoformat()}, format="json")
        self.reminder.refresh_from_db()
        self.assertEqual(self.reminder.due_at, new)

    def test_moving_onto_another_blocks_minute_is_refused(self):
        extra = self.due + timedelta(hours=2)
        self.add(self.rid, extra)
        block = blocks(self.reminder).get(start_datetime=extra)
        resp = self.client.patch(f"{URL}{self.rid}/occurrences/{block.pk}/", {"start": self.due.isoformat()}, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_a_block_can_be_removed_without_touching_the_reminder_or_the_others(self):
        extra = self.due + timedelta(hours=2)
        self.add(self.rid, extra)
        block = blocks(self.reminder).get(start_datetime=extra)
        resp = self.client.delete(f"{URL}{self.rid}/occurrences/{block.pk}/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(blocks(self.reminder).count(), 1)
        self.assertTrue(Reminder.objects.filter(pk=self.rid).exists())

    def test_a_block_that_is_not_this_reminders_is_404(self):
        other_rid = self.create(title="Other")
        other_block = blocks(Reminder.objects.get(pk=other_rid)).get()
        self.assertEqual(self.client.delete(f"{URL}{self.rid}/occurrences/{other_block.pk}/").status_code, 404)
        self.assertTrue(CalendarEvent.objects.filter(pk=other_block.pk).exists())


class FollowingTheReminderTests(_Base):
    def test_changing_the_due_time_moves_only_the_block_at_the_old_due_time(self):
        rid = self.create()
        extra = self.due + timedelta(hours=2)
        self.add(rid, extra)
        new_due = self.due + timedelta(hours=7)
        self.client.patch(f"{URL}{rid}/", {"due_at": new_due.isoformat()}, format="json")
        starts = sorted(b.start_datetime for b in blocks(Reminder.objects.get(pk=rid)))
        self.assertEqual(starts, sorted([extra, new_due]))
        self.assertTrue(all(b.end_datetime - b.start_datetime == QUARTER for b in blocks()))

    def test_renaming_and_relinking_follow_the_reminder_on_every_block(self):
        rid = self.create()
        self.add(rid, self.due + timedelta(hours=2))
        self.client.patch(f"{URL}{rid}/", {"title": "Renamed", "resource_type": "account",
                                           "resource_id": self.account.pk}, format="json")
        for b in blocks(Reminder.objects.get(pk=rid)):
            self.assertEqual((b.title, b.account), ("Renamed", self.account))

    def test_saving_again_never_adds_a_block(self):
        rid = self.create()
        for i in range(3):
            self.client.patch(f"{URL}{rid}/", {"title": f"t{i}"}, format="json")
        self.assertEqual(blocks().count(), 1)

    def test_a_block_the_user_deleted_does_not_come_back_on_an_unrelated_edit(self):
        rid = self.create()
        blocks().delete()
        self.client.patch(f"{URL}{rid}/", {"title": "again"}, format="json")
        self.assertEqual(blocks().count(), 0)

    def test_dismissing_removes_every_block_and_rearming_restores_the_first(self):
        rid = self.create()
        self.add(rid, self.due + timedelta(hours=2))
        self.client.post(f"{URL}{rid}/dismiss/")
        self.assertEqual(blocks().count(), 0)
        self.client.patch(f"{URL}{rid}/", {"status": "pending"}, format="json")
        [b] = blocks()
        self.assertEqual(b.start_datetime, self.due)

    def test_snoozing_moves_the_block_at_the_due_time(self):
        rid = self.create()
        until = self.due + timedelta(hours=4)
        self.client.post(f"{URL}{rid}/snooze/", {"until": until.isoformat()}, format="json")
        [b] = blocks()
        self.assertEqual((b.start_datetime, b.end_datetime), (until, until + QUARTER))

    def test_a_reminder_that_already_fired_fires_again_when_moved_to_the_future(self):
        rid = self.create()
        Reminder.objects.filter(pk=rid).update(status="sent")
        self.client.patch(f"{URL}{rid}/", {"due_at": (timezone.now() + timedelta(hours=3)).isoformat()}, format="json")
        self.assertEqual(Reminder.objects.get(pk=rid).status, "pending")

    def test_nobody_else_sees_the_blocks(self):
        self.create()
        other = User.objects.create_user("ana", email="ana@example.com", password="x")
        self.client.force_authenticate(user=other)
        events = self.client.get("/api/v1/scheduler/events/", {
            "start": (self.due - timedelta(days=1)).isoformat(), "end": (self.due + timedelta(days=1)).isoformat(),
        }).data
        self.assertEqual([e for e in events if e["calendar_id"] == "reminders"], [])


@override_settings(NOTIFICATION_ALLOWED_EMAILS="")
class NotifyAtEachStartTests(TestCase):
    """Every occurrence notifies at its own start, with the reminder's details."""

    def setUp(self):
        self.user = User.objects.create_user("liz", email="liz@example.com", password="x")
        UserProfile.objects.create(user=self.user)
        self.now = timezone.now()

    def reminder(self, due_offset=timedelta(minutes=-1), **kw):
        r = Reminder.objects.create(
            created_by=self.user, title="Prep deck", body="Slides", due_at=self.now + due_offset,
            notify_in_app=True, **kw,
        )
        return r

    def block(self, reminder, start, **kw):
        return CalendarEvent.objects.create(
            owner=self.user, title=reminder.title, calendar_id="reminders", reminder=reminder,
            start_datetime=start, end_datetime=start + QUARTER, **kw,
        )

    @mock.patch("scheduler.tasks._send_in_app")
    def test_a_due_extra_block_notifies_once_with_the_reminders_details(self, send):
        r = self.reminder(due_offset=timedelta(days=1))  # its own due time is tomorrow
        b = self.block(r, self.now - timedelta(minutes=1))
        deliver_due_reminders()
        deliver_due_reminders()  # a second minute must not repeat it
        self.assertEqual(send.call_count, 1)
        self.assertEqual(send.call_args.args[1].title, "Prep deck")
        n = Notification.objects.get(user=self.user)
        self.assertEqual((n.title, n.body, n.status), ("⏰ Prep deck", "Slides", "sent"))
        b.refresh_from_db()
        self.assertIsNotNone(b.reminder_notified_at)
        r.refresh_from_db()
        self.assertEqual(r.status, "pending", "an extra block does not use up the reminder's own due time")

    @mock.patch("scheduler.tasks._send_in_app")
    def test_each_block_notifies_separately(self, send):
        r = self.reminder(due_offset=timedelta(days=1))
        self.block(r, self.now - timedelta(minutes=2))
        self.block(r, self.now - timedelta(minutes=1))
        deliver_due_reminders()
        self.assertEqual(send.call_count, 2)

    @mock.patch("scheduler.tasks._send_in_app")
    def test_a_future_block_waits(self, send):
        r = self.reminder(due_offset=timedelta(days=1))
        self.block(r, self.now + timedelta(hours=1))
        deliver_due_reminders()
        send.assert_not_called()

    @mock.patch("scheduler.tasks._send_in_app")
    def test_the_block_at_the_due_time_does_not_notify_twice(self, send):
        r = self.reminder()  # due a minute ago
        self.block(r, r.due_at)
        deliver_due_reminders()
        self.assertEqual(send.call_count, 1, "the reminder notifies for its due time; the block must not repeat it")

    @mock.patch("scheduler.tasks._send_in_app")
    def test_a_dismissed_reminders_blocks_stay_quiet(self, send):
        r = self.reminder(due_offset=timedelta(days=1), status="dismissed")
        self.block(r, self.now - timedelta(minutes=1))
        deliver_due_reminders()
        send.assert_not_called()

    @mock.patch("scheduler.tasks._send_in_app")
    def test_a_long_overdue_block_is_marked_handled_without_notifying(self, send):
        r = self.reminder(due_offset=timedelta(days=1))
        b = self.block(r, self.now - timedelta(hours=3))
        deliver_due_reminders()
        send.assert_not_called()
        b.refresh_from_db()
        self.assertIsNotNone(b.reminder_notified_at)

    @mock.patch("scheduler.tasks._send_in_app")
    def test_an_already_claimed_block_is_not_notified_again(self, send):
        r = self.reminder(due_offset=timedelta(days=1))
        self.block(r, self.now - timedelta(minutes=1), reminder_notified_at=self.now)
        deliver_due_reminders()
        send.assert_not_called()

    @mock.patch("scheduler.tasks._send_in_app")
    def test_moving_a_block_re_arms_it(self, send):
        r = self.reminder(due_offset=timedelta(days=1))
        b = self.block(r, self.now - timedelta(minutes=1), reminder_notified_at=self.now)
        from .. import reminder_calendar

        reminder_calendar.move_occurrence(r, b, self.now - timedelta(seconds=30))
        deliver_due_reminders()
        self.assertEqual(send.call_count, 1)

    @mock.patch("scheduler.tasks._send_in_app")
    def test_recipients_are_notified_for_a_block_too(self, send):
        ana = User.objects.create_user("ana", email="ana@example.com", password="x")
        UserProfile.objects.create(user=ana)
        r = self.reminder(due_offset=timedelta(days=1))
        r.recipients.add(ana)
        self.block(r, self.now - timedelta(minutes=1))
        deliver_due_reminders()
        self.assertEqual(sorted(c.args[0].username for c in send.call_args_list), ["ana", "liz"])


class BackfillMigrationTests(_Base):
    def test_zero_length_markers_become_15_minutes(self):
        r = Reminder.objects.create(created_by=self.user, title="x", due_at=self.due)
        zero = CalendarEvent.objects.create(owner=self.user, title="x", calendar_id="reminders", reminder=r,
                                            start_datetime=self.due, end_datetime=self.due)
        mod = importlib.import_module("scheduler.migrations.0015_reminder_occurrence_notified")
        mod.give_markers_a_length(django_apps, None)
        zero.refresh_from_db()
        self.assertEqual(zero.end_datetime - zero.start_datetime, QUARTER)
