"""Tests for the Confluence, JIRA, and Zendesk OAuth views."""
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.core import signing
from django.test import override_settings
from rest_framework.test import APITestCase

User = get_user_model()

CONFLUENCE_SETTINGS = {
    "CONFLUENCE_CLIENT_ID": "conf-id",
    "CONFLUENCE_CLIENT_SECRET": "conf-secret",
    "CONFLUENCE_REDIRECT_URI": "http://localhost/conf/cb",
}

JIRA_SETTINGS = {
    "JIRA_CLIENT_ID": "jira-id",
    "JIRA_CLIENT_SECRET": "jira-secret",
    "JIRA_REDIRECT_URI": "http://localhost/jira/cb",
}

ZENDESK_SETTINGS = {
    "ZENDESK_CLIENT_ID": "zd-id",
    "ZENDESK_CLIENT_SECRET": "zd-secret",
    "ZENDESK_REDIRECT_URI": "http://localhost/zd/cb",
    "ZENDESK_SUBDOMAIN": "mycompany",
}


# ── Confluence OAuth Init ──────────────────────────────────────────────────────

class ConfluenceOAuthInitViewTest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="alice", password="pass")

    def test_unauthenticated_returns_401(self):
        resp = self.client.get("/api/v1/integrations/confluence/connect/")
        self.assertEqual(resp.status_code, 401)

    @override_settings(CONFLUENCE_CLIENT_ID="")
    def test_not_configured_returns_503(self):
        self.client.force_authenticate(user=self.user)
        resp = self.client.get("/api/v1/integrations/confluence/connect/")
        self.assertEqual(resp.status_code, 503)

    @override_settings(**CONFLUENCE_SETTINGS)
    def test_configured_returns_authorization_url(self):
        self.client.force_authenticate(user=self.user)
        resp = self.client.get("/api/v1/integrations/confluence/connect/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("authorization_url", data)
        self.assertIn("auth.atlassian.com/authorize", data["authorization_url"])
        self.assertIn("confluence", data["authorization_url"])


# ── Confluence OAuth Callback ──────────────────────────────────────────────────

class ConfluenceOAuthCallbackViewTest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="alice", password="pass")

    def test_missing_code_returns_400(self):
        resp = self.client.get("/api/v1/integrations/confluence/callback/")
        self.assertEqual(resp.status_code, 400)

    def test_invalid_state_returns_400(self):
        resp = self.client.get(
            "/api/v1/integrations/confluence/callback/",
            {"code": "x", "state": "not-valid"},
        )
        self.assertEqual(resp.status_code, 400)

    @override_settings(**CONFLUENCE_SETTINGS)
    @patch("integrations.views.requests.get")
    @patch("integrations.views.requests.post")
    def test_valid_callback_stores_credential_and_returns_html(self, mock_post, mock_get):
        mock_post.return_value = MagicMock(
            ok=True,
            json=lambda: {"access_token": "acc", "refresh_token": "ref", "expires_in": 3600},
        )
        mock_get.return_value = MagicMock(
            ok=True,
            json=lambda: [{"id": "cloud-abc", "name": "mysite"}],
        )

        state = signing.dumps({"uid": self.user.pk}, salt="confluence-oauth")
        resp = self.client.get(
            "/api/v1/integrations/confluence/callback/",
            {"code": "authcode", "state": state},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn(b"Confluence connected", resp.content)

        from integrations.models import OAuthCredential
        cred = OAuthCredential.objects.get(user=self.user, provider="confluence")
        self.assertTrue(cred.is_active)

    @override_settings(**CONFLUENCE_SETTINGS)
    @patch("integrations.views.requests.post")
    def test_failed_token_exchange_returns_400(self, mock_post):
        mock_post.return_value = MagicMock(ok=False, text="Unauthorized")
        state = signing.dumps({"uid": self.user.pk}, salt="confluence-oauth")
        resp = self.client.get(
            "/api/v1/integrations/confluence/callback/",
            {"code": "bad", "state": state},
        )
        self.assertEqual(resp.status_code, 400)


# ── JIRA OAuth Init ────────────────────────────────────────────────────────────

class JiraOAuthInitViewTest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="bob", password="pass")

    def test_unauthenticated_returns_401(self):
        resp = self.client.get("/api/v1/integrations/jira/connect/")
        self.assertEqual(resp.status_code, 401)

    @override_settings(JIRA_CLIENT_ID="")
    def test_not_configured_returns_503(self):
        self.client.force_authenticate(user=self.user)
        resp = self.client.get("/api/v1/integrations/jira/connect/")
        self.assertEqual(resp.status_code, 503)

    @override_settings(**JIRA_SETTINGS)
    def test_configured_returns_authorization_url(self):
        self.client.force_authenticate(user=self.user)
        resp = self.client.get("/api/v1/integrations/jira/connect/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("authorization_url", data)
        self.assertIn("auth.atlassian.com/authorize", data["authorization_url"])
        self.assertIn("jira", data["authorization_url"])


# ── JIRA OAuth Callback ────────────────────────────────────────────────────────

class JiraOAuthCallbackViewTest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="bob", password="pass")

    def test_missing_code_returns_400(self):
        resp = self.client.get("/api/v1/integrations/jira/callback/")
        self.assertEqual(resp.status_code, 400)

    def test_invalid_state_returns_400(self):
        resp = self.client.get(
            "/api/v1/integrations/jira/callback/",
            {"code": "x", "state": "bad-state"},
        )
        self.assertEqual(resp.status_code, 400)

    @override_settings(**JIRA_SETTINGS)
    @patch("integrations.views.requests.get")
    @patch("integrations.views.requests.post")
    def test_valid_callback_stores_credential_and_returns_html(self, mock_post, mock_get):
        mock_post.return_value = MagicMock(
            ok=True,
            json=lambda: {"access_token": "acc", "refresh_token": "ref", "expires_in": 3600},
        )
        mock_get.return_value = MagicMock(
            ok=True,
            json=lambda: [{"id": "cloud-xyz", "name": "mysite"}],
        )

        state = signing.dumps({"uid": self.user.pk}, salt="jira-oauth")
        resp = self.client.get(
            "/api/v1/integrations/jira/callback/",
            {"code": "authcode", "state": state},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn(b"JIRA connected", resp.content)

        from integrations.models import OAuthCredential
        cred = OAuthCredential.objects.get(user=self.user, provider="jira")
        self.assertTrue(cred.is_active)

    @override_settings(**JIRA_SETTINGS)
    @patch("integrations.views.requests.post")
    def test_failed_token_exchange_returns_400(self, mock_post):
        mock_post.return_value = MagicMock(ok=False, text="Unauthorized")
        state = signing.dumps({"uid": self.user.pk}, salt="jira-oauth")
        resp = self.client.get(
            "/api/v1/integrations/jira/callback/",
            {"code": "bad", "state": state},
        )
        self.assertEqual(resp.status_code, 400)


# ── Zendesk OAuth Init ─────────────────────────────────────────────────────────

class ZendeskOAuthInitViewTest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="carol", password="pass")

    def test_unauthenticated_returns_401(self):
        resp = self.client.get("/api/v1/integrations/zendesk/connect/")
        self.assertEqual(resp.status_code, 401)

    @override_settings(ZENDESK_CLIENT_ID="")
    def test_not_configured_returns_503(self):
        self.client.force_authenticate(user=self.user)
        resp = self.client.get("/api/v1/integrations/zendesk/connect/")
        self.assertEqual(resp.status_code, 503)

    @override_settings(ZENDESK_CLIENT_ID="zd-id", ZENDESK_SUBDOMAIN="")
    def test_no_subdomain_returns_503(self):
        self.client.force_authenticate(user=self.user)
        resp = self.client.get("/api/v1/integrations/zendesk/connect/")
        self.assertEqual(resp.status_code, 503)

    @override_settings(**ZENDESK_SETTINGS)
    def test_configured_returns_authorization_url(self):
        self.client.force_authenticate(user=self.user)
        resp = self.client.get("/api/v1/integrations/zendesk/connect/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("authorization_url", data)
        self.assertIn("mycompany.zendesk.com/oauth/authorizations/new", data["authorization_url"])


# ── Zendesk OAuth Callback ─────────────────────────────────────────────────────

class ZendeskOAuthCallbackViewTest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="carol", password="pass")

    def test_missing_code_returns_400(self):
        resp = self.client.get("/api/v1/integrations/zendesk/callback/")
        self.assertEqual(resp.status_code, 400)

    def test_invalid_state_returns_400(self):
        resp = self.client.get(
            "/api/v1/integrations/zendesk/callback/",
            {"code": "x", "state": "invalid"},
        )
        self.assertEqual(resp.status_code, 400)

    @override_settings(**ZENDESK_SETTINGS)
    @patch("integrations.views.requests.post")
    def test_valid_callback_stores_credential_and_returns_html(self, mock_post):
        mock_post.return_value = MagicMock(
            ok=True,
            json=lambda: {"access_token": "zdacc", "expires_in": 7200},
        )

        state = signing.dumps({"uid": self.user.pk}, salt="zendesk-oauth")
        resp = self.client.get(
            "/api/v1/integrations/zendesk/callback/",
            {"code": "authcode", "state": state},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn(b"Zendesk connected", resp.content)

        from integrations.models import OAuthCredential
        cred = OAuthCredential.objects.get(user=self.user, provider="zendesk")
        self.assertTrue(cred.is_active)

    @override_settings(**ZENDESK_SETTINGS)
    @patch("integrations.views.requests.post")
    def test_failed_token_exchange_returns_400(self, mock_post):
        mock_post.return_value = MagicMock(ok=False, text="Unauthorized")
        state = signing.dumps({"uid": self.user.pk}, salt="zendesk-oauth")
        resp = self.client.get(
            "/api/v1/integrations/zendesk/callback/",
            {"code": "bad", "state": state},
        )
        self.assertEqual(resp.status_code, 400)


# ── Scraper Status ────────────────────────────────────────────────────────────

class ScraperStatusViewTest(APITestCase):
    URL = "/api/v1/integrations/scraper-status/"

    def setUp(self):
        self.user = User.objects.create_user(username="alice", password="pass")

    def test_unauthenticated_returns_401(self):
        resp = self.client.get(self.URL)
        self.assertEqual(resp.status_code, 401)

    @override_settings(ATLASSIAN_API_TOKEN="", GONG_ACCESS_KEY="", NOTION_INTEGRATION_TOKEN="")
    def test_returns_false_when_no_tokens_configured(self):
        self.client.force_authenticate(user=self.user)
        resp = self.client.get(self.URL)
        self.assertEqual(resp.status_code, 200)
        for key in ("confluence", "jira", "zendesk", "gong", "notion"):
            self.assertFalse(resp.data[key], f"{key} should be False when token is empty")

    @override_settings(ATLASSIAN_API_TOKEN="tok123", GONG_ACCESS_KEY="gong123", NOTION_INTEGRATION_TOKEN="")
    def test_returns_true_for_configured_tokens(self):
        # Zendesk uses the admin OAuth credential in the DB, not a plain env token.
        from integrations.models import OAuthCredential
        OAuthCredential.objects.create(
            user=self.user,
            provider="zendesk_admin",
            access_token="zd-access",
            refresh_token="",
            scopes="read",
            is_active=True,
        )
        self.client.force_authenticate(user=self.user)
        resp = self.client.get(self.URL)
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data["confluence"])
        self.assertTrue(resp.data["jira"])
        self.assertTrue(resp.data["zendesk"])
        self.assertTrue(resp.data["gong"])
        self.assertFalse(resp.data["notion"])


