"""
Django settings for the Agent PM project.

All secrets are read from environment variables.
Copy .env.example to .env and fill in real values before running.
"""

import os
import sys
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
    # Before CSPMiddleware on purpose: response phases run in reverse order, so this
    # runs after it and its sandbox header wins for user-uploaded HTML under MEDIA_URL.
    "core.middleware.MediaSecurityHeadersMiddleware",
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
    "google-calendar-sync-every-5-minutes": {
        "task": "integrations.tasks.sync_all_google_calendars",
        "schedule": 300,  # backup for Google push notifications; also renews push channels
    },
    "deliver-due-reminders-every-minute": {
        "task": "scheduler.deliver_due_reminders",
        "schedule": 60,  # every 60 seconds — reminder precision is ~1 minute
    },
}

# ── Gmail Watch Keywords (default sync filters) ────────────────────────────────
GMAIL_DEFAULT_KEYWORDS = [
    "meeting notes",
    "meeting assets",
    "calendar",
    "invite",
    "gong",
    "zoom",
]

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
AGENT_BACKEND = os.getenv("AGENT_BACKEND", "gateway").strip().lower()

# The gateway is authenticated with a short-lived Okta token. Prefer a static
# ANTHROPIC_API_KEY (a LiteLLM virtual key) where one exists — CI and prod should use
# that; locally this helper mints and caches one, re-authenticating via the browser
# when its own cache is stale. See core.llm.gateway_token.
AGENT_GATEWAY_TOKEN_COMMAND = os.getenv(
    "AGENT_GATEWAY_TOKEN_COMMAND", "/usr/local/bin/claude-litellm-token"
)
# Bounded so a web worker can never block on the helper's interactive browser flow.
AGENT_GATEWAY_TOKEN_TIMEOUT = float(os.getenv("AGENT_GATEWAY_TOKEN_TIMEOUT", "20"))

# Refuse to send this app's data to a non-Anthropic model. The gateway publishes
# `et-router` and `claude-router`, which pool Anthropic's models with third-party ones
# — measured 2026-08-31, both dispatched to moonshotai.kimi-k2.5. Enforced in
# core.llm.model_for_tier, the one funnel every LLM call goes through.
AGENT_REQUIRE_ANTHROPIC_MODEL = os.getenv("AGENT_REQUIRE_ANTHROPIC_MODEL", "1") not in ("0", "false", "False")

# Never send a request to an Opus model, on cost grounds. Enforced in
# core.llm.model_for_tier: an Opus id from any source — a tier, or an
# AGENT_MODEL_OVERRIDE — is *substituted* with the best non-Opus model configured for
# the active backend and logged, rather than raising. Degrading is the right failure
# mode for a cost preference; taking the agent down over one is not.
# The escalation path (agents.agent.ESCALATE_TOOL) therefore now runs
# default -> strong as sonnet-4-6 -> sonnet-5, which is still a real step up.
AGENT_BLOCK_OPUS = os.getenv("AGENT_BLOCK_OPUS", "1") not in ("0", "false", "False")

