"""
Sign in with Google (Twilio accounts only).

The SPA authenticates with SimpleJWT tokens, not a Django session, so this is a small
purpose-built OpenID Connect flow that ends by issuing the same tokens ``/auth/token/`` does:

1. ``start``    sends the browser to Google with a one-time ``state`` and ``nonce`` (kept in a short-lived
                signed, HttpOnly cookie) and asks for the account chooser every time.
2. ``callback`` checks ``state``, exchanges the code, verifies Google's signed ID token (signature,
                audience, expiry, ``nonce``), then requires a *verified* email in the allowed domain.
                The email must belong to an existing, active user: this never creates accounts
                unless ``GOOGLE_LOGIN_AUTO_CREATE`` is set.

Every failure sends the browser back to ``/login?error=<code>`` with a fixed code. Google's error text,
the token and the exception never reach the browser (they are logged server-side).
The tokens go in the URL *fragment*, which browsers do not send to servers or put in logs.
"""

from __future__ import annotations

import hmac
import logging
import secrets
from urllib.parse import urlencode

import requests
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from django.http import HttpResponseRedirect
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.throttling import AnonRateThrottle
from rest_framework_simplejwt.tokens import RefreshToken

logger = logging.getLogger(__name__)

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
COOKIE = "agentpm_google_login"
COOKIE_MAX_AGE = 600  # ten minutes to finish choosing an account


class GoogleLoginThrottle(AnonRateThrottle):
    scope = "google_login"


def enabled() -> bool:
    return bool(
        getattr(settings, "GOOGLE_LOGIN_ENABLED", False)
        and settings.GOOGLE_CLIENT_ID
        and settings.GOOGLE_CLIENT_SECRET
    )


def _frontend() -> str:
    return getattr(settings, "GOOGLE_LOGIN_FRONTEND_URL", "http://localhost:5173").rstrip("/")


def _fail(code: str):
    response = HttpResponseRedirect(f"{_frontend()}/login?{urlencode({'error': code})}")
    response.delete_cookie(COOKIE)
    return response


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([GoogleLoginThrottle])
def start(request):
    if not enabled():
        return _fail("not_configured")
    state, nonce = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": settings.GOOGLE_LOGIN_REDIRECT_URI,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "nonce": nonce,
        # `hd` only steers Google's chooser; the callback enforces the domain itself.
        "hd": settings.GOOGLE_LOGIN_ALLOWED_DOMAIN,
        # Always show the account chooser, so signing in is always a deliberate Google step.
        "prompt": "select_account",
    }
    response = HttpResponseRedirect(f"{AUTH_URL}?{urlencode(params)}")
    response.set_cookie(
        COOKIE, signing.dumps({"s": state, "n": nonce}, salt=COOKIE),
        max_age=COOKIE_MAX_AGE, httponly=True, samesite="Lax",
        secure=not settings.DEBUG,
    )
    return response


def _verified_claims(code: str, nonce: str):
    """Exchange the code and return the verified ID-token claims, or raise."""
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token

    reply = requests.post(
        TOKEN_URL,
        data={
            "code": code,
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "redirect_uri": settings.GOOGLE_LOGIN_REDIRECT_URI,
            "grant_type": "authorization_code",
        },
        timeout=10,
    )
    reply.raise_for_status()
    claims = id_token.verify_oauth2_token(
        reply.json()["id_token"], google_requests.Request(), settings.GOOGLE_CLIENT_ID
    )
    if not hmac.compare_digest(str(claims.get("nonce", "")), nonce):
        raise ValueError("nonce mismatch")
    return claims


def _user_for(claims):
    User = get_user_model()
    email = (claims.get("email") or "").strip().lower()
    matches = list(User.objects.filter(email__iexact=email, is_active=True)[:2])
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        logger.error("Google login: %d active users share the email %s; refusing", len(matches), email)
        return None
    if getattr(settings, "GOOGLE_LOGIN_AUTO_CREATE", False):
        user = User.objects.create_user(username=email, email=email)
        user.set_unusable_password()
        user.save(update_fields=["password"])
        return user
    return None


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([GoogleLoginThrottle])
def callback(request):
    if not enabled():
        return _fail("not_configured")
    if request.GET.get("error"):
        logger.info("Google login declined at Google: %s", request.GET.get("error"))
        return _fail("cancelled")

    try:
        saved = signing.loads(request.COOKIES.get(COOKIE, ""), salt=COOKIE, max_age=COOKIE_MAX_AGE)
    except signing.BadSignature:
        return _fail("session_expired")
    if not hmac.compare_digest(str(saved.get("s", "")), request.GET.get("state", "")) or not request.GET.get("code"):
        return _fail("session_expired")

    try:
        claims = _verified_claims(request.GET["code"], saved["n"])
    except Exception:  # noqa: BLE001 — never show Google's or the library's text to the browser
        logger.exception("Google login: token exchange or verification failed")
        return _fail("verification_failed")

    domain = settings.GOOGLE_LOGIN_ALLOWED_DOMAIN.lower()
    email = (claims.get("email") or "").strip().lower()
    if not (
        claims.get("email_verified") is True
        and email.endswith("@" + domain)
        and str(claims.get("hd", "")).lower() == domain
    ):
        logger.warning("Google login refused: %s is not a verified @%s account", email or "(none)", domain)
        return _fail("wrong_domain")

    user = _user_for(claims)
    if user is None:
        logger.warning("Google login: no active AgentPM user for %s", email)
        return _fail("no_account")

    refresh = RefreshToken.for_user(user)
    response = HttpResponseRedirect(
        f"{_frontend()}/auth/callback#" + urlencode({"access": str(refresh.access_token), "refresh": str(refresh)})
    )
    response.delete_cookie(COOKIE)
    logger.info("Google login: signed in user %s", user.pk)
    return response
