import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw-server";
import { resetRequestCache } from "../../lib/requestCache";
import { mockNotification } from "../../test/handlers/profile";
import { REMINDER_ALERTS_POLL_MS, useReminderAlerts } from "../useReminderAlerts";
import type { AppNotification } from "../../types/team";

const unread = (id: number, over: Partial<AppNotification> = {}) =>
  mockNotification({ id, title: `⏰ Reminder ${id}`, body: "Slides", reminder: 100 + id, fired_for: "2026-11-10T21:30:00Z", can_snooze: true, ...over });

/** A server that remembers what has been acknowledged, as the real one does. */
function serve(initial: AppNotification[]) {
  let list = [...initial];
  const params: URLSearchParams[] = [];
  const read: number[][] = [];
  const snoozes: Array<{ id: string; body: Record<string, unknown> }> = [];
  server.use(
    http.get("/api/v1/team/notifications/", ({ request }) => {
      const p = new URL(request.url).searchParams;
      params.push(p);
      const rows = p.get("unread") ? list.filter((n) => n.read_at === null) : list;
      return HttpResponse.json({ count: rows.length, next: null, previous: null, results: rows });
    }),
    http.post("/api/v1/team/notifications/mark-read/", async ({ request }) => {
      const { ids } = (await request.json()) as { ids: number[] };
      read.push(ids);
      list = list.map((n) => (ids.includes(n.id) ? { ...n, read_at: "2026-11-10T22:00:00Z" } : n));
      return HttpResponse.json({ updated: ids.length });
    }),
    http.post("/api/v1/scheduler/reminders/:id/snooze/", async ({ request, params: p }) => {
      snoozes.push({ id: String(p.id), body: (await request.json()) as Record<string, unknown> });
      list = list.map((n) => (String(n.reminder) === p.id ? { ...n, read_at: "2026-11-10T22:00:00Z" } : n)); // the server acknowledges
      return HttpResponse.json({});
    }),
  );
  return { params, read, snoozes, add: (n: AppNotification) => { list = [...list, n]; } };
}

describe("useReminderAlerts", () => {
  it("asks for the user's unread in-app reminder notifications", async () => {
    const { params } = serve([]);
    renderHook(() => useReminderAlerts());
    await waitFor(() => expect(params.length).toBeGreaterThan(0));
    expect(params[0].get("channel")).toBe("in_app");
    expect(params[0].get("kind")).toBe("reminder");
    expect(params[0].get("unread")).toBe("1");
  });

  it("shows what is already waiting when the page loads — a reload does not lose an alert", async () => {
    serve([unread(7), unread(8)]);
    const { result } = renderHook(() => useReminderAlerts());
    await waitFor(() => expect(result.current.alerts.map((a) => a.id)).toEqual([7, 8]));
  });

  it("keeps an alert on screen across polls until it is answered", async () => {
    const { params } = serve([unread(7)]);
    const { result } = renderHook(() => useReminderAlerts());
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));
    // Come back to the tab twice: each re-reads the server. The alert is still unanswered, so still there.
    for (let i = 2; i <= 3; i++) {
      resetRequestCache(); // the app caches GETs for 10 s; a real poll 20 s later gets past it
      document.dispatchEvent(new Event("visibilitychange"));
      await waitFor(() => expect(params.length).toBeGreaterThanOrEqual(i));
      await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
      expect(result.current.alerts.map((a) => a.id)).toEqual([7]);
    }
  });

  it("acknowledging removes it and tells the server, so it stays gone", async () => {
    const { read } = serve([unread(7), unread(8)]);
    const { result } = renderHook(() => useReminderAlerts());
    await waitFor(() => expect(result.current.alerts).toHaveLength(2));
    await act(async () => { await result.current.acknowledge(7); });
    expect(result.current.alerts.map((a) => a.id)).toEqual([8]);
    expect(read).toEqual([[7]]);
  });

  it("an alert that could not be acknowledged comes back rather than being lost", async () => {
    serve([unread(7)]);
    server.use(http.post("/api/v1/team/notifications/mark-read/", () => HttpResponse.json({}, { status: 500 })));
    const { result } = renderHook(() => useReminderAlerts());
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));
    await act(async () => { await result.current.acknowledge(7); });
    await waitFor(() => expect(result.current.alerts.map((a) => a.id)).toEqual([7]));
  });

  it("snoozing reschedules the reminder that fired, from the moment that fired, and clears the alert", async () => {
    const { snoozes } = serve([unread(7)]);
    const { result } = renderHook(() => useReminderAlerts());
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));
    let message: string | null = "unset";
    await act(async () => { message = await result.current.snooze(result.current.alerts[0], { until: "2026-11-10T23:00:00.000Z" }); });
    expect(message).toBeNull();
    expect(snoozes).toEqual([{ id: "107", body: { until: "2026-11-10T23:00:00.000Z", from: "2026-11-10T21:30:00Z" } }]);
    expect(result.current.alerts).toEqual([]);
  });

  it("a refused snooze reports why and leaves the alert on screen", async () => {
    serve([unread(7)]);
    server.use(http.post("/api/v1/scheduler/reminders/:id/snooze/", () =>
      HttpResponse.json({ until: "Pick a time in the future." }, { status: 400 })));
    const { result } = renderHook(() => useReminderAlerts());
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));
    let message: string | null = null;
    await act(async () => { message = await result.current.snooze(result.current.alerts[0], { until: "2020-01-01T00:00:00Z" }); });
    expect(message).toBe("Pick a time in the future.");
    expect(result.current.alerts).toHaveLength(1);
  });

  it("cannot snooze a reminder that no longer exists", async () => {
    serve([unread(7, { reminder: null, can_snooze: false })]);
    const { result } = renderHook(() => useReminderAlerts());
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));
    let message: string | null = null;
    await act(async () => { message = await result.current.snooze(result.current.alerts[0], { until: "2026-11-10T23:00:00Z" }); });
    expect(message).toMatch(/no longer exists/);
  });

  it("keeps working after a failed poll, and keeps the alerts it already had", async () => {
    serve([unread(7)]);
    const { result } = renderHook(() => useReminderAlerts());
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));
    server.use(http.get("/api/v1/team/notifications/", () => HttpResponse.error()));
    window.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(result.current.alerts).toHaveLength(1);
  });

  it("re-checks within half a minute, so a reminder that fires while the page is open appears", () => {
    expect(REMINDER_ALERTS_POLL_MS).toBeLessThanOrEqual(30_000);
  });
});
