# Agent PM — Agentic Project Management Assistant

A hybrid Django + React application that combines an AI-powered scheduling and project management agent with real-time collaboration tools. Built for customer success and account management teams.

## Architecture

```
backend/   Django 5 · DRF · Channels · Celery · Anthropic SDK · Twilio
frontend/  Vite · React 18 · TypeScript · Tailwind CSS v4 · React Router v7
```

## Prerequisites

- Python 3.12+
- Node 20+
- PostgreSQL 16
- Redis 7

## Quick Start

### 1. Clone and configure

```bash
cp .env.example .env
# Fill in real values for every key — see Environment Variables section below
```

### 2. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

In a second terminal (Celery worker + beat):

```bash
cd backend
source .venv/bin/activate
celery -A core worker --loglevel=info &
celery -A core beat --loglevel=info
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server runs on **http://localhost:5173** and proxies `/api` to Django on port 8000.

## Services

| Service | URL |
|---|---|
| React App | http://localhost:5173/ |
| Django API | http://localhost:8000/api/v1/ |
| Django Admin | http://localhost:8000/admin/ |
| OpenAPI Schema | http://localhost:8000/api/schema/ |
| Swagger UI | http://localhost:8000/api/schema/swagger-ui/ |

## Frontend Pages

| Page | Route | Description |
|---|---|---|
| Dashboard | `/` | Live activity feed, upcoming meetings, action item summary |
| Calendar | `/calendar` | Full-calendar view with Google Calendar sync and action item scheduling |
| Action Items | `/action-items` | Kanban/list view of all action items, synced with Airtable |
| Accounts | `/accounts` | Account list with health scores and quick stats |
| Account Detail | `/accounts/:id` | Per-account meetings, action items, contacts, Gmail threads, artifacts |
| Team | `/team` | Team member roster, tags, and profiles |
| Chat | `/chat` | Claude agent chat with tool use, export flow, and layout builder |
| Reminders | `/reminders` | Reminder management with multi-channel notification settings |
| Claude Skills | `/skills` | Browse, submit, and review agent skills |
| Discover | `/discover` | Applet marketplace for team-shared automations |
| Logs | `/logs` | Agent activity log, feedback submissions, voice sessions |
| Settings | `/settings` | OAuth integrations, notification preferences, profile |
| Role | `/role` | Role-based onboarding and skill assignment |

## Backend Apps

| App | Responsibility |
|---|---|
| `accounts` | Accounts, notes, contacts, quick links, artifacts |
| `agents` | Claude agent orchestration, MCP tool server, session/message history |
| `airtable_sync` | Bidirectional Airtable sync (accounts, meetings, action items), write-through for other tables |
| `analytics_tracking` | Segment event tracking |
| `comments` | Threaded comments on any resource type, Airtable sync |
| `discover` | Applet marketplace, Airtable write-through |
| `feedback` | UI feedback submissions with attachments, Airtable sync |
| `integrations` | Google Calendar, Gmail, Slack, Salesforce, GitHub, Notion, Microsoft OAuth + webhooks |
| `layouts` | Page layout builder (nodes/JSON), hearts, forks |
| `realtime` | Twilio Sync tokens, WebSocket consumers, voice webhooks, activity event log |
| `salesforce_sync` | Salesforce accounts, projects, tasks, time entries |
| `scheduler` | Calendar events, action items, tasks, reminders, meeting notes |
| `search` | Full-text search across accounts, meetings, action items |
| `skills` | Claude Skills and Agent Skills CRUD, invocation tracking |
| `team` | User profiles, team members, tags, team memberships |

## Authentication

All API endpoints require a JWT bearer token. Obtain tokens via:

```
POST /api/v1/auth/token/          { "username": "...", "password": "..." }
POST /api/v1/auth/token/refresh/  { "refresh": "..." }
```

Okta/OIDC SSO is supported when `OKTA_CLIENT_ID` is configured — see settings.

## Agent / MCP

The `AgentOrchestrator` in `backend/agents/agent.py` accepts a user message, calls Claude (`claude-sonnet-4-6`) with tool-use enabled, and dispatches tool calls through `MCPServer` in `backend/agents/mcp_server.py`. Tools cover Google Calendar, Gmail, Airtable, and Slack.

## Airtable Sync

Three tables sync bidirectionally every 30 minutes (Celery beat):

| Table env var | Direction | Sync type |
|---|---|---|
| `AIRTABLE_TABLE_ACCOUNTS` | Airtable → Django (pull) + Django → Airtable (write-through) | Bidirectional |
| `AIRTABLE_TABLE_MEETINGS` | Airtable → Django (pull) + gong notes write-through | Bidirectional |
| `AIRTABLE_TABLE_ACTION_ITEMS` | Airtable → Django (pull) + Django → Airtable (write-through) | Bidirectional |
| `AIRTABLE_TABLE_ARTIFACTS` | Django → Airtable only (batch upsert) | Push-only |
| `AIRTABLE_TABLE_CONTACTS` | Django → Airtable only (write-through) | Push-only |
| `AIRTABLE_TABLE_CLAUDE_SKILLS` | Django → Airtable only (batch upsert) | Push-only |
| `AIRTABLE_TABLE_COMMENTS` | Django → Airtable only (batch upsert) | Push-only |
| `AIRTABLE_TABLE_FEEDBACK` | Django → Airtable only (batch upsert) | Push-only |
| `AIRTABLE_TABLE_TEAM_MEMBERS` | Django → Airtable only (management command) | Push-only |
| `AIRTABLE_TABLE_APPLETS` | Django → Airtable only (write-through) | Push-only |

Airtable API calls use exponential backoff (up to 5 retries, max 16s delay) to handle 429 rate limits.

## Real-time

Twilio Sync powers the live agent activity feed on the dashboard. Browser clients subscribe to a Sync list via `/api/v1/realtime/sync-token/`. Django Channels handles WebSocket connections for the chat interface.

## Background Tasks (Celery)

| Task | Schedule |
|---|---|
| Airtable full sync (`sync_all`) | Every 30 minutes |
| Deliver due reminders | Every 60 seconds |

## Environment Variables

### Required

```bash
DJANGO_SECRET_KEY=
FIELD_ENCRYPTION_KEY=          # Fernet key for encrypting OAuth tokens at rest
DATABASE_URL=                  # postgres://user:pass@host:5432/dbname
REDIS_URL=                     # redis://localhost:6379/0

