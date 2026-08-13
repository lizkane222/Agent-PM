"""Root URL configuration for Agent PM."""

import os

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import FileResponse, JsonResponse
from django.urls import include, path, re_path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.throttling import AnonRateThrottle
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView


def vapid_public_key(request):
    """Return the VAPID public key so the frontend can subscribe to push notifications."""
    return JsonResponse({"vapid_public_key": settings.VAPID_PUBLIC_KEY})


def oidc_status(request):
    """Return whether Okta OIDC is enabled so the frontend can show/hide the SSO button."""
    return JsonResponse({"okta_enabled": bool(settings.OIDC_RP_CLIENT_ID)})


def oidc_logout_fallback(request):
    """Flush session and redirect to /login when Okta is not configured."""
    request.session.flush()
    from django.shortcuts import redirect
    return redirect("/login")


class LoginRateThrottle(AnonRateThrottle):
    """Strict per-IP throttle for the JWT login endpoint to prevent brute-force."""
    scope = "login"


class ThrottledTokenObtainPairView(TokenObtainPairView):
    throttle_classes = [LoginRateThrottle]

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        if response.status_code == 200:
            try:
                from django.contrib.auth import get_user_model
                from analytics_tracking import segment as seg
                User = get_user_model()
                username = request.data.get("username", "")
                user = User.objects.filter(username=username).first() or \
                       User.objects.filter(email=username).first()
                if user:
                    profile = getattr(user, "profile", None)
                    seg.identify(user.pk, {
                        "username": user.username,
                        "email": user.email,
                        "display_name": getattr(profile, "display_name", "") or user.get_full_name(),
                        "title": getattr(profile, "title", ""),
                        "role": getattr(profile, "role", ""),
                    })
                    seg.track(user.pk, "Signed In", {"method": "password"})
            except Exception:
                import logging
                logging.getLogger(__name__).debug("Segment identify on login failed", exc_info=True)
        return response


urlpatterns = [
    # Django Admin (superadmins only — team data management, user assignment, health)
    path("admin/", admin.site.urls),

    # Okta OIDC — only mount mozilla_django_oidc routes when Okta is configured.
    # When Okta is absent, mount a lightweight logout fallback so the frontend's
    # window.location.href = "/oidc/logout/" doesn't 404.
    *([path("oidc/", include("mozilla_django_oidc.urls"))] if os.environ.get("OKTA_CLIENT_ID") else []),
    *([path("oidc/logout/", oidc_logout_fallback, name="oidc-logout-fallback")] if not os.environ.get("OKTA_CLIENT_ID") else []),
    path("api/v1/auth/oidc-status/", oidc_status, name="oidc-status"),

    # OpenAPI schema + Swagger UI
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "api/schema/swagger-ui/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui",
    ),

    # Web Push VAPID public key (unauthenticated — needed before login to subscribe)
    path("api/v1/push/vapid-public-key/", vapid_public_key, name="vapid-public-key"),

    # JWT auth — token/obtain has a strict login-scoped throttle (5/min per IP)
    path("api/v1/auth/token/", ThrottledTokenObtainPairView.as_view(), name="token-obtain"),
    path("api/v1/auth/token/refresh/", TokenRefreshView.as_view(), name="token-refresh"),

    # App routers
    path("api/v1/agents/", include("agents.urls")),
    path("api/v1/integrations/", include("integrations.urls")),
    path("api/v1/scheduler/", include("scheduler.urls")),
    path("api/v1/team/", include("team.urls")),
    path("api/v1/realtime/", include("realtime.urls")),
    path("api/v1/accounts/", include("accounts.urls")),
    path("api/v1/skills/", include("skills.urls")),
    path("api/v1/airtable/", include("airtable_sync.urls")),
    path("api/v1/salesforce/", include("salesforce_sync.urls")),
    path("api/v1/search/", include("search.urls")),
    path("api/v1/layouts/", include("layouts.urls")),
    path("api/v1/comments/", include("comments.urls")),
    path("api/v1/discover/", include("discover.urls")),
    path("api/v1/feedback/", include("feedback.urls")),
    path("api/v1/account-feed/", include("account_feed.urls")),
    path("api/v1/sync-review/", include("sync_review.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

# Serve the React SPA for any URL not matched above.
# In production, WhiteNoise handles /static/; this view handles everything else
# (React Router paths like /accounts, /calendar, etc.)
_REACT_INDEX = settings.STATIC_ROOT / "frontend" / "index.html"

def _react_index(request):
    return FileResponse(open(_REACT_INDEX, "rb"), content_type="text/html")

if _REACT_INDEX.exists():
    urlpatterns += [re_path(r"^(?!api/|admin/|oidc/|ws/).*$", _react_index)]
