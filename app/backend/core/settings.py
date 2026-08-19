"""
Django settings for the Agent PM project.

All secrets are read from environment variables.
Copy .env.example to .env and fill in real values before running.
"""

import os
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

# ── Base ──────────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR.parent / ".env")

SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]
DEBUG = os.getenv("DJANGO_DEBUG", "False") == "True"

# OAUTHLIB_INSECURE_TRANSPORT must never be set here.
# If needed for local development, set it in a developer-only .env.local that is gitignored.
if DEBUG:
    os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")
ALLOWED_HOSTS = os.getenv("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")

# Trust X-Forwarded-Host / X-Forwarded-Proto from ngrok (and any reverse proxy).
# Without this, build_absolute_uri() returns http://localhost instead of the ngrok https URL,
# which breaks Twilio signature validation.
USE_X_FORWARDED_HOST = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# ── Installed Apps ────────────────────────────────────────────────────────────
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third-party
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "mozilla_django_oidc",
    "corsheaders",
    "channels",
    "drf_spectacular",
    # Local
    "agents",
    "skills",
    "integrations",
    "scheduler",
    "team",
    "realtime",
    "accounts",
    "airtable_sync",
    "salesforce_sync",
    "confluence_sync",
    "jira_sync",
    "zendesk_sync",
    "layouts",
    "comments",
    "discover",
    "feedback",
    "account_feed",
    "sync_review",
]

# ── Middleware ────────────────────────────────────────────────────────────────
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "csp.middleware.CSPMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "analytics_tracking.middleware.SegmentTrackingMiddleware",
]

# Only activate OIDC session-refresh middleware when Okta is configured.
if os.environ.get("OKTA_CLIENT_ID"):
    MIDDLEWARE.insert(6, "mozilla_django_oidc.middleware.SessionRefresh")

ROOT_URLCONF = "core.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# ── ASGI / Channels ───────────────────────────────────────────────────────────
ASGI_APPLICATION = "core.asgi.application"

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [os.getenv("REDIS_URL", "redis://localhost:6379/0")],
        },
    },
}

# ── Database ──────────────────────────────────────────────────────────────────
# Use DATABASE_URL (PostgreSQL) in any environment beyond a single developer
# machine. SQLite does not support concurrent writes from multiple processes
# (Celery workers + ASGI server + Gunicorn workers all write simultaneously).
_database_url = os.getenv("DATABASE_URL")
if _database_url:
    import urllib.parse as _urlparse
    _p = _urlparse.urlparse(_database_url)
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": _p.path.lstrip("/"),
            "USER": _p.username or "",
            "PASSWORD": _p.password or "",
            "HOST": _p.hostname or "localhost",
            "PORT": str(_p.port or 5432),
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

# ── Password Validation ───────────────────────────────────────────────────────
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# ── Internationalisation ──────────────────────────────────────────────────────
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# ── Static Files ──────────────────────────────────────────────────────────────
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
# In production, the React build output is copied into STATIC_ROOT by the Dockerfile.
# WhiteNoise serves everything under STATIC_ROOT with compression + long-lived cache headers.
STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Cap upload size at 25 MB — enforced at the Django request layer before hitting any view.
FILE_UPLOAD_MAX_MEMORY_SIZE = 26_214_400   # 25 MB
DATA_UPLOAD_MAX_MEMORY_SIZE = 26_214_400   # 25 MB

# ── Django REST Framework ─────────────────────────────────────────────────────
_auth_classes = ["rest_framework_simplejwt.authentication.JWTAuthentication"]
if os.environ.get("OKTA_CLIENT_ID"):
    _auth_classes.insert(0, "mozilla_django_oidc.contrib.drf.OIDCAuthentication")

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": _auth_classes,
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "20/min",
        "user": "200/min",
        "login": "5/min",
        "agent_stream": "30/min",
        "sync_token": "10/min",
    },
}

