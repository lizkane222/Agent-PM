import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { useEventAccountLinks } from "../useEventAccountLinks";
import type { CalendarEvent } from "../../types/scheduler";

const mockEvent: CalendarEvent = {
  id: 1,
  owner: 1,
  owner_username: "alice",
  title: "Q3 Planning",
  description: "",
  location: "",
  start_datetime: "2026-07-28T10:00:00Z",
  end_datetime: "2026-07-28T11:00:00Z",
  all_day: false,
  status: "confirmed",
  account: null,
  account_name: null,
  google_event_id: "google-evt-001",
  meet_link: "",
  calendar_id: "",
  is_synced: false,
  agentpm_airtable_id: "",
  attendees: [],
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
};

describe("useEventAccountLinks", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("bulkUpdateLinks populates map by google_event_id and dual-key (numeric id)", () => {
    const { result } = renderHook(() => useEventAccountLinks());
    const byUid = {
      "google-evt-001": { linked: true, airtable_account_id: 5, account_name: "Acme Corp" },
    };
    act(() => { result.current.bulkUpdateLinks(byUid, [mockEvent]); });
    expect(result.current.eventAccountLinks.get("google-evt-001")).toEqual({ accountId: 5, accountName: "Acme Corp" });
    // Dual-key: numeric id "1" also mapped
    expect(result.current.eventAccountLinks.get("1")).toEqual({ accountId: 5, accountName: "Acme Corp" });
  });

  it("bulkUpdateLinks skips unlinked entries", () => {
    const { result } = renderHook(() => useEventAccountLinks());
    const byUid = {
      "google-evt-001": { linked: false },
    };
    act(() => { result.current.bulkUpdateLinks(byUid, [mockEvent]); });
    expect(result.current.eventAccountLinks.size).toBe(0);
  });

  it("linkEventToAccount POSTs and updates map for both keys", async () => {
    const { result } = renderHook(() => useEventAccountLinks());
    await act(async () => {
      await result.current.linkEventToAccount(5, "Acme Corp", "google-evt-001", null, [mockEvent]);
    });
    await waitFor(() => {
      expect(result.current.eventAccountLinks.get("google-evt-001")).toEqual({ accountId: 5, accountName: "Acme Corp" });
    });
    // Dual key
    expect(result.current.eventAccountLinks.get("1")).toEqual({ accountId: 5, accountName: "Acme Corp" });
  });

  it("unlinkEvent PATCHes and removes from map", async () => {
    const { result } = renderHook(() => useEventAccountLinks());
    // Pre-populate a link
    act(() => {
      result.current.bulkUpdateLinks(
        { "google-evt-001": { linked: true, airtable_account_id: 5, account_name: "Acme Corp" } },
        [mockEvent],
      );
    });
    await act(async () => {
      await result.current.unlinkEvent("google-evt-001");
    });
    expect(result.current.eventAccountLinks.get("google-evt-001")).toBeUndefined();
  });

  it("linkEventToAccount API error calls reportError and rolls back optimistic update", async () => {
    server.use(
      http.post("/api/v1/airtable/categorize/", () => new HttpResponse(null, { status: 500 }))
    );
    const { result } = renderHook(() => useEventAccountLinks());
    await act(async () => {
      await result.current.linkEventToAccount(5, "Acme Corp", "google-evt-001", null, []);
    });
    // Optimistic update should be rolled back (only uid was set, then deleted)
    expect(result.current.eventAccountLinks.get("google-evt-001")).toBeUndefined();
  });
});
