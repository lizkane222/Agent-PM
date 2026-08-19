import { http, HttpResponse } from "msw";

import type { MeetingNotesEmailReport } from "../../lib/api";

/** Default: a scan that found nothing. Tests override with server.use() for hits. */
export const mockMeetingNotesReport: MeetingNotesEmailReport = {
  days: 30,
  account: "",
  account_name: "",
  scoped_to_account: false,
  scanned_emails: 0,
  scanned_meetings: 0,
  updated: [],
  skipped: [],
  errors: [],
  summaries_truncated: false,
  max_summaries: 25,
  no_summary_in_email: 0,
  recordings_linked: 0,
  scanned_unlinked_events: 0,
  meetings_created: 0,
};

export const mockGmailCredential = {
  id: 1,
  provider: "gmail" as const,
  provider_display: "Gmail",
  scopes: "email",
  is_active: true,
  token_expiry: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

export const integrationsHandlers = [
  http.get("/api/v1/integrations/status/", () =>
    HttpResponse.json({ connected: [mockGmailCredential], sync_states: [] })
  ),
  http.get("/api/v1/integrations/scraper-status/", () =>
    HttpResponse.json({ confluence: false, jira: false, zendesk: false, gong: false, notion: false })
  ),
  http.post("/api/v1/integrations/gmail/watch/", () =>
    HttpResponse.json({ detail: "Gmail watch registration enqueued." })
  ),
  http.post("/api/v1/integrations/gmail/meeting-notes/", () =>
    HttpResponse.json(mockMeetingNotesReport)
  ),
];
