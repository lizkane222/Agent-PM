"""Tests for the Confluence, JIRA, and Zendesk OAuth views."""
from datetime import timedelta as _td
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.core import signing
from django.core.cache import cache
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


class GoogleCalendarBiDirectionalSyncTest(APITestCase):
    """Test that `_sync_google_calendar` pushes local edits before pulling.

    This ensures that a user's edits in the app don't get overwritten by Google's
    old version when the sync button is clicked.
    """

    def setUp(self):
        from django.utils import timezone
        self.user = User.objects.create_user(username="bi_sync_user", password="pass")
        self.now = timezone.now()

    def test_sync_pushes_recent_edits_before_pulling(self):
        """Edited events are pushed to Google before the pull happens.

        Scenario:
        1. User edits event title "Sync" → "Sync Updated"
        2. User clicks "Sync Google Calendar"
        3. Expect push to Google with new title
        4. Then pull from Google should bring back the new title
        5. No flicker or overwrite
        """
        from django.utils import timezone
        from datetime import timedelta
        from scheduler.models import CalendarEvent
        from integrations.models import SyncState

        # Create a synced event
        event = CalendarEvent.objects.create(
            owner=self.user,
            google_event_id="existing-event-123",
            title="Sync",
            description="Old description",
            location="Room A",
            start_datetime=self.now + timedelta(hours=1),
            end_datetime=self.now + timedelta(hours=2),
            status="confirmed",
            is_synced=True,
            calendar_id="primary",
        )

        # Record a prior sync so we have a baseline
        SyncState.objects.update_or_create(
            user=self.user,
            provider="google",
            resource="calendar",
            defaults={"last_synced_at": self.now - timedelta(minutes=5)},
        )

        # User edits the event
        event.title = "Sync Updated"
        event.location = "Room B"
        event.save()

        # Verify the event was modified after the last sync
        self.assertGreater(event.updated_at, self.now - timedelta(minutes=5))

        # Run the sync with mocked Google API
        from integrations import views as integrations_views

        service_mock = MagicMock()
        service_mock.events.return_value.list.return_value.execute.return_value = {
            "items": [
                {
                    "id": "existing-event-123",
                    "summary": "Sync Updated",  # Should come back with the new title we pushed
                    "description": "Old description",
                    "location": "Room B",
                    "status": "confirmed",
                    "start": {"dateTime": str(event.start_datetime)},
                    "end": {"dateTime": str(event.end_datetime)},
                }
            ],
            "nextPageToken": None,
        }

        with patch("googleapiclient.discovery.build", return_value=service_mock):
            integrations_views._sync_google_calendar(self.user, MagicMock())

        # Verify that patch() was called (push happened)
        service_mock.events.return_value.patch.assert_called_once()
        patch_call_kwargs = service_mock.events.return_value.patch.call_args.kwargs
        self.assertEqual(patch_call_kwargs["eventId"], "existing-event-123")
        self.assertEqual(patch_call_kwargs["body"]["summary"], "Sync Updated")
        self.assertEqual(patch_call_kwargs["body"]["location"], "Room B")

        # Verify the event is still there with the new title
        event.refresh_from_db()
        self.assertEqual(event.title, "Sync Updated")
        self.assertEqual(event.location, "Room B")
        self.assertTrue(event.is_synced)

    def test_sync_does_not_push_unsynced_events(self):
        """Only synced events (is_synced=True) are pushed."""
        from django.utils import timezone
        from datetime import timedelta
        from scheduler.models import CalendarEvent
        from integrations.models import SyncState

        # Create an unsynced event
        event = CalendarEvent.objects.create(
            owner=self.user,
            google_event_id="",  # No Google ID
            title="Local Only",
            start_datetime=self.now + timedelta(hours=1),
            end_datetime=self.now + timedelta(hours=2),
            status="confirmed",
            is_synced=False,  # Not synced
            calendar_id="primary",
        )

        # Record a prior sync
        SyncState.objects.update_or_create(
            user=self.user,
            provider="google",
            resource="calendar",
            defaults={"last_synced_at": self.now - timedelta(minutes=5)},
        )

        # Run the sync
        from integrations import views as integrations_views

        service_mock = MagicMock()
        service_mock.events.return_value.list.return_value.execute.return_value = {
            "items": [],
            "nextPageToken": None,
        }

        with patch("googleapiclient.discovery.build", return_value=service_mock):
            integrations_views._sync_google_calendar(self.user, MagicMock())

        # Verify patch was NOT called (unsynced events are not pushed)
        service_mock.events.return_value.patch.assert_not_called()

    def test_sync_skips_push_phase_on_first_sync(self):
        """First sync has no prior last_synced_at, so nothing is pushed."""
        from datetime import timedelta
        from scheduler.models import CalendarEvent
        from integrations.models import SyncState

        # Create a synced event
        event = CalendarEvent.objects.create(
            owner=self.user,
            google_event_id="first-sync-event",
            title="Existing",
            start_datetime=self.now + timedelta(hours=1),
            end_datetime=self.now + timedelta(hours=2),
            status="confirmed",
            is_synced=True,
            calendar_id="primary",
        )

        # No prior sync state yet (first sync)
        SyncState.objects.filter(
            user=self.user,
            provider="google",
            resource="calendar",
        ).delete()

        # Run the sync
        from integrations import views as integrations_views

        service_mock = MagicMock()
        service_mock.events.return_value.list.return_value.execute.return_value = {
            "items": [
                {
                    "id": "first-sync-event",
                    "summary": "Existing",
                    "status": "confirmed",
                    "start": {"dateTime": str(event.start_datetime)},
                    "end": {"dateTime": str(event.end_datetime)},
                }
            ],
            "nextPageToken": None,
        }

        with patch("googleapiclient.discovery.build", return_value=service_mock):
            integrations_views._sync_google_calendar(self.user, MagicMock())

        # Verify patch was NOT called (no prior sync to establish push boundary)
        service_mock.events.return_value.patch.assert_not_called()

    def test_push_failure_does_not_block_pull(self):
        """If pushing an event fails, the pull still proceeds."""
        from django.utils import timezone
        from datetime import timedelta
        from scheduler.models import CalendarEvent
        from integrations.models import SyncState
        from googleapiclient.errors import HttpError

        # Create a synced event
        event = CalendarEvent.objects.create(
            owner=self.user,
            google_event_id="failing-event",
            title="Will Fail Push",
            start_datetime=self.now + timedelta(hours=1),
            end_datetime=self.now + timedelta(hours=2),
            status="confirmed",
            is_synced=True,
            calendar_id="primary",
        )

        # Record a prior sync
        SyncState.objects.update_or_create(
            user=self.user,
            provider="google",
            resource="calendar",
            defaults={"last_synced_at": self.now - timedelta(minutes=5)},
        )

        # Run the sync with a failing patch
        from integrations import views as integrations_views

        service_mock = MagicMock()
        service_mock.events.return_value.patch.return_value.execute.side_effect = HttpError(
            MagicMock(status=500), b"Server error"
        )
        service_mock.events.return_value.list.return_value.execute.return_value = {
            "items": [
                {
                    "id": "failing-event",
                    "summary": "Will Fail Push",
                    "status": "confirmed",
                    "start": {"dateTime": str(event.start_datetime)},
                    "end": {"dateTime": str(event.end_datetime)},
                }
            ],
            "nextPageToken": None,
        }

        with patch("googleapiclient.discovery.build", return_value=service_mock):
            # Should not raise, pull should still complete
            integrations_views._sync_google_calendar(self.user, MagicMock())

        # Verify that list (pull) was still called despite patch (push) failure
        service_mock.events.return_value.list.assert_called_once()

    def test_a_non_httperror_push_failure_does_not_abort_the_sync(self):
        """A transient failure (network timeout, connection reset, ...) on one push
        must not escape and abort the whole sync — same contract as an HttpError,
        just a different exception type. Regression test for a real reported 500:
        the old handler only caught HttpError, so anything else propagated out of
        _push_event_to_google, out of _sync_google_calendar, and back to the view
        as an unhandled 500.
        """
        from datetime import timedelta
        from scheduler.models import CalendarEvent
        from integrations.models import SyncState

        # Two synced, recently-edited events — both attempt a push this sync.
        event_a = CalendarEvent.objects.create(
            owner=self.user,
            google_event_id="flaky-event-a",
            title="Flaky A",
            start_datetime=self.now + timedelta(hours=1),
            end_datetime=self.now + timedelta(hours=2),
            status="confirmed",
            is_synced=True,
            calendar_id="primary",
        )
        event_b = CalendarEvent.objects.create(
            owner=self.user,
            google_event_id="flaky-event-b",
            title="Flaky B",
            start_datetime=self.now + timedelta(hours=3),
            end_datetime=self.now + timedelta(hours=4),
            status="confirmed",
            is_synced=True,
            calendar_id="primary",
        )

        SyncState.objects.update_or_create(
            user=self.user,
            provider="google",
            resource="calendar",
            defaults={"last_synced_at": self.now - timedelta(minutes=5)},
        )

        from integrations import views as integrations_views

        service_mock = MagicMock()
        # The first push raises a non-HttpError exception (e.g. a network-level
        # failure); the second push should still be attempted and succeed.
        service_mock.events.return_value.patch.return_value.execute.side_effect = [
            ConnectionError("connection reset by peer"),
            {},
        ]
        service_mock.events.return_value.list.return_value.execute.return_value = {
            "items": [
                {
                    "id": "flaky-event-a",
                    "summary": "Flaky A",
                    "status": "confirmed",
                    "start": {"dateTime": str(event_a.start_datetime)},
                    "end": {"dateTime": str(event_a.end_datetime)},
                },
                {
                    "id": "flaky-event-b",
                    "summary": "Flaky B",
                    "status": "confirmed",
                    "start": {"dateTime": str(event_b.start_datetime)},
                    "end": {"dateTime": str(event_b.end_datetime)},
                },
            ],
            "nextPageToken": None,
        }

        with patch("googleapiclient.discovery.build", return_value=service_mock):
            # Must not raise, despite the first push blowing up with a plain
            # ConnectionError rather than an HttpError.
            integrations_views._sync_google_calendar(self.user, MagicMock())

        # Both pushes were attempted — the first one's failure didn't stop the loop.
        self.assertEqual(service_mock.events.return_value.patch.return_value.execute.call_count, 2)
        # The pull still completed.
        service_mock.events.return_value.list.assert_called_once()

    def test_an_unchanged_pulled_event_does_not_bump_updated_at(self):
        """PHASE 2's pull must not mark every untouched event as if it had just been
        locally edited. update_or_create() calls .save() on the existing row, which
        bumps `updated_at` (auto_now=True) even when nothing about the row reflects a
        real local edit — that falsely makes PHASE 1 re-push the entire calendar back
        to Google on every subsequent sync. Regression test for that bug: a pull that
        brings back identical data must leave updated_at untouched, while a pull that
        brings back genuinely different data must still update the row.
        """
        from datetime import timedelta
        from scheduler.models import CalendarEvent
        from integrations.models import SyncState

        event = CalendarEvent.objects.create(
            owner=self.user,
            google_event_id="stable-event",
            title="Stable",
            start_datetime=self.now + timedelta(hours=1),
            end_datetime=self.now + timedelta(hours=2),
            status="confirmed",
            is_synced=True,
            calendar_id="primary",
        )
        # Push updated_at into the past so it's clearly distinguishable from "now",
        # and so this event does NOT look like a "recent local edit" for PHASE 1.
        stale_updated_at = self.now - timedelta(days=3)
        CalendarEvent.objects.filter(pk=event.pk).update(updated_at=stale_updated_at)

        SyncState.objects.update_or_create(
            user=self.user,
            provider="google",
            resource="calendar",
            defaults={"last_synced_at": self.now - timedelta(days=3)},
        )

        from integrations import views as integrations_views

        service_mock = MagicMock()
        service_mock.events.return_value.list.return_value.execute.return_value = {
            "items": [
                {
                    "id": "stable-event",
                    # Identical to what's already stored — nothing actually changed.
                    "summary": "Stable",
                    "status": "confirmed",
                    "start": {"dateTime": str(event.start_datetime)},
                    "end": {"dateTime": str(event.end_datetime)},
                }
            ],
            "nextPageToken": None,
        }

        with patch("googleapiclient.discovery.build", return_value=service_mock):
            integrations_views._sync_google_calendar(self.user, MagicMock())

        event.refresh_from_db()
        self.assertEqual(event.updated_at, stale_updated_at)

        # A second sync where Google genuinely has a new title must still update the
        # real field value — proving the .filter().update() swap didn't silently break
        # real field writes while fixing the false-positive updated_at bump.
        service_mock.events.return_value.list.return_value.execute.return_value = {
            "items": [
                {
                    "id": "stable-event",
                    "summary": "Renamed On Google",
                    "status": "confirmed",
                    "start": {"dateTime": str(event.start_datetime)},
                    "end": {"dateTime": str(event.end_datetime)},
                }
            ],
            "nextPageToken": None,
        }
        SyncState.objects.update_or_create(
            user=self.user,
            provider="google",
            resource="calendar",
            defaults={"last_synced_at": self.now - timedelta(minutes=1)},
        )
        with patch("googleapiclient.discovery.build", return_value=service_mock):
            integrations_views._sync_google_calendar(self.user, MagicMock())

        event.refresh_from_db()
        self.assertEqual(event.title, "Renamed On Google")


