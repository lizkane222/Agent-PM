"""OAuth ``state`` that is bound to the browser that started the flow.

The callbacks are unauthenticated (they run in a popup with no JWT), so a signed
``{"uid"}`` alone proves only *who started* the flow, not *who is finishing it*. An
attacker could start a flow, then trick a victim into completing it: the victim's
provider account would be attached to the attacker's user (account-linking CSRF).

Each ``state`` therefore also carries a random nonce, and the same nonce is set as an
HttpOnly cookie on the init response (``OAuthStateCookieMiddleware``). The callback
accepts the state only if the cookie sent by the browser matches. A victim's browser
never received the attacker's cookie, so the attack fails closed.
"""

import secrets

from django.conf import settings
from django.core import signing

COOKIE_NAME = "oauth_state_nonce"
MAX_AGE = 600


def dumps(request, salt: str) -> str:
    nonce = secrets.token_urlsafe(24)
    # DRF wraps the Django request; the middleware sees the underlying one.
    getattr(request, "_request", request)._oauth_state_nonce = nonce
    return signing.dumps({"uid": request.user.pk, "n": nonce}, salt=salt)


def loads(request, raw_state: str, salt: str) -> dict:
    """Verify signature, age and (when enforced) the browser binding. Raises on failure."""
    payload = signing.loads(raw_state, salt=salt, max_age=MAX_AGE)
    if getattr(settings, "OAUTH_STATE_BIND_ENFORCE", True):
        nonce = payload.get("n") or ""
        cookie = request.COOKIES.get(COOKIE_NAME, "")
        if not nonce or not cookie or not secrets.compare_digest(str(nonce), cookie):
            raise signing.BadSignature("OAuth state is not bound to this browser")
    return payload


class OAuthStateCookieMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        nonce = getattr(request, "_oauth_state_nonce", None)
        if nonce:
            response.set_cookie(
                COOKIE_NAME, nonce, max_age=MAX_AGE, httponly=True, samesite="Lax",
                secure=not settings.DEBUG, path="/api/v1/integrations/",
            )
        return response
