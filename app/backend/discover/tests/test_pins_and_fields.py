"""Discovery: new types/categories, tag rules and list, Airtable mapping, and pins."""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from accounts.models import Account
from discover.models import Applet, AppletPin
from discover.write_back import _applet_fields, airtable_category, airtable_type
from team.models import TeamMember

User = get_user_model()

APPLETS = "/api/v1/discover/applets/"
PINS = "/api/v1/discover/pins/"

NO_AIRTABLE = [
    patch("discover.views.push_applet_create", return_value=None),
    patch("discover.views.push_applet_update", return_value=None),
    patch("discover.views.push_applet_delete", return_value=None),
]


def _user(name):
    return User.objects.create_user(username=name, email=f"{name}@example.com", password="x")


def _applet(by, name="Tool", **kw):
    data = dict(type="tool", name=name, description="d", url="https://example.com",
                category="Tool", author=by.username, submitted_by=by, tags=[])
    data.update(kw)
    return Applet.objects.create(**data)


def _account(name, *members, admin_owner=None):
    acct = Account.objects.create(company_name=name, admin_owner=admin_owner)
    for u in members:
        tm, _ = TeamMember.objects.get_or_create(
            user=u, defaults={"full_name": u.username, "email": f"{u.username}@example.com"})
        acct.team_members.add(tm)
    return acct


class TypesCategoriesTagsTest(APITestCase):
    def setUp(self):
        self.user = _user("alice")
        self.client.force_authenticate(self.user)
        for p in NO_AIRTABLE:
            p.start()
            self.addCleanup(p.stop)

    def _create(self, **kw):
        body = dict(type="site", name="Wiki", description="d", url="https://wiki.example.com",
                    category="Documentation", author="Alice", tags=[])
        body.update(kw)
        return self.client.post(APPLETS, body, format="json")

    def test_new_types_and_categories_accepted(self):
        for t in ("applet", "repo", "tool", "site", "doc"):
            self.assertEqual(self._create(type=t).status_code, 201, t)
        for c in ("Documentation", "Reference", "Reporting", "Communication",
                  "Data", "AI", "Security", "Productivity"):
            self.assertEqual(self._create(category=c).status_code, 201, c)

    def test_unknown_type_and_category_rejected(self):
        self.assertEqual(self._create(type="gadget").status_code, 400)
        self.assertEqual(self._create(category="Nope").status_code, 400)

    def test_non_http_url_rejected(self):
        self.assertEqual(self._create(url="javascript:alert(1)").status_code, 400)

    def test_tags_are_normalised_and_deduped_case_insensitively(self):
        resp = self._create(tags=["  SMS ", "sms", "Python", "", "python  "])
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["tags"], ["SMS", "Python"])

    def test_tag_too_long_and_too_many_rejected(self):
        self.assertEqual(self._create(tags=["x" * 31]).status_code, 400)
        self.assertEqual(self._create(tags=[f"t{i}" for i in range(11)]).status_code, 400)
        self.assertEqual(self._create(tags=[f"t{i}" for i in range(10)]).status_code, 201)

    def test_legacy_rows_still_listed(self):
        _applet(self.user, "Old", type="repo", category="Game")
        resp = self.client.get(APPLETS)
        self.assertEqual(resp.status_code, 200)

    def test_page_size_is_honoured(self):
        for i in range(60):
            _applet(self.user, f"A{i}")
        resp = self.client.get(APPLETS, {"page_size": "200"})
        self.assertEqual(len(resp.data["results"]), 60)


class TagListTest(APITestCase):
    def setUp(self):
        self.user = _user("alice")
        _applet(self.user, "a", tags=["sms", "Python"])
        _applet(self.user, "b", tags=["SMS", "go"])
        _applet(self.user, "c", tags=["sms"])

    def test_unauthenticated_401(self):
        self.assertEqual(self.client.get(APPLETS + "tags/").status_code, 401)

    def test_counts_merge_case_and_sort(self):
        self.client.force_authenticate(self.user)
        resp = self.client.get(APPLETS + "tags/")
        self.assertEqual(resp.status_code, 200)
        tags = resp.data["tags"]
        self.assertEqual(tags[0]["count"], 3)
        self.assertEqual(tags[0]["name"].lower(), "sms")
        self.assertEqual([t["name"] for t in tags[1:]], ["go", "Python"])


class AirtableWriteBackMappingTest(APITestCase):
    def test_new_values_map_to_options_airtable_knows(self):
        self.assertEqual(airtable_type("tool"), "applet")
        self.assertEqual(airtable_type("doc"), "applet")
        self.assertEqual(airtable_type("repo"), "repo")
        self.assertEqual(airtable_category("AI"), "Tool")
        self.assertEqual(airtable_category("Bot"), "Bot")
        a = _applet(_user("u"), type="site", category="Security")
        fields = _applet_fields(a)
        self.assertEqual(fields["Type"], "applet")
        self.assertEqual(fields["Category"], "Tool")

    def test_airtable_failure_never_fails_the_local_save(self):
        user = _user("alice")
        self.client.force_authenticate(user)
        with patch("discover.write_back.TABLE_APPLETS", "tbl"), \
             patch("airtable_sync.airtable_client.get_table", side_effect=RuntimeError("UNKNOWN_SELECT_OPTION")):
            resp = self.client.post(APPLETS, dict(
                type="doc", name="Guide", description="d", url="https://x.example.com",
                category="Reference", author="A", tags=[]), format="json")
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(Applet.objects.filter(name="Guide", type="doc").exists())