class GoogleCalendarSyncViewEndpointTest(APITestCase):
    """`POST /api/v1/integrations/google/sync/` — the manual "Sync Google Calendar"
    button. Regression coverage for two real bugs that made every click 500:

    1. `_push_event_to_google` built its Credentials with
       `creds.scopes.split() if hasattr(creds, "scopes") else creds.scopes`. `creds`
       here is always a real google.oauth2.credentials.Credentials, whose .scopes is
       already a list — hasattr() is true regardless, so it always took the
       .split() branch and crashed with `AttributeError: 'list' object has no
       attribute 'split'`. (Earlier tests in this file pass a bare MagicMock() as
       creds, which never surfaces this: Mock attribute access/methods never raise
       AttributeError, so the bug went undetected.)
    2. Even past that, the pushed `dateTime` was built from `str(a_datetime)`
       ("2026-05-28 20:00:00+00:00" — a space) instead of `.isoformat()`
       ("...T20:00:00+00:00"). Google's Calendar API requires the RFC3339 "T"
       separator and rejects the space form with a generic 400 and no field-level
       detail, so every push silently failed after bug 1 was fixed.
    """

    def setUp(self):
        from django.utils import timezone
        from datetime import timedelta
        from scheduler.models import CalendarEvent
        from integrations.models import OAuthCredential, SyncState

        self.user = User.objects.create_user(username="sync_btn_user", password="pass")
        self.client.force_authenticate(user=self.user)
        self.now = timezone.now()

        OAuthCredential.objects.create(
            user=self.user,
            provider="google",
            access_token="tok",
            refresh_token="ref",
            # A real (space-separated string) OAuthCredential.scopes, exactly as
            # stored in the DB — not a list and not a MagicMock. This is what
            # actually exposed both bugs above.
            scopes="https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events",
            is_active=True,
        )
        self.event = CalendarEvent.objects.create(
            owner=self.user,
            google_event_id="synced-event-1",
            title="Weekly Sync",
            start_datetime=self.now + timedelta(hours=1),
            end_datetime=self.now + timedelta(hours=2),
            status="confirmed",
            is_synced=True,
            calendar_id="primary",
        )
        SyncState.objects.update_or_create(
            user=self.user,
            provider="google",
            resource="calendar",
            defaults={"last_synced_at": self.now - timedelta(minutes=5)},
        )
        # An edit after the last sync, so PHASE 1 (push) attempts this event.
        self.event.title = "Weekly Sync Updated"
        self.event.save()

    def _mock_service(self):
        service_mock = MagicMock()
        service_mock.events.return_value.list.return_value.execute.return_value = {
            "items": [
                {
                    "id": "synced-event-1",
                    "summary": "Weekly Sync Updated",
                    "status": "confirmed",
                    "start": {"dateTime": self.event.start_datetime.isoformat()},
                    "end": {"dateTime": self.event.end_datetime.isoformat()},
                }
            ],
            "nextPageToken": None,
        }
        return service_mock

    def test_sync_no_longer_500s(self):
        service_mock = self._mock_service()
        with patch("googleapiclient.discovery.build", return_value=service_mock):
            resp = self.client.post("/api/v1/integrations/google/sync/")

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["detail"], "Sync complete.")

    def test_sync_pushes_an_rfc3339_datetime_with_a_t_separator(self):
        service_mock = self._mock_service()
        with patch("googleapiclient.discovery.build", return_value=service_mock):
            resp = self.client.post("/api/v1/integrations/google/sync/")

        self.assertEqual(resp.status_code, 200)
        service_mock.events.return_value.patch.assert_called_once()
        body = service_mock.events.return_value.patch.call_args.kwargs["body"]
        self.assertIn("T", body["start"]["dateTime"])
        self.assertIn("T", body["end"]["dateTime"])
        self.assertNotIn(" ", body["start"]["dateTime"])
        self.assertNotIn(" ", body["end"]["dateTime"])


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


