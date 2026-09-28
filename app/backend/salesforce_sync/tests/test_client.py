"""
Tests for host resolution in `salesforce_sync.client`.

This is the layer that was silently broken: every call used
`settings.SALESFORCE_INSTANCE_URL`, and the deployed value was
`https://twlo.lightning.force.com` — the Lightning *UI* host, which answers
`/services/oauth2/token` with a 302. So OAuth and every REST call failed in a way that
read like a credentials problem. The token response's `instance_url` is authoritative and
is now stored by the OAuth callback and preferred here.
"""

from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from salesforce_sync.client import resolve_instance_url
from salesforce_sync.models import SalesforceConfig

User = get_user_model()

SANDBOX = "https://twlo--jarvisdc.sandbox.my.salesforce.com"
FALLBACK = "https://login.salesforce.com"


@override_settings(SALESFORCE_INSTANCE_URL=FALLBACK)
class ResolveInstanceUrlTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="liz", email="liz@example.com", password="pass"
        )

    def test_prefers_the_stored_instance_url(self):
        SalesforceConfig.objects.create(user=self.user, instance_url=SANDBOX)

        self.assertEqual(resolve_instance_url(self.user), SANDBOX)

    def test_falls_back_to_the_setting_when_no_config_exists(self):
        # Covers a user who connected before the callback started storing the value.
        self.assertEqual(resolve_instance_url(self.user), FALLBACK)

    def test_falls_back_when_the_stored_value_is_blank(self):
        SalesforceConfig.objects.create(user=self.user, instance_url="")

        self.assertEqual(resolve_instance_url(self.user), FALLBACK)

    def test_strips_a_trailing_slash(self):
        # `.env` carried a trailing slash, which would have produced a double slash in
        # every REST path.
        SalesforceConfig.objects.create(user=self.user, instance_url=SANDBOX + "/")

        self.assertEqual(resolve_instance_url(self.user), SANDBOX)

    def test_tolerates_an_anonymous_or_userless_caller(self):
        self.assertEqual(resolve_instance_url(None), FALLBACK)


@override_settings(
    SALESFORCE_INSTANCE_URL=FALLBACK,
    SALESFORCE_CLIENT_ID="cid",
    SALESFORCE_CLIENT_SECRET="secret",
)
class RefreshTokenHostTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="liz", email="liz@example.com", password="pass"
        )
        SalesforceConfig.objects.create(user=self.user, instance_url=SANDBOX)
        from integrations.models import OAuthCredential
        self.cred = OAuthCredential.objects.create(
            user=self.user, provider="salesforce",
            access_token="old", refresh_token="rt", is_active=True,
        )

    def test_refresh_posts_to_the_resolved_host_not_the_setting(self):
        from salesforce_sync.client import _refresh_token

        response = mock.Mock(ok=True)
        response.json.return_value = {"access_token": "new"}
        response.raise_for_status.return_value = None

        with mock.patch("salesforce_sync.client.requests.post", return_value=response) as post:
            _refresh_token(self.cred)

        url = post.call_args[0][0]
        self.assertEqual(url, f"{SANDBOX}/services/oauth2/token")
        self.assertNotIn("login.salesforce.com", url)
        self.cred.refresh_from_db()
        self.assertEqual(self.cred.access_token, "new")


class GetClientHostTest(TestCase):
    """`get_client` must build simple_salesforce against the resolved host."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="liz", email="liz@example.com", password="pass"
        )
        SalesforceConfig.objects.create(user=self.user, instance_url=SANDBOX)
        from integrations.models import OAuthCredential
        OAuthCredential.objects.create(
            user=self.user, provider="salesforce",
            access_token="tok", refresh_token="rt", is_active=True,
        )

    @override_settings(SALESFORCE_INSTANCE_URL=FALLBACK)
    def test_uses_the_stored_host(self):
        from salesforce_sync import client

        with mock.patch("simple_salesforce.Salesforce") as Salesforce:
            client.get_client(self.user)

        self.assertEqual(Salesforce.call_args.kwargs["instance_url"], SANDBOX)

    def test_a_missing_credential_raises_permission_error(self):
        from integrations.models import OAuthCredential
        from salesforce_sync import client

        OAuthCredential.objects.filter(user=self.user).delete()
        with self.assertRaises(PermissionError):
            client.get_client(self.user)