ANTHROPIC_API_KEY=

AIRTABLE_API_KEY=
AIRTABLE_BASE_ID=
AIRTABLE_TABLE_ACCOUNTS=
AIRTABLE_TABLE_ACTION_ITEMS=
AIRTABLE_TABLE_MEETINGS=
AIRTABLE_FIELD_EMAIL_DOMAIN=
```

### Twilio

```bash
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
TWILIO_SYNC_SERVICE_SID=
TWILIO_API_KEY=
TWILIO_API_SECRET=
TWILIO_TWIML_APP_SID=
TWILIO_CONVERSATIONS_SERVICE_SID=
```

### Google / Gmail

```bash
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=           # default: http://localhost:8000/api/v1/integrations/google/callback/
GMAIL_REDIRECT_URI=            # default: http://localhost:8000/api/v1/integrations/gmail/callback/
GMAIL_OKTA_IDP_ID=             # optional: route Gmail OAuth through Okta IdP tile
GOOGLE_DRIVE_REDIRECT_URI=     # default: http://localhost:8000/api/v1/integrations/google-drive/callback/
```

### Slack

```bash
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
SLACK_APP_TOKEN=
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_REDIRECT_URI=            # default: http://localhost:8000/api/v1/integrations/slack/callback/
```

### Salesforce

```bash
SALESFORCE_CLIENT_ID=
SALESFORCE_CLIENT_SECRET=
SALESFORCE_INSTANCE_URL=       # default: https://login.salesforce.com
SALESFORCE_REDIRECT_URI=       # default: http://localhost:8000/api/v1/integrations/salesforce/callback/
```

### Okta SSO (optional)

```bash
OKTA_CLIENT_ID=
OKTA_CLIENT_SECRET=
OKTA_AUTHORIZATION_ENDPOINT=
OKTA_TOKEN_ENDPOINT=
OKTA_USER_ENDPOINT=
OKTA_JWKS_ENDPOINT=
```

### Other Integrations (optional)

```bash
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_REDIRECT_URI=

NOTION_CLIENT_ID=
NOTION_CLIENT_SECRET=
NOTION_REDIRECT_URI=

MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_REDIRECT_URI=
```

### Optional Airtable Tables

```bash
AIRTABLE_TABLE_TEAM=
AIRTABLE_TABLE_TEAM_MEMBERS=
AIRTABLE_TABLE_ARTIFACTS=
AIRTABLE_TABLE_CONTACTS=
AIRTABLE_TABLE_CLAUDE_SKILLS=
AIRTABLE_TABLE_COMMENTS=
AIRTABLE_TABLE_FEEDBACK=
AIRTABLE_TABLE_APPLETS=
AIRTABLE_TABLE_REMINDERS=
AIRTABLE_TABLE_TASKS=
AIRTABLE_TABLE_ACTIVITY_LOG=
AIRTABLE_TABLE_VOICE_SESSIONS=
```

### Notifications (optional)

```bash
NOTIFICATION_ALLOWED_EMAILS=   # comma-separated allowlist; blank = all users
VAPID_PUBLIC_KEY=              # for web push notifications
VAPID_PRIVATE_KEY=
VAPID_ADMIN_EMAIL=
```

### CORS / Deployment

```bash
CORS_ALLOWED_ORIGINS=          # comma-separated list of allowed frontend origins
ALLOWED_HOSTS=                 # comma-separated list of allowed Django host headers
```

Never commit `.env`.