# ── Okta OIDC ─────────────────────────────────────────────────────────────────
OIDC_RP_CLIENT_ID = os.environ.get("OKTA_CLIENT_ID", "")
OIDC_RP_CLIENT_SECRET = os.environ.get("OKTA_CLIENT_SECRET", "")
OIDC_OP_AUTHORIZATION_ENDPOINT = os.environ.get("OKTA_AUTHORIZATION_ENDPOINT", "")
OIDC_OP_TOKEN_ENDPOINT = os.environ.get("OKTA_TOKEN_ENDPOINT", "")
OIDC_OP_USER_ENDPOINT = os.environ.get("OKTA_USER_ENDPOINT", "")
OIDC_OP_JWKS_ENDPOINT = os.environ.get("OKTA_JWKS_ENDPOINT", "")
OIDC_RP_SIGN_ALGO = "RS256"
OIDC_STORE_ACCESS_TOKEN = False
OIDC_STORE_ID_TOKEN = False
LOGIN_REDIRECT_URL = os.getenv("LOGIN_REDIRECT_URL", "http://localhost:5173/")
LOGOUT_REDIRECT_URL = os.getenv("LOGOUT_REDIRECT_URL", "http://localhost:5173/")

AUTHENTICATION_BACKENDS = ["core.auth_backends.EmailOrUsernameBackend"]
if os.environ.get("OKTA_CLIENT_ID"):
    AUTHENTICATION_BACKENDS.insert(0, "mozilla_django_oidc.auth.OIDCAuthenticationBackend")

# ── SimpleJWT ────────────────────────────────────────────────────────────────
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=30),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
}

# ── Field-level Encryption (OAuth tokens) ────────────────────────────────────
FIELD_ENCRYPTION_KEY = os.environ["FIELD_ENCRYPTION_KEY"]

