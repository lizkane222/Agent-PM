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

export const realtimeHandlers = [
  http.get("/api/v1/realtime/activity/", () =>
    HttpResponse.json({ results: [], count: 0 })
  ),
  http.get("/api/v1/realtime/sync-token/", () => HttpResponse.json(mockSyncToken)),
];
