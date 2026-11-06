import { http, HttpResponse } from "msw";
import type { AgentActivityEvent, SyncToken } from "../../types";

export const mockSyncToken: SyncToken = {
  token: "fake-access-token",
  identity: "1",
  sync_service_sid: "IS" + "0".repeat(32),
};

export const mockReplyNotification: AgentActivityEvent = {
  id: 101,
  event_type: "comment_reply",
  title: 'Bob replied to your comment on "Fix billing issue"',
  detail: "bob's reply text",
  metadata: {
    resource_type: "action_item",
    resource_id: 10,
    resource_label: "Fix billing issue",
    reply_id: 55,
    parent_id: 20,
    reply_author_id: 2,
  },
  sync_document_id: "",
  client_id: "reply-55",
  client_ts: null,
  created_at: "2026-08-05T12:00:00Z",
};

/** Shared per-record activity feed. Default is empty so existing card DOM is unchanged. */
export function resourceActivityResponse(
  rows: Array<Partial<AgentActivityEvent> & { actor_display: string; title: string }>,
) {
  return {
    results: rows.map((r, i) => ({
      id: 900 + i,
      event_type: "action_item",
      detail: "",
      metadata: {},
      sync_document_id: "",
      client_id: `srv-client-${i}`,
      client_ts: null,
      created_at: "2026-10-01T12:00:00Z",
      actor_id: 2,
      ...r,
    })),
  };
}

/** One entry from the Events tab feed — a change made to a calendar event. */
export const mockEventUpdate = (overrides: Partial<AgentActivityEvent> = {}): AgentActivityEvent => ({
  id: 301,
  event_type: "calendar_event.created",
  title: 'Event created: "Kickoff"',
  detail: "",
  metadata: {
    action: "created",
    event_title: "Kickoff",
    event_start: "2026-11-10T17:00:00Z",
    resource: { type: "calendar_event", id: 7 },
    links: [{ label: "View calendar", path: "/calendar" }],
  },
  sync_document_id: "",
  client_id: "",
  client_ts: null,
  created_at: "2026-11-04T12:00:00Z",
  ...overrides,
});

export const realtimeHandlers = [
  http.get("/api/v1/realtime/activity/event-updates/", () => HttpResponse.json({ results: [] })),
  http.get("/api/v1/realtime/activity/for-resource/", () => HttpResponse.json({ results: [] })),
  http.get("/api/v1/realtime/activity/", () =>
    HttpResponse.json({ results: [], count: 0 })
  ),
  http.get("/api/v1/realtime/sync-token/", () => HttpResponse.json(mockSyncToken)),
];
