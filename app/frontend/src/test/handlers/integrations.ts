import { http, HttpResponse } from "msw";

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
];
