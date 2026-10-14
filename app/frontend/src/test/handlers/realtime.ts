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

export const realtimeHandlers = [
  http.get("/api/v1/realtime/activity/for-resource/", () => HttpResponse.json({ results: [] })),
  http.get("/api/v1/realtime/activity/", () =>
    HttpResponse.json({ results: [], count: 0 })
  ),
  http.get("/api/v1/realtime/sync-token/", () => HttpResponse.json(mockSyncToken)),
];
