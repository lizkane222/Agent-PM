import { describe, it, expect, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import {
  CALENDAR_CHANGED_KEY, cancelLiveTimer, getLiveTimers, refreshLiveTimers, resetLiveTimers, runningSeconds,
  startLiveTimer, stopLiveTimer, subscribeLiveTimers, type LiveTimer,
} from "../liveTimers";

const session = (over: Partial<LiveTimer> = {}): LiveTimer => ({
  id: 1, action_item: "recA", task: "Task", account_name: null, started_at: "2026-10-14T16:00:00Z",
  ended_at: null, seconds: 0, calendar_event: 5, ...over,
});

describe("liveTimers store", () => {
  beforeEach(() => resetLiveTimers());

  it("loads running timers from the server on first subscribe", async () => {
    server.use(http.get("/api/v1/airtable/timers/", () => HttpResponse.json({ results: [session()] })));
    const unsub = subscribeLiveTimers(() => {});
    await refreshLiveTimers();
    expect(Object.keys(getLiveTimers())).toEqual(["recA"]);
    unsub();
  });

  it("start adds the session and tells the calendar to refetch", async () => {
    const seen: string[] = [];
    const onStorage = (e: StorageEvent) => { if (e.key) seen.push(e.key); };
    window.addEventListener("storage", onStorage);
    await startLiveTimer("recAAA001");
    window.removeEventListener("storage", onStorage);
    expect(getLiveTimers().recAAA001).toBeDefined();
    expect(seen).toContain(CALENDAR_CHANGED_KEY);
  });

  it("stop removes the session, returns the item totals and broadcasts an item change", async () => {
    await startLiveTimer("recAAA001");
    const seen: string[] = [];
    const onStorage = (e: StorageEvent) => { if (e.key) seen.push(e.key); };
    window.addEventListener("storage", onStorage);
    const item = await stopLiveTimer("recAAA001");
    window.removeEventListener("storage", onStorage);
    expect(item.tracked_time).toBe(60);
    expect(getLiveTimers().recAAA001).toBeUndefined();
    expect(seen).toEqual(expect.arrayContaining([CALENDAR_CHANGED_KEY, "actionItemsUpdated"]));
  });

  it("a failed stop (already stopped elsewhere) still clears the local view and rethrows", async () => {
    await startLiveTimer("recAAA001");
    server.use(http.post("/api/v1/airtable/timers/stop/", () => HttpResponse.json({ error: "x" }, { status: 409 })));
    await expect(stopLiveTimer("recAAA001")).rejects.toBeTruthy();
    expect(getLiveTimers().recAAA001).toBeUndefined();
  });

  it("cancel removes the session", async () => {
    await startLiveTimer("recAAA001");
    await cancelLiveTimer("recAAA001");
    expect(getLiveTimers()).toEqual({});
  });

  it("runningSeconds counts from the server start time", () => {
    const t = session({ started_at: new Date(1_000_000).toISOString() });
    expect(runningSeconds(t, 1_000_000 + 125_000)).toBe(125);
    expect(runningSeconds(undefined)).toBe(0);
  });
});