# ── Confluence API Token Connect ───────────────────────────────────────────────

class ConfluenceAPITokenConnectViewTest(APITestCase):
    URL = "/api/v1/integrations/confluence/connect-token/"

    def setUp(self):
        self.user = User.objects.create_user(username="alice", password="pass")

    def test_unauthenticated_returns_401(self):
        resp = self.client.post(self.URL, {"email": "a@example.com", "api_token": "tok"})
        self.assertEqual(resp.status_code, 401)

    def test_missing_fields_returns_400(self):
        self.client.force_authenticate(user=self.user)
        resp = self.client.post(self.URL, {"email": "a@example.com"})
        self.assertEqual(resp.status_code, 400)

    @patch("integrations.views.requests.get")
    def test_bad_credentials_returns_400(self, mock_get):
        self.client.force_authenticate(user=self.user)
        mock_get.return_value = MagicMock(ok=False, status_code=401)
        resp = self.client.post(self.URL, {"email": "a@example.com", "api_token": "bad"})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("401", resp.data["detail"])

    @patch("integrations.views.requests.get")
    def test_valid_credentials_creates_credential_and_config(self, mock_get):
        self.client.force_authenticate(user=self.user)
        mock_get.return_value = MagicMock(ok=True, status_code=200)
        resp = self.client.post(
            self.URL,
            {"email": "alice@twilio.com", "api_token": "mytoken123"},
        )
        self.assertEqual(resp.status_code, 200)
        from integrations.models import OAuthCredential
        cred = OAuthCredential.objects.get(user=self.user, provider="confluence")
        self.assertTrue(cred.is_active)
        self.assertEqual(cred.access_token, "mytoken123")
        from confluence_sync.models import ConfluenceConfig
        config = ConfluenceConfig.objects.get(user=self.user)
        self.assertEqual(config.atlassian_email, "alice@twilio.com")
        self.assertEqual(config.cloud_id, "twilio-productivity")