class AppletPinTest(APITestCase):
    def setUp(self):
        self.alice = _user("alice")
        self.bob = _user("bob")
        self.carol = _user("carol")
        self.acme = _account("Acme", self.alice, self.bob)
        self.other = _account("Other", self.carol)
        self.applet = _applet(self.alice, "Tool 1")

    def _as(self, user):
        self.client.force_authenticate(user)

    def _pin(self, account=None, applet=None):
        return self.client.post(PINS, {"applet": (applet or self.applet).pk, "account": account.pk if account else None}, format="json")

    def test_unauthenticated_401(self):
        self.assertEqual(self.client.get(PINS).status_code, 401)
        self.assertEqual(self.client.post(PINS, {}, format="json").status_code, 401)
        self.assertEqual(self.client.delete(PINS + "1/").status_code, 401)

    def test_pin_to_profile_sets_owner_and_is_idempotent(self):
        self._as(self.alice)
        r1 = self._pin()
        self.assertEqual(r1.status_code, 201)
        self.assertIsNone(r1.data["account"])
        self.assertEqual(r1.data["pinned_by_username"], "alice")
        self.assertEqual(self._pin().status_code, 200)
        self.assertEqual(AppletPin.objects.count(), 1)
        self.assertEqual(AppletPin.objects.get().user, self.alice)

    def test_profile_pins_are_private(self):
        self._as(self.alice)
        pin_id = self._pin().data["id"]
        self._as(self.bob)
        self.assertEqual(self.client.get(PINS, {"profile": "1"}).data, [])
        self.assertEqual(self.client.get(PINS).data, [])
        self.assertEqual(self.client.delete(f"{PINS}{pin_id}/").status_code, 404)
        self.assertTrue(AppletPin.objects.filter(pk=pin_id).exists())

    def test_account_pin_visible_to_team_not_outsiders(self):
        self._as(self.alice)
        pin_id = self._pin(self.acme).data["id"]
        self._as(self.bob)
        resp = self.client.get(PINS, {"account": self.acme.pk})
        self.assertEqual([p["id"] for p in resp.data], [pin_id])
        self.assertFalse(resp.data[0]["can_remove"])
        self._as(self.carol)
        self.assertEqual(self.client.get(PINS, {"account": self.acme.pk}).status_code, 404)
        self.assertEqual(self.client.get(PINS).data, [])

    def test_cannot_pin_to_account_not_on_or_missing_same_404(self):
        self._as(self.alice)
        self.assertEqual(self._pin(self.other).status_code, 404)
        r = self.client.post(PINS, {"applet": self.applet.pk, "account": 99999}, format="json")
        self.assertEqual(r.status_code, 404)
        r = self.client.post(PINS, {"applet": 99999, "account": None}, format="json")
        self.assertEqual(r.status_code, 404)
        self.assertEqual(AppletPin.objects.count(), 0)

    def test_one_account_pin_per_applet_even_across_users(self):
        self._as(self.alice)
        first = self._pin(self.acme).data["id"]
        self._as(self.bob)
        r = self._pin(self.acme)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["id"], first)
        self.assertEqual(AppletPin.objects.count(), 1)

    def test_only_pinner_or_admin_removes_account_pin(self):
        self._as(self.alice)
        pin_id = self._pin(self.acme).data["id"]
        self._as(self.bob)
        self.assertEqual(self.client.delete(f"{PINS}{pin_id}/").status_code, 403)
        self.assertTrue(AppletPin.objects.filter(pk=pin_id).exists())
        self._as(self.alice)
        self.assertEqual(self.client.delete(f"{PINS}{pin_id}/").status_code, 204)
        self.assertFalse(AppletPin.objects.filter(pk=pin_id).exists())

    def test_admin_on_the_account_can_remove_others_pin(self):
        self._as(self.alice)
        pin_id = self._pin(self.acme).data["id"]
        from team.models import UserProfile
        UserProfile.objects.update_or_create(
            user=self.bob, defaults={"access_level": "admin", "staff_view_override": False})
        self.bob = User.objects.get(pk=self.bob.pk)
        self._as(self.bob)
        resp = self.client.get(PINS, {"account": self.acme.pk})
        self.assertTrue(resp.data[0]["can_remove"])
        self.assertEqual(self.client.delete(f"{PINS}{pin_id}/").status_code, 204)

    def test_deleting_the_applet_removes_its_pins(self):
        self._as(self.alice)
        self._pin()
        self.applet.delete()
        self.assertEqual(AppletPin.objects.count(), 0)

    def test_filter_by_applet(self):
        self._as(self.alice)
        other = _applet(self.alice, "Tool 2")
        self._pin()
        self._pin(applet=other)
        resp = self.client.get(PINS, {"profile": "1", "applet": other.pk})
        self.assertEqual([p["applet"]["id"] for p in resp.data], [other.pk])
