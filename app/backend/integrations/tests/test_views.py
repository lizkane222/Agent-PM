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


# ── Google Calendar sync: event category mapping ──────────────────────────────

class GoogleCalendarSyncCategoryTest(APITestCase):
    """`_sync_google_calendar` maps Google's `eventType` to `event_category`.

    Without this the column stayed at its "meeting" default for every synced
    event, so out-of-office / focus-time / working-location events all rendered
    in the meeting color on the calendar.
    """

    def setUp(self):
        self.user = User.objects.create_user(username="gcal_user", password="pass")

    def _run_sync(self, items):
        """Run the sync with a stubbed Google API returning `items`."""
        from integrations import views as integrations_views

        service = MagicMock()
        service.events.return_value.list.return_value.execute.return_value = {
            "items": items,
            "nextPageToken": None,
        }
        # `build` is imported inside the function, so patching the module attribute
        # is enough to intercept it.
        with patch("googleapiclient.discovery.build", return_value=service):
            integrations_views._sync_google_calendar(self.user, MagicMock())

    def _event(self, event_id, event_type=None, summary="Event"):
        item = {
            "id": event_id,
            "summary": summary,
            "status": "confirmed",
            "start": {"dateTime": "2026-08-20T10:00:00+00:00"},
            "end": {"dateTime": "2026-08-20T11:00:00+00:00"},
        }
        if event_type is not None:
            item["eventType"] = event_type
        return item

    def _category(self, google_event_id):
        from scheduler.models import CalendarEvent

        return CalendarEvent.objects.get(
            owner=self.user, google_event_id=google_event_id
        ).event_category

    def test_out_of_office_maps_to_out_of_office(self):
        self._run_sync([self._event("g-ooo", "outOfOffice")])
        self.assertEqual(self._category("g-ooo"), "out_of_office")

    def test_focus_time_maps_to_focus_time(self):
        self._run_sync([self._event("g-focus", "focusTime")])
        self.assertEqual(self._category("g-focus"), "focus_time")

    def test_working_location_maps_to_working_location(self):
        self._run_sync([self._event("g-loc", "workingLocation")])
        self.assertEqual(self._category("g-loc"), "working_location")

    def test_default_event_type_stays_a_meeting(self):
        self._run_sync([self._event("g-default", "default")])
        self.assertEqual(self._category("g-default"), "meeting")

    def test_missing_event_type_stays_a_meeting(self):
        self._run_sync([self._event("g-none")])
        self.assertEqual(self._category("g-none"), "meeting")

    def test_unknown_event_type_stays_a_meeting(self):
        self._run_sync([self._event("g-birthday", "birthday")])
        self.assertEqual(self._category("g-birthday"), "meeting")

    def test_resync_does_not_clobber_a_user_chosen_category(self):
        """A "default" Google event keeps the category the user set in-app."""
        from scheduler.models import CalendarEvent

        self._run_sync([self._event("g-task", "default")])
        CalendarEvent.objects.filter(google_event_id="g-task").update(event_category="task")

        self._run_sync([self._event("g-task", "default")])
        self.assertEqual(self._category("g-task"), "task")

    def test_resync_does_reapply_a_google_owned_category(self):
        """Google stays authoritative for the types it owns."""
        from scheduler.models import CalendarEvent

        self._run_sync([self._event("g-ooo2", "outOfOffice")])
        CalendarEvent.objects.filter(google_event_id="g-ooo2").update(event_category="task")

        self._run_sync([self._event("g-ooo2", "outOfOffice")])
        self.assertEqual(self._category("g-ooo2"), "out_of_office")

    def test_every_mapped_category_is_a_valid_model_choice(self):
        from integrations.views import GOOGLE_EVENT_TYPE_TO_CATEGORY
        from scheduler.models import CalendarEvent

        valid = {value for value, _label in CalendarEvent.EVENT_CATEGORY_CHOICES}
        self.assertTrue(set(GOOGLE_EVENT_TYPE_TO_CATEGORY.values()).issubset(valid))


# ── Meeting notes from email ────────────────────────────────────────────────────