# ── Zendesk Admin OAuth ────────────────────────────────────────────────────────

ZENDESK_ADMIN_SETTINGS = {
    "ZENDESK_CLIENT_ID": "zd-id",
    "ZENDESK_CLIENT_SECRET": "zd-secret",
    "ZENDESK_SUBDOMAIN": "mycompany",
    "ZENDESK_ADMIN_REDIRECT_URI": "http://localhost/zd/admin-cb",
}


class ZendeskAdminConnectViewTest(APITestCase):
    URL = "/api/v1/integrations/zendesk/admin-connect/"

    def setUp(self):
        self.admin = User.objects.create_user(
            username="admin", password="pass", is_staff=True
        )
        self.regular = User.objects.create_user(username="regular", password="pass")

    def test_unauthenticated_returns_401(self):
        resp = self.client.get(self.URL)
        self.assertEqual(resp.status_code, 401)

    def test_non_staff_returns_403(self):
        self.client.force_authenticate(user=self.regular)
        resp = self.client.get(self.URL)
        self.assertEqual(resp.status_code, 403)

    @override_settings(ZENDESK_CLIENT_ID="")
    def test_not_configured_returns_503(self):
        self.client.force_authenticate(user=self.admin)
        resp = self.client.get(self.URL)
        self.assertEqual(resp.status_code, 503)

    @override_settings(**ZENDESK_ADMIN_SETTINGS)
    def test_returns_authorization_url(self):
        self.client.force_authenticate(user=self.admin)
        resp = self.client.get(self.URL)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("authorization_url", data)
        self.assertIn("mycompany.zendesk.com/oauth/authorizations/new", data["authorization_url"])


