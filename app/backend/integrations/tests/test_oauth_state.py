"""OAuth state must be bound to the browser that started the flow (account-linking CSRF)."""
from django.contrib.auth import get_user_model
from django.core import signing
from django.test import override_settings
from rest_framework.test import APIClient, APITestCase

from integrations import oauth_state

User = get_user_model()


@override_settings(OAUTH_STATE_BIND_ENFORCE=True, JIRA_CLIENT_ID="cid", JIRA_CLIENT_SECRET="sec",
                   JIRA_REDIRECT_URI="http://testserver/cb")
class OAuthStateBindingTest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("u1", "u1@twilio.com", "pw")

    def _init(self):
        self.client.force_authenticate(self.user)
        r = self.client.get("/api/v1/integrations/jira/connect/")
        self.assertEqual(r.status_code, 200)
        self.client.force_authenticate(None)
        return r

    def test_init_sets_nonce_cookie_and_state_carries_it(self):
        r = self._init()
        cookie = r.cookies[oauth_state.COOKIE_NAME]
        self.assertTrue(cookie["httponly"])
        state = r.data["authorization_url"].split("state=")[1].split("&")[0]
        from urllib.parse import unquote
        payload = signing.loads(unquote(state), salt="jira-oauth")
        self.assertEqual(payload["n"], cookie.value)

    def test_callback_without_cookie_is_rejected(self):
        state = signing.dumps({"uid": self.user.pk, "n": "abc"}, salt="jira-oauth")
        r = APIClient().get("/api/v1/integrations/jira/callback/", {"code": "x", "state": state})
        self.assertEqual(r.status_code, 400)

    def test_callback_with_someone_elses_cookie_is_rejected(self):
        state = signing.dumps({"uid": self.user.pk, "n": "attacker"}, salt="jira-oauth")
        c = APIClient()
        c.cookies[oauth_state.COOKIE_NAME] = "victim"
        self.assertEqual(c.get("/api/v1/integrations/jira/callback/", {"code": "x", "state": state}).status_code, 400)

    def test_legacy_state_without_nonce_is_rejected(self):
        state = signing.dumps({"uid": self.user.pk}, salt="jira-oauth")
        c = APIClient()
        c.cookies[oauth_state.COOKIE_NAME] = "anything"
        self.assertEqual(c.get("/api/v1/integrations/jira/callback/", {"code": "x", "state": state}).status_code, 400)

    def test_matching_cookie_passes_state_check(self):
        from unittest.mock import patch
        state = signing.dumps({"uid": self.user.pk, "n": "same"}, salt="jira-oauth")
        c = APIClient()
        c.cookies[oauth_state.COOKIE_NAME] = "same"
        with patch("integrations.views.requests.post") as post:
            post.return_value.ok = False
            post.return_value.status_code = 400
            post.return_value.json.return_value = {}
            c.get("/api/v1/integrations/jira/callback/", {"code": "x", "state": state})
        self.assertTrue(post.called)  # got past state validation to the token exchange


class InactiveUserScheduledJobsTest(APITestCase):
    """A deactivated user's credentials must not keep syncing (or spending LLM tokens)."""

    def test_calendar_sweep_skips_inactive_users(self):
        from unittest.mock import patch
        from integrations.models import OAuthCredential
        from integrations import tasks
        active = User.objects.create_user("a", "a@twilio.com", "pw")
        gone = User.objects.create_user("g", "g@twilio.com", "pw", is_active=False)
        for u in (active, gone):
            OAuthCredential.objects.create(user=u, provider="google", access_token="t", is_active=True)
        with patch("integrations.calendar_sync.sync_user_calendar") as sync, \
             patch("integrations.calendar_sync.ensure_watch"):
            tasks.sync_all_google_calendars()
        self.assertEqual([c.args[0] for c in sync.call_args_list], [active])