# ── CORS ──────────────────────────────────────────────────────────────────────
CORS_ALLOWED_ORIGINS = os.environ.get(
    "CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",")
CORS_ALLOW_CREDENTIALS = True

# ── Segment Analytics ────────────────────────────────────────────────────────
# Set SEGMENT_BACKEND_WRITE_KEY in .env to enable server-side tracking.
# All calls are fire-and-forget in a background thread so they never block
# request handling.  Leave empty to disable silently.
SEGMENT_BACKEND_WRITE_KEY = os.getenv("SEGMENT_BACKEND_WRITE_KEY", "")

# ── Celery ────────────────────────────────────────────────────────────────────
CELERY_BROKER_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
CELERY_RESULT_BACKEND = os.getenv("REDIS_URL", "redis://localhost:6379/0")
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = TIME_ZONE
CELERY_BEAT_SCHEDULE = {
    "airtable-sync-every-30-minutes": {
        "task": "airtable_sync.tasks.sync_airtable",
        "schedule": 1800,
    },
    "salesforce-sync-every-30-minutes": {
        "task": "salesforce_sync.tasks.sync_salesforce_all_users",
        "schedule": 1800,
    },
    "deliver-due-reminders-every-minute": {
        "task": "scheduler.deliver_due_reminders",
        "schedule": 60,  # every 60 seconds — reminder precision is ~1 minute
    },
}

# ── DRF Spectacular (OpenAPI) ─────────────────────────────────────────────────
SPECTACULAR_SETTINGS = {
    "TITLE": "Agent PM API",
    "DESCRIPTION": "Agentic scheduling assistant — REST API documentation.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "SERVE_PERMISSIONS": ["rest_framework.permissions.IsAuthenticated"],
}

# ── Anthropic ────────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

# Which transport the agent uses to reach Claude.
#   "bedrock" — AWS Bedrock via the twilio-devex-bedrock SSO profile (needs `aws sso login`)
#   "gateway" — the corporate LiteLLM proxy, authenticated with ANTHROPIC_API_KEY as a bearer token
AGENT_BACKEND = os.getenv("AGENT_BACKEND", "bedrock").strip().lower()

# base_url is passed explicitly rather than left to the SDK's ANTHROPIC_BASE_URL fallback:
# Claude Code's managed settings export that variable, so a bare client would silently
# inherit it from whatever shell happened to launch Django.
AGENT_GATEWAY_BASE_URL = os.getenv(
    "AGENT_GATEWAY_BASE_URL", "https://litellm.ai-services.corp.twilio.com"
)

# Model ids are backend-specific: Bedrock wants inference-profile ids, the gateway wants
# whatever LiteLLM publishes on /v1/models. "default" handles the request; the agent may
# escalate itself to "strong" once per request (see agents.agent.ESCALATE_TOOL).
AGENT_MODEL_TIERS: dict[str, dict[str, str]] = {
    "bedrock": {
        "default": os.getenv("AGENT_MODEL_BEDROCK_DEFAULT", "us.anthropic.claude-sonnet-4-6"),
        # Opus 4.8, not Opus 5: the BedrockAccess role lists an Opus 5 inference profile
        # but invoking it 403s ("not authorized to perform the required AWS Marketplace
        # actions"). Switch this to us.anthropic.claude-opus-5 once that subscription
        # exists — the generous strong-tier max_tokens below already accounts for it.
        "strong": os.getenv("AGENT_MODEL_BEDROCK_STRONG", "us.anthropic.claude-opus-4-8"),
    },
    "gateway": {
        # Populate once a LiteLLM virtual key exists and /v1/models has been queried.
        "default": os.getenv("AGENT_MODEL_GATEWAY_DEFAULT", ""),
        "strong": os.getenv("AGENT_MODEL_GATEWAY_STRONG", ""),
    },
}

# Pin a single model id and suppress escalation entirely (debugging / cost control).
AGENT_MODEL_OVERRIDE = os.getenv("AGENT_MODEL_OVERRIDE", "").strip()

# max_tokens bounds thinking *and* visible text together. Opus 5 thinks by default, so the
# strong tier needs materially more headroom than the default tier or replies truncate
# mid-answer. The non-streaming ceiling stays under the SDK's ~10min HTTP timeout guard.
AGENT_MAX_TOKENS_DEFAULT = int(os.getenv("AGENT_MAX_TOKENS_DEFAULT", "4096"))
AGENT_MAX_TOKENS_STRONG = int(os.getenv("AGENT_MAX_TOKENS_STRONG", "16000"))
AGENT_MAX_TOKENS_STREAM_DEFAULT = int(os.getenv("AGENT_MAX_TOKENS_STREAM_DEFAULT", "8192"))
AGENT_MAX_TOKENS_STREAM_STRONG = int(os.getenv("AGENT_MAX_TOKENS_STREAM_STRONG", "32000"))

# ── Notification allowlist ───────────────────────────────────────────────────
# Comma-separated email addresses that may receive reminder notifications.
# While connectors are being validated, set this to your own email only.
# Remove the variable (or set it to "") to open notifications to all users.
_notif_raw = os.getenv("NOTIFICATION_ALLOWED_EMAILS", "")
NOTIFICATION_ALLOWED_EMAILS: set[str] = {
    e.strip().lower() for e in _notif_raw.split(",") if e.strip()
}

# ── Web Push (VAPID) ─────────────────────────────────────────────────────────
# Generate once: python3 -c "from pywebpush import Vapid; v=Vapid(); v.generate_keys(); print(v.public_key, v.private_key)"
# Then base64url-encode each and add to env.
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_ADMIN_EMAIL = os.getenv("VAPID_ADMIN_EMAIL", "admin@example.com")

# ── Twilio ───────────────────────────────────────────────────────────────────
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_PHONE_NUMBER = os.getenv("TWILIO_PHONE_NUMBER", "")
TWILIO_SYNC_SERVICE_SID = os.getenv("TWILIO_SYNC_SERVICE_SID", "")
TWILIO_API_KEY = os.getenv("TWILIO_API_KEY", "")
TWILIO_API_SECRET = os.getenv("TWILIO_API_SECRET", "")
TWILIO_TWIML_APP_SID = os.getenv("TWILIO_TWIML_APP_SID", "")
TWILIO_CONVERSATIONS_SERVICE_SID = os.getenv("TWILIO_CONVERSATIONS_SERVICE_SID", "")
# Pre-shared secret for the /ws/voice-relay/ WebSocket — must match the token
# embedded in the TwiML <ConversationRelay url="wss://host/ws/voice-relay/?relay_token=..."/>.
# Leave empty in local dev to disable the check; MUST be set in production.
VOICE_RELAY_TOKEN = os.getenv("VOICE_RELAY_TOKEN", "")
# Claude model to use for ConversationRelay voice sessions via AWS Bedrock.
VOICE_BEDROCK_MODEL_ID = os.getenv("VOICE_BEDROCK_MODEL_ID", "anthropic.claude-3-5-haiku-20241022:0")

# ── Google ────────────────────────────────────────────────────────────────────
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.getenv(
    "GOOGLE_REDIRECT_URI", "http://localhost:8000/api/v1/integrations/google/callback/"
)
GMAIL_REDIRECT_URI = os.getenv(
    "GMAIL_REDIRECT_URI", "http://localhost:8000/api/v1/integrations/gmail/callback/"
)
# Okta tile integration: when set, the Gmail OAuth flow will present the Okta-managed
# Google IdP instead of the standard Google consent screen.
GMAIL_OKTA_IDP_ID = os.getenv("GMAIL_OKTA_IDP_ID", "")

# ── Airtable ──────────────────────────────────────────────────────────────────
AIRTABLE_API_KEY = os.getenv("AIRTABLE_API_KEY", "")
AIRTABLE_BASE_ID = os.getenv("AIRTABLE_BASE_ID", "")
AIRTABLE_TABLE_ACCOUNTS = os.getenv("AIRTABLE_TABLE_ACCOUNTS", "")
AIRTABLE_TABLE_ACTION_ITEMS = os.getenv("AIRTABLE_TABLE_ACTION_ITEMS", "")
AIRTABLE_TABLE_MEETINGS = os.getenv("AIRTABLE_TABLE_MEETINGS", "")
AIRTABLE_TABLE_TEAM = os.getenv("AIRTABLE_TABLE_TEAM", "")
AIRTABLE_FIELD_EMAIL_DOMAIN = os.getenv("AIRTABLE_FIELD_EMAIL_DOMAIN", "")
AIRTABLE_TABLE_CLAUDE_SKILLS = os.getenv("AIRTABLE_TABLE_CLAUDE_SKILLS", "")
AIRTABLE_TABLE_REMINDERS = os.getenv("AIRTABLE_TABLE_REMINDERS", "")
AIRTABLE_TABLE_ACTIVITY_LOG = os.getenv("AIRTABLE_TABLE_ACTIVITY_LOG", "")
AIRTABLE_TABLE_VOICE_SESSIONS = os.getenv("AIRTABLE_TABLE_VOICE_SESSIONS", "")
AIRTABLE_TABLE_ARTIFACTS = os.getenv("AIRTABLE_TABLE_ARTIFACTS", "")
AIRTABLE_TABLE_TASKS = os.getenv("AIRTABLE_TABLE_TASKS", "")
AIRTABLE_TABLE_TEAM_MEMBERS = os.getenv("AIRTABLE_TABLE_TEAM_MEMBERS", "")
AIRTABLE_TABLE_COMMENTS = os.getenv("AIRTABLE_TABLE_COMMENTS", "")
AIRTABLE_TABLE_FEEDBACK = os.getenv("AIRTABLE_TABLE_FEEDBACK", "")
AIRTABLE_TABLE_APPLETS = os.getenv("AIRTABLE_TABLE_APPLETS", "")

# ── Salesforce ────────────────────────────────────────────────────────────────
SALESFORCE_CLIENT_ID = os.getenv("SALESFORCE_CLIENT_ID", "")
SALESFORCE_CLIENT_SECRET = os.getenv("SALESFORCE_CLIENT_SECRET", "")
SALESFORCE_INSTANCE_URL = os.getenv("SALESFORCE_INSTANCE_URL", "https://login.salesforce.com")
SALESFORCE_REDIRECT_URI = os.getenv(
    "SALESFORCE_REDIRECT_URI", "http://localhost:8000/api/v1/integrations/salesforce/callback/"
)

# ── Slack ─────────────────────────────────────────────────────────────────────
SLACK_BOT_TOKEN = os.getenv("SLACK_BOT_TOKEN", "")
SLACK_SIGNING_SECRET = os.getenv("SLACK_SIGNING_SECRET", "")
SLACK_APP_TOKEN = os.getenv("SLACK_APP_TOKEN", "")
SLACK_CLIENT_ID = os.getenv("SLACK_CLIENT_ID", "")
SLACK_CLIENT_SECRET = os.getenv("SLACK_CLIENT_SECRET", "")
SLACK_REDIRECT_URI = os.getenv(
    "SLACK_REDIRECT_URI", "http://localhost:8000/api/v1/integrations/slack/callback/"
)

# ── GitHub ────────────────────────────────────────────────────────────────────
GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID", "")
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET", "")
GITHUB_REDIRECT_URI = os.getenv("GITHUB_REDIRECT_URI", "http://localhost:8000/api/v1/integrations/github/callback/")

# ── Google Drive / Docs / Sheets ──────────────────────────────────────────────
GOOGLE_DRIVE_REDIRECT_URI = os.getenv("GOOGLE_DRIVE_REDIRECT_URI", "http://localhost:8000/api/v1/integrations/google-drive/callback/")

# ── Notion ────────────────────────────────────────────────────────────────────
NOTION_CLIENT_ID = os.getenv("NOTION_CLIENT_ID", "")
NOTION_CLIENT_SECRET = os.getenv("NOTION_CLIENT_SECRET", "")
NOTION_REDIRECT_URI = os.getenv("NOTION_REDIRECT_URI", "http://localhost:8000/api/v1/integrations/notion/callback/")

# ── Microsoft ─────────────────────────────────────────────────────────────────
MICROSOFT_CLIENT_ID = os.getenv("MICROSOFT_CLIENT_ID", "")
MICROSOFT_CLIENT_SECRET = os.getenv("MICROSOFT_CLIENT_SECRET", "")
MICROSOFT_REDIRECT_URI = os.getenv("MICROSOFT_REDIRECT_URI", "http://localhost:8000/api/v1/integrations/microsoft/callback/")

# ── Confluence (per-user OAuth 2.0) ──────────────────────────────────────────
CONFLUENCE_CLIENT_ID = os.getenv("CONFLUENCE_CLIENT_ID", "")
CONFLUENCE_CLIENT_SECRET = os.getenv("CONFLUENCE_CLIENT_SECRET", "")
CONFLUENCE_REDIRECT_URI = os.getenv(
    "CONFLUENCE_REDIRECT_URI",
    "http://localhost:8000/api/v1/integrations/confluence/callback/",
)

# ── JIRA (per-user OAuth 2.0) ─────────────────────────────────────────────────
JIRA_CLIENT_ID = os.getenv("JIRA_CLIENT_ID", "")
JIRA_CLIENT_SECRET = os.getenv("JIRA_CLIENT_SECRET", "")
JIRA_REDIRECT_URI = os.getenv(
    "JIRA_REDIRECT_URI",
    "http://localhost:8000/api/v1/integrations/jira/callback/",
)

# ── Zendesk (per-user + org-admin OAuth 2.0 confidential client) ─────────────
ZENDESK_CLIENT_ID = os.getenv("ZENDESK_CLIENT_ID", "")
ZENDESK_CLIENT_SECRET = os.getenv("ZENDESK_CLIENT_SECRET", "")
ZENDESK_SUBDOMAIN = os.getenv("ZENDESK_SUBDOMAIN", "twilio")
ZENDESK_REDIRECT_URI = os.getenv(
    "ZENDESK_REDIRECT_URI",
    "http://localhost:8000/api/v1/integrations/zendesk/callback/",
)
ZENDESK_ADMIN_REDIRECT_URI = os.getenv(
    "ZENDESK_ADMIN_REDIRECT_URI",
    "http://localhost:8000/api/v1/integrations/zendesk/admin-callback/",
)

# ── Atlassian / Confluence + JIRA (org scraper) ───────────────────────────────
ATLASSIAN_EMAIL = os.getenv("ATLASSIAN_EMAIL", "")
ATLASSIAN_API_TOKEN = os.getenv("ATLASSIAN_API_TOKEN", "")
ATLASSIAN_BASE_URL = os.getenv("ATLASSIAN_BASE_URL", "https://twilio-productivity.atlassian.net")

# ── Gong (org scraper) ────────────────────────────────────────────────────────
GONG_ACCESS_KEY = os.getenv("GONG_ACCESS_KEY", "")
GONG_ACCESS_SECRET = os.getenv("GONG_ACCESS_SECRET", "")

# ── Notion integration token (org scraper) ───────────────────────────────────
NOTION_INTEGRATION_TOKEN = os.getenv("NOTION_INTEGRATION_TOKEN", "")

# ── Content-Security-Policy (django-csp) ──────────────────────────────────────
CSP_DEFAULT_SRC = ("'self'",)
CSP_SCRIPT_SRC = ("'self'", "https://cdn.segment.com")
CSP_STYLE_SRC = ("'self'", "'unsafe-inline'")
CSP_IMG_SRC = ("'self'", "data:", "https:")
CSP_CONNECT_SRC = ("'self'", "wss:", "https:", "https://api.segment.io", "https://cdn.segment.com")
CSP_FONT_SRC = ("'self'", "https:", "data:")
CSP_FRAME_ANCESTORS = ("'none'",)

# ── Production security settings ──────────────────────────────────────────────
if not DEBUG:
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_SSL_REDIRECT = True
