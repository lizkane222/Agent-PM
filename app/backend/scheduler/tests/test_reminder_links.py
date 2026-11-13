"""
A reminder can link to several records of different types. The picker lists, and saving
accepts, only records the user can already see — never the whole table.
"""

from datetime import timedelta

from django.contrib.auth.models import User
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import Account
from airtable_sync.models import AirtableAccount, AirtableActionItem
from team.models import TeamMember, UserProfile

from ..models import CalendarEvent, Reminder, Task

URL = "/api/v1/scheduler/reminders/"
OPTIONS = f"{URL}link-options/"


def person(username, **profile):
    user = User.objects.create_user(username, email=f"{username}@example.com", password="x")
    UserProfile.objects.create(user=user, **profile)
    member = TeamMember.objects.create(user=user, full_name=username.title(), email=user.email)
    return user, member


class _Base(APITestCase):
    def setUp(self):
        cache.clear()
        self.me, self.me_m = person("liz", airtable_collaborator_id="usrLIZ")
        self.other, self.other_m = person("eve", airtable_collaborator_id="usrEVE")
        self.mine = Account.objects.create(company_name="Acme Corp")
        self.mine.team_members.add(self.me_m)
        self.theirs = Account.objects.create(company_name="Globex Secret")
        self.theirs.team_members.add(self.other_m)
        start = timezone.now() + timedelta(days=1)
        self.my_event = CalendarEvent.objects.create(owner=self.me, title="Acme QBR", calendar_id="primary",
                                                     start_datetime=start, end_datetime=start + timedelta(hours=1))
        self.their_event = CalendarEvent.objects.create(owner=self.other, title="Globex QBR", calendar_id="primary",
                                                        start_datetime=start, end_datetime=start + timedelta(hours=1))
        self.block = CalendarEvent.objects.create(owner=self.me, title="🔔 a reminder block", calendar_id="reminders",
                                                  start_datetime=start, end_datetime=start + timedelta(minutes=15))
        self.at_account = AirtableAccount.objects.create(airtable_id="recA", name="Acme Corp")
        self.admin_account = AirtableAccount.objects.create(airtable_id="recAdmin", name="Admin")
        self.item = AirtableActionItem.objects.create(airtable_id="recI1", task="Draft QBR deck", account=self.at_account)
        self.my_private = AirtableActionItem.objects.create(
            airtable_id="recI2", task="My private admin task", account=self.admin_account, assignee_airtable_id="usrLIZ")
        self.their_private = AirtableActionItem.objects.create(
            airtable_id="recI3", task="Eve private admin task", account=self.admin_account, assignee_airtable_id="usrEVE")
        self.my_task = Task.objects.create(title="Send contract", assigned_to=self.me, created_by=self.me)
        self.their_task = Task.objects.create(title="Eve's task", assigned_to=self.other, created_by=self.other)
        self.client.force_authenticate(user=self.me)

    def options(self, type_, q=""):
        resp = self.client.get(OPTIONS, {"type": type_, "q": q})
        self.assertEqual(resp.status_code, 200, resp.data)
        return resp.data["results"]

    def labels(self, type_, q=""):
        return sorted(o["label"] for o in self.options(type_, q))

    def create(self, **extra):
        body = {"title": "Follow up", "due_at": (timezone.now() + timedelta(days=2)).isoformat(), "notify_in_app": True}
        body.update(extra)
        return self.client.post(URL, body, format="json")


class LinkOptionsScopeTests(_Base):
    def test_accounts_are_only_the_ones_the_user_is_on(self):
        self.assertEqual(self.labels("account"), ["Acme Corp"])

    def test_an_admin_with_the_staff_view_sees_every_account(self):
        UserProfile.objects.filter(user=self.me).update(access_level="admin", staff_view_override=True)
        User.objects.filter(pk=self.me.pk).update(is_staff=True)
        self.client.force_authenticate(user=User.objects.get(pk=self.me.pk))  # fresh profile, not the cached one
        self.assertEqual(self.labels("account"), ["Acme Corp", "Globex Secret"])

    def test_calendar_events_are_the_users_own_meetings_only(self):
        self.assertEqual(self.labels("calendar_event"), ["Acme QBR"])

    def test_action_items_hide_other_peoples_private_admin_items(self):
        self.assertEqual(self.labels("action_item"), ["Draft QBR deck", "My private admin task"])

    def test_tasks_are_the_ones_assigned_to_the_user(self):
        self.assertEqual(self.labels("task"), ["Send contract"])

    def test_typing_filters_the_results(self):
        self.assertEqual(self.labels("action_item", "qbr"), ["Draft QBR deck"])
        self.assertEqual(self.labels("action_item", "zzz"), [])
        self.assertEqual(self.labels("account", "acm"), ["Acme Corp"])

    def test_a_filter_cannot_reach_hidden_records(self):
        self.assertEqual(self.labels("account", "globex"), [])
        self.assertEqual(self.labels("action_item", "eve"), [])
        self.assertEqual(self.labels("calendar_event", "globex"), [])

    def test_results_are_capped(self):
        for i in range(40):
            AirtableActionItem.objects.create(airtable_id=f"recX{i}", task=f"Item {i}", account=self.at_account)
        self.assertEqual(len(self.options("action_item")), 25)

    def test_each_option_carries_what_the_picker_needs(self):
        [o] = self.options("calendar_event")
        self.assertEqual(set(o), {"id", "label", "detail", "at"})
        [a] = self.options("account")
        self.assertEqual((a["id"], a["label"]), (self.mine.pk, "Acme Corp"))

    def test_unknown_type_is_400_and_unauthenticated_401(self):
        self.assertEqual(self.client.get(OPTIONS, {"type": "ticket"}).status_code, 400)
        self.assertEqual(self.client.get(OPTIONS).status_code, 400)
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get(OPTIONS, {"type": "account"}).status_code, 401)


