import { describe, it, expect, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { syncLogsFromBackend, getLogs } from "../appLog";

function activityEvent(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    event_type: "action_item",
    title: "an entry",
    detail: "",
    metadata: {},
    client_id: "c1",
    client_ts: 1000,
    created_at: "2026-08-19T00:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("syncLogsFromBackend", () => {
  it("requests the full 500-event window, not just page one", async () => {
    let seenPageSize: string | null = null;
    server.use(
      http.get("/api/v1/realtime/activity/", ({ request }) => {
        seenPageSize = new URL(request.url).searchParams.get("page_size");
        return HttpResponse.json({ count: 0, next: null, previous: null, results: [] });
      }),
    );
    await syncLogsFromBackend();
    expect(seenPageSize).toBe("500");
  });

  it("restores comment_reply entries (previously dropped)", async () => {
    server.use(
      http.get("/api/v1/realtime/activity/", () =>
        HttpResponse.json({
          count: 2,
          next: null,
          previous: null,
          results: [
            activityEvent({ client_id: "reply-1", event_type: "comment_reply", title: "New reply" }),
            activityEvent({ client_id: "item-1", event_type: "action_item", title: "Status changed" }),
          ],
        }),
      ),
    );
    await syncLogsFromBackend();
    const messages = getLogs().map((e) => e.message);
    expect(messages).toContain("New reply");
    expect(messages).toContain("Status changed");
  });

  it("still drops non-frontend event types", async () => {
    server.use(
      http.get("/api/v1/realtime/activity/", () =>
        HttpResponse.json({
          count: 2,
          next: null,
          previous: null,
          results: [
            activityEvent({ client_id: "tool-1", event_type: "tool_call", title: "internal" }),
            activityEvent({ client_id: "item-2", event_type: "calendar", title: "kept" }),
          ],
        }),
      ),
    );
    await syncLogsFromBackend();
    const messages = getLogs().map((e) => e.message);
    expect(messages).toContain("kept");
    expect(messages).not.toContain("internal");
  });
});
