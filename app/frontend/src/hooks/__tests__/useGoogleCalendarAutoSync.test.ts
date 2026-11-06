import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { AUTO_SYNC_INTERVAL_MS, useGoogleCalendarAutoSync } from "../useGoogleCalendarAutoSync";

describe("useGoogleCalendarAutoSync", () => {
  let bodies: unknown[];
  let changed: number;

  beforeEach(() => {
    bodies = [];
    changed = 1;
    server.use(
      http.post("/api/v1/integrations/google/sync/", async ({ request }) => {
        bodies.push(await request.json().catch(() => null));
        return HttpResponse.json({ detail: "ok", event_count: 3, changed });
      }),
    );
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  function setVisibility(v: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", { value: v, configurable: true });
  }

  it("syncs quietly every 5 minutes and refreshes when Google changed something", async () => {
    setVisibility("visible");
    const onChanged = vi.fn();
    renderHook(() => useGoogleCalendarAutoSync({ enabled: true, busy: () => false, onChanged }));
    // The on-open sync.
    await waitFor(() => expect(bodies).toEqual([{ auto: true }]));
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_INTERVAL_MS);
    await waitFor(() => expect(bodies).toEqual([{ auto: true }, { auto: true }]));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
  });

  it("still re-reads when this call found nothing new (the background job may have applied it first)", async () => {
    setVisibility("visible");
    changed = 0;
    const onChanged = vi.fn();
    renderHook(() => useGoogleCalendarAutoSync({ enabled: true, busy: () => false, onChanged }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_INTERVAL_MS);
    await waitFor(() => expect(bodies).toHaveLength(2));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("does not re-read on open when that sync changed nothing (the page just read the DB)", async () => {
    setVisibility("visible");
    changed = 0;
    const onChanged = vi.fn();
    renderHook(() => useGoogleCalendarAutoSync({ enabled: true, busy: () => false, onChanged }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("syncs when the tab becomes visible again", async () => {
    setVisibility("visible");
    renderHook(() => useGoogleCalendarAutoSync({ enabled: true, busy: () => false, onChanged: vi.fn() }));
    await waitFor(() => expect(bodies).toHaveLength(1)); // on open
    await vi.advanceTimersByTimeAsync(61_000);
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(bodies).toHaveLength(2));
  });

  it("skips while the tab is hidden", async () => {
    setVisibility("hidden");
    const { unmount } = renderHook(() => useGoogleCalendarAutoSync({ enabled: true, busy: () => false, onChanged: vi.fn() }));
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_INTERVAL_MS);
    expect(bodies).toHaveLength(0);
    unmount();
  });

  it("skips while busy (manual sync or drag in flight)", async () => {
    setVisibility("visible");
    const { unmount } = renderHook(() => useGoogleCalendarAutoSync({ enabled: true, busy: () => true, onChanged: vi.fn() }));
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_INTERVAL_MS);
    expect(bodies).toHaveLength(0);
    unmount();
  });

  it("refreshes when another tab announces a sync", () => {
    const onChanged = vi.fn();
    renderHook(() => useGoogleCalendarAutoSync({ enabled: true, busy: () => false, onChanged }));
    window.dispatchEvent(new StorageEvent("storage", { key: "calendarUpdated", newValue: "1" }));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
