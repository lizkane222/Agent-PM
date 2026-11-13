"""Notepad notes (UserPageNote): private to the owner, optionally linked to an account."""

from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APITestCase

from accounts.models import Account
from layouts.models import UserPageNote
from team.models import TeamMember, UserProfile

User = get_user_model()
URL = "/api/v1/layouts/page-notes/"


def _user(name):
    u = User.objects.create_user(name, email=f"{name}@example.com", password="x")
    UserProfile.objects.create(user=u)
    return u, TeamMember.objects.create(user=u, full_name=name.title(), email=f"{name}@example.com")


class PageNoteAccountLinkTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.ann, self.ann_m = _user("ann")
        self.bob, self.bob_m = _user("bob")
        self.acme = Account.objects.create(company_name="Acme")
        self.acme.team_members.add(self.ann_m)
        self.globex = Account.objects.create(company_name="Globex")  # ann is not on this one
        self.client.force_authenticate(self.ann)

    def test_unauthenticated_is_401(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(URL).status_code, 401)

    def test_create_with_an_account_i_am_on_links_it_and_sets_the_label(self):
        r = self.client.post(URL, {"content": "<p>hi</p>", "account": self.acme.id}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["account"], self.acme.id)
        self.assertEqual(r.data["account_name"], "Acme")
        self.assertEqual(r.data["account_ref_label"], "Acme")
        self.assertEqual(UserPageNote.objects.get().owner, self.ann)

    def test_cannot_link_to_an_account_i_am_not_on(self):
        r = self.client.post(URL, {"content": "x", "account": self.globex.id}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertFalse(UserPageNote.objects.exists())

    def test_my_own_admin_workspace_is_allowed_someone_elses_is_not(self):
        mine = Account.objects.create(company_name="Admin", is_admin_account=True, admin_owner=self.ann)
        theirs = Account.objects.create(company_name="Admin", is_admin_account=True, admin_owner=self.bob)
        self.assertEqual(self.client.post(URL, {"content": "x", "account": mine.id}, format="json").status_code, 201)
        self.assertEqual(self.client.post(URL, {"content": "x", "account": theirs.id}, format="json").status_code, 400)

    def test_unlinking_clears_the_account_and_label(self):
        n = UserPageNote.objects.create(owner=self.ann, content="x", account=self.acme, account_ref_label="Acme")
        r = self.client.patch(f"{URL}{n.id}/", {"account": None}, format="json")
        self.assertEqual(r.status_code, 200)
        n.refresh_from_db()
        self.assertIsNone(n.account)
        self.assertEqual(n.account_ref_label, "")

    def test_editing_only_the_text_keeps_the_link(self):
        n = UserPageNote.objects.create(owner=self.ann, content="x", account=self.acme, account_ref_label="Acme")
        self.client.patch(f"{URL}{n.id}/", {"content": "<p>new</p>"}, format="json")
        n.refresh_from_db()
        self.assertEqual(n.account, self.acme)

    def test_list_is_owner_only_and_filters_by_account(self):
        mine_linked = UserPageNote.objects.create(owner=self.ann, content="a", account=self.acme)
        mine_general = UserPageNote.objects.create(owner=self.ann, content="b")
        UserPageNote.objects.create(owner=self.bob, content="c", account=self.acme)  # bob's, same account
        ids = {n["id"] for n in self.client.get(URL).data["results"]}
        self.assertEqual(ids, {mine_linked.id, mine_general.id})
        ids = {n["id"] for n in self.client.get(URL, {"account": self.acme.id}).data["results"]}
        self.assertEqual(ids, {mine_linked.id})

    def test_another_users_notes_cannot_be_read_or_changed(self):
        theirs = UserPageNote.objects.create(owner=self.bob, content="private")
        self.assertEqual(self.client.get(f"{URL}{theirs.id}/").status_code, 404)
        self.assertEqual(self.client.patch(f"{URL}{theirs.id}/", {"content": "x"}, format="json").status_code, 404)
        self.assertEqual(self.client.delete(f"{URL}{theirs.id}/").status_code, 404)

    def test_a_bad_account_filter_returns_nothing_not_everything(self):
        UserPageNote.objects.create(owner=self.ann, content="a", account=self.acme)
        self.assertEqual(self.client.get(URL, {"account": "abc"}).data["results"], [])

    def test_deleting_the_account_keeps_the_note(self):
        n = UserPageNote.objects.create(owner=self.ann, content="a", account=self.acme)
        self.acme.delete()
        n.refresh_from_db()
        self.assertIsNone(n.account)


class BackfillMigrationTests(APITestCase):
    """The data step of 0003 links an old name-only label only when it names exactly one of my accounts."""

    def run_backfill(self):
        import importlib
        from django.apps import apps
        mod = importlib.import_module("layouts.migrations.0003_userpagenote_account")
        mod.link_existing_labels(apps, None)

    def test_links_an_unambiguous_label_and_leaves_the_rest(self):
        ann, ann_m = _user("ann")
        acme = Account.objects.create(company_name="Acme")
        acme.team_members.add(ann_m)
        other = Account.objects.create(company_name="Acme")  # same name, ann is not on it
        exact = UserPageNote.objects.create(owner=ann, content="a", account_ref_label="Acme")
        unknown = UserPageNote.objects.create(owner=ann, content="b", account_ref_label="Nope")
        general = UserPageNote.objects.create(owner=ann, content="c")
        self.run_backfill()
        for n in (exact, unknown, general):
            n.refresh_from_db()
        self.assertEqual(exact.account, acme)
        self.assertNotEqual(exact.account, other)
        self.assertIsNone(unknown.account)
        self.assertIsNone(general.account)

    def test_two_accounts_with_the_same_name_are_not_guessed(self):
        ann, ann_m = _user("ann")
        for _ in range(2):
            Account.objects.create(company_name="Acme").team_members.add(ann_m)
        n = UserPageNote.objects.create(owner=ann, content="a", account_ref_label="Acme")
        self.run_backfill()
        n.refresh_from_db()
        self.assertIsNone(n.account)

    def test_never_links_to_an_account_the_owner_is_not_on(self):
        ann, _ = _user("ann")
        Account.objects.create(company_name="Globex")
        n = UserPageNote.objects.create(owner=ann, content="a", account_ref_label="Globex")
        self.run_backfill()
        n.refresh_from_db()
        self.assertIsNone(n.account)