class ZendeskAdminCallbackViewTest(APITestCase):
    URL = "/api/v1/integrations/zendesk/admin-callback/"

    def setUp(self):
        self.admin = User.objects.create_user(
            username="admin2", password="pass", is_staff=True
        )

    def test_missing_code_returns_400(self):
        resp = self.client.get(self.URL)
        self.assertEqual(resp.status_code, 400)

    def test_invalid_state_returns_400(self):
        resp = self.client.get(self.URL, {"code": "x", "state": "bad-state"})
        self.assertEqual(resp.status_code, 400)

    @override_settings(**ZENDESK_ADMIN_SETTINGS)
    @patch("integrations.views.requests.post")
    def test_valid_callback_stores_admin_credential_and_returns_html(self, mock_post):
        mock_post.return_value = MagicMock(
            ok=True,
            json=lambda: {"access_token": "zd-admin-token"},
        )
        state = signing.dumps({"uid": self.admin.pk}, salt="zendesk-admin-oauth")
        resp = self.client.get(self.URL, {"code": "authcode", "state": state})
        self.assertEqual(resp.status_code, 200)
        self.assertIn(b"Zendesk connected", resp.content)

        from integrations.models import OAuthCredential
        cred = OAuthCredential.objects.get(provider="zendesk_admin")
        self.assertTrue(cred.is_active)
        self.assertEqual(cred.access_token, "zd-admin-token")

    @override_settings(**ZENDESK_ADMIN_SETTINGS)
    @patch("integrations.views.requests.post")
    def test_failed_token_exchange_returns_400(self, mock_post):
        mock_post.return_value = MagicMock(ok=False, text="Unauthorized")
        state = signing.dumps({"uid": self.admin.pk}, salt="zendesk-admin-oauth")
        resp = self.client.get(self.URL, {"code": "bad", "state": state})
        self.assertEqual(resp.status_code, 400)

    @override_settings(**ZENDESK_ADMIN_SETTINGS)
    @patch("integrations.views.requests.post")
    def test_non_staff_user_in_state_returns_403(self, mock_post):
        regular = User.objects.create_user(username="reg2", password="pass")
        state = signing.dumps({"uid": regular.pk}, salt="zendesk-admin-oauth")
        resp = self.client.get(self.URL, {"code": "authcode", "state": state})
        self.assertEqual(resp.status_code, 403)
