# Integration Setup Instructions

Step-by-step guide for connecting every integration on the Settings page.
For the canonical credential reference (what each variable means), see [THIRD_PARTY_SETUP.md](THIRD_PARTY_SETUP.md).

---

## Google Calendar

### Step 1 — Create a Google Cloud OAuth client

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and sign in
2. Create a new project or select an existing one
3. **APIs & Services** → **Enable APIs** → search and enable **Google Calendar API**
4. **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Under **Authorized redirect URIs**, add all Google redirect URIs at once:
   - `http://localhost:8000/api/v1/integrations/google/callback/`
   - `http://localhost:8000/api/v1/integrations/gmail/callback/`
   - `http://localhost:8000/api/v1/integrations/google-drive/callback/`
7. Click **Create** → copy **Client ID** and **Client Secret**
8. **APIs & Services** → **OAuth consent screen** → add your email as a test user

### Step 2 — Add credentials to `.env`

```
GOOGLE_CLIENT_ID=<your client id>
GOOGLE_CLIENT_SECRET=<your client secret>
GOOGLE_REDIRECT_URI=http://localhost:8000/api/v1/integrations/google/callback/
```

### Step 3 — (Optional) Okta IdP routing

If your org uses Okta SSO to log into Google Workspace, set:

```
GOOGLE_OKTA_IDP_ID=<okta idp id for the google workspace tile>
```

This routes the connect popup through `your-okta-domain.okta.com/login/login.htm?fromURI=<google_url>&idp=<idp_id>`. The same value covers Google Calendar AND Google Drive, Docs, Sheets & Slides — you only need to set it once. `GMAIL_OKTA_IDP_ID` is a separate variable for Gmail but typically has the same value.

To find the IdP ID: Okta Admin Console → **Applications** → click the Google Workspace app tile → the URL segment after `/app/`.

### Step 4 — Restart and connect

```bash
npm run start-agent-pm
```

Go to Settings → **Google Calendar** → click **Connect**. On first connect the app syncs ±90 days of events from your primary calendar.

### Scopes granted

`calendar`, `calendar.readonly`

---

## Gmail

Uses the **same Google Cloud OAuth client** as Google Calendar — no new app needed.

### Step 1 — Add Gmail redirect URI to existing OAuth client

In Google Cloud Console → your existing OAuth 2.0 client → **Authorized redirect URIs** — confirm `http://localhost:8000/api/v1/integrations/gmail/callback/` is listed (added in the Google Calendar step above).

### Step 2 — Add credentials to `.env`

```
GMAIL_REDIRECT_URI=http://localhost:8000/api/v1/integrations/gmail/callback/
```

`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are already set from the Calendar step.

### Step 3 — (Optional) Okta IdP routing

If your org uses Okta SSO to log into Google/Gmail, set:

```
GMAIL_OKTA_IDP_ID=<okta idp id for the google tile>
```

To find the IdP ID:
1. Okta Admin Console → **Applications** → click the Google Workspace app tile
2. The URL contains something like `/app/<idp_id>/...` — that segment is the value

When set, the connect flow routes through `your-okta-domain.okta.com/login/login.htm?fromURI=<gmail_url>&idp=<idp_id>` so users see the Okta login instead of the bare Google consent screen.

### Step 4 — Restart and connect

Go to Settings → **Gmail** → click **Connect**.

### Scopes granted

`gmail.compose` only — the app opens compose windows but never sends email on your behalf.

---

## Slack

### Step 1 — Create a Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. App name: `Agent PM` → pick your workspace

### Step 2 — Add OAuth scopes

**OAuth & Permissions** → **Bot Token Scopes** — add:
`channels:history`, `channels:read`, `chat:write`, `groups:history`, `groups:read`, `im:history`, `im:read`, `mpim:history`, `mpim:read`, `reactions:read`, `users:read`, `users.profile:read`

### Step 3 — Add redirect URL

**OAuth & Permissions** → **Redirect URLs** → add:
`http://localhost:8000/api/v1/integrations/slack/callback/`

### Step 4 — Install and copy credentials

1. **Install App to workspace** → click **Allow** → copy **Bot User OAuth Token** → `SLACK_BOT_TOKEN`
2. **Basic Information** → copy **Signing Secret** → `SLACK_SIGNING_SECRET`
3. **Basic Information** → **App Credentials** → copy Client ID → `SLACK_CLIENT_ID` and Client Secret → `SLACK_CLIENT_SECRET`

### Step 5 — Add credentials to `.env`

```
SLACK_BOT_TOKEN=xoxb-<your token>
SLACK_SIGNING_SECRET=<your signing secret>
SLACK_CLIENT_ID=<your client id>
SLACK_CLIENT_SECRET=<your client secret>
SLACK_REDIRECT_URI=http://localhost:8000/api/v1/integrations/slack/callback/
```

