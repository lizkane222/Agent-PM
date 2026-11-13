"""CustomerContact.timezone: IANA name, validated server-side, blank allowed."""

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from accounts.models import Account, CustomerContact
from team.models import TeamMember

User = get_user_model()
URL = "/api/v1/accounts/contacts/"


def _user(name):
    return User.objects.create_user(username=name, email=f"{name}@example.com", password="{PASSWORD}")


class CustomerContactTimezoneTest(APITestCase):
    def setUp(self):
        self.owner = _user("owner")
        self.other = _user("other")
        self.acct = Account.objects.create(company_name="Acme")
        self.acct.team_members.add(TeamMember.objects.create(user=self.owner, full_name="owner", email=self.owner.email))
        self.client.force_authenticate(self.owner)

    def test_unauthenticated_is_401(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(URL).status_code, 401)

    def test_default_blank(self):
        self.assertEqual(CustomerContact.objects.create(account=self.acct, name="Ann").timezone, "")

    def test_create_with_valid_zone(self):
        r = self.client.post(URL, {"account": self.acct.id, "name": "Ann", "timezone": "America/Chicago"}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["timezone"], "America/Chicago")

    def test_invalid_zone_rejected(self):
        r = self.client.post(URL, {"account": self.acct.id, "name": "Ann", "timezone": "Mars/Olympus"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("timezone", r.json())

    def test_update_and_clear(self):
        c = CustomerContact.objects.create(account=self.acct, name="Ann")
        r = self.client.patch(f"{URL}{c.id}/", {"timezone": "Asia/Kolkata"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        c.refresh_from_db()
        self.assertEqual(c.timezone, "Asia/Kolkata")
        r = self.client.patch(f"{URL}{c.id}/", {"timezone": ""}, format="json")
        self.assertEqual(r.status_code, 200)
        c.refresh_from_db()
        self.assertEqual(c.timezone, "")

    def test_other_users_contact_not_editable(self):
        c = CustomerContact.objects.create(account=self.acct, name="Ann")
        self.client.force_authenticate(self.other)
        r = self.client.patch(f"{URL}{c.id}/", {"timezone": "Europe/London"}, format="json")
        self.assertIn(r.status_code, (403, 404))
        c.refresh_from_db()
        self.assertEqual(c.timezone, "")
