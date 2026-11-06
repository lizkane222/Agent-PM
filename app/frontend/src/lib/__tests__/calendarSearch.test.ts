import { describe, it, expect } from "vitest";
import { eventMatchesQuery, rankResults, searchWindow, MAX_RESULTS, SEARCH_WINDOW_DAYS } from "../calendarSearch";
import type { CalendarEvent } from "../../types";

function ev(over: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 1, owner: 1, owner_username: "me", account: null, account_name: null, google_event_id: "",
    title: "", description: "", location: "", start_datetime: "2026-10-14T16:00:00Z",
    end_datetime: "2026-10-14T17:00:00Z", all_day: false, status: "confirmed", attendees: [],
    meet_link: "", calendar_id: "primary", is_synced: true, agentpm_airtable_id: "",
    created_at: "", updated_at: "", ...over,
  } as CalendarEvent;
}

describe("eventMatchesQuery", () => {
  it("matches title, description, location, account and guests case-insensitively", () => {
    const e = ev({ title: "Kickoff", description: "agenda", location: "Room 4", account_name: "Acme",
      attendees: [{ email: "ana@x.com", displayName: "Ana Diaz", responseStatus: "accepted" }] });
    for (const q of ["kick", "AGENDA", "room 4", "acme", "diaz", "ana@x"]) expect(eventMatchesQuery(e, q)).toBe(true);
    expect(eventMatchesQuery(e, "dentist")).toBe(false);
  });

  it("requires every term", () => {
    const e = ev({ title: "Acme kickoff" });
    expect(eventMatchesQuery(e, "acme kickoff")).toBe(true);
    expect(eventMatchesQuery(e, "acme review")).toBe(false);
  });

  it("uses the linked account name supplied by the page", () => {
    expect(eventMatchesQuery(ev({ title: "Sync" }), "beta", "Beta Inc")).toBe(true);
  });

  it("an empty query matches everything", () => {
    expect(eventMatchesQuery(ev({}), "   ")).toBe(true);
  });
});

describe("rankResults", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  it("orders nearest first, drops reminders and duplicates", () => {
    const out = rankResults([
      ev({ id: 1, title: "far", start_datetime: "2027-03-01T00:00:00Z" }),
      ev({ id: 2, title: "near", start_datetime: "2026-10-15T00:00:00Z" }),
      ev({ id: 2, title: "near dup", start_datetime: "2026-10-15T00:00:00Z" }),
      ev({ id: 3, title: "reminder", calendar_id: "reminders", start_datetime: "2026-10-14T13:00:00Z" }),
    ], now);
    expect(out.map((e) => e.title)).toEqual(["near", "far"]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 40 }, (_, i) => ev({ id: i + 1 }));
    expect(rankResults(many, now)).toHaveLength(MAX_RESULTS);
  });
});

describe("searchWindow", () => {
  it("spans the configured days either side of now", () => {
    const now = new Date("2026-10-14T00:00:00Z");
    const { start, end } = searchWindow(now);
    const day = 86_400_000;
    expect((now.getTime() - new Date(start).getTime()) / day).toBe(SEARCH_WINDOW_DAYS);
    expect((new Date(end).getTime() - now.getTime()) / day).toBe(SEARCH_WINDOW_DAYS);
  });
});
