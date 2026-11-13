"""
Reminders that notify other people: who may be added, the required approval, the opt-out,
and delivery. Rules live in scheduler/reminder_recipients.py + ReminderSerializer.
"""

from datetime import timedelta
from unittest import mock

from asgiref.sync import async_to_sync
from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import Account
from agents.mcp_server import mcp_server
from team.models import Notification, TeamMember, UserProfile

from ..models import Reminder
from ..tasks import deliver_due_reminders

URL = "/api/v1/scheduler/reminders/"
RECIPIENTS_URL = "/api/v1/scheduler/reminders/recipients/"


def _person(username, *, allow=True, on=None):
    user = User.objects.create_user(username, email=f"{username}@example.com", password="x")
    UserProfile.objects.create(user=user, allow_reminders_from_others=allow)
    member = TeamMember.objects.create(user=user, full_name=username.title(), email=user.email)
    if on is not None:
        on.team_members.add(member)
    return user


class _Base(APITestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.account = Account.objects.create(company_name="Acme")
        self.me = _person("liz", on=self.account)
        self.ana = _person("ana", on=self.account)
        self.opted_out = _person("ben", allow=False, on=self.account)
        self.stranger = _person("cy")  # not on the account
        self.client.force_authenticate(user=self.me)

    def body(self, **extra):
        data = {
            "title": "Call Acme",
            "due_at": (timezone.now() + timedelta(hours=1)).isoformat(),
            "resource_type": "account",
            "resource_id": self.account.pk,
            "resource_label": "Acme",
            "notify_in_app": True,
        }
        data.update(extra)
        return data

    def post(self, **extra):
        return self.client.post(URL, self.body(**extra), format="json")


class CreateRulesTests(_Base):
    def test_default_notifies_only_the_creator(self):
        resp = self.post()
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["recipients"], [])
        self.assertEqual(resp.data["recipient_details"], [])

    def test_an_account_reminder_with_no_recipients_needs_no_confirmation(self):
        self.assertEqual(self.post().status_code, 201)

    def test_adding_a_person_without_confirmation_is_refused_and_creates_nothing(self):
        resp = self.post(recipients=[self.ana.pk])
        self.assertEqual(resp.status_code, 400)
        self.assertIn("confirm_notify_others", resp.data)
        self.assertEqual(Reminder.objects.count(), 0)

    def test_confirmation_must_be_true(self):
        resp = self.post(recipients=[self.ana.pk], confirm_notify_others=False)
        self.assertEqual(resp.status_code, 400)

    def test_confirmed_recipients_are_saved_and_named(self):
        resp = self.post(recipients=[self.ana.pk], confirm_notify_others=True)
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["recipients"], [self.ana.pk])
        self.assertEqual(resp.data["recipient_details"], [{"id": self.ana.pk, "name": "Ana"}])
        self.assertNotIn("confirm_notify_others", resp.data)

    def test_recipients_need_an_account_link(self):
        resp = self.post(recipients=[self.ana.pk], confirm_notify_others=True,
                         resource_type="general", resource_id=None)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("recipients", resp.data)

    def test_someone_off_the_accounts_team_is_refused(self):
        resp = self.post(recipients=[self.stranger.pk], confirm_notify_others=True)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("recipients", resp.data)

    def test_someone_who_opted_out_is_refused_with_the_reason(self):
        resp = self.post(recipients=[self.opted_out.pk], confirm_notify_others=True)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("turned off being notified", str(resp.data["recipients"]))
        self.assertEqual(Reminder.objects.count(), 0)

    def test_a_creator_not_on_the_account_cannot_notify_its_team(self):
        self.client.force_authenticate(user=self.stranger)
        resp = self.post(recipients=[self.ana.pk], confirm_notify_others=True)
        self.assertEqual(resp.status_code, 400)

    def test_the_creator_is_never_stored_as_a_recipient(self):
        resp = self.post(recipients=[self.me.pk], confirm_notify_others=True)
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["recipients"], [])

    def test_an_unknown_user_id_is_refused(self):
        resp = self.post(recipients=[999999], confirm_notify_others=True)
        self.assertEqual(resp.status_code, 400)