def link(type_, pk, label="client label"):
    return {"resource_type": type_, "resource_id": pk, "resource_label": label}


class SavingLinksTests(_Base):
    def test_a_reminder_can_link_to_several_record_types_at_once(self):
        resp = self.create(links=[link("action_item", self.item.pk), link("account", self.mine.pk),
                                  link("calendar_event", self.my_event.pk)])
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual([l["resource_type"] for l in resp.data["links"]], ["action_item", "account", "calendar_event"])

    def test_labels_come_from_the_database_not_the_client(self):
        resp = self.create(links=[link("account", self.mine.pk, "TOTALLY FAKE")])
        self.assertEqual(resp.data["links"][0]["resource_label"], "Acme Corp")
        self.assertEqual(resp.data["resource_label"], "Acme Corp")

    def test_the_primary_fields_mirror_the_account_link_else_the_first(self):
        resp = self.create(links=[link("action_item", self.item.pk), link("account", self.mine.pk)])
        self.assertEqual((resp.data["resource_type"], resp.data["resource_id"]), ("account", self.mine.pk))
        resp = self.create(links=[link("action_item", self.item.pk), link("calendar_event", self.my_event.pk)])
        self.assertEqual((resp.data["resource_type"], resp.data["resource_id"]), ("action_item", self.item.pk))

    def test_a_record_the_user_cannot_see_is_refused_for_every_type(self):
        for bad in (link("account", self.theirs.pk), link("calendar_event", self.their_event.pk),
                    link("action_item", self.their_private.pk), link("task", self.their_task.pk)):
            resp = self.create(links=[link("account", self.mine.pk), bad])
            self.assertEqual(resp.status_code, 400, bad)
            self.assertIn("links", resp.data)
        self.assertEqual(Reminder.objects.count(), 0)

    def test_a_reminder_or_work_block_cannot_be_linked_as_a_meeting(self):
        self.assertEqual(self.create(links=[link("calendar_event", self.block.pk)]).status_code, 400)

    def test_nonsense_is_refused(self):
        for bad in ([link("ticket", 1)], [link("account", "x")], [{"resource_type": "account"}], ["a"],
                    [link("account", 999999)], "nope", {"resource_type": "account"}):
            self.assertEqual(self.create(links=bad).status_code, 400, bad)

    def test_too_many_links_are_refused(self):
        self.assertEqual(self.create(links=[link("account", self.mine.pk + i) for i in range(11)]).status_code, 400)

    def test_duplicates_collapse(self):
        resp = self.create(links=[link("account", self.mine.pk), link("account", self.mine.pk)])
        self.assertEqual(len(resp.data["links"]), 1)

    def test_editing_replaces_the_links_and_an_empty_list_clears_them(self):
        rid = self.create(links=[link("account", self.mine.pk), link("task", self.my_task.pk)]).data["id"]
        resp = self.client.patch(f"{URL}{rid}/", {"links": [link("task", self.my_task.pk)]}, format="json")
        self.assertEqual([l["resource_type"] for l in resp.data["links"]], ["task"])
        resp = self.client.patch(f"{URL}{rid}/", {"links": []}, format="json")
        self.assertEqual((resp.data["links"], resp.data["resource_type"], resp.data["resource_id"]), ([], "general", None))

    def test_an_unrelated_edit_leaves_the_links_alone(self):
        rid = self.create(links=[link("account", self.mine.pk), link("task", self.my_task.pk)]).data["id"]
        resp = self.client.patch(f"{URL}{rid}/", {"title": "Renamed"}, format="json")
        self.assertEqual(len(resp.data["links"]), 2)

    def test_the_single_link_fields_still_work_and_fill_links(self):
        resp = self.create(resource_type="account", resource_id=self.mine.pk, resource_label="Acme Corp")
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["links"], [link("account", self.mine.pk, "Acme Corp")])
        resp = self.create(resource_type="general")
        self.assertEqual(resp.data["links"], [])