# ── No live LLM calls from the test suite ────────────────────────────────────
# Under `manage.py test`, strip every gateway credential source so any code path
# that reaches an LLM *without* being patched raises ImproperlyConfigured instead of
# quietly making a real, billable network call. This is the same discipline as the
# frontend's MSW `onUnhandledRequest: "error"`: an unmocked dependency should fail
# loudly. It caught integrations.summarize_email genuinely calling the gateway from a
# test once the ANTHROPIC_API_KEY gate was removed.
_RUNNING_TESTS = "test" in sys.argv or os.getenv("DJANGO_RUNNING_TESTS") == "1"
if _RUNNING_TESTS:
    AGENT_GATEWAY_TOKEN_COMMAND = ""
    ANTHROPIC_API_KEY = ""

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
        # Sonnet 5, not Opus: Opus is disabled (AGENT_BLOCK_OPUS) on cost grounds, and
        # core.llm substitutes a non-Opus model anyway if this is pointed back at one.
        "strong": os.getenv("AGENT_MODEL_BEDROCK_STRONG", "us.anthropic.claude-sonnet-5"),
        # Voice (ConversationRelay) gets its own tier: turn-taking latency dominates
        # quality on a phone call, and voice must never escalate mid-call — an Opus
        # round that thinks by default would add many seconds of silence. This also
        # replaces the retired claude-3-5-haiku-20241022 that realtime/llm.py was
        # pinned to (retired 2026-02-19).
        "voice": os.getenv("AGENT_MODEL_BEDROCK_VOICE", "us.anthropic.claude-haiku-4-5"),
    },
    # Verified against GET /v1/models on 2026-08-31: all three resolve to Anthropic
    # and support streaming with tool use, which every agent loop here depends on.
    # Deliberately NOT `et-router` / `claude-router` — see AGENT_REQUIRE_ANTHROPIC_MODEL.
    "gateway": {
        "default": os.getenv("AGENT_MODEL_GATEWAY_DEFAULT", "claude-sonnet-4-6"),
        # Sonnet 5 is the strongest non-Opus model the gateway publishes; verified
        # 2026-08-31 to stream with tool use.
        "strong": os.getenv("AGENT_MODEL_GATEWAY_STRONG", "claude-sonnet-5"),
        # Lowest latency of the three, which is what turn-taking on a phone call needs.
        "voice": os.getenv("AGENT_MODEL_GATEWAY_VOICE", "claude-haiku-4-5"),
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

# ── Voice agent loop ─────────────────────────────────────────────────────────
# The model comes from AGENT_MODEL_TIERS[...]["voice"] above, not from a separate
# id here (the old VOICE_BEDROCK_MODEL_ID pinned a model retired 2026-02-19).
#
# Long spoken answers are the enemy, so max_tokens is far below the chat tiers.
VOICE_MAX_TOKENS = int(os.getenv("VOICE_MAX_TOKENS", "512"))
# Chat allows 10 tool rounds; three covers search → act → confirm, which is the
# realistic ceiling for a spoken request, and bounds worst-case dead air.
VOICE_MAX_TOOL_ROUNDS = int(os.getenv("VOICE_MAX_TOOL_ROUNDS", "3"))
# Checked at the top of each round — never used to cancel a stream mid-flight, which
# would strand a last:false frame with no terminator and wedge TTS for the rest of
# the call. Over budget forces a final wrap-up round instead.
VOICE_TURN_BUDGET_SECONDS = float(os.getenv("VOICE_TURN_BUDGET_SECONDS", "20"))
VOICE_TOOL_TIMEOUT_SECONDS = float(os.getenv("VOICE_TOOL_TIMEOUT_SECONDS", "8"))
# How long a spoken "are you sure?" stays answerable before it is dropped.
VOICE_CONFIRM_TTL_SECONDS = float(os.getenv("VOICE_CONFIRM_TTL_SECONDS", "90"))
# TwiML POST → dial → WS connect → setup frame is normally < 5s. 120s absorbs a cold
# worker or a slow carrier leg while keeping the replay window small.
VOICE_IDENTITY_MAX_AGE = int(os.getenv("VOICE_IDENTITY_MAX_AGE", "120"))
# Skills are injected into the voice system prompt so they fire with zero discovery
# round-trips; these bound the prompt growth.
VOICE_SKILL_INVENTORY_LIMIT = int(os.getenv("VOICE_SKILL_INVENTORY_LIMIT", "25"))
VOICE_SKILL_DESCRIPTION_CHARS = int(os.getenv("VOICE_SKILL_DESCRIPTION_CHARS", "200"))

# ── ConversationRelay quality knobs ──────────────────────────────────────────
# Everything audible defaults to today's behaviour, so no env change = no audible
# change. ElevenLabs / Deepgram are vendor dependencies with per-use cost: enable
# them deliberately in prod after an A/B, not by shipping.
VOICE_TTS_PROVIDER = os.getenv("VOICE_TTS_PROVIDER", "")
VOICE_TTS_VOICE = os.getenv("VOICE_TTS_VOICE", "")
VOICE_STT_PROVIDER = os.getenv("VOICE_STT_PROVIDER", "")
VOICE_STT_MODEL = os.getenv("VOICE_STT_MODEL", "")
# Speech hints — the highest-leverage accuracy knob for this domain, since the
# agent's inputs are mostly proper nouns (account names, people).
VOICE_HINTS_ACCOUNT_LIMIT = int(os.getenv("VOICE_HINTS_ACCOUNT_LIMIT", "60"))
VOICE_HINTS_MAX_CHARS = int(os.getenv("VOICE_HINTS_MAX_CHARS", "1000"))

# ── Google ────────────────────────────────────────────────────────────────────
# Public HTTPS base URL Google Calendar push notifications are delivered to, e.g.
# "https://agentpm.example.com". Blank (the default, and on a laptop) disables push
# channels; the 5-minute scheduled sync and the calendar page's own refresh still run.
GOOGLE_WEBHOOK_BASE_URL = os.getenv("GOOGLE_WEBHOOK_BASE_URL", "")
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
# The org's API host — a My Domain URL, e.g. https://acme.my.salesforce.com, or for a
# sandbox https://acme--dev.sandbox.my.salesforce.com. Must NOT be a *.lightning.force.com
# URL: that is the Lightning UI host, which 302s on /services/oauth2/token, so OAuth and
# every REST call fail in a way that reads like a credentials problem.
#
# This is only the *fallback*. Once a user connects, the `instance_url` from their token
# response is stored on SalesforceConfig and takes precedence — see
# salesforce_sync.client.resolve_instance_url.
SALESFORCE_INSTANCE_URL = os.getenv(
    "SALESFORCE_INSTANCE_URL", "https://login.salesforce.com"
).rstrip("/")
# Host that serves /services/oauth2/authorize. Usually the same as above; a sandbox that
# requires the generic login host sets this to https://test.salesforce.com.
SALESFORCE_LOGIN_URL = os.getenv(
    "SALESFORCE_LOGIN_URL", SALESFORCE_INSTANCE_URL
).rstrip("/")
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
