"""
Sign in with Google: only a verified account in the allowed domain, belonging to an existing
active user, gets tokens; every other outcome sends the browser back to /login with a fixed code.
"""

from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlparse

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from core import google_login

User = get_user_model()

CFG = dict(
    GOOGLE_CLIENT_ID="cid", GOOGLE_CLIENT_SECRET="sec", GOOGLE_LOGIN_ENABLED=True,
    GOOGLE_LOGIN_ALLOWED_DOMAIN="twilio.com", GOOGLE_LOGIN_FRONTEND_URL="http://front",
    GOOGLE_LOGIN_REDIRECT_URI="http://api/cb/", GOOGLE_LOGIN_AUTO_CREATE=False,
)
GOOD = {"email": "liz@twilio.com", "email_verified": True, "hd": "twilio.com", "nonce": "N"}


@override_settings(**CFG)
class _Base(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.client = APIClient()
        self.user = User.objects.create_user("liz", email="Liz@Twilio.com", password="pw")

    def begin(self):
        r = self.client.get("/api/v1/auth/google/start/")
        self.assertEqual(r.status_code, 302)
        q = parse_qs(urlparse(r["Location"]).query)
        return r, q

    def finish(self, claims=GOOD, state=None, code="c0de", extra=None):
        cache.clear()  # these tests make many sign-ins; the throttle has its own test
        _, q = self.begin()
        with patch.object(google_login, "_verified_claims", return_value={**claims, "nonce": "N"}) as v:
            r = self.client.get("/api/v1/auth/google/callback/",
                                {"state": state or q["state"][0], "code": code, **(extra or {})})
        return r, v

    def error_of(self, r):
        self.assertTrue(r["Location"].startswith("http://front/login?error="), r["Location"])
        return parse_qs(urlparse(r["Location"]).query)["error"][0]


class StartTests(_Base):
    def test_sends_the_browser_to_google_with_the_chooser_and_domain_hint(self):
        r, q = self.begin()
        self.assertTrue(r["Location"].startswith("https://accounts.google.com/"))
        self.assertEqual(q["prompt"], ["select_account"])
        self.assertEqual(q["hd"], ["twilio.com"])
        self.assertEqual(q["redirect_uri"], ["http://api/cb/"])
        self.assertEqual(q["response_type"], ["code"])
        self.assertIn("openid", q["scope"][0])
        self.assertTrue(q["state"][0] and q["nonce"][0])

    def test_state_is_kept_in_an_httponly_cookie(self):
        r, q = self.begin()
        cookie = r.cookies[google_login.COOKIE]
        self.assertTrue(cookie["httponly"])
        self.assertNotIn(q["state"][0], "")  # sanity: a non-empty state exists
        self.assertTrue(cookie.value)

    @override_settings(GOOGLE_LOGIN_ENABLED=False)
    def test_disabled_login_never_redirects_to_google(self):
        r = self.client.get("/api/v1/auth/google/start/")
        self.assertEqual(self.error_of(r), "not_configured")

    @override_settings(GOOGLE_CLIENT_SECRET="")
    def test_missing_credentials_never_redirect_to_google(self):
        self.assertEqual(self.error_of(self.client.get("/api/v1/auth/google/start/")), "not_configured")


class CallbackTests(_Base):
    def test_a_verified_company_account_gets_tokens_in_the_fragment(self):
        r, _ = self.finish()
        self.assertEqual(r.status_code, 302)
        loc = urlparse(r["Location"])
        self.assertEqual(f"{loc.scheme}://{loc.netloc}{loc.path}", "http://front/auth/callback")
        frag = parse_qs(loc.fragment)
        self.assertTrue(frag["access"][0] and frag["refresh"][0])
        self.assertEqual(loc.query, "", "tokens must never be in the query string")
        me = APIClient()
        me.credentials(HTTP_AUTHORIZATION="Bearer " + frag["access"][0])
        self.assertEqual(me.get("/api/v1/team/profiles/me/").status_code, 200)

    def test_the_email_match_ignores_case(self):
        r, _ = self.finish({**GOOD, "email": "LIZ@TWILIO.COM"})
        self.assertIn("/auth/callback#", r["Location"])

    def test_a_state_that_does_not_match_is_refused(self):
        r, v = self.finish(state="forged")
        self.assertEqual(self.error_of(r), "session_expired")
        v.assert_not_called()

    def test_a_callback_without_the_cookie_is_refused(self):
        r = self.client.get("/api/v1/auth/google/callback/", {"state": "x", "code": "y"})
        self.assertEqual(self.error_of(r), "session_expired")

    def test_a_missing_code_is_refused(self):
        _, q = self.begin()
        r = self.client.get("/api/v1/auth/google/callback/", {"state": q["state"][0]})
        self.assertEqual(self.error_of(r), "session_expired")

    def test_cancelling_at_google_returns_to_login(self):
        self.begin()
        r = self.client.get("/api/v1/auth/google/callback/", {"error": "access_denied"})
        self.assertEqual(self.error_of(r), "cancelled")

    def test_a_personal_gmail_account_is_refused(self):
        r, _ = self.finish({"email": "liz@gmail.com", "email_verified": True})
        self.assertEqual(self.error_of(r), "wrong_domain")

    def test_an_unverified_email_is_refused(self):
        r, _ = self.finish({**GOOD, "email_verified": False})
        self.assertEqual(self.error_of(r), "wrong_domain")

    def test_a_lookalike_domain_is_refused(self):
        for email in ("liz@twilio.com.evil.io", "liz@eviltwilio.com", "liz@sub.twilio.com"):
            with self.subTest(email=email):
                r, _ = self.finish({**GOOD, "email": email})
                self.assertEqual(self.error_of(r), "wrong_domain")

    def test_a_matching_email_without_the_workspace_claim_is_refused(self):
        r, _ = self.finish({"email": "liz@twilio.com", "email_verified": True})
        self.assertEqual(self.error_of(r), "wrong_domain")

    def test_a_company_account_with_no_agentpm_user_is_refused(self):
        r, _ = self.finish({**GOOD, "email": "new@twilio.com"})
        self.assertEqual(self.error_of(r), "no_account")
        self.assertFalse(User.objects.filter(email="new@twilio.com").exists())

    @override_settings(GOOGLE_LOGIN_AUTO_CREATE=True)
    def test_auto_create_makes_a_user_with_no_usable_password(self):
        r, _ = self.finish({**GOOD, "email": "new@twilio.com"})
        self.assertIn("/auth/callback#", r["Location"])
        self.assertFalse(User.objects.get(email="new@twilio.com").has_usable_password())

    def test_an_inactive_user_cannot_sign_in(self):
        self.user.is_active = False
        self.user.save()
        r, _ = self.finish()
        self.assertEqual(self.error_of(r), "no_account")

    def test_two_users_with_one_email_are_refused_not_guessed(self):
        User.objects.create_user("liz2", email="liz@twilio.com", password="pw")
        r, _ = self.finish()
        self.assertEqual(self.error_of(r), "no_account")

    def test_a_verification_failure_shows_no_detail(self):
        _, q = self.begin()
        with patch.object(google_login, "_verified_claims", side_effect=RuntimeError("secret detail")):
            r = self.client.get("/api/v1/auth/google/callback/", {"state": q["state"][0], "code": "c"})
        self.assertEqual(self.error_of(r), "verification_failed")
        self.assertNotIn("secret", r["Location"])

    def test_the_state_cannot_be_replayed_once_used(self):
        r, q = self.begin()
        with patch.object(google_login, "_verified_claims", return_value=GOOD):
            first = self.client.get("/api/v1/auth/google/callback/", {"state": q["state"][0], "code": "c"})
        self.assertIn("/auth/callback#", first["Location"])
        again = self.client.get("/api/v1/auth/google/callback/", {"state": q["state"][0], "code": "c"})
        self.assertEqual(self.error_of(again), "session_expired")


class TokenVerificationTests(_Base):
    """_verified_claims itself: audience/signature come from google-auth; the nonce is ours."""

    def _run(self, claims):
        reply = MagicMock()
        reply.json.return_value = {"id_token": "jwt"}
        with patch("core.google_login.requests.post", return_value=reply) as post, \
                patch("google.oauth2.id_token.verify_oauth2_token", return_value=claims) as verify:
            return google_login._verified_claims("code", "N"), post, verify

    def test_returns_claims_and_verifies_against_our_client_id(self):
        claims, post, verify = self._run({"nonce": "N", "email": "a@twilio.com"})
        self.assertEqual(claims["email"], "a@twilio.com")
        self.assertEqual(verify.call_args.args[2], "cid")
        self.assertEqual(post.call_args.kwargs["timeout"], 10)

    def test_a_wrong_nonce_is_rejected(self):
        with self.assertRaises(ValueError):
            self._run({"nonce": "other"})


class StatusAndPasswordSwitchTests(_Base):
    def test_status_reports_google_enabled(self):
        self.assertTrue(self.client.get("/api/v1/auth/oidc-status/").json()["google_enabled"])

    @override_settings(GOOGLE_LOGIN_ENABLED=False)
    def test_status_reports_google_disabled(self):
        self.assertFalse(self.client.get("/api/v1/auth/oidc-status/").json()["google_enabled"])

    def test_password_login_still_works_by_default(self):
        r = self.client.post("/api/v1/auth/token/", {"username": "liz", "password": "pw"}, format="json")
        self.assertEqual(r.status_code, 200)

    @override_settings(AUTH_PASSWORD_LOGIN_DISABLED=True)
    def test_password_login_can_be_switched_off_entirely(self):
        r = self.client.post("/api/v1/auth/token/", {"username": "liz", "password": "pw"}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertNotIn("access", r.json())


class ThrottleTests(_Base):
    def test_a_flood_of_start_requests_is_throttled(self):
        codes = [self.client.get("/api/v1/auth/google/start/").status_code for _ in range(25)]
        self.assertIn(429, codes)
        self.assertEqual(codes[:20], [302] * 20)