class MeetingNotesFromEmailViewTest(APITestCase):
    """POST /api/v1/integrations/gmail/meeting-notes/"""

    URL = "/api/v1/integrations/gmail/meeting-notes/"

    def setUp(self):
        self.user = User.objects.create_user(username="notesuser", password="pass", is_staff=True)
        self.client.force_authenticate(user=self.user)

    def test_unauthenticated_returns_401(self):
        self.client.force_authenticate(user=None)
        resp = self.client.post(self.URL, {}, format="json")
        self.assertEqual(resp.status_code, 401)

    def test_get_is_not_allowed(self):
        """The scan mutates meetings, so it is POST-only."""
        resp = self.client.get(self.URL)
        self.assertEqual(resp.status_code, 405)

    def test_gmail_not_connected_returns_400(self):
        resp = self.client.post(self.URL, {}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Gmail", resp.json()["detail"])

    @patch("integrations.meeting_notes.sync_meeting_notes_from_email")
    def test_returns_the_report_verbatim(self, mock_sync):
        report = {
            "days": 30, "account_name": "", "scanned_emails": 4, "scanned_meetings": 2,
            "updated": [{
                "meeting_id": 1, "airtable_id": "recA", "meeting_name": "Acme Sync",
                "date": None, "account_name": "Acme Corp", "sources": ["gong"],
            }],
            "skipped": [], "errors": [], "summaries_truncated": False, "max_summaries": 25,
        }
        mock_sync.return_value = report

        resp = self.client.post(self.URL, {}, format="json")

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), report)

    @patch("integrations.meeting_notes.sync_meeting_notes_from_email")
    def test_passes_days_and_account_name_through(self, mock_sync):
        mock_sync.return_value = {
            "days": 7, "account_name": "Acme Corp", "scanned_emails": 0,
            "scanned_meetings": 0, "updated": [], "skipped": [], "errors": [],
            "summaries_truncated": False, "max_summaries": 25,
        }

        self.client.post(self.URL, {"days": 7, "account_name": "  Acme Corp  "}, format="json")

        kwargs = mock_sync.call_args.kwargs
        self.assertEqual(kwargs["days"], 7)
        self.assertEqual(kwargs["account_name"], "Acme Corp")

    @patch("integrations.meeting_notes.sync_meeting_notes_from_email")
    def test_passes_the_account_identifier_through(self, mock_sync):
        """The account detail page scopes by rec* id; profile/role pages send neither."""
        mock_sync.return_value = {
            "days": 30, "account": "recACME001", "account_name": "Acme Corp",
            "scoped_to_account": True, "scanned_emails": 0, "scanned_meetings": 0,
            "updated": [], "skipped": [], "errors": [], "summaries_truncated": False,
            "max_summaries": 25,
        }

        self.client.post(
            self.URL, {"account": "recACME001", "account_name": "Acme Corp"}, format="json"
        )

        kwargs = mock_sync.call_args.kwargs
        self.assertEqual(kwargs["account"], "recACME001")
        self.assertEqual(kwargs["account_name"], "Acme Corp")

    @patch("integrations.meeting_notes.sync_meeting_notes_from_email")
    def test_omitting_the_account_scans_everything(self, mock_sync):
        mock_sync.return_value = {
            "days": 30, "account": "", "account_name": "", "scoped_to_account": False,
            "scanned_emails": 0, "scanned_meetings": 0, "updated": [], "skipped": [],
            "errors": [], "summaries_truncated": False, "max_summaries": 25,
        }

        self.client.post(self.URL, {}, format="json")

        kwargs = mock_sync.call_args.kwargs
        self.assertEqual(kwargs["account"], "")
        self.assertEqual(kwargs["account_name"], "")

    @patch("integrations.meeting_notes.sync_meeting_notes_from_email")
    def test_numeric_account_pk_is_coerced_to_string(self, mock_sync):
        """A JSON body can send the PK as a number; the resolver expects a string."""
        mock_sync.return_value = {
            "days": 30, "account": "12", "account_name": "", "scoped_to_account": True,
            "scanned_emails": 0, "scanned_meetings": 0, "updated": [], "skipped": [],
            "errors": [], "summaries_truncated": False, "max_summaries": 25,
        }

        self.client.post(self.URL, {"account": 12}, format="json")

        self.assertEqual(mock_sync.call_args.kwargs["account"], "12")

    @patch("integrations.meeting_notes.sync_meeting_notes_from_email")
    def test_days_is_clamped_to_the_ceiling(self, mock_sync):
        mock_sync.return_value = {
            "days": 180, "account_name": "", "scanned_emails": 0, "scanned_meetings": 0,
            "updated": [], "skipped": [], "errors": [], "summaries_truncated": False,
            "max_summaries": 25,
        }

        self.client.post(self.URL, {"days": 5000}, format="json")

        self.assertEqual(mock_sync.call_args.kwargs["days"], 180)

    @patch("integrations.meeting_notes.sync_meeting_notes_from_email")
    def test_junk_days_falls_back_to_the_default(self, mock_sync):
        """A non-numeric param must not 500 — it narrows to the documented default."""
        mock_sync.return_value = {
            "days": 30, "account_name": "", "scanned_emails": 0, "scanned_meetings": 0,
            "updated": [], "skipped": [], "errors": [], "summaries_truncated": False,
            "max_summaries": 25,
        }

        resp = self.client.post(self.URL, {"days": "not-a-number"}, format="json")

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(mock_sync.call_args.kwargs["days"], 30)

    @patch("integrations.meeting_notes.sync_meeting_notes_from_email")
    def test_gmail_error_returns_502_not_500(self, mock_sync):
        mock_sync.side_effect = RuntimeError("gmail exploded")

        resp = self.client.post(self.URL, {}, format="json")

        self.assertEqual(resp.status_code, 502)
        self.assertIn("detail", resp.json())
        # The upstream message is not leaked to the client.
        self.assertNotIn("exploded", resp.json()["detail"])


# ── Gmail Watch ─────────────────────────────────────────────────────────────

class GmailWatchViewTest(APITestCase):
    URL = "/api/v1/integrations/gmail/watch/"

    def setUp(self):
        self.user = User.objects.create_user(
            username="watcher", email="watcher@example.com", password="pw"
        )

    def test_unauthenticated_returns_401(self):
        resp = self.client.post(self.URL)

        self.assertEqual(resp.status_code, 401)

    @patch("integrations.tasks.register_gmail_watch.delay")
    def test_queues_the_task_for_the_current_user(self, mock_delay):
        self.client.force_authenticate(user=self.user)

        resp = self.client.post(self.URL)

        self.assertEqual(resp.status_code, 200)
        self.assertIn("detail", resp.json())
        mock_delay.assert_called_once_with(self.user.id)

    @patch("integrations.tasks.register_gmail_watch.delay")
    def test_broker_failure_returns_503_not_500(self, mock_delay):
        mock_delay.side_effect = RuntimeError("[Errno 111] Connection refused")
        self.client.force_authenticate(user=self.user)

        resp = self.client.post(self.URL)

        self.assertEqual(resp.status_code, 503)
        self.assertEqual(
            resp.json()["detail"],
            "Failed to register watch. Check that Celery is running.",
        )
