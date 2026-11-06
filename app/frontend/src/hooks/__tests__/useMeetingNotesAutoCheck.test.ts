import { renderHook, act, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { server } from "../../test/msw-server";
import { mockMeetingNotesReport } from "../../test/handlers/integrations";
import { useMeetingNotesAutoCheck, NOTES_CHECK_INTERVAL_MS } from "../useMeetingNotesAutoCheck";
import { MEETING_NOTES_UPDATED_EVENT } from "../../lib/meetingNotes";

const event = {
  id: 7,
  event_type: "meeting_notes",
  title: "Gong notes added to Siemens Call",
  metadata: { meeting_id: 3, account_name: "Siemens", source: "gong" },
  created_at: new Date().toISOString(),
};

let scans: Array<Record<string, unknown>>;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  scans = [];
  server.use(
    http.post("/api/v1/integrations/gmail/meeting-notes/", async ({ request }) => {
      scans.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(mockMeetingNotesReport);
    })
  );
});
afterEach(() => vi.useRealTimers());

describe("useMeetingNotesAutoCheck", () => {
  it("does not scan on mount, then scans every 10 minutes as an auto run", async () => {
    renderHook(() => useMeetingNotesAutoCheck());
    expect(scans).toHaveLength(0);

    await act(async () => { await vi.advanceTimersByTimeAsync(NOTES_CHECK_INTERVAL_MS); });
    await waitFor(() => expect(scans).toHaveLength(1));
    expect(scans[0]).toEqual({ auto: true });
  });

  it("surfaces a notification and announces it to open pages", async () => {
    server.use(http.get("/api/v1/realtime/activity/", () => HttpResponse.json({ results: [event], count: 1 })));
    const heard = vi.fn();
    window.addEventListener(MEETING_NOTES_UPDATED_EVENT, heard);

    const { result } = renderHook(() => useMeetingNotesAutoCheck());
    await act(async () => { await vi.advanceTimersByTimeAsync(NOTES_CHECK_INTERVAL_MS); });

    await waitFor(() => expect(result.current.pending).toHaveLength(1));
    expect(result.current.pending[0].title).toBe("Gong notes added to Siemens Call");
    expect(heard).toHaveBeenCalled();
    window.removeEventListener(MEETING_NOTES_UPDATED_EVENT, heard);
  });

  it("never shows the same event twice and can dismiss it", async () => {
    server.use(http.get("/api/v1/realtime/activity/", () => HttpResponse.json({ results: [event], count: 1 })));
    const { result } = renderHook(() => useMeetingNotesAutoCheck());
    await act(async () => { await vi.advanceTimersByTimeAsync(NOTES_CHECK_INTERVAL_MS * 2); });
    await waitFor(() => expect(result.current.pending).toHaveLength(1));

    act(() => result.current.dismiss(7));
    expect(result.current.pending).toHaveLength(0);
  });

  it("stays silent when Gmail is not connected", async () => {
    server.use(
      http.post("/api/v1/integrations/gmail/meeting-notes/", () =>
        HttpResponse.json({ detail: "Gmail not connected." }, { status: 400 })
      )
    );
    const { result } = renderHook(() => useMeetingNotesAutoCheck());
    await act(async () => { await vi.advanceTimersByTimeAsync(NOTES_CHECK_INTERVAL_MS); });
    expect(result.current.pending).toHaveLength(0);
  });

  it("does nothing when disabled", async () => {
    renderHook(() => useMeetingNotesAutoCheck(false));
    await act(async () => { await vi.advanceTimersByTimeAsync(NOTES_CHECK_INTERVAL_MS * 2); });
    expect(scans).toHaveLength(0);
  });
});