class UpdateRulesTests(_Base):
    def setUp(self):
        super().setUp()
        self.rid = self.post(recipients=[self.ana.pk], confirm_notify_others=True).data["id"]

    def patch(self, **data):
        return self.client.patch(f"{URL}{self.rid}/", data, format="json")

    def test_editing_other_fields_keeps_recipients_and_needs_no_confirmation(self):
        resp = self.patch(title="Renamed")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["recipients"], [self.ana.pk])

    def test_adding_another_person_needs_confirmation(self):
        extra = _person("dee", on=self.account)
        resp = self.patch(recipients=[self.ana.pk, extra.pk])
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(Reminder.objects.get(pk=self.rid).recipients.count(), 1)
        resp = self.patch(recipients=[self.ana.pk, extra.pk], confirm_notify_others=True)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data["recipients"]), 2)

    def test_removing_a_person_needs_no_confirmation(self):
        resp = self.patch(recipients=[])
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["recipients"], [])

    def test_a_recipient_who_opts_out_later_does_not_block_unrelated_edits(self):
        UserProfile.objects.filter(user=self.ana).update(allow_reminders_from_others=False)
        resp = self.patch(title="Still fine", recipients=[self.ana.pk])
        self.assertEqual(resp.status_code, 200)

    def test_relinking_to_another_account_drops_recipients(self):
        other = Account.objects.create(company_name="Globex")
        other.team_members.add(self.me.team_member)
        resp = self.patch(resource_id=other.pk, resource_label="Globex")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["recipients"], [])

    def test_unlinking_the_account_drops_recipients(self):
        resp = self.patch(resource_type="general", resource_id=None)
        self.assertEqual(resp.data["recipients"], [])

    def test_another_user_cannot_edit_the_reminder_even_as_a_recipient(self):
        self.client.force_authenticate(user=self.ana)
        self.assertEqual(self.patch(title="mine now").status_code, 404)
        self.assertEqual(self.client.get(f"{URL}{self.rid}/").status_code, 404)


class RecipientsEndpointTests(_Base):
    def test_lists_teammates_with_availability_excluding_self(self):
        resp = self.client.get(RECIPIENTS_URL, {"account": self.account.pk})
        self.assertEqual(resp.status_code, 200)
        rows = {r["name"]: r for r in resp.data["results"]}
        self.assertEqual(set(rows), {"Ana", "Ben"})
        self.assertTrue(rows["Ana"]["available"])
        self.assertFalse(rows["Ben"]["available"])
        self.assertIn("turned off being notified", rows["Ben"]["reason"])
        self.assertNotIn(self.me.pk, [r["user_id"] for r in resp.data["results"]])

    def test_members_without_a_login_are_listed_but_cannot_be_chosen(self):
        ghost = TeamMember.objects.create(full_name="No Login", email="ghost@example.com")
        self.account.team_members.add(ghost)
        rows = {r["name"]: r for r in self.client.get(RECIPIENTS_URL, {"account": self.account.pk}).data["results"]}
        row = rows["No Login"]
        self.assertEqual((row["user_id"], row["member_id"], row["available"]), (None, ghost.pk, False))
        self.assertIn("hasn't signed in to AgentPM", row["reason"])

    def test_a_member_marked_inactive_is_not_listed(self):
        gone = TeamMember.objects.create(full_name="Left Co", email="left@example.com", status="inactive")
        self.account.team_members.add(gone)
        names = [r["name"] for r in self.client.get(RECIPIENTS_URL, {"account": self.account.pk}).data["results"]]
        self.assertNotIn("Left Co", names)

    def test_an_account_of_people_who_never_signed_in_still_lists_them(self):
        lonely = Account.objects.create(company_name="Autodesk")
        lonely.team_members.add(self.me.team_member)
        for i in range(3):
            lonely.team_members.add(TeamMember.objects.create(full_name=f"Pat {i}", email=f"pat{i}@example.com"))
        data = self.client.get(RECIPIENTS_URL, {"account": lonely.pk}).data
        self.assertEqual([r["name"] for r in data["results"]], ["Pat 0", "Pat 1", "Pat 2"])
        self.assertTrue(all(not r["available"] for r in data["results"]))
        self.assertEqual(data["sources"], ["Autodesk"])

    def test_a_non_member_gets_404(self):
        self.client.force_authenticate(user=self.stranger)
        self.assertEqual(self.client.get(RECIPIENTS_URL, {"account": self.account.pk}).status_code, 404)

    def test_no_links_means_no_teammates_and_a_bad_link_is_404(self):
        resp = self.client.get(RECIPIENTS_URL)
        self.assertEqual((resp.status_code, resp.data["results"], resp.data["accounts"]), (200, [], []))
        self.assertEqual(self.client.get(RECIPIENTS_URL, {"account": "x"}).status_code, 404)

    def test_unauthenticated_is_rejected(self):
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get(RECIPIENTS_URL, {"account": self.account.pk}).status_code, 401)