# ── Google Calendar OAuth (Init + Callback) ─────────────────────────────────────

GOOGLE_SETTINGS = {
    "GOOGLE_CLIENT_ID": "g-id",
    "GOOGLE_CLIENT_SECRET": "g-secret",
    "GOOGLE_REDIRECT_URI": "http://localhost:8000/api/v1/integrations/google/callback/",
}


class GoogleOAuthPKCERegressionTest(APITestCase):
    """
    Regression coverage for a real bug: GoogleOAuthInitView and GoogleOAuthCallbackView
    each build their own short-lived Flow via _build_google_flow() — nothing persists
    state between the two requests. With autogenerate_code_verifier=True, init attached
    a PKCE code_challenge to the authorization URL, promising Google a code_verifier
    that only ever existed on that discarded Flow instance. The callback's fresh Flow
    had no verifier to answer it, so every real exchange failed with
    "(invalid_grant) Missing code verifier" — surfaced to users as a misleading
    "Authorization code expired" message, independent of ngrok/localhost or any
    redirect URI configuration.
    """

    def setUp(self):
        self.user = User.objects.create_user(username="alice", password="pass")

    @override_settings(**GOOGLE_SETTINGS)
    def test_build_google_flow_disables_pkce(self):
        from integrations.views import _build_google_flow

        flow = _build_google_flow()
        self.assertFalse(flow.autogenerate_code_verifier)
        self.assertIsNone(getattr(flow, "code_verifier", None))

    @override_settings(**GOOGLE_SETTINGS)
    def test_authorization_url_makes_no_pkce_promise(self):
        from urllib.parse import parse_qs, urlparse

        self.client.force_authenticate(user=self.user)
        resp = self.client.get("/api/v1/integrations/google/connect/")

        self.assertEqual(resp.status_code, 200)
        qs = parse_qs(urlparse(resp.json()["authorization_url"]).query)
        self.assertNotIn("code_challenge", qs)
        self.assertNotIn("code_challenge_method", qs)

    @override_settings(**GOOGLE_SETTINGS)
    @patch("integrations.views._sync_google_calendar")
    def test_callback_exchanges_code_via_a_fresh_flow_with_no_carried_over_verifier(
        self, mock_sync
    ):
        """
        Drives GoogleOAuthInitView then GoogleOAuthCallbackView as two independent
        requests — the same shape Google's real redirect produces. The token
        endpoint's HTTP transport (not the OAuth library) is faked, so the real
        fetch_token / oauthlib parsing code runs exactly as it does in production.
        """
        import json

        from integrations.views import GOOGLE_SCOPES
        from requests.adapters import HTTPAdapter
        from requests.models import Response

        self.client.force_authenticate(user=self.user)
        init_resp = self.client.get("/api/v1/integrations/google/connect/")
        self.assertEqual(init_resp.status_code, 200)

        captured_bodies = []

        def fake_send(self, request, **kwargs):
            body = request.body or ""
            captured_bodies.append(body.decode() if isinstance(body, bytes) else body)
            resp = Response()
            resp.status_code = 200
            resp._content = json.dumps(
                {
                    "access_token": "fake-access-token",
                    "refresh_token": "fake-refresh-token",
                    "expires_in": 3599,
                    "scope": " ".join(GOOGLE_SCOPES),
                    "token_type": "Bearer",
                }
            ).encode()
            resp.headers["content-type"] = "application/json"
            resp.request = request
            return resp

        state = signing.dumps({"uid": self.user.pk}, salt="google-oauth")
        with patch.object(HTTPAdapter, "send", fake_send):
            resp = self.client.get(
                "/api/v1/integrations/google/callback/",
                {"code": "authcode", "state": state},
            )

        self.assertEqual(resp.status_code, 200)
        self.assertIn(b"Google Calendar connected", resp.content)
        self.assertTrue(captured_bodies, "token endpoint was never called")
        self.assertNotIn("code_verifier", captured_bodies[0])

        from integrations.models import OAuthCredential

        cred = OAuthCredential.objects.get(user=self.user, provider="google")
        self.assertEqual(cred.access_token, "fake-access-token")
        self.assertTrue(cred.is_active)
        mock_sync.assert_called_once()


