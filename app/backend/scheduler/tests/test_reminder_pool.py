"""
Who a reminder can notify beyond the teams of its linked accounts:

* the creator's **manager**, always — they are often on none of the accounts the person works;
* the creator's **colleagues** (people sharing an account or a Team with them) — but only for a
  reminder about the private Admin workspace, which cannot be shared and so has no team.
"""

from datetime import timedelta
from unittest import mock

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import Account
from airtable_sync.models import AirtableAccount, AirtableActionItem
from team.models import Notification, Team, TeamMember, TeamMembership, UserProfile

from ..models import CalendarEvent, Reminder
from ..tasks import deliver_due_reminders

URL = "/api/v1/scheduler/reminders/"


def person(username, *, manager=None, login=True, **profile):
    user = User.objects.create_user(username, email=f"{username}@example.com", password="x") if login else None
    if user:
        UserProfile.objects.create(user=user, **profile)
    member = TeamMember.objects.create(user=user, full_name=username.title(), email=f"{username}@example.com", manager=manager)
    return user, member


def link(t, pk):
    return {"resource_type": t, "resource_id": pk, "resource_label": "x"}


class _Base(APITestCase):
    def setUp(self):
        cache.clear()
        # The manager is on none of liz's accounts; a stranger shares nothing at all.
        self.boss, self.boss_m = person("sam")
        self.me, self.me_m = person("liz", manager=self.boss_m)
        self.mate, self.mate_m = person("ana")            # shares the Acme account with liz
        self.teammate, self.tm_m = person("tom")          # shares a Team with liz, no account
        self.stranger, self.str_m = person("zed")         # shares nothing
        self.acme = Account.objects.create(company_name="Acme", airtable_id="recAcme")
        self.acme.team_members.add(self.me_m, self.mate_m)
        team = Team.objects.create(name="SAs")
        TeamMembership.objects.create(user=self.me, team=team)
        TeamMembership.objects.create(user=self.teammate, team=team)
        # liz's private Admin workspace (per-user, unshared) and an action item filed under it.
        self.admin = Account.objects.create(company_name="Admin", is_admin_account=True, admin_owner=self.me)
        self.admin.team_members.add(self.me_m)
        at_admin = AirtableAccount.objects.create(airtable_id="recAdmin", name="Admin")
        self.admin_item = AirtableActionItem.objects.create(airtable_id="recA1", task="Private prep", account=at_admin)
        at_acme = AirtableAccount.objects.create(airtable_id="recAcme", name="Acme")
        self.acme_item = AirtableActionItem.objects.create(airtable_id="recA2", task="Draft QBR deck", account=at_acme)
        self.client.force_authenticate(user=self.me)

    def fresh(self):
        """A request reloads the user; the test's own object caches its manager and profile."""
        self.client.force_authenticate(user=User.objects.get(pk=self.me.pk))

    def create(self, links, recipients=(), **extra):
        body = {"title": "Follow up", "due_at": (timezone.now() + timedelta(days=3)).isoformat(), "notify_in_app": True,
                "links": links, "recipients": [u.pk for u in recipients], **extra}
        return self.client.post(URL, body, format="json")

    def names(self, *links):
        params = [("link", f"{l['resource_type']}:{l['resource_id']}") for l in links]
        resp = self.client.get(f"{URL}recipients/", params)
        self.assertEqual(resp.status_code, 200, resp.data)
        return sorted(r["name"] for r in resp.data["results"]), resp.data


class ManagerTests(_Base):
    def test_the_manager_is_offered_with_no_links_at_all(self):
        names, data = self.names()
        self.assertEqual(names, ["Sam"])
        self.assertEqual(data["sources"], ["Your manager"])
        self.assertEqual(data["results"][0]["accounts"], ["Your manager"])

    def test_the_manager_is_offered_alongside_a_linked_accounts_team(self):
        names, data = self.names(link("account", self.acme.pk))
        self.assertEqual(names, ["Ana", "Sam"])
        self.assertEqual(data["sources"], ["Acme", "Your manager"])

    def test_a_manager_who_is_also_on_the_account_appears_once(self):
        self.acme.team_members.add(self.boss_m)
        names, _ = self.names(link("account", self.acme.pk))
        self.assertEqual(names, ["Ana", "Sam"])

    def test_the_manager_can_be_notified_without_sharing_an_account(self):
        resp = self.create([], [self.boss], confirm_notify_others=True)
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["recipients"], [self.boss.pk])

    def test_still_needs_the_explicit_yes(self):
        resp = self.create([], [self.boss])
        self.assertEqual(resp.status_code, 400)
        self.assertIn("confirm_notify_others", resp.data)

    def test_no_manager_means_no_option(self):
        TeamMember.objects.filter(pk=self.me_m.pk).update(manager=None)
        self.fresh()
        self.assertEqual(self.names()[0], [])

    def test_a_manager_who_has_never_signed_in_is_listed_but_cannot_be_chosen(self):
        _, ghost = person("gil", login=False)
        TeamMember.objects.filter(pk=self.me_m.pk).update(manager=ghost)
        self.fresh()
        _, data = self.names()
        [row] = data["results"]
        self.assertEqual((row["name"], row["available"], row["user_id"]), ("Gil", False, None))
        self.assertIn("hasn't signed in", row["reason"])

    def test_a_manager_who_opted_out_is_listed_but_refused(self):
        UserProfile.objects.filter(user=self.boss).update(allow_reminders_from_others=False)
        self.fresh()
        _, data = self.names()
        self.assertFalse(data["results"][0]["available"])
        resp = self.create([], [self.boss], confirm_notify_others=True)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("turned off being notified", str(resp.data["recipients"]))

    def test_it_is_your_manager_not_someone_elses(self):
        # ana's manager is not offered to liz
        _, ana_boss_m = person("amy")
        TeamMember.objects.filter(pk=self.mate_m.pk).update(manager=ana_boss_m)
        self.fresh()
        self.assertEqual(self.names()[0], ["Sam"])

    def test_the_manager_survives_unlinking_everything(self):
        rid = self.create([link("account", self.acme.pk)], [self.boss, self.mate], confirm_notify_others=True).data["id"]
        resp = self.client.patch(f"{URL}{rid}/", {"links": []}, format="json")
        self.assertEqual(resp.data["recipients"], [self.boss.pk], "Ana was only reachable through Acme")