class AccountAmongSeveralLinksTests(_Base):
    """Everything that used to read the single link finds the account among several."""

    def test_recipients_work_when_the_account_is_one_of_several_links(self):
        mate, mate_m = person("ana")
        self.mine.team_members.add(mate_m)
        resp = self.create(links=[link("action_item", self.item.pk), link("account", self.mine.pk)],
                           recipients=[mate.pk], confirm_notify_others=True)
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["recipients"], [mate.pk])

    def test_recipients_still_need_an_account_link(self):
        mate, mate_m = person("ana")
        resp = self.create(links=[link("action_item", self.item.pk)], recipients=[mate.pk], confirm_notify_others=True)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("account", str(resp.data["recipients"]).lower())

    def test_removing_the_account_link_drops_recipients(self):
        mate, mate_m = person("ana")
        self.mine.team_members.add(mate_m)
        rid = self.create(links=[link("account", self.mine.pk)], recipients=[mate.pk], confirm_notify_others=True).data["id"]
        resp = self.client.patch(f"{URL}{rid}/", {"links": [link("task", self.my_task.pk)]}, format="json")
        self.assertEqual(resp.data["recipients"], [])

    def test_the_calendar_block_and_snooze_find_the_account(self):
        from .. import reminder_links, reminder_snooze

        r = Reminder.objects.get(pk=self.create(links=[link("task", self.my_task.pk), link("account", self.mine.pk)]).data["id"])
        self.assertEqual(reminder_links.linked_account(r), self.mine)
        self.assertEqual(reminder_snooze.reminder_account(r), self.mine)
        self.assertEqual(CalendarEvent.objects.get(reminder=r, calendar_id="reminders").account, self.mine)

    def test_the_account_of_a_linked_meeting_counts_when_no_account_is_linked(self):
        from .. import reminder_links

        CalendarEvent.objects.filter(pk=self.my_event.pk).update(account=self.mine)
        r = Reminder.objects.get(pk=self.create(links=[link("calendar_event", self.my_event.pk)]).data["id"])
        self.assertEqual(reminder_links.linked_account(r), self.mine)

    def test_a_reminder_that_predates_links_falls_back_to_its_single_link(self):
        from .. import reminder_links

        r = Reminder.objects.create(created_by=self.me, title="old", due_at=timezone.now(),
                                    resource_type="account", resource_id=self.mine.pk, resource_label="Acme Corp")
        self.assertEqual(r.links, [])
        self.assertEqual(reminder_links.linked_account(r), self.mine)


class MigrationRepairTests(_Base):
    def test_existing_single_links_and_stuck_snoozed_reminders_are_repaired(self):
        import importlib
        from django.apps import apps

        old = Reminder.objects.create(created_by=self.me, title="old", due_at=timezone.now(), status="snoozed",
                                      resource_type="account", resource_id=self.mine.pk, resource_label="Acme Corp")
        plain = Reminder.objects.create(created_by=self.me, title="plain", due_at=timezone.now(), status="sent")
        importlib.import_module("scheduler.migrations.0016_reminder_links").backfill(apps, None)
        old.refresh_from_db()
        plain.refresh_from_db()
        self.assertEqual(old.status, "pending", "the old snooze left it unable to fire")
        self.assertEqual(old.links, [link("account", self.mine.pk, "Acme Corp")])
        self.assertEqual((plain.status, plain.links), ("sent", []))


class ListingTests(_Base):
    def make(self, n):
        base = timezone.now()
        Reminder.objects.bulk_create([
            Reminder(created_by=self.me, title=f"R{i:03d}", due_at=base + timedelta(minutes=i)) for i in range(n)
        ])

    def test_page_size_is_honoured_so_a_long_history_is_not_cut_off(self):
        self.make(60)
        self.assertEqual(len(self.client.get(URL).data["results"]), 50)  # the default page
        resp = self.client.get(URL, {"page_size": "500"})
        self.assertEqual(len(resp.data["results"]), 60)

    def test_newest_first_with_descending_ordering(self):
        self.make(5)
        titles = [r["title"] for r in self.client.get(URL, {"ordering": "-due_at"}).data["results"]]
        self.assertEqual(titles, ["R004", "R003", "R002", "R001", "R000"])

    def test_other_users_reminders_never_appear(self):
        Reminder.objects.create(created_by=self.other, title="Eve's", due_at=timezone.now())
        self.make(2)
        titles = [r["title"] for r in self.client.get(URL, {"page_size": "500"}).data["results"]]
        self.assertNotIn("Eve's", titles)