# ── Google OAuth Error Categorization ──────────────────────────────────────────


class GoogleOAuthErrorCategorization(APITestCase):
    """Test that OAuth errors are categorized into helpful messages."""

    def test_redirect_uri_mismatch_error(self):
        """Detects redirect URI mismatches and suggests the fix."""
        from integrations.views import _categorize_oauth_error

        exc = Exception("redirect_uri_mismatch: The redirect_uri parameter does not match")
        category, message = _categorize_oauth_error(exc)

        self.assertEqual(category, "redirect_uri_mismatch")
        self.assertIn("Redirect URI mismatch", message)
        self.assertIn("Google Cloud Console", message)
        self.assertIn(".env", message)

    def test_expired_code_error(self):
        """Detects expired authorization codes."""
        from integrations.views import _categorize_oauth_error

        exc = Exception("invalid_grant: The authorization code is invalid or expired.")
        category, message = _categorize_oauth_error(exc)

        self.assertEqual(category, "code_expired")
        self.assertIn("expired", message.lower())
        self.assertIn("try connecting again", message)

    def test_invalid_credentials_error(self):
        """Detects invalid client credentials."""
        from integrations.views import _categorize_oauth_error

        exc = Exception("invalid_client: The OAuth client was not recognized.")
        category, message = _categorize_oauth_error(exc)

        self.assertEqual(category, "invalid_credentials")
        self.assertIn("GOOGLE_CLIENT_ID", message)
        self.assertIn("GOOGLE_CLIENT_SECRET", message)

    def test_network_error(self):
        """Detects network and SSL errors."""
        from integrations.views import _categorize_oauth_error

        exc = Exception("SSL: CERTIFICATE_VERIFY_FAILED")
        category, message = _categorize_oauth_error(exc)

        self.assertEqual(category, "network_error")
        self.assertIn("Network error", message)

    def test_unknown_error_fallback(self):
        """Falls back to generic message for unknown errors."""
        from integrations.views import _categorize_oauth_error

        exc = Exception("Something weird happened")
        category, message = _categorize_oauth_error(exc)

        self.assertEqual(category, "unknown")
        self.assertIn("Token exchange failed", message)


# ── Salesforce OAuth callback: identity capture ────────────────────────────────

SALESFORCE_SETTINGS = {
    "SALESFORCE_CLIENT_ID": "sf-id",
    "SALESFORCE_CLIENT_SECRET": "sf-secret",
    "SALESFORCE_REDIRECT_URI": "http://localhost:8000/api/v1/integrations/salesforce/callback/",
    "SALESFORCE_INSTANCE_URL": "https://twlo--jarvisdc.sandbox.my.salesforce.com",
    "SALESFORCE_LOGIN_URL": "https://twlo--jarvisdc.sandbox.my.salesforce.com",
}


class ExtractSfUserIdTest(APITestCase):
    """
    The token response's `id` is `https://<login host>/id/<org id>/<user id>`, so the
    Salesforce User id is free — no API call. It is worth parsing carefully: the only
    other source is `chatter/users/me`, which 404s in an org with Chatter disabled, and a
    blank `sf_user_id` silently disables the role-matched project fallback in
    `log_week._role_project_ids`, empties `SalesforceProjectViewSet`, and strips
    `Resource__c` off every time entry.
    """

    def test_an_18_char_id_is_extracted(self):
        from integrations.views import extract_sf_user_id

        self.assertEqual(
            extract_sf_user_id(
                "https://login.salesforce.com/id/00D000000000001EAA/005000000000001AAA"
            ),
            "005000000000001AAA",
        )

    def test_a_15_char_id_is_extracted(self):
        from integrations.views import extract_sf_user_id

        self.assertEqual(
            extract_sf_user_id("https://login.salesforce.com/id/00D000000000001/005000000000001"),
            "005000000000001",
        )

    def test_a_trailing_slash_does_not_swallow_the_id(self):
        from integrations.views import extract_sf_user_id

        self.assertEqual(
            extract_sf_user_id(
                "https://login.salesforce.com/id/00D000000000001EAA/005000000000001AAA/"
            ),
            "005000000000001AAA",
        )

    def test_a_missing_identity_url_is_blank_not_an_error(self):
        from integrations.views import extract_sf_user_id

        self.assertEqual(extract_sf_user_id(None), "")
        self.assertEqual(extract_sf_user_id(""), "")

    def test_a_non_user_key_prefix_is_rejected(self):
        # 00D is the Org prefix. Storing it would look plausible and match nothing.
        from integrations.views import extract_sf_user_id

        self.assertEqual(
            extract_sf_user_id("https://login.salesforce.com/id/00D000000000001EAA"), ""
        )

    def test_a_malformed_last_segment_is_rejected(self):
        from integrations.views import extract_sf_user_id

        self.assertEqual(extract_sf_user_id("https://login.salesforce.com/id/"), "")
        self.assertEqual(extract_sf_user_id("not-a-url"), "")