### Step 6 — (Optional) Okta IdP routing

If your org uses Okta SSO to log into Slack, set:

```
SLACK_OKTA_IDP_ID=<okta idp id for the slack tile>
```

To find the IdP ID: Okta Admin Console → **Applications** → click the Slack app tile → the URL segment after `/app/`.

### Step 7 — Restart and connect

Go to Settings → **Slack** → click **Connect**.

---

## Airtable

Airtable uses a server-side personal access token (not per-user OAuth). All users of this Agent PM instance share the same Airtable credentials.

### Step 1 — Create a personal access token

1. Go to [airtable.com/create/tokens](https://airtable.com/create/tokens) → **Create new token**
2. Token name: `agent-pm`
3. Scopes — add all three:
   - `data.records:read`
   - `data.records:write`
   - `schema.bases:read`
4. **Access** → grant access to your base → **Create token** → copy it immediately (shown once)

### Step 2 — Find your Base ID

Open your Airtable base. The URL is `airtable.com/appXXXXXXXX/...` — copy the `appXXXXXXXX` segment.

### Step 3 — Add credentials to `.env`

```
AIRTABLE_API_KEY=<your personal access token>
AIRTABLE_BASE_ID=<your base id starting with app...>
```

The app also uses table name variables (`AIRTABLE_TABLE_ACCOUNTS`, `AIRTABLE_TABLE_MEETINGS`, etc.) — check `.env.example` for the full list.

### Step 4 — Restart and connect

Go to Settings → **Airtable** → click **Connect**. The backend validates the token and marks Airtable as connected.

---

## Salesforce (Cloud Coach)

### Step 1 — Find your My Domain URL

1. Salesforce Setup → search **My Domain** in Quick Find
2. Copy the **Current My Domain URL** (e.g. `https://twilio.my.salesforce.com`)
3. Add to `.env` as `SALESFORCE_INSTANCE_URL`

### Step 2 — Create a Connected App

1. Salesforce Setup → **App Manager** → **New Connected App**
2. Fill in:
   - **Connected App Name:** `Agent PM`
   - **API Name:** `Agent_PM` (auto-filled)
   - **Contact Email:** your email
3. Under **API (Enable OAuth Settings)**:
   - Check **Enable OAuth Settings**
   - **Callback URL:** `http://localhost:8000/api/v1/integrations/salesforce/callback/`
   - **Selected OAuth Scopes** — add:
     - `Access and manage your data (api)`
     - `Perform requests on your behalf at any time (refresh_token, offline_access)`
     - `Full access (full)` *(required for Cloud Coach custom objects)*
4. Click **Save** — wait up to 10 minutes for the app to activate
5. Click **Manage Consumer Details** (may require MFA) → copy **Consumer Key** → `SALESFORCE_CLIENT_ID` and **Consumer Secret** → `SALESFORCE_CLIENT_SECRET`

### Step 3 — Relax IP Restrictions (local dev)

1. Setup → **App Manager** → find **Agent PM** → click **Manage**
2. Click **Edit Policies** → **IP Relaxation** → select **Relax IP restrictions** → Save

### Step 4 — Add credentials to `.env`

```
SALESFORCE_CLIENT_ID=<consumer key>
SALESFORCE_CLIENT_SECRET=<consumer secret>
SALESFORCE_INSTANCE_URL=https://your-org.my.salesforce.com
SALESFORCE_REDIRECT_URI=http://localhost:8000/api/v1/integrations/salesforce/callback/
```

### Step 5 — (Optional) Okta IdP routing

If your org uses Okta SSO to log into Salesforce, set:

```
SALESFORCE_OKTA_IDP_ID=<okta idp id for the salesforce tile>
```

To find the IdP ID: Okta Admin Console → **Applications** → click the Salesforce app tile → the URL segment after `/app/`.

### Step 6 — Restart and connect

Go to Settings → **Salesforce (Cloud Coach)** → click **Connect**. The app auto-discovers your Cloud Coach package namespace on first connect.

---

## Gong

### Step 1 — Create an OAuth app in Gong

Requires a Gong admin account.

1. Log into Gong → **Settings** → **Ecosystem** → **API** → **OAuth Apps**
2. Click **Create new app**
3. Fill in:
   - **App name:** `Agent PM (local)`
   - **Redirect URI:** `http://localhost:8000/api/v1/integrations/gong/callback/`
4. Under **Scopes**, add:
   - `api:calls:read:basic`
   - `api:calls:read:transcript`
   - `api:users:read`
5. Save → copy **Client ID** and **Client Secret**

### Step 2 — Add credentials to `.env`

```
GONG_CLIENT_ID=<your client id>
GONG_CLIENT_SECRET=<your client secret>
GONG_REDIRECT_URI=http://localhost:8000/api/v1/integrations/gong/callback/
```

### Step 3 — Restart and connect

Go to Settings → **Gong** → click **Connect**.

If your org uses Okta SSO with Gong, click **Sign in with SSO** on Gong's consent screen — Gong routes through Okta automatically on its side. No extra config needed in Agent PM.

### Scopes granted

| Scope | What it allows |
|---|---|
| `api:calls:read:basic` | Call metadata (title, date, duration, participants) |
| `api:calls:read:transcript` | Full call transcripts |
| `api:users:read` | List workspace members |

---

## Zoom

### Step 1 — Create an OAuth app in Zoom Marketplace

1. Go to [marketplace.zoom.us](https://marketplace.zoom.us) → **Develop** → **Build App**
2. Choose **OAuth** → click **Create**
3. Fill in:
   - **App name:** `Agent PM (local)`
   - **App type:** User-managed app
4. Under **OAuth Information**:
   - **Redirect URL for OAuth:** `http://localhost:8000/api/v1/integrations/zoom/callback/`
   - **Allow lists** (add the same URL): `http://localhost:8000/api/v1/integrations/zoom/callback/`
5. Under **Scopes**, add:
   - `meeting:read`
   - `recording:read`
   - `user:read`
6. Activate the app → copy **Client ID** and **Client Secret** from the **App Credentials** tab

### Step 2 — Add credentials to `.env`

```
ZOOM_CLIENT_ID=<your client id>
ZOOM_CLIENT_SECRET=<your client secret>
ZOOM_REDIRECT_URI=http://localhost:8000/api/v1/integrations/zoom/callback/
```

### Step 3 — (Optional) Okta IdP routing

If your org uses Okta SSO to log into Zoom, set:

```
ZOOM_OKTA_IDP_ID=<okta idp id for the zoom tile>
```

To find the IdP ID:
1. Okta Admin Console → **Applications** → click the Zoom app tile
2. The URL contains something like `/app/<idp_id>/...` — that segment is the value
3. Or: Zoom app config → **Sign On** tab → **Identity Provider metadata** link; the IdP ID appears in the URL

When set, Agent PM routes the popup through `your-okta-domain.okta.com/login/login.htm?fromURI=<zoom_url>&idp=<idp_id>`.

### Step 4 — Restart and connect

Go to Settings → **Zoom** → click **Connect**.

---

## Lucidchart

### Step 1 — Create an OAuth app in Lucid Developer Portal

1. Go to [lucid.app/developer](https://lucid.app/developer) and sign in
2. Click **Create new application**
3. Fill in:
   - **Application name:** `Agent PM (local)`
   - **Redirect URI:** `http://localhost:8000/api/v1/integrations/lucidchart/callback/`
4. Under **OAuth Scopes**, add:
   - `lucidchart.document.content:read`
   - `lucidchart.document.app:read`
   - `account:read`
   - `user:read`
5. Save → copy **Client ID** and **Client Secret**

### Step 2 — Add credentials to `.env`

```
LUCIDCHART_CLIENT_ID=<your client id>
LUCIDCHART_CLIENT_SECRET=<your client secret>
LUCIDCHART_REDIRECT_URI=http://localhost:8000/api/v1/integrations/lucidchart/callback/
```

### Step 3 — (Optional) Okta IdP routing

If your org uses Okta SSO to log into Lucidchart, set:

```
LUCIDCHART_OKTA_IDP_ID=<okta idp id for the lucidchart tile>
```

To find the IdP ID:
1. Okta Admin Console → **Applications** → click the Lucidchart app tile
2. The URL contains something like `/app/<idp_id>/...` — that segment is the value

When set, Agent PM routes the popup through `your-okta-domain.okta.com/login/login.htm?fromURI=<lucidchart_url>&idp=<idp_id>`.

### Step 4 — Restart and connect

Go to Settings → **Lucidchart** → click **Connect**.

---

## GitHub

### Step 1 — Create an OAuth app on GitHub

1. github.com → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**
2. Fill in:
   - **Application name:** `Agent PM (local)`
   - **Homepage URL:** `http://localhost:5173`
   - **Authorization callback URL:** `http://localhost:8000/api/v1/integrations/github/callback/`
3. Click **Register application** → copy **Client ID**
4. Click **Generate a new client secret** → copy it immediately

### Step 2 — Add credentials to `.env`

```
GITHUB_CLIENT_ID=<your client id>
GITHUB_CLIENT_SECRET=<your client secret>
GITHUB_REDIRECT_URI=http://localhost:8000/api/v1/integrations/github/callback/
```

### Step 3 — (Optional) Okta IdP routing

If your org uses Okta SSO to log into GitHub, set:

```
GITHUB_OKTA_IDP_ID=<okta idp id for the github tile>
```

To find the IdP ID: Okta Admin Console → **Applications** → click the GitHub app tile → the URL segment after `/app/`.

### Step 4 — Restart and connect

Go to Settings → **GitHub** → click **Connect**.

### Scopes granted

`repo`, `read:user`, `user:email`

---

## Google Drive, Docs, Sheets & Slides

Uses the **same Google Cloud OAuth client** as Google Calendar and Gmail — no new app needed.

### Step 1 — Enable additional APIs

In Google Cloud Console → **APIs & Services** → **Enable APIs** — enable:
- **Google Drive API**
- **Google Docs API**
- **Google Sheets API**
- **Google Slides API**

### Step 2 — Confirm redirect URI

Your existing OAuth 2.0 client should already have `http://localhost:8000/api/v1/integrations/google-drive/callback/` listed (added in the Google Calendar step above). If not, add it now.

### Step 3 — Add redirect URI to `.env`

```
GOOGLE_DRIVE_REDIRECT_URI=http://localhost:8000/api/v1/integrations/google-drive/callback/
```

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_OKTA_IDP_ID` (if set) are shared with Google Calendar — no extra variables needed.

### Step 4 — Restart and connect

Go to Settings → **Google Drive, Docs, Sheets & Slides** → click **Connect**.

If you previously connected with read-only scopes, disconnect first and reconnect to upgrade to full read/write + Slides access.

### Scopes granted

`drive`, `documents`, `spreadsheets`, `presentations` (full read/write — create and update files)

### NotebookLM

Google has not released a public API for NotebookLM. It cannot be integrated programmatically at this time. Check [ai.google.dev](https://ai.google.dev) for updates.

---

## Notion

### Step 1 — Create a public Notion integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations) → **New integration**
2. Fill in:
   - **Name:** `Agent PM`
   - **Type:** Public integration
   - **Redirect URIs:** `http://localhost:8000/api/v1/integrations/notion/callback/`
3. Click **Submit** → copy **OAuth client ID** → `NOTION_CLIENT_ID` and **OAuth client secret** → `NOTION_CLIENT_SECRET`

### Step 2 — Add credentials to `.env`

```
NOTION_CLIENT_ID=<your client id>
NOTION_CLIENT_SECRET=<your client secret>
NOTION_REDIRECT_URI=http://localhost:8000/api/v1/integrations/notion/callback/
```

### Step 3 — (Optional) Okta IdP routing

If your org uses Okta SSO to log into Notion, set:

```
NOTION_OKTA_IDP_ID=<okta idp id for the notion tile>
```

To find the IdP ID: Okta Admin Console → **Applications** → click the Notion app tile → the URL segment after `/app/`.

### Step 4 — Restart and connect

Go to Settings → **Notion** → click **Connect**.

---

## Microsoft Teams

### Step 1 — Register an app in Azure

1. Go to [portal.azure.com](https://portal.azure.com) → **Azure Active Directory** → **App registrations** → **New registration**
2. Fill in:
   - **Name:** `Agent PM (local)`
   - **Supported account types:** Accounts in this organizational directory only
   - **Redirect URI:** Web → `http://localhost:8000/api/v1/integrations/microsoft/callback/`
3. Click **Register** → copy **Application (client) ID** → `MICROSOFT_CLIENT_ID`

### Step 2 — Create a client secret

**Certificates & secrets** → **New client secret** → set an expiry → **Add** → copy the **Value** (not the ID) → `MICROSOFT_CLIENT_SECRET`

⚠️ The secret value is shown once. Copy it before navigating away.

### Step 3 — Add API permissions

**API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions** — add:
`User.Read`, `Team.ReadBasic.All`, `Channel.ReadBasic.All`, `Chat.Read`, `offline_access`

Then click **Grant admin consent for [your org]**.

### Step 4 — Add credentials to `.env`

```
MICROSOFT_CLIENT_ID=<your application client id>
MICROSOFT_CLIENT_SECRET=<your client secret value>
MICROSOFT_REDIRECT_URI=http://localhost:8000/api/v1/integrations/microsoft/callback/
```

### Step 5 — Restart and connect

Go to Settings → **Microsoft Teams** → click **Connect**.

### Scopes granted

`offline_access`, `User.Read`, `Team.ReadBasic.All`, `Channel.ReadBasic.All`, `Chat.Read`
