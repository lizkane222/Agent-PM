import { renderHook, act, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { server } from "../../test/msw-server";
import { useReplyNotifications } from "../useReplyNotifications";
import { mockReplyNotification } from "../../test/handlers/realtime";

beforeEach(() => {
  // shouldAdvanceTime lets real-time async (MSW, waitFor) still work while
  // giving us vi.advanceTimersByTimeAsync() for interval control.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("useReplyNotifications", () => {
  it("happy path: surfaces a new reply notification on mount poll", async () => {
    server.use(
      http.get("/api/v1/realtime/activity/", () =>
        HttpResponse.json({ results: [mockReplyNotification], count: 1 })
      )
    );

    const { result } = renderHook(() => useReplyNotifications());

    await waitFor(() => expect(result.current.pending).toHaveLength(1));
    expect(result.current.pending[0].title).toContain("Bob");
  });

  it("empty state: pending stays empty when API returns nothing", async () => {
    // Default handler returns empty array
    const { result } = renderHook(() => useReplyNotifications());

    // Advance enough for the initial poll to settle
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(result.current.pending).toHaveLength(0);
  });

  it("deduplication: same notification is not added twice after a second poll", async () => {
    server.use(
      http.get("/api/v1/realtime/activity/", () =>
        HttpResponse.json({ results: [mockReplyNotification], count: 1 })
      )
    );

    const { result } = renderHook(() => useReplyNotifications());
    await waitFor(() => expect(result.current.pending).toHaveLength(1));

    // Trigger the second poll at the 45s mark
    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });

    expect(result.current.pending).toHaveLength(1);
  });

  it("dismiss: removes notification from pending", async () => {
    server.use(
      http.get("/api/v1/realtime/activity/", () =>
        HttpResponse.json({ results: [mockReplyNotification], count: 1 })
      )
    );

    const { result } = renderHook(() => useReplyNotifications());
    await waitFor(() => expect(result.current.pending).toHaveLength(1));

    act(() => {
      result.current.dismiss(mockReplyNotification.id);
    });

    expect(result.current.pending).toHaveLength(0);
  });

  it("network error: silently swallowed, pending stays empty", async () => {
    server.use(
      http.get("/api/v1/realtime/activity/", () => HttpResponse.error())
    );

    const { result } = renderHook(() => useReplyNotifications());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(result.current.pending).toHaveLength(0);
  });

  it("writes notification to localStorage activity log", async () => {
    server.use(
      http.get("/api/v1/realtime/activity/", () =>
        HttpResponse.json({ results: [mockReplyNotification], count: 1 })
      )
    );

    renderHook(() => useReplyNotifications());
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("appActivityLog") ?? "[]");
      return stored.length > 0;
    });

    const stored = JSON.parse(localStorage.getItem("appActivityLog") ?? "[]");
    expect(stored[0].category).toBe("comment_reply");
    expect(stored[0].message).toContain("Bob");
  });
});