@override_settings(**SALESFORCE_SETTINGS)
class SalesforceOAuthCallbackIdentityTest(APITestCase):
    """
    The callback is `AllowAny`, so every test here spends from the process-wide anon
    throttle bucket (20/min). Adding this class alone was enough to push the file past
    it and 429 the Zendesk callback tests that happen to run later — the same failure
    mode `realtime`'s `VoiceTwiMLViewTests` hit. Cleared on both sides so this class is
    neither a victim nor a cause.
    """

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username="liz", password="pass")
        self.state = signing.dumps({"uid": self.user.pk}, salt="sf-oauth")

    def tearDown(self):
        cache.clear()

    def _callback(self, payload):
        mock_resp = MagicMock(ok=True)
        mock_resp.json.return_value = payload
        # sync_all builds a real client, so it is patched out — this test is about what the
        # callback stores, not about syncing.
        with patch("integrations.views.requests.post", return_value=mock_resp), patch(
            "salesforce_sync.sync.sync_all"
        ):
            return self.client.get(
                "/api/v1/integrations/salesforce/callback/",
                {"code": "abc", "state": self.state},
            )

    def _config(self):
        from salesforce_sync.models import SalesforceConfig

        return SalesforceConfig.objects.get(user=self.user)

    def test_the_instance_url_and_user_id_are_both_stored(self):
        resp = self._callback({
            "access_token": "tok",
            "refresh_token": "ref",
            "instance_url": "https://twlo--jarvisdc.sandbox.my.salesforce.com",
            "id": "https://test.salesforce.com/id/00D000000000001EAA/005000000000001AAA",
        })

        self.assertEqual(resp.status_code, 200)
        config = self._config()
        self.assertEqual(
            config.instance_url, "https://twlo--jarvisdc.sandbox.my.salesforce.com"
        )
        self.assertEqual(config.sf_user_id, "005000000000001AAA")

    def test_a_trailing_slash_is_stripped_from_the_instance_url(self):
        # The stored value is concatenated with /services/... paths, so a trailing slash
        # would produce a double slash in every REST URL.
        self._callback({
            "access_token": "tok",
            "instance_url": "https://twlo--jarvisdc.sandbox.my.salesforce.com/",
            "id": "https://test.salesforce.com/id/00D000000000001EAA/005000000000001AAA",
        })

        self.assertEqual(
            self._config().instance_url, "https://twlo--jarvisdc.sandbox.my.salesforce.com"
        )

    def test_a_token_response_without_an_identity_url_still_stores_the_host(self):
        self._callback({
            "access_token": "tok",
            "instance_url": "https://twlo--jarvisdc.sandbox.my.salesforce.com",
        })

        config = self._config()
        self.assertEqual(
            config.instance_url, "https://twlo--jarvisdc.sandbox.my.salesforce.com"
        )
        self.assertEqual(config.sf_user_id, "")

    def test_a_previously_stored_user_id_is_not_blanked_by_a_reconnect(self):
        from salesforce_sync.models import SalesforceConfig

        SalesforceConfig.objects.create(
            user=self.user,
            instance_url="https://twlo--jarvisdc.sandbox.my.salesforce.com",
            sf_user_id="005000000000001AAA",
        )

        # A reconnect whose token response omits `id` must not clear what is already known;
        # only non-blank values are written into the defaults.
        self._callback({
            "access_token": "tok",
            "instance_url": "https://twlo--jarvisdc.sandbox.my.salesforce.com",
        })

        self.assertEqual(self._config().sf_user_id, "005000000000001AAA")

    def test_the_credential_is_still_stored_when_the_config_write_fails(self):
        # The OAuth credential is the thing the user just earned; a SalesforceConfig
        # problem must not cost them the connection.
        with patch(
            "salesforce_sync.models.SalesforceConfig.objects.update_or_create",
            side_effect=RuntimeError("db unhappy"),
        ):
            resp = self._callback({
                "access_token": "tok",
                "instance_url": "https://twlo--jarvisdc.sandbox.my.salesforce.com",
                "id": "https://test.salesforce.com/id/00D000000000001EAA/005000000000001AAA",
            })

        self.assertEqual(resp.status_code, 200)
        from integrations.models import OAuthCredential

        self.assertTrue(
            OAuthCredential.objects.filter(user=self.user, provider="salesforce").exists()
        )


# ── Google Calendar sync: reconciliation must not destroy local work ──────────