class ColleaguesForAdminItemsTests(_Base):
    def test_a_reminder_about_a_private_admin_action_item_can_reach_colleagues_who_share_no_account(self):
        names, data = self.names(link("action_item", self.admin_item.pk))
        self.assertEqual(names, ["Ana", "Sam", "Tom"], "account-mate, manager and Team-mate; not the stranger")
        self.assertEqual(data["sources"], ["Your colleagues", "Your manager"])

    def test_the_admin_account_itself_counts(self):
        names, _ = self.names(link("account", self.admin.pk))
        self.assertEqual(names, ["Ana", "Sam", "Tom"])

    def test_a_meeting_filed_under_the_admin_account_counts(self):
        start = timezone.now() + timedelta(days=1)
        ev = CalendarEvent.objects.create(owner=self.me, title="Private", account=self.admin, calendar_id="primary",
                                          start_datetime=start, end_datetime=start + timedelta(hours=1))
        self.assertEqual(self.names(link("calendar_event", ev.pk))[0], ["Ana", "Sam", "Tom"])

    def test_someone_who_shares_nothing_is_never_offered(self):
        self.assertNotIn("Zed", self.names(link("action_item", self.admin_item.pk))[0])

    def test_an_ordinary_action_item_does_not_open_the_colleague_list(self):
        names, data = self.names(link("action_item", self.acme_item.pk))
        self.assertEqual(names, ["Ana", "Sam"], "Tom shares only a Team; that is not enough for a normal reminder")
        self.assertNotIn("Your colleagues", data["sources"])

    def test_saving_can_notify_a_team_mate_for_an_admin_item(self):
        resp = self.create([link("action_item", self.admin_item.pk)], [self.teammate], confirm_notify_others=True)
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["recipients"], [self.teammate.pk])

    def test_but_not_for_an_ordinary_reminder(self):
        resp = self.create([link("action_item", self.acme_item.pk)], [self.teammate], confirm_notify_others=True)
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(self.create([], [self.teammate], confirm_notify_others=True).status_code, 400)

    def test_a_stranger_is_refused_even_for_an_admin_item(self):
        resp = self.create([link("action_item", self.admin_item.pk)], [self.stranger], confirm_notify_others=True)
        self.assertEqual(resp.status_code, 400)

    def test_still_needs_the_explicit_yes_and_respects_opt_out(self):
        self.assertEqual(self.create([link("action_item", self.admin_item.pk)], [self.teammate]).status_code, 400)
        UserProfile.objects.filter(user=self.teammate).update(allow_reminders_from_others=False)
        resp = self.create([link("action_item", self.admin_item.pk)], [self.teammate], confirm_notify_others=True)
        self.assertEqual(resp.status_code, 400)

    def test_unlinking_the_admin_item_drops_the_colleague_but_keeps_the_manager(self):
        rid = self.create([link("action_item", self.admin_item.pk)], [self.teammate, self.boss], confirm_notify_others=True).data["id"]
        resp = self.client.patch(f"{URL}{rid}/", {"links": [link("action_item", self.acme_item.pk)]}, format="json")
        self.assertEqual(resp.data["recipients"], [self.boss.pk])

    def test_someone_elses_private_admin_item_cannot_be_linked_to_reach_anyone(self):
        other_admin = Account.objects.create(company_name="Admin", is_admin_account=True, admin_owner=self.mate)
        resp = self.create([link("account", other_admin.pk)], [self.teammate], confirm_notify_others=True)
        self.assertEqual(resp.status_code, 400)  # not visible to liz, so it can't even be linked


@override_settings(NOTIFICATION_ALLOWED_EMAILS="")
class DeliveryTests(_Base):
    @mock.patch("scheduler.tasks._send_in_app")
    def test_the_manager_and_a_colleague_are_notified_with_the_senders_name_and_cannot_read_the_reminder(self, send):
        r = Reminder.objects.create(created_by=self.me, title="Prep", body="Slides", notify_in_app=True,
                                    due_at=timezone.now() - timedelta(minutes=1))
        r.recipients.add(self.boss, self.teammate)
        deliver_due_reminders()
        self.assertEqual(sorted(c.args[0].username for c in send.call_args_list), ["liz", "sam", "tom"])
        note = Notification.objects.get(user=self.boss)
        self.assertEqual(note.body, "Set by Liz — Slides")
        self.client.force_authenticate(user=self.boss)
        self.assertEqual(self.client.get(f"{URL}{r.pk}/").status_code, 404)
