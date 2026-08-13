"""Tests for account_feed views — RBAC, config CRUD, custom fields."""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from account_feed.models import AccountFeedConfig, AccountFeedCustomField
from accounts.models import Account, AccountRole
from team.models import UserProfile

User = get_user_model()

FEED_URL = "/api/v1/account-feed/{account_id}/feed/"
CUSTOM_FIELDS_URL = "/api/v1/account-feed/{account_id}/feed/custom-fields/"


def _make_user(username, is_staff=False):
    user = User.objects.create_user(username=username, email=f"{username}@example.com", password="pass", is_staff=is_staff)
    if is_staff:
        UserProfile.objects.create(user=user, staff_view_override=True)
    return user


def _make_account(name):
    return Account.objects.create(company_name=name)


class AccountFeedConfigUnauthenticatedTest(APITestCase):
    def test_get_requires_auth(self):
        acct = _make_account("Anon Corp")
        resp = self.client.get(FEED_URL.format(account_id=acct.id))
        self.assertEqual(resp.status_code, 401)


class AccountFeedConfigStaffTest(APITestCase):
    def setUp(self):
        self.staff = _make_user("staff", is_staff=True)
        self.acct = _make_account("Staff Corp")

    def test_staff_get_creates_config_if_missing(self):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.get(FEED_URL.format(account_id=self.acct.id))
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(AccountFeedConfig.objects.filter(account=self.acct).exists())

    def test_staff_can_update_name_aliases(self):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.put(
            FEED_URL.format(account_id=self.acct.id),
            {"name_aliases": ["Acme", "ACME Ltd"], "drive_folders": [], "email_domains": []},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        config = AccountFeedConfig.objects.get(account=self.acct)
        self.assertIn("Acme", config.name_aliases)

    def test_unknown_account_returns_404(self):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.get(FEED_URL.format(account_id=99999))
        self.assertEqual(resp.status_code, 404)


class AccountFeedConfigRBACTest(APITestCase):
    def setUp(self):
        self.staff = _make_user("staff2", is_staff=True)
        self.reviewer = _make_user("reviewer")
        self.outsider = _make_user("outsider")
        self.acct = _make_account("RBAC Corp")
        AccountRole.objects.create(user=self.reviewer, account=self.acct, role="sync_reviewer", assigned_by=self.staff)

    def test_reviewer_can_get_feed(self):
        self.client.force_authenticate(user=self.reviewer)
        resp = self.client.get(FEED_URL.format(account_id=self.acct.id))
        self.assertEqual(resp.status_code, 200)

    def test_outsider_cannot_get_feed(self):
        self.client.force_authenticate(user=self.outsider)
        resp = self.client.get(FEED_URL.format(account_id=self.acct.id))
        self.assertEqual(resp.status_code, 403)

    def test_reviewer_can_add_alias(self):
        self.client.force_authenticate(user=self.reviewer)
        resp = self.client.put(
            FEED_URL.format(account_id=self.acct.id),
            {"name_aliases": ["Corp RBAC"], "drive_folders": [], "email_domains": []},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)


class AccountFeedCustomFieldTest(APITestCase):
    def setUp(self):
        self.staff = _make_user("staff3", is_staff=True)
        self.acct = _make_account("Custom Corp")

    @patch("account_feed.tasks.create_airtable_field.delay")
    def test_staff_can_create_custom_field_with_type(self, mock_delay):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.post(
            CUSTOM_FIELDS_URL.format(account_id=self.acct.id),
            {"name": "Contract Value", "value": "$500k", "airtable_field_type": "singleLineText"},
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(AccountFeedCustomField.objects.filter(name="Contract Value").exists())
        mock_delay.assert_called_once()

    @patch("account_feed.tasks.determine_and_create_airtable_field.delay")
    def test_staff_can_create_custom_field_without_type_triggers_agent(self, mock_delay):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.post(
            CUSTOM_FIELDS_URL.format(account_id=self.acct.id),
            {"name": "Support Tier", "value": "Enterprise"},
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        mock_delay.assert_called_once()

    def test_outsider_cannot_create_custom_field(self):
        outsider = _make_user("outsider2")
        self.client.force_authenticate(user=outsider)
        resp = self.client.post(
            CUSTOM_FIELDS_URL.format(account_id=self.acct.id),
            {"name": "Sneaky Field", "value": "bad"},
            format="json",
        )
        self.assertEqual(resp.status_code, 403)