class GoogleCalendarReconcileMissingEventsTest(APITestCase):
    """`_reconcile_missing_google_events` — what happens to rows Google did not return.

    The block this replaces deleted every `is_synced=True` row in `primary`/`work_tracking`
    absent from the pull response, with no window check and no `google_event_id` check. That
    destroyed user data three separate ways, one test each below.
    """

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username="reconcile_user", password="{PASSWORD}")

    def tearDown(self):
        cache.clear()

    # -- helpers ----------------------------------------------------------------

    def _run_sync(self, items, insert_id="g-repushed"):
        from integrations import views as integrations_views

        service = MagicMock()
        service.events.return_value.list.return_value.execute.return_value = {
            "items": items,
            "nextPageToken": None,
        }
        # A real dict, not the default MagicMock: PHASE 1b reads `.get("id")` off this and
        # writes it to a CharField, and a MagicMock there fails as an "aggregate function".
        service.events.return_value.insert.return_value.execute.return_value = {"id": insert_id}
        with patch("googleapiclient.discovery.build", return_value=service):
            integrations_views._sync_google_calendar(self.user, MagicMock())
        return service

    def _google_item(self, event_id="g-keeper"):
        """An unrelated event, so `seen_ids` is non-empty and reconciliation actually runs."""
        from django.utils import timezone

        start = timezone.now()
        return {
            "id": event_id,
            "summary": "Some meeting",
            "status": "confirmed",
            "start": {"dateTime": start.isoformat()},
            "end": {"dateTime": (start + _td(hours=1)).isoformat()},
        }

    def _event(self, **kwargs):
        from django.utils import timezone
        from scheduler.models import CalendarEvent

        start = kwargs.pop("start", timezone.now())
        defaults = {
            "owner": self.user,
            "title": "Scheduled work",
            "start_datetime": start,
            "end_datetime": start + _td(hours=1),
            "calendar_id": "work_tracking",
            "is_synced": True,
            "google_event_id": "g-gone",
            "agentpm_airtable_id": "recABC",
        }
        defaults.update(kwargs)
        return CalendarEvent.objects.create(**defaults)

    def _reload(self, event):
        from scheduler.models import CalendarEvent

        return CalendarEvent.objects.filter(pk=event.pk).first()

    # -- the three data-loss paths ---------------------------------------------

    def test_a_row_never_pushed_to_google_is_left_alone(self):
        """Google cannot omit an event it was never told about.

        A blank `google_event_id` still matched `.exclude(google_event_id__in=seen_ids)`, so a
        locally-created row was deleted by the very first sync that ran after it was made.
        """
        event = self._event(google_event_id="", is_synced=True)
        self._run_sync([self._google_item()])
        self.assertIsNotNone(self._reload(event), "a never-pushed row must survive the sync")

    def test_a_row_outside_the_pull_window_is_left_alone(self):
        """The pull asks for now ±90 days, so anything outside it is absent by construction."""
        from django.utils import timezone

        event = self._event(start=timezone.now() + _td(days=200), google_event_id="g-far")
        self._run_sync([self._google_item()])
        self.assertIsNotNone(
            self._reload(event), "an out-of-window row must not be deleted for being absent"
        )

    def test_an_agentpm_owned_row_is_unlinked_not_deleted(self):
        """work_tracking / reminders rows are originals here and copies in Google.

        Missing from Google means the mirror is stale, so the row is kept and de-linked ready
        for the next sync to re-push. This is the bound that makes the reported bug impossible.
        """
        event = self._event(google_event_id="g-vanished")
        self._run_sync([self._google_item()])

        refreshed = self._reload(event)
        self.assertIsNotNone(refreshed, "an AgentPM-owned row must never be deleted")
        self.assertEqual(refreshed.google_event_id, "")
        self.assertFalse(refreshed.is_synced)

    def test_an_unlinked_row_is_repushed_by_the_next_sync(self):
        """The unlink has to be self-healing, or it just defers the divergence."""
        event = self._event(google_event_id="g-vanished")
        self._run_sync([self._google_item()])

        service = self._run_sync([self._google_item()])
        inserted = service.events.return_value.insert
        self.assertTrue(inserted.called, "the unlinked row should be re-inserted into Google")
        body = inserted.call_args.kwargs["body"]
        self.assertEqual(
            body["extendedProperties"]["private"]["agentpm_source"], "action_item"
        )
        self.assertEqual(
            body["extendedProperties"]["private"]["agentpm_airtable_id"], "recABC"
        )

    def test_a_scheduled_reminder_row_is_also_unlinked_not_deleted(self):
        from scheduler.models import Reminder
        from django.utils import timezone

        reminder = Reminder.objects.create(
            created_by=self.user, title="Ping Dan", due_at=timezone.now()
        )
        event = self._event(
            calendar_id="reminders",
            agentpm_airtable_id="",
            reminder=reminder,
            google_event_id="g-rem-gone",
        )
        self._run_sync([self._google_item()])

        refreshed = self._reload(event)
        self.assertIsNotNone(refreshed)
        self.assertEqual(refreshed.google_event_id, "")

    # -- the behaviour that must NOT regress ----------------------------------

    def test_a_plain_in_window_meeting_google_omits_is_still_deleted(self):
        """Google really is authoritative for ordinary meetings — don't break that."""
        event = self._event(
            calendar_id="primary", agentpm_airtable_id="", google_event_id="g-deleted-in-google"
        )
        self._run_sync([self._google_item()])
        self.assertIsNone(self._reload(event), "a deleted Google meeting should still be removed")

    def test_nothing_is_reconciled_when_google_returns_no_items(self):
        """An empty response is a probable transient failure, not an empty calendar."""
        event = self._event(calendar_id="primary", agentpm_airtable_id="")
        self._run_sync([])
        self.assertIsNotNone(self._reload(event))


