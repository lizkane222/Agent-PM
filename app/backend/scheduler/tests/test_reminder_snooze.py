"""Snoozing reschedules a reminder to a time the user picks, and it fires again then."""

from datetime import timedelta
from unittest import mock

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import Account
from team.models import TeamMember, UserProfile

from ..models import CalendarEvent, Reminder
from ..tasks import deliver_due_reminders

URL = "/api/v1/scheduler/reminders/"
QUARTER = timedelta(minutes=15)


class _Base(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user("liz", email="liz@example.com", password="x")
        UserProfile.objects.create(user=self.user)
        self.member = TeamMember.objects.create(user=self.user, full_name="Liz", email="liz@example.com")
        self.acme = Account.objects.create(company_name="Acme")
        self.acme.team_members.add(self.member)
        self.client.force_authenticate(user=self.user)
        self.now = timezone.now().replace(second=0, microsecond=0)

    def reminder(self, **kw):
        r = Reminder.objects.create(
            created_by=self.user, title="Prep QBR", due_at=kw.pop("due_at", self.now + timedelta(hours=1)),
            resource_type=kw.pop("resource_type", "account"),
            resource_id=kw.pop("resource_id", self.acme.pk), notify_in_app=True, **kw,
        )
        from .. import reminder_calendar
        reminder_calendar.sync_reminder_block(r, created=True)
        return r

    def snooze(self, r, **body):
        return self.client.post(f"{URL}{r.pk}/snooze/", body, format="json")

    def meeting(self, hours, account=None, **kw):
        start = self.now + timedelta(hours=hours)
        defaults = dict(owner=self.user, title="QBR", account=account or self.acme, calendar_id="primary",
                        start_datetime=start, end_datetime=start + timedelta(hours=1))
        defaults.update(kw)
        return CalendarEvent.objects.create(**defaults)


class SnoozeUntilTests(_Base):
    def test_moves_the_due_time_and_re_arms_the_reminder(self):
        r = self.reminder(status="sent", due_at=self.now - timedelta(hours=1))
        until = self.now + timedelta(minutes=15)
        resp = self.snooze(r, until=until.isoformat())
        self.assertEqual(resp.status_code, 200)
        r.refresh_from_db()
        self.assertEqual((r.due_at, r.status), (until, "pending"))
        self.assertEqual(resp.data["status"], "pending")

    def test_the_calendar_block_at_the_old_due_time_moves_with_it(self):
        r = self.reminder()
        until = self.now + timedelta(days=1, hours=2)
        self.snooze(r, until=until.isoformat())
        [b] = CalendarEvent.objects.filter(reminder=r, calendar_id="reminders")
        self.assertEqual((b.start_datetime, b.end_datetime), (until, until + QUARTER))

    def test_other_calendar_blocks_stay_put(self):
        r = self.reminder()
        extra = self.now + timedelta(days=3)
        self.client.post(f"{URL}{r.pk}/occurrences/", {"start": extra.isoformat()}, format="json")
        self.snooze(r, until=(self.now + timedelta(hours=5)).isoformat())
        self.assertTrue(CalendarEvent.objects.filter(reminder=r, start_datetime=extra).exists())
        self.assertEqual(CalendarEvent.objects.filter(reminder=r).count(), 2)

    def test_a_dismissed_reminder_comes_back(self):
        r = self.reminder(status="dismissed")
        CalendarEvent.objects.filter(reminder=r).delete()
        until = self.now + timedelta(hours=2)
        self.assertEqual(self.snooze(r, until=until.isoformat()).status_code, 200)
        r.refresh_from_db()
        self.assertEqual(r.status, "pending")
        self.assertEqual(CalendarEvent.objects.get(reminder=r).start_datetime, until)

    def test_the_past_the_present_and_nonsense_are_refused_and_change_nothing(self):
        r = self.reminder()
        before = r.due_at
        for body in ({"until": (self.now - timedelta(minutes=5)).isoformat()}, {"until": "soon"},
                     {"until": ""}, {}, {"preset": "whenever"}):
            resp = self.snooze(r, **body)
            self.assertEqual(resp.status_code, 400, body)
            self.assertIn("until", resp.data)
        r.refresh_from_db()
        self.assertEqual(r.due_at, before)

    def test_a_naive_time_is_read_as_utc_not_rejected(self):
        r = self.reminder()
        future = (self.now + timedelta(days=2)).replace(tzinfo=None).isoformat()
        self.assertEqual(self.snooze(r, until=future).status_code, 200)

    def test_another_users_reminder_is_404(self):
        r = self.reminder()
        self.client.force_authenticate(user=User.objects.create_user("ana", email="a@example.com", password="x"))
        self.assertEqual(self.snooze(r, until=(self.now + timedelta(hours=3)).isoformat()).status_code, 404)

    def test_unauthenticated_is_rejected(self):
        r = self.reminder()
        self.client.force_authenticate(user=None)
        self.assertEqual(self.snooze(r, until=(self.now + timedelta(hours=3)).isoformat()).status_code, 401)


class SnoozeBeforeNextAccountMeetingTests(_Base):
    def preset(self, r):
        return self.snooze(r, preset="next_account_meeting")

    def test_fires_15_minutes_before_the_next_meeting_on_the_account(self):
        r = self.reminder()
        m = self.meeting(5)
        self.meeting(9)  # a later one is ignored
        resp = self.preset(r)
        self.assertEqual(resp.status_code, 200)
        r.refresh_from_db()
        self.assertEqual(r.due_at, m.start_datetime - timedelta(minutes=15))

    def test_a_meeting_starting_within_15_minutes_still_reminds_a_minute_from_now(self):
        r = self.reminder()
        self.meeting(0.1)  # 6 minutes away
        before = timezone.now()
        self.assertEqual(self.preset(r).status_code, 200)
        r.refresh_from_db()
        self.assertGreater(r.due_at, before)
        self.assertLess(r.due_at - before, timedelta(minutes=3))

    def test_other_accounts_reminders_work_and_cancelled_all_day_or_skipped_meetings_do_not_count(self):
        r = self.reminder()
        other = Account.objects.create(company_name="Globex")
        self.meeting(2, account=other)
        self.meeting(3, status="cancelled")
        self.meeting(4, all_day=True)
        self.meeting(5, attended=False)
        self.meeting(6, calendar_id="work_tracking")
        self.meeting(7, calendar_id="reminders")
        good = self.meeting(8)
        self.preset(r)
        r.refresh_from_db()
        self.assertEqual(r.due_at, good.start_datetime - timedelta(minutes=15))

    def test_someone_elses_meeting_on_the_same_account_does_not_count(self):
        r = self.reminder()
        ana = User.objects.create_user("ana", email="ana@example.com", password="x")
        self.meeting(2, owner=ana)
        resp = self.preset(r)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("no upcoming meeting", resp.data["until"].lower())

    def test_no_upcoming_meeting_is_refused_with_a_reason_and_changes_nothing(self):
        r = self.reminder()
        before = r.due_at
        resp = self.preset(r)
        self.assertEqual(resp.status_code, 400)
        r.refresh_from_db()
        self.assertEqual(r.due_at, before)

    def test_a_reminder_with_no_account_is_refused(self):
        r = self.reminder(resource_type="general", resource_id=None)
        resp = self.preset(r)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("account", resp.data["until"])

    def test_a_reminder_about_a_meeting_uses_that_meetings_account(self):
        base = self.meeting(1)
        r = self.reminder(resource_type="calendar_event", resource_id=base.pk)
        later = self.meeting(6)
        self.preset(r)
        r.refresh_from_db()
        self.assertEqual(r.due_at, base.start_datetime - timedelta(minutes=15))
        self.assertLess(r.due_at, later.start_datetime)


@override_settings(NOTIFICATION_ALLOWED_EMAILS="")
class SnoozedReminderFiresAgainTests(TestCase):
    @mock.patch("scheduler.tasks._send_in_app")
    def test_a_sent_reminder_that_is_snoozed_fires_again_at_the_new_time_not_before(self, send):
        user = User.objects.create_user("liz", email="liz@example.com", password="x")
        UserProfile.objects.create(user=user)
        now = timezone.now()
        r = Reminder.objects.create(created_by=user, title="x", due_at=now - timedelta(minutes=1), status="sent", notify_in_app=True)
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_authenticate(user=user)
        until = now + timedelta(minutes=15)
        self.assertEqual(client.post(f"{URL}{r.pk}/snooze/", {"until": until.isoformat()}, format="json").status_code, 200)
        deliver_due_reminders()
        send.assert_not_called()  # not yet
        Reminder.objects.filter(pk=r.pk).update(due_at=now - timedelta(seconds=5))  # time passes
        deliver_due_reminders()
        send.assert_called_once()


class SnoozeMovesTheBlockYouSeeTests(_Base):
    """The card sits under one time. Snoozing moves *that* block to the new time."""

    def block_at(self, r, start):
        return CalendarEvent.objects.filter(reminder=r, calendar_id="reminders", start_datetime=start).first()

    def snooze_from(self, r, from_start, until):
        return self.client.post(f"{URL}{r.pk}/snooze/",
                                {"until": until.isoformat(), "from": from_start.isoformat()}, format="json")

    def test_an_extra_block_moves_and_the_due_time_stays(self):
        r = self.reminder(due_at=self.now - timedelta(hours=3), status="sent")
        extra = self.now + timedelta(hours=1)
        self.client.post(f"{URL}{r.pk}/occurrences/", {"start": extra.isoformat()}, format="json")
        until = self.now + timedelta(days=1)
        self.assertEqual(self.snooze_from(r, extra, until).status_code, 200)
        self.assertIsNone(self.block_at(r, extra))
        moved = self.block_at(r, until)
        self.assertEqual(moved.end_datetime - moved.start_datetime, QUARTER)
        self.assertIsNone(moved.reminder_notified_at, "it will notify at the new time")
        r.refresh_from_db()
        self.assertEqual(r.due_at, self.now - timedelta(hours=3), "the due time is untouched")
        self.assertEqual(self.block_at(r, r.due_at).reminder_id, r.pk, "the other block stays put")

    def test_the_block_at_the_due_time_moves_the_due_time_and_re_arms(self):
        r = self.reminder(due_at=self.now - timedelta(minutes=30), status="sent")
        until = self.now + timedelta(hours=2)
        self.snooze_from(r, r.due_at, until)
        r.refresh_from_db()
        self.assertEqual((r.due_at, r.status), (until, "pending"))
        self.assertEqual(CalendarEvent.objects.filter(reminder=r, calendar_id="reminders").count(), 1)

    def test_the_old_snooze_state_is_re_armed_by_a_snooze(self):
        r = self.reminder(due_at=self.now + timedelta(hours=1), status="snoozed")
        self.snooze_from(r, r.due_at, self.now + timedelta(hours=5))
        r.refresh_from_db()
        self.assertEqual(r.status, "pending")

    def test_a_time_with_no_block_still_reschedules_through_the_due_time(self):
        r = self.reminder()
        CalendarEvent.objects.filter(reminder=r).delete()
        until = self.now + timedelta(days=2)
        self.snooze_from(r, self.now + timedelta(minutes=1), until)  # no block there
        r.refresh_from_db()
        self.assertEqual(r.due_at, until)
        self.assertEqual(self.block_at(r, until).reminder_id, r.pk)

    def test_snoozing_onto_a_minute_that_already_has_a_block_is_refused_and_changes_nothing(self):
        r = self.reminder()
        taken = self.now + timedelta(hours=6)
        self.client.post(f"{URL}{r.pk}/occurrences/", {"start": taken.isoformat()}, format="json")
        resp = self.snooze_from(r, r.due_at, taken)
        self.assertEqual(resp.status_code, 400)
        r.refresh_from_db()
        self.assertIsNotNone(self.block_at(r, r.due_at))

    def test_a_snoozed_extra_block_actually_notifies_at_the_new_time(self):
        from unittest import mock
        from django.test import override_settings

        r = self.reminder(due_at=self.now - timedelta(hours=3), status="sent")
        extra = self.now + timedelta(hours=1)
        self.client.post(f"{URL}{r.pk}/occurrences/", {"start": extra.isoformat()}, format="json")
        self.snooze_from(r, extra, self.now + timedelta(minutes=1))
        # Time passes: the block's start arrives.
        CalendarEvent.objects.filter(reminder=r, start_datetime=self.now + timedelta(minutes=1)).update(
            start_datetime=timezone.now() - timedelta(seconds=10))
        with override_settings(NOTIFICATION_ALLOWED_EMAILS=""), mock.patch("scheduler.tasks._send_in_app") as send:
            deliver_due_reminders()
        send.assert_called_once()