class OptOutSettingTests(APITestCase):
    URL = "/api/v1/team/profiles/me/"

    def test_defaults_on_and_can_be_switched_off_and_on(self):
        user = User.objects.create_user("opt", email="opt@example.com", password="x")
        self.client.force_authenticate(user=user)
        self.assertTrue(self.client.get(self.URL).data["allow_reminders_from_others"])
        resp = self.client.patch(self.URL, {"allow_reminders_from_others": False}, format="json")
        self.assertFalse(resp.data["allow_reminders_from_others"])
        self.assertFalse(UserProfile.objects.get(user=user).allow_reminders_from_others)
        resp = self.client.patch(self.URL, {"allow_reminders_from_others": True}, format="json")
        self.assertTrue(resp.data["allow_reminders_from_others"])


@override_settings(NOTIFICATION_ALLOWED_EMAILS="")
class DeliveryTests(TestCase):
    def setUp(self):
        self.account = Account.objects.create(company_name="Acme")
        self.me = _person("liz", on=self.account)
        self.ana = _person("ana", on=self.account)

    def make(self, recipients=(), **kw):
        r = Reminder.objects.create(
            created_by=self.me, title="Prep deck", body="Slides", due_at=timezone.now() - timedelta(seconds=5),
            resource_type="account", resource_id=self.account.pk, notify_in_app=True, **kw,
        )
        r.recipients.set(recipients)
        return r

    @mock.patch("scheduler.tasks._send_in_app")
    def test_default_notifies_only_the_creator(self, send):
        self.make()
        deliver_due_reminders()
        self.assertEqual([c.args[0] for c in send.call_args_list], [self.me])
        self.assertFalse(Notification.objects.filter(user=self.ana).exists())

    @mock.patch("scheduler.tasks._send_in_app")
    def test_recipients_are_notified_too_with_the_senders_name(self, send):
        self.make([self.ana])
        deliver_due_reminders()
        self.assertEqual([c.args[0] for c in send.call_args_list], [self.me, self.ana])
        mine = Notification.objects.get(user=self.me)
        theirs = Notification.objects.get(user=self.ana)
        self.assertEqual(mine.body, "Slides")
        self.assertEqual(theirs.body, "Set by Liz — Slides")
        self.assertEqual(theirs.status, "sent")
        self.assertEqual(theirs.account, self.account)
        # The recipient is sent the shared copy, never the creator's own reminder object.
        self.assertEqual(send.call_args_list[1].args[1].body, "Set by Liz — Slides")

    @mock.patch("scheduler.tasks._send_in_app")
    def test_someone_who_opted_out_since_being_added_is_skipped(self, send):
        self.make([self.ana])
        UserProfile.objects.filter(user=self.ana).update(allow_reminders_from_others=False)
        deliver_due_reminders()
        self.assertEqual([c.args[0] for c in send.call_args_list], [self.me])
        self.assertFalse(Notification.objects.filter(user=self.ana).exists())

    @mock.patch("scheduler.tasks._send_in_app")
    def test_the_allowlist_applies_to_each_recipient(self, send):
        self.make([self.ana])
        with override_settings(NOTIFICATION_ALLOWED_EMAILS={self.me.email}):
            deliver_due_reminders()
        self.assertEqual([c.args[0] for c in send.call_args_list], [self.me])

    @mock.patch("scheduler.tasks._send_in_app", side_effect=[None, RuntimeError("feed down")])
    def test_one_recipients_failure_does_not_stop_the_reminder(self, send):
        r = self.make([self.ana])
        deliver_due_reminders()
        r.refresh_from_db()
        self.assertEqual(r.status, "sent")
        self.assertEqual(Notification.objects.get(user=self.ana).status, "failed")

    @mock.patch("scheduler.tasks._send_in_app")
    def test_sms_goes_to_the_recipients_own_number(self, _feed):
        UserProfile.objects.filter(user=self.ana).update(phone_number="+14155550199", notify_default_sms=True)
        UserProfile.objects.filter(user=self.me).update(phone_number="+14155550100")
        self.make([self.ana], notify_sms=True)
        with override_settings(TWILIO_ACCOUNT_SID="AC1", TWILIO_AUTH_TOKEN="t", TWILIO_PHONE_NUMBER="+15550000000"), \
                mock.patch("twilio.rest.Client") as client, \
                mock.patch("scheduler.tasks.check_sms_delivery.apply_async"):
            client.return_value.messages.create.return_value.sid = "SM1"
            deliver_due_reminders()
        sent = {c.kwargs["to"]: c.kwargs["body"] for c in client.return_value.messages.create.call_args_list}
        self.assertEqual(set(sent), {"+14155550100", "+14155550199"})
        self.assertIn("Set by Liz", sent["+14155550199"])
        self.assertNotIn("Set by", sent["+14155550100"])