class GoogleCalendarPushNewAgentpmEventsTest(APITestCase):
    """PHASE 1b — the sync, not the client, mirrors newly-scheduled rows to Google."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username="push_new_user", password="{PASSWORD}")

    def tearDown(self):
        cache.clear()

    def _service(self, insert_ids):
        service = MagicMock()
        service.events.return_value.list.return_value.execute.return_value = {
            "items": [], "nextPageToken": None,
        }
        service.events.return_value.insert.return_value.execute.side_effect = insert_ids
        return service

    def _pending(self, title, **kwargs):
        from django.utils import timezone
        from scheduler.models import CalendarEvent

        start = kwargs.pop("start", timezone.now() + _td(days=1))
        defaults = {
            "owner": self.user,
            "title": title,
            "start_datetime": start,
            "end_datetime": start + _td(hours=1),
            "calendar_id": "work_tracking",
            "google_event_id": "",
            "is_synced": False,
            "agentpm_airtable_id": f"rec-{title}",
        }
        defaults.update(kwargs)
        return CalendarEvent.objects.create(**defaults)

    def _run(self, service):
        from integrations import views as integrations_views

        with patch("googleapiclient.discovery.build", return_value=service):
            integrations_views._sync_google_calendar(self.user, MagicMock())

    def test_an_unsynced_row_is_inserted_and_marked_synced(self):
        event = self._pending("Provision SQL Traits")
        self._run(self._service([{"id": "g-new-1"}]))

        event.refresh_from_db()
        self.assertEqual(event.google_event_id, "g-new-1")
        self.assertTrue(event.is_synced)

    def test_the_insert_carries_the_extended_properties_the_pull_needs(self):
        """Without these the pull classifies it "primary" and it becomes a meeting."""
        self._pending("Create Diagram")
        service = self._service([{"id": "g-new-2"}])
        self._run(service)

        body = service.events.return_value.insert.call_args.kwargs["body"]
        private = body["extendedProperties"]["private"]
        self.assertEqual(private["agentpm_source"], "action_item")
        self.assertEqual(private["agentpm_airtable_id"], "rec-Create Diagram")

    def test_a_reminder_row_is_pushed_with_the_reminder_source(self):
        from django.utils import timezone
        from scheduler.models import Reminder

        reminder = Reminder.objects.create(
            created_by=self.user, title="Call back", due_at=timezone.now()
        )
        self._pending(
            "Call back", calendar_id="reminders", agentpm_airtable_id="", reminder=reminder
        )
        service = self._service([{"id": "g-rem-1"}])
        self._run(service)

        private = service.events.return_value.insert.call_args.kwargs["body"]["extendedProperties"]["private"]
        self.assertEqual(private["agentpm_source"], "reminder")
        self.assertEqual(private["agentpm_reminder_id"], str(reminder.pk))

    def test_one_failing_insert_does_not_abort_the_rest(self):
        """A batch of schedulings must not be lost to a single flaky call."""
        first = self._pending("aaa-fails")
        second = self._pending("bbb-succeeds")
        service = self._service([RuntimeError("google down"), {"id": "g-ok"}])
        self._run(service)

        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(first.google_event_id, "", "the failed row stays pending for a retry")
        self.assertEqual(second.google_event_id, "g-ok")

    def test_an_out_of_window_row_is_not_pushed(self):
        from django.utils import timezone

        event = self._pending("far future", start=timezone.now() + _td(days=200))
        service = self._service([{"id": "g-nope"}])
        self._run(service)

        event.refresh_from_db()
        self.assertEqual(event.google_event_id, "")

    def test_a_plain_primary_row_is_not_pushed_by_this_phase(self):
        """`primary` creates already push at create time via CalendarEventViewSet."""
        event = self._pending("meeting", calendar_id="primary", agentpm_airtable_id="")
        service = self._service([{"id": "g-should-not"}])
        self._run(service)

        event.refresh_from_db()
        self.assertEqual(event.google_event_id, "")


class ParseStartMinuteTest(APITestCase):
    """`_parse_start_minute` — a failed parse must never read as "duplicate exists"."""

    def test_it_truncates_to_the_minute(self):
        from integrations.views import _parse_start_minute

        parsed = _parse_start_minute("2026-09-15T11:30:45+00:00")
        self.assertEqual((parsed.second, parsed.microsecond), (0, 0))
        self.assertEqual((parsed.hour, parsed.minute), (11, 30))

    def test_it_accepts_a_trailing_z(self):
        from integrations.views import _parse_start_minute

        self.assertIsNotNone(_parse_start_minute("2026-09-15T11:30:00Z"))

    def test_a_naive_string_is_treated_as_utc(self):
        from integrations.views import _parse_start_minute

        self.assertIsNotNone(_parse_start_minute("2026-09-15T11:30:00").tzinfo)

    def test_unparseable_input_returns_none(self):
        from integrations.views import _parse_start_minute

        for bad in ("", None, "not a date", "2026-13-45T99:99:99"):
            self.assertIsNone(_parse_start_minute(bad), bad)


class GoogleActionItemsPushDedupTest(APITestCase):
    """The push view must treat a second occurrence as a new event, not a duplicate.

    Matching on `agentpm_airtable_id` alone answered a *new* scheduling with the *first*
    occurrence's google_event_id. The caller read that as confirmation and dropped its own
    copy, so the new scheduling existed nowhere. This is loss path 1 from the bug report.
    """

    URL = "/api/v1/integrations/google/push-action-items/"

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username="push_dedup", password="{PASSWORD}")
        self.client.force_authenticate(self.user)
        from integrations.models import OAuthCredential

        OAuthCredential.objects.create(
            user=self.user, provider="google", access_token="t",
            refresh_token="r", scopes="https://www.googleapis.com/auth/calendar",
            is_active=True,
        )

    def tearDown(self):
        cache.clear()

    def _existing(self, start, google_event_id="g-first"):
        from scheduler.models import CalendarEvent

        return CalendarEvent.objects.create(
            owner=self.user, title="Composite Keys", calendar_id="work_tracking",
            start_datetime=start, end_datetime=start + _td(hours=1),
            is_synced=True, google_event_id=google_event_id, agentpm_airtable_id="recDUP",
        )

    def _push(self, start_iso, service):
        with patch("googleapiclient.discovery.build", return_value=service):
            return self.client.post(self.URL, {"items": [{
                "airtableId": "recDUP",
                "start": start_iso,
                "end": start_iso.replace("T09:", "T10:"),
                "task": "Composite Keys",
            }]}, format="json")

    def _service(self, new_id="g-second"):
        service = MagicMock()
        service.events.return_value.insert.return_value.execute.return_value = {"id": new_id}
        return service

    def test_a_second_occurrence_creates_a_new_google_event(self):
        import datetime

        self._existing(datetime.datetime(2026, 9, 2, 9, 0, tzinfo=datetime.timezone.utc))
        service = self._service()
        resp = self._push("2026-09-03T09:00:00+00:00", service)

        self.assertEqual(resp.status_code, 200)
        self.assertTrue(
            service.events.return_value.insert.called,
            "a different start must produce a real Google insert",
        )
        self.assertEqual(resp.data["results"][0]["googleEventId"], "g-second")

    def test_the_same_start_minute_still_dedups(self):
        import datetime

        self._existing(datetime.datetime(2026, 9, 2, 9, 0, tzinfo=datetime.timezone.utc))
        service = self._service()
        resp = self._push("2026-09-02T09:00:00+00:00", service)

        self.assertFalse(
            service.events.return_value.insert.called,
            "a genuine same-slot duplicate must not create a second Google event",
        )
        self.assertEqual(resp.data["results"][0]["googleEventId"], "g-first")


class IntegrationVotesAndHintsTest(APITestCase):
    def setUp(self):
        from django.core.cache import cache
        cache.clear()
        self.user = User.objects.create_user("voter", password="{PASSWORD}")
        self.client.force_authenticate(user=self.user)

    def test_availability_marks_unconfigured_providers(self):
        resp = self.client.get("/api/v1/integrations/availability/")
        self.assertEqual(resp.status_code, 200)
        providers = resp.data["providers"]
        for p in ("gong", "zoom", "lucidchart"):
            self.assertFalse(providers[p]["configured"])

    def test_vote_is_recorded_and_can_be_changed(self):
        self.assertEqual(self.client.post("/api/v1/integrations/votes/", {"provider": "zoom", "vote": "yes"}, format="json").status_code, 200)
        resp = self.client.get("/api/v1/integrations/availability/")
        self.assertEqual((resp.data["providers"]["zoom"]["my_vote"], resp.data["providers"]["zoom"]["yes_votes"]), ("yes", 1))
        self.client.post("/api/v1/integrations/votes/", {"provider": "zoom", "vote": "not_now"}, format="json")
        resp = self.client.get("/api/v1/integrations/availability/")
        self.assertEqual((resp.data["providers"]["zoom"]["my_vote"], resp.data["providers"]["zoom"]["yes_votes"]), ("not_now", 0))

    def test_vote_validation(self):
        self.assertEqual(self.client.post("/api/v1/integrations/votes/", {"provider": "zoom", "vote": "maybe"}, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/v1/integrations/votes/", {"provider": "nope", "vote": "yes"}, format="json").status_code, 400)
        with self.settings(GOOGLE_CLIENT_ID="x", GOOGLE_CLIENT_SECRET="y"):
            self.assertEqual(self.client.post("/api/v1/integrations/votes/", {"provider": "google", "vote": "yes"}, format="json").status_code, 400)

    def test_scraper_hints_never_reveal_the_token(self):
        secret = "atl-super-secret-token-9f3a"
        with self.settings(ATLASSIAN_API_TOKEN=secret, NOTION_INTEGRATION_TOKEN="", GONG_ACCESS_KEY="short"):
            resp = self.client.get("/api/v1/integrations/scraper-status/")
        self.assertTrue(resp.data["confluence"])
        self.assertEqual(resp.data["hints"]["confluence"], "••••••••9f3a")
        self.assertEqual(resp.data["hints"]["notion"], "")
        self.assertEqual(resp.data["hints"]["gong"], "••••••••")  # short: no tail at all
        self.assertNotIn(secret[:-4], str(resp.data))

    def test_unauthenticated_is_rejected(self):
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get("/api/v1/integrations/availability/").status_code, 401)
        self.assertEqual(self.client.post("/api/v1/integrations/votes/", {}, format="json").status_code, 401)


import datetime as _dt  # noqa: E402
from django.utils import timezone as _tz  # noqa: E402


class GoogleCalendarAutoSyncTest(APITestCase):
    """Automatic Google → AgentPM sync: webhook, 5-minute job, and push-channel upkeep."""

    WEBHOOK = "/api/v1/integrations/google/calendar-webhook/"

    def setUp(self):
        from django.core.cache import cache
        from integrations.models import OAuthCredential, SyncState
        cache.clear()
        self.user = User.objects.create_user("autosync", password="{PASSWORD}")
        OAuthCredential.objects.create(user=self.user, provider="google", is_active=True,
                                       access_token="t", refresh_token="r", scopes="calendar")
        SyncState.objects.create(user=self.user, provider="google", resource="calendar_watch",
                                 sync_token="chan-1|res-1|s3cret",
                                 last_synced_at=_tz.now() + _dt.timedelta(days=5))

    def _hook(self, **headers):
        return self.client.post(self.WEBHOOK, **{f"HTTP_{k}": v for k, v in headers.items()})

    @patch("integrations.tasks.sync_google_calendar_for_user.delay")
    def test_webhook_with_valid_channel_and_token_queues_a_sync(self, delay):
        resp = self._hook(X_GOOG_CHANNEL_ID="chan-1", X_GOOG_CHANNEL_TOKEN="s3cret", X_GOOG_RESOURCE_STATE="exists")
        self.assertEqual(resp.status_code, 200)
        delay.assert_called_once_with(self.user.pk, "webhook")

    @patch("integrations.tasks.sync_google_calendar_for_user.delay")
    def test_wrong_token_is_ignored(self, delay):
        resp = self._hook(X_GOOG_CHANNEL_ID="chan-1", X_GOOG_CHANNEL_TOKEN="guess", X_GOOG_RESOURCE_STATE="exists")
        self.assertEqual(resp.status_code, 200)
        delay.assert_not_called()

    @patch("integrations.tasks.sync_google_calendar_for_user.delay")
    def test_handshake_does_not_sync(self, delay):
        self._hook(X_GOOG_CHANNEL_ID="chan-1", X_GOOG_CHANNEL_TOKEN="s3cret", X_GOOG_RESOURCE_STATE="sync")
        delay.assert_not_called()

    @patch("integrations.calendar_sync.sync_user_calendar")
    @patch("integrations.tasks.sync_google_calendar_for_user.delay", side_effect=RuntimeError("no broker"))
    def test_runs_inline_when_celery_is_unavailable(self, _delay, sync_user):
        resp = self._hook(X_GOOG_CHANNEL_ID="chan-1", X_GOOG_CHANNEL_TOKEN="s3cret", X_GOOG_RESOURCE_STATE="exists")
        self.assertEqual(resp.status_code, 200)
        sync_user.assert_called_once()
        self.assertEqual(sync_user.call_args.args[0], self.user)

    @patch("integrations.calendar_sync._announce")
    @patch("integrations.views._sync_google_calendar", return_value={"created": 1, "updated": 0, "deleted": 0, "unlinked": 0})
    def test_scheduled_job_syncs_connected_users_and_announces_changes(self, sync, announce):
        from integrations.tasks import sync_all_google_calendars
        with self.settings(GOOGLE_WEBHOOK_BASE_URL=""):
            sync_all_google_calendars()
        sync.assert_called_once()
        announce.assert_called_once()

    @patch("integrations.calendar_sync._announce")
    @patch("integrations.views._sync_google_calendar", return_value={"created": 0, "updated": 0, "deleted": 0, "unlinked": 0})
    def test_no_changes_means_no_announcement(self, _sync, announce):
        from integrations.tasks import sync_all_google_calendars
        sync_all_google_calendars()
        announce.assert_not_called()

    @patch("integrations.views._sync_google_calendar", side_effect=RuntimeError("boom"))
    def test_one_users_failure_does_not_stop_the_job(self, _sync):
        from integrations.tasks import sync_all_google_calendars
        sync_all_google_calendars()  # must not raise

    def test_no_public_url_means_no_push_channel(self):
        from integrations.calendar_sync import ensure_watch
        with self.settings(GOOGLE_WEBHOOK_BASE_URL="http://localhost:8000"):
            self.assertFalse(ensure_watch(self.user))

    @patch("googleapiclient.discovery.build")
    def test_expiring_channel_is_renewed_and_old_one_stopped(self, build):
        from integrations.calendar_sync import ensure_watch, parse_watch_state
        from integrations.models import SyncState
        SyncState.objects.filter(resource="calendar_watch").update(last_synced_at=_tz.now() + _dt.timedelta(hours=2))
        service = build.return_value
        service.events.return_value.watch.return_value.execute.return_value = {"resourceId": "res-2", "expiration": "0"}
        with self.settings(GOOGLE_WEBHOOK_BASE_URL="https://agentpm.example.com"):
            self.assertTrue(ensure_watch(self.user))
        body = service.events.return_value.watch.call_args.kwargs["body"]
        self.assertEqual(body["address"], "https://agentpm.example.com/api/v1/integrations/google/calendar-webhook/")
        service.channels.return_value.stop.assert_called_once()
        state = parse_watch_state(SyncState.objects.get(resource="calendar_watch").sync_token)
        self.assertEqual(state["resource_id"], "res-2")
        self.assertNotEqual(state["token"], "s3cret")

    @patch("integrations.views._sync_google_calendar", return_value={"created": 0, "updated": 2, "deleted": 0, "unlinked": 0})
    def test_manual_sync_reports_changes_and_auto_sync_skips_the_activity_entry(self, _sync):
        from realtime.models import AgentActivityEvent
        self.client.force_authenticate(user=self.user)
        resp = self.client.post("/api/v1/integrations/google/sync/", {"auto": True}, format="json")
        self.assertEqual((resp.status_code, resp.data["changed"]), (200, 2))
        self.assertFalse(AgentActivityEvent.objects.filter(event_type="sync.google_calendar").exists())
        self.client.post("/api/v1/integrations/google/sync/", {}, format="json")
        self.assertTrue(AgentActivityEvent.objects.filter(event_type="sync.google_calendar").exists())
