"""CustomerContact: customer-side `team` (free text) and `is_main_poc` flag."""

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from accounts.models import Account, CustomerContact
from team.models import TeamMember

User = get_user_model()
URL = "/api/v1/accounts/contacts/"


def _user(name):
    return User.objects.create_user(username=name, email=f"{name}@example.com", password="pass")


def _member_of(user, account):
    tm = TeamMember.objects.create(user=user, full_name=user.username, email=user.email)
    account.team_members.add(tm)
    return tm


class CustomerContactTeamAndPocTest(APITestCase):
    def setUp(self):
        self.owner = _user("owner")
        self.other = _user("other")
        self.acct = Account.objects.create(company_name="Acme")
        _member_of(self.owner, self.acct)
        self.client.force_authenticate(self.owner)

    def test_unauthenticated_is_401(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(URL).status_code, 401)

    def test_defaults(self):
        c = CustomerContact.objects.create(account=self.acct, name="Ann")
        self.assertEqual(c.team, "")
        self.assertFalse(c.is_main_poc)

    def test_create_with_team_and_poc(self):
        r = self.client.post(URL, {"account": self.acct.id, "name": "Ann", "team": "Platform", "is_main_poc": True}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["team"], "Platform")
        self.assertTrue(r.data["is_main_poc"])

    def test_toggle_star_and_set_team_via_patch(self):
        c = CustomerContact.objects.create(account=self.acct, name="Ann")
        r = self.client.patch(f"{URL}{c.id}/", {"is_main_poc": True, "team": "Data"}, format="json")
        self.assertEqual(r.status_code, 200)
        c.refresh_from_db()
        self.assertTrue(c.is_main_poc)
        self.assertEqual(c.team, "Data")
        self.client.patch(f"{URL}{c.id}/", {"is_main_poc": False}, format="json")
        c.refresh_from_db()
        self.assertFalse(c.is_main_poc)

    def test_multiple_pocs_allowed_on_one_account(self):
        for n in ("A", "B"):
            r = self.client.post(URL, {"account": self.acct.id, "name": n, "is_main_poc": True}, format="json")
            self.assertEqual(r.status_code, 201)
        self.assertEqual(CustomerContact.objects.filter(account=self.acct, is_main_poc=True).count(), 2)

    def test_team_length_is_bounded(self):
        r = self.client.post(URL, {"account": self.acct.id, "name": "Ann", "team": "x" * 201}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_list_includes_fields_for_members_only(self):
        CustomerContact.objects.create(account=self.acct, name="Ann", team="T", is_main_poc=True)
        r = self.client.get(f"{URL}?account={self.acct.id}")
        rows = r.data["results"] if isinstance(r.data, dict) else r.data
        self.assertEqual(rows[0]["team"], "T")
        self.assertTrue(rows[0]["is_main_poc"])
        self.client.force_authenticate(self.other)
        r = self.client.get(f"{URL}?account={self.acct.id}")
        rows = r.data["results"] if isinstance(r.data, dict) else r.data
        self.assertEqual(rows, [])

    def test_non_member_cannot_update_or_delete(self):
        c = CustomerContact.objects.create(account=self.acct, name="Ann")
        self.client.force_authenticate(self.other)
        self.assertIn(self.client.patch(f"{URL}{c.id}/", {"is_main_poc": True}, format="json").status_code, (403, 404))
        self.assertIn(self.client.delete(f"{URL}{c.id}/").status_code, (403, 404))
        c.refresh_from_db()
        self.assertFalse(c.is_main_poc)

    def test_member_can_delete(self):
        c = CustomerContact.objects.create(account=self.acct, name="Ann")
        self.assertEqual(self.client.delete(f"{URL}{c.id}/").status_code, 204)