class AgentCannotNotifyOthersTests(TestCase):
    """The agent tools expose no recipients argument, and the schema rejects unknown keys."""

    def setUp(self):
        cache.clear()
        self.account = Account.objects.create(company_name="Acme")
        self.me = _person("liz", on=self.account)
        self.ana = _person("ana", on=self.account)

    def test_create_reminder_refuses_recipients_and_the_flag(self):
        due = (timezone.now() + timedelta(hours=2)).isoformat()
        for extra in ({"recipients": [self.ana.pk]}, {"confirm_notify_others": True}):
            out = async_to_sync(mcp_server.dispatch)(
                "create_reminder", {"title": "x", "due_at": due, **extra}, user=self.me)
            self.assertEqual(out["status"], "error", extra)
        self.assertEqual(Reminder.objects.count(), 0)

    def test_update_reminder_refuses_recipients(self):
        r = Reminder.objects.create(created_by=self.me, title="x", due_at=timezone.now() + timedelta(hours=1))
        out = async_to_sync(mcp_server.dispatch)(
            "update_reminder", {"reminder_id": r.pk, "recipients": [self.ana.pk]}, user=self.me)
        self.assertEqual(out["status"], "error")
        self.assertEqual(r.recipients.count(), 0)


class DeletingAReminderRemovesItsCalendarBlocksTests(_Base):
    def _block(self, reminder, **kw):
        from ..models import CalendarEvent

        start = timezone.now() + timedelta(hours=1)
        return CalendarEvent.objects.create(
            owner=self.me, title="🔔 x", start_datetime=start, end_datetime=start + timedelta(minutes=15),
            calendar_id="reminders", reminder=reminder, **kw,
        )

    def test_blocks_are_deleted_with_the_reminder(self):
        from ..models import CalendarEvent

        rid = self.post().data["id"]
        reminder = Reminder.objects.get(pk=rid)
        self._block(reminder)
        self._block(reminder)
        other_block = self._block(None)  # an unrelated reminders-calendar row
        self.assertEqual(self.client.delete(f"{URL}{rid}/").status_code, 204)
        self.assertEqual(list(CalendarEvent.objects.values_list("pk", flat=True)), [other_block.pk])

    @mock.patch("scheduler.views.CalendarEventViewSet._delete_from_google")
    def test_a_google_mirrored_block_is_removed_from_google_too(self, delete_from_google):
        rid = self.post().data["id"]
        self._block(Reminder.objects.get(pk=rid), google_event_id="g123", is_synced=True)
        self._block(Reminder.objects.get(pk=rid))  # never synced: nothing to delete remotely
        self.client.delete(f"{URL}{rid}/")
        delete_from_google.assert_called_once_with("g123")

    @mock.patch("scheduler.views.CalendarEventViewSet._delete_from_google", side_effect=RuntimeError("google down"))
    def test_a_google_failure_does_not_block_the_delete(self, _):
        rid = self.post().data["id"]
        self._block(Reminder.objects.get(pk=rid), google_event_id="g1", is_synced=True)
        self.assertEqual(self.client.delete(f"{URL}{rid}/").status_code, 204)


