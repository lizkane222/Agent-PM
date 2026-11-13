"""
Every way of creating a reminder reaches the same defaults: the channels the user chose in
Settings → Reminder notification defaults, unless the caller names its own.
"""

from datetime import timedelta

from asgiref.sync import async_to_sync
from django.contrib.auth.models import User
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from agents.mcp_server import mcp_server
from airtable_sync.models import AirtableAccount, AirtableActionItem
from team.models import UserProfile

from ..models import CalendarEvent, Reminder

URL = "/api/v1/scheduler/reminders/"
CHANNELS = ("notify_in_app", "notify_push", "notify_sms", "notify_slack")


class _Base(APITestCase):
    def setUp(self):
        cache.clear()
        self.me = User.objects.create_user("liz", email="liz@example.com", password="x")
        self.profile = UserProfile.objects.create(
            user=self.me, notify_default_in_app=True, notify_default_push=True, notify_default_sms=True, notify_default_slack=False)
        self.client.force_authenticate(user=self.me)
        self.due = (timezone.now() + timedelta(days=1)).isoformat()

    def flags(self, r):
        return {c: getattr(r, c) for c in CHANNELS}


class CreateViaApiTests(_Base):
    def post(self, **extra):
        resp = self.client.post(URL, {"title": "Call", "due_at": self.due, **extra}, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        return Reminder.objects.get(pk=resp.data["id"])

    def test_channels_left_out_come_from_the_users_settings(self):
        self.assertEqual(self.flags(self.post()),
                         {"notify_in_app": True, "notify_push": True, "notify_sms": True, "notify_slack": False})

    def test_a_channel_the_caller_names_wins_true_or_false(self):
        r = self.post(notify_in_app=False, notify_slack=True)
        self.assertEqual(self.flags(r), {"notify_in_app": False, "notify_push": True, "notify_sms": True, "notify_slack": True})

    def test_naming_every_channel_uses_exactly_those(self):
        r = self.post(notify_in_app=True, notify_push=False, notify_sms=False, notify_slack=False)
        self.assertEqual(self.flags(r), {"notify_in_app": True, "notify_push": False, "notify_sms": False, "notify_slack": False})

    def test_settings_with_everything_off_still_reach_the_user_in_app(self):
        UserProfile.objects.filter(user=self.me).update(
            notify_default_in_app=False, notify_default_push=False, notify_default_sms=False, notify_default_slack=False)
        self.client.force_authenticate(user=User.objects.get(pk=self.me.pk))
        self.assertTrue(self.post().notify_in_app, "a reminder that notifies nobody is never what was meant")

    def test_a_user_with_no_profile_gets_in_app(self):
        other = User.objects.create_user("noprofile", email="n@example.com", password="x")
        self.client.force_authenticate(user=other)
        self.assertEqual(self.flags(self.post()), {"notify_in_app": True, "notify_push": False, "notify_sms": False, "notify_slack": False})

    def test_editing_never_rewrites_the_channels(self):
        r = self.post(notify_push=False)
        UserProfile.objects.filter(user=self.me).update(notify_default_slack=True)
        resp = self.client.patch(f"{URL}{r.pk}/", {"title": "Renamed"}, format="json")
        self.assertEqual(resp.status_code, 200)
        r.refresh_from_db()
        self.assertFalse(r.notify_push)
        self.assertFalse(r.notify_slack, "only creation applies the defaults")


class AgentCreateTests(_Base):
    def test_the_agent_create_reminder_tool_uses_the_users_settings(self):
        out = async_to_sync(mcp_server.dispatch)("create_reminder", {"title": "Call", "due_at": self.due}, user=self.me)
        self.assertEqual(out.get("status"), "created", out)
        r = Reminder.objects.get(pk=out["reminder"]["id"])
        self.assertEqual(self.flags(r), {"notify_in_app": True, "notify_push": True, "notify_sms": True, "notify_slack": False})


class ActionItemReminderTests(_Base):
    def setUp(self):
        super().setUp()
        acct = AirtableAccount.objects.create(airtable_id="recAcme", name="Acme")
        self.item = AirtableActionItem.objects.create(airtable_id="recI1", task="Draft QBR deck", account=acct)
        self.url = f"/api/v1/airtable/action-items/{self.item.pk}/set-reminder/"

    def set(self, **extra):
        resp = self.client.post(self.url, {"due_at": self.due, **extra}, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.item.refresh_from_db()
        return self.item.reminder

    def test_uses_the_users_settings_not_in_app_only(self):
        self.assertEqual(self.flags(self.set()), {"notify_in_app": True, "notify_push": True, "notify_sms": True, "notify_slack": False})

    def test_a_channel_named_in_the_request_still_wins(self):
        r = self.set(notify_in_app=True, notify_push=False, notify_sms=False)
        self.assertEqual((r.notify_push, r.notify_sms), (False, False))

    def test_the_reminder_is_linked_to_the_action_item_like_any_other(self):
        r = self.set()
        self.assertEqual(r.links, [{"resource_type": "action_item", "resource_id": self.item.pk, "resource_label": "Draft QBR deck"}])

    def test_and_is_on_the_calendar_at_its_due_time(self):
        r = self.set()
        [block] = CalendarEvent.objects.filter(reminder=r, calendar_id="reminders")
        self.assertEqual(block.start_datetime.isoformat(), r.due_at.isoformat())

    def test_replacing_it_takes_the_old_reminders_blocks_off_the_calendar(self):
        first = self.set()
        second = self.set(due_at=(timezone.now() + timedelta(days=3)).isoformat())
        self.assertNotEqual(first.pk, second.pk)
        self.assertEqual(CalendarEvent.objects.filter(calendar_id="reminders").count(), 1)
        self.assertEqual(CalendarEvent.objects.get(calendar_id="reminders").reminder_id, second.pk)


class AccountReminderTests(_Base):
    """POST /accounts/accounts/<id>/reminders/ — the account page's own way to make one."""

    def setUp(self):
        super().setUp()
        from accounts.models import Account
        from team.models import TeamMember

        member = TeamMember.objects.create(user=self.me, full_name="Liz", email="liz@example.com")
        self.account = Account.objects.create(company_name="Acme")
        self.account.team_members.add(member)

    def post(self, **extra):
        resp = self.client.post(f"/api/v1/accounts/accounts/{self.account.pk}/reminders/",
                                {"title": "Call", "due_at": self.due, **extra}, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        return Reminder.objects.get(pk=resp.data["id"])

    def test_uses_the_users_settings_and_a_channel_named_still_wins(self):
        self.assertEqual(self.flags(self.post()), {"notify_in_app": True, "notify_push": True, "notify_sms": True, "notify_slack": False})
        self.assertFalse(self.post(notify_sms=False).notify_sms)

    def test_is_linked_to_the_account_and_on_the_calendar(self):
        r = self.post()
        self.assertEqual(r.links, [{"resource_type": "account", "resource_id": self.account.pk, "resource_label": "Acme"}])
        [block] = CalendarEvent.objects.filter(reminder=r, calendar_id="reminders")
        self.assertEqual(block.account_id, self.account.pk)
