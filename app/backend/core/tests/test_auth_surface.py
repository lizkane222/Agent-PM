"""Every API route must reject an anonymous caller unless it is deliberately public."""
import re

from django.test import override_settings
from django.urls import URLPattern, URLResolver, get_resolver
from rest_framework.test import APITestCase

# Public on purpose: sign-in flow, provider callbacks/webhooks (verified by signature or signed
# state in their own view), health probes. Anything new that is anonymous must be added here
# deliberately, which is the point of this test.
PUBLIC_PREFIXES = (
    "api/v1/auth/",
    "api/v1/push/vapid-public-key/",
    "api/v1/health/",
    "health/",
    "oidc/",
)
PUBLIC_SUBSTRINGS = ("callback", "webhook", "voice/twiml", "voice/status", "voice/recording", "oauth")


def _walk(patterns, prefix=""):
    for p in patterns:
        route = prefix + str(p.pattern)
        if isinstance(p, URLResolver):
            yield from _walk(p.url_patterns, route)
        elif isinstance(p, URLPattern):
            yield route


def _concrete(route):
    route = route.lstrip("^").replace("$", "")
    route = re.sub(r"\(\?P<\w+>[^)]*\)", "1", route)
    route = re.sub(r"<(?:\w+:)?\w+>", "1", route)
    route = route.replace("\\.", ".").replace("/?", "/").replace("?", "")
    route = route.replace("^", "")
    return "/" + route + ("" if route.endswith("/") else "/")


class AnonymousAccessTest(APITestCase):
    @override_settings(ALLOWED_HOSTS=["testserver"])
    def test_api_routes_require_authentication(self):
        leaks = []
        for route in set(_walk(get_resolver().url_patterns)):
            path = _concrete(route)
            rel = path.lstrip("/")
            if not rel.startswith("api/"):
                continue
            if rel.startswith(PUBLIC_PREFIXES) or any(s in rel for s in PUBLIC_SUBSTRINGS):
                continue
            if "(" in path or "[" in path or "\\" in path:
                continue
            for method in ("get", "post"):
                resp = getattr(self.client, method)(path, {}, format="json")
                if resp.status_code not in (401, 403, 404, 405):
                    leaks.append((method.upper(), path, resp.status_code))
        self.assertEqual(leaks, [])