@override_settings(NOTIFICATION_ALLOWED_EMAILS="")
class TeammatesAreReachedTheirOwnWayTests(TestCase):
    """The creator's "notify me via" is about the creator. Everyone else gets their own defaults."""

    def setUp(self):
        self.account = Account.objects.create(company_name="Acme")
        self.me = _person("liz", on=self.account)
        self.ana = _person("ana", on=self.account)

    def deliver(self, **creator_flags):
        r = Reminder.objects.create(created_by=self.me, title="Prep", due_at=timezone.now() - timedelta(minutes=1), **creator_flags)
        r.recipients.add(self.ana)
        sent = {"in_app": [], "push": [], "sms": [], "slack": []}
        with mock.patch("scheduler.tasks._send_in_app", side_effect=lambda u, rem: sent["in_app"].append(u.username)), \
                mock.patch("scheduler.tasks._send_push", side_effect=lambda p, rem: sent["push"].append(p.user.username) or True), \
                mock.patch("scheduler.tasks._send_sms", side_effect=lambda p, rem: sent["sms"].append(p.user.username) or "SM1"), \
                mock.patch("scheduler.tasks._send_slack", side_effect=lambda u, p, rem: sent["slack"].append(u.username) or True), \
                mock.patch("scheduler.tasks._schedule_sms_check"):
            deliver_due_reminders()
        return sent

    def test_the_creators_channels_are_not_applied_to_the_teammate(self):
        # liz asked for SMS and push for herself; ana's defaults are in-app only.
        sent = self.deliver(notify_in_app=True, notify_sms=True, notify_push=True)
        self.assertEqual(sent["sms"], ["liz"])
        self.assertEqual(sent["push"], ["liz"])
        self.assertEqual(sorted(sent["in_app"]), ["ana", "liz"])

    def test_the_teammate_is_reached_by_their_own_defaults_even_if_the_creator_chose_none_of_them(self):
        UserProfile.objects.filter(user=self.ana).update(notify_default_in_app=False, notify_default_push=True, notify_default_sms=True)
        sent = self.deliver(notify_in_app=True)  # liz: in-app only
        self.assertEqual(sent["in_app"], ["liz"])
        self.assertEqual(sent["push"], ["ana"])
        self.assertEqual(sent["sms"], ["ana"])

    def test_a_teammate_with_every_default_off_still_gets_it_in_app(self):
        UserProfile.objects.filter(user=self.ana).update(
            notify_default_in_app=False, notify_default_push=False, notify_default_sms=False, notify_default_slack=False)
        sent = self.deliver(notify_in_app=True)
        self.assertEqual(sorted(sent["in_app"]), ["ana", "liz"])

    def test_the_creator_still_gets_exactly_what_they_chose(self):
        sent = self.deliver(notify_in_app=False, notify_push=True)
        self.assertEqual(sent["push"], ["liz"])
        self.assertNotIn("liz", sent["in_app"])
