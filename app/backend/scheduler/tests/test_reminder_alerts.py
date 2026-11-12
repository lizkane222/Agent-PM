"""
An in-app reminder alert stays on screen until the user acknowledges it or snoozes the reminder.
The server keeps that state: an unread notification, tied to the reminder that fired.
Plus: teammates can be notified through any linked record that leads to an account.
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
from airtable_sync.models import AirtableAccount, AirtableActionItem
from team.models import Notification, TeamMember, UserProfile

from ..models import CalendarEvent, Reminder
from ..tasks import deliver_due_reminders

URL = "/api/v1/scheduler/reminders/"
NOTES = "/api/v1/team/notifications/"
QUARTER = timedelta(minutes=15)


def person(username, **profile):
    user = User.objects.create_user(username, email=f"{username}@example.com", password="x")
    UserProfile.objects.create(user=user, **profile)
    return user, TeamMember.objects.create(user=user, full_name=username.title(), email=user.email)


@override_settings(NOTIFICATION_ALLOWED_EMAILS="")
class AlertStateTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.me, _ = person("liz")
        self.ana, _ = person("ana")
        self.now = timezone.now()
        self.client.force_authenticate(user=self.me)

    def fire(self, **kw):
        r = Reminder.objects.create(created_by=self.me, title="Prep", body="Slides", notify_in_app=True,
                                    due_at=kw.pop("due_at", self.now - timedelta(minutes=1)), **kw)
        with mock.patch("scheduler.tasks._send_in_app"):
            deliver_due_reminders()
        return r

    def alerts(self, **params):
        return self.client.get(NOTES, {"channel": "in_app", "kind": "reminder", "unread": "1", **params}).data["results"]

    def test_a_fired_reminder_is_recorded_unread_and_tied_to_the_reminder_and_its_moment(self):
        r = self.fire()
        [n] = self.alerts()
        self.assertEqual((n["reminder"], n["read_at"], n["can_snooze"]), (r.pk, None, True))
        self.assertEqual(n["fired_for"].replace("Z", "+00:00"), r.due_at.isoformat())

    def test_a_calendar_block_that_fires_records_its_own_start(self):
        r = Reminder.objects.create(created_by=self.me, title="Prep", notify_in_app=True, due_at=self.now + timedelta(days=1))
        block = CalendarEvent.objects.create(owner=self.me, title="Prep", calendar_id="reminders", reminder=r,
                                             start_datetime=self.now - timedelta(minutes=1),
                                             end_datetime=self.now + timedelta(minutes=14))
        with mock.patch("scheduler.tasks._send_in_app"):
            deliver_due_reminders()
        [n] = self.alerts()
        self.assertEqual(n["fired_for"].replace("Z", "+00:00"), block.start_datetime.isoformat())

    def test_unread_filters_to_what_has_not_been_acknowledged(self):
        self.fire()
        [n] = self.alerts()
        self.client.post(f"{NOTES}mark-read/", {"ids": [n["id"]]}, format="json")
        self.assertEqual(self.alerts(), [])
        self.assertEqual(len(self.client.get(NOTES, {"kind": "reminder"}).data["results"]), 1, "still in the history")

    def test_snoozing_the_reminder_acknowledges_its_alert_and_only_its_alert(self):
        r = self.fire()
        r2 = Reminder.objects.create(created_by=self.me, title="Second", notify_in_app=True, due_at=self.now - timedelta(minutes=1))
        with mock.patch("scheduler.tasks._send_in_app"):
            deliver_due_reminders()
        self.assertEqual(len(self.alerts()), 2)
        until = self.now + timedelta(hours=2)
        self.client.post(f"{URL}{r.pk}/snooze/", {"until": until.isoformat()}, format="json")
        [left] = self.alerts()
        self.assertEqual(left["reminder"], r2.pk)

    def test_dismissing_acknowledges_the_alert(self):
        r = self.fire()
        self.client.post(f"{URL}{r.pk}/dismiss/")
        self.assertEqual(self.alerts(), [])

    def test_snoozing_does_not_touch_anyone_elses_alert(self):
        r = self.fire()
        r.recipients.add(self.ana)
        Notification.objects.create(user=self.ana, channel="in_app", kind="reminder", title="t", reminder=r)
        self.client.post(f"{URL}{r.pk}/snooze/", {"until": (self.now + timedelta(hours=2)).isoformat()}, format="json")
        self.assertEqual(Notification.objects.filter(user=self.ana, read_at__isnull=True).count(), 1)

    def test_a_teammate_notified_through_my_reminder_can_acknowledge_but_not_snooze(self):
        r = Reminder.objects.create(created_by=self.me, title="Prep", notify_in_app=True, due_at=self.now - timedelta(minutes=1))
        Notification.objects.create(user=self.ana, channel="in_app", kind="reminder", title="t", reminder=r)
        self.client.force_authenticate(user=self.ana)
        [n] = self.alerts()
        self.assertFalse(n["can_snooze"])
        self.assertEqual(self.client.post(f"{URL}{r.pk}/snooze/", {"until": (self.now + timedelta(hours=1)).isoformat()},
                                          format="json").status_code, 404, "it is not their reminder")

    def test_nobody_sees_anothers_alerts(self):
        self.fire()
        self.client.force_authenticate(user=self.ana)
        self.assertEqual(self.alerts(), [])

    def test_deleting_the_reminder_keeps_the_history_row(self):
        r = self.fire()
        self.client.delete(f"{URL}{r.pk}/")
        [n] = self.alerts()
        self.assertIsNone(n["reminder"])
        self.assertFalse(n["can_snooze"])

    def test_existing_reminder_notifications_start_read(self):
        old = Notification.objects.create(user=self.me, channel="in_app", kind="reminder", title="old")
        keep = Notification.objects.create(user=self.me, channel="in_app", kind="comment_reply", title="reply")
        importlib.import_module("team.migrations.0015_notification_reminder_link").start_clean(django_apps, None)
        old.refresh_from_db(); keep.refresh_from_db()
        self.assertIsNotNone(old.read_at)
        self.assertIsNone(keep.read_at, "only reminder notifications are cleared")


def link(t, pk):
    return {"resource_type": t, "resource_id": pk, "resource_label": "x"}


class TeammatesThroughAnyLinkTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.me, self.me_m = person("liz")
        self.ana, self.ana_m = person("ana")
        self.ben, self.ben_m = person("ben", allow_reminders_from_others=False)
        self.cy, self.cy_m = person("cy")
        self.acme = Account.objects.create(company_name="Acme", airtable_id="recAcme")
        self.acme.team_members.add(self.me_m, self.ana_m, self.ben_m)
        self.globex = Account.objects.create(company_name="Globex", airtable_id="recGlobex")
        self.globex.team_members.add(self.me_m, self.cy_m, self.ana_m)
        self.secret = Account.objects.create(company_name="Secret", airtable_id="recSecret")
        self.secret.team_members.add(self.cy_m)  # not mine
        at = AirtableAccount.objects.create(airtable_id="recAcme", name="Acme")
        self.item = AirtableActionItem.objects.create(airtable_id="recI1", task="Draft QBR deck", account=at)
        start = timezone.now() + timedelta(days=1)
        self.meeting = CalendarEvent.objects.create(owner=self.me, title="Globex sync", account=self.globex, calendar_id="primary",
                                                    start_datetime=start, end_datetime=start + timedelta(hours=1))
        self.loose = CalendarEvent.objects.create(owner=self.me, title="Lunch", calendar_id="primary",
                                                  start_datetime=start, end_datetime=start + timedelta(hours=1))
        self.client.force_authenticate(user=self.me)

    def create(self, links, recipients=(), **extra):
        body = {"title": "Follow up", "due_at": (timezone.now() + timedelta(days=3)).isoformat(), "notify_in_app": True,
                "links": links, "recipients": [u.pk for u in recipients], **extra}
        return self.client.post(URL, body, format="json")

    def options(self, *links):
        params = [("link", f"{l['resource_type']}:{l['resource_id']}") for l in links]
        resp = self.client.get(f"{URL}recipients/", params)
        self.assertEqual(resp.status_code, 200, resp.data)
        return resp.data

    def test_an_action_items_account_supplies_the_teammates_without_linking_the_account(self):
        data = self.options(link("action_item", self.item.pk))
        self.assertEqual([r["name"] for r in data["results"]], ["Ana", "Ben"])
        self.assertEqual(data["accounts"], ["Acme"])

    def test_a_meetings_account_does_too(self):
        self.assertEqual([r["name"] for r in self.options(link("calendar_event", self.meeting.pk))["results"]], ["Ana", "Cy"])

    def test_several_links_pool_their_teams_once_each_and_say_where_from(self):
        data = self.options(link("account", self.acme.pk), link("calendar_event", self.meeting.pk))
        self.assertEqual([r["name"] for r in data["results"]], ["Ana", "Ben", "Cy"])
        ana = next(r for r in data["results"] if r["name"] == "Ana")
        self.assertEqual(sorted(ana["accounts"]), ["Acme", "Globex"])
        self.assertEqual(sorted(data["accounts"]), ["Acme", "Globex"])

    def test_a_link_with_no_account_behind_it_offers_nobody(self):
        data = self.options(link("calendar_event", self.loose.pk))
        self.assertEqual((data["results"], data["accounts"]), ([], []))

    def test_saving_with_an_action_item_link_can_notify_that_accounts_team(self):
        resp = self.create([link("action_item", self.item.pk)], [self.ana], confirm_notify_others=True)
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["recipients"], [self.ana.pk])

    def test_still_needs_the_approval(self):
        resp = self.create([link("action_item", self.item.pk)], [self.ana])
        self.assertEqual(resp.status_code, 400)
        self.assertIn("confirm_notify_others", resp.data)

    def test_someone_who_opted_out_is_still_refused_through_any_link(self):
        resp = self.create([link("action_item", self.item.pk)], [self.ben], confirm_notify_others=True)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("turned off being notified", str(resp.data["recipients"]))

    def test_with_no_account_behind_the_links_the_error_says_what_to_link(self):
        resp = self.create([link("calendar_event", self.loose.pk)], [self.ana], confirm_notify_others=True)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("team of an account this reminder is linked to", str(resp.data["recipients"]))

    def test_someone_only_on_an_account_I_am_not_on_cannot_be_reached(self):
        resp = self.create([link("account", self.acme.pk)], [self.cy], confirm_notify_others=True)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("team of an account this reminder is linked to", str(resp.data["recipients"]))

    def test_an_account_I_am_not_on_cannot_be_used_to_reach_its_team(self):
        resp = self.create([link("account", self.secret.pk)], [self.cy], confirm_notify_others=True)
        self.assertEqual(resp.status_code, 400)  # I cannot even link it
        self.assertEqual(Reminder.objects.count(), 0)

    def test_relinking_keeps_whoever_is_still_reachable_and_drops_the_rest(self):
        both = self.create([link("account", self.acme.pk), link("account", self.globex.pk)], [self.ana, self.cy], confirm_notify_others=True)
        self.assertEqual(sorted(both.data["recipients"]), sorted([self.ana.pk, self.cy.pk]))
        resp = self.client.patch(f"{URL}{both.data['id']}/", {"links": [link("account", self.acme.pk)]}, format="json")
        self.assertEqual(resp.data["recipients"], [self.ana.pk], "Ana is on Acme too; Cy was only reachable through Globex")

    def test_unlinking_everything_drops_everyone(self):
        rid = self.create([link("account", self.acme.pk)], [self.ana], confirm_notify_others=True).data["id"]
        resp = self.client.patch(f"{URL}{rid}/", {"links": []}, format="json")
        self.assertEqual(resp.data["recipients"], [])

    def test_a_link_I_cannot_see_makes_the_lookup_404(self):
        resp = self.client.get(f"{URL}recipients/", [("link", f"account:{self.secret.pk}")])
        self.assertEqual(resp.status_code, 404)

    def test_the_old_account_parameter_still_works(self):
        resp = self.client.get(f"{URL}recipients/", {"account": self.acme.pk})
        self.assertEqual([r["name"] for r in resp.data["results"]], ["Ana", "Ben"])
