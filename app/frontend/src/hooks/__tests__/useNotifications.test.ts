import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { useNotifications } from "../useNotifications";

describe("useNotifications", () => {
  it("loads notifications and starts in a loading state", async () => {
    const { result } = renderHook(() => useNotifications());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data[0].title).toBe("⏰ Call Acme");
  });

  it("sends channel and kind filters", async () => {
    let seen = "";
    server.use(http.get("/api/v1/team/notifications/", ({ request }) => {
      seen = new URL(request.url).search;
      return HttpResponse.json({ count: 0, next: null, previous: null, results: [] });
    }));
    const { result } = renderHook(() => useNotifications({ channel: "sms", kind: "reminder" }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(seen).toContain("channel=sms");
    expect(seen).toContain("kind=reminder");
  });

  it("surfaces an error", async () => {
    server.use(http.get("/api/v1/team/notifications/", () => new HttpResponse(null, { status: 500 })));
    const { result } = renderHook(() => useNotifications());
    await waitFor(() => expect(result.current.error).not.toBeNull());
  });

  it("markRead posts ids and refetches", async () => {
    let body: unknown = null;
    let gets = 0;
    server.use(
      http.get("/api/v1/team/notifications/", () => {
        gets += 1;
        return HttpResponse.json({ count: 0, next: null, previous: null, results: [] });
      }),
      http.post("/api/v1/team/notifications/mark-read/", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ updated: 1 });
      }),
    );
    const { result } = renderHook(() => useNotifications());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.markRead([4]); });
    expect(body).toEqual({ ids: [4] });
    await waitFor(() => expect(gets).toBeGreaterThanOrEqual(2));
  });
});
