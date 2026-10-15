import { describe, it, expect } from "vitest";
import {
  eventSeconds, isLoggableMeeting, itemBelongsToAccount, localDate, projectForActionItem, trackedSecondsByDay,
} from "../logTimeRows";
import type { AccountProject, CalendarEvent } from "../../types";

function ev(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 1, owner: 1, owner_username: "me", account: null, account_name: "Acme", google_event_id: "",
    title: "Sync", description: "", location: "", start_datetime: "2026-10-12T16:00:00Z",
    end_datetime: "2026-10-12T17:00:00Z", all_day: false, status: "confirmed", attendees: [],
    meet_link: "", calendar_id: "primary", is_synced: true, agentpm_airtable_id: "",
    created_at: "", updated_at: "", ...over,
  } as CalendarEvent;
}

function proj(over: Partial<AccountProject>): AccountProject {
  return {
    id: 1, account: 1, name: "P", description: "", url: "", position: 0, action_ids: [], meeting_ids: [],
    goal_ids: [], resources: [], sf_data: {}, sf_project_id: "", kind: "project", created_at: "", ...over,
  } as AccountProject;
}

describe("localDate", () => {
  it("uses the local calendar day, not the UTC one", () => {
    const d = new Date(2026, 9, 12, 22, 30); // 22:30 local on Oct 12
    expect(localDate(d.toISOString())).toBe("2026-10-12");
  });
});

describe("eventSeconds", () => {
  it("is 0 for all-day and inverted events", () => {
    expect(eventSeconds(ev({ all_day: true }))).toBe(0);
    expect(eventSeconds(ev({ end_datetime: "2026-10-12T15:00:00Z" }))).toBe(0);
    expect(eventSeconds(ev())).toBe(3600);
  });
});

describe("isLoggableMeeting", () => {
  it("accepts an attended meeting on the account, case-insensitively", () => {
    expect(isLoggableMeeting(ev({ account_name: "ACME" }), "Acme", undefined)).toBe(true);
  });
  it("prefers the in-session link over the stored account", () => {
    expect(isLoggableMeeting(ev({ account_name: "Acme" }), "Acme", "Beta")).toBe(false);
    expect(isLoggableMeeting(ev({ account_name: null }), "Beta", "Beta")).toBe(true);
  });
  it("rejects zero-length, all-day, cancelled, not-attended, no-account and non-meeting rows", () => {
    expect(isLoggableMeeting(ev({ end_datetime: "2026-10-12T16:00:00Z" }), "Acme", undefined)).toBe(false);
    expect(isLoggableMeeting(ev({ all_day: true }), "Acme", undefined)).toBe(false);
    expect(isLoggableMeeting(ev({ status: "cancelled" }), "Acme", undefined)).toBe(false);
    expect(isLoggableMeeting(ev({ attended: false }), "Acme", undefined)).toBe(false);
    expect(isLoggableMeeting(ev({ account_name: null }), "Acme", undefined)).toBe(false);
    expect(isLoggableMeeting(ev({ calendar_id: "work_tracking" }), "Acme", undefined)).toBe(false);
    expect(isLoggableMeeting(ev({ calendar_id: "reminders" }), "Acme", undefined)).toBe(false);
  });
  it("keeps attended=null (never recorded) meetings", () => {
    expect(isLoggableMeeting(ev({ attended: null }), "Acme", undefined)).toBe(true);
  });
});

describe("itemBelongsToAccount", () => {
  it("matches the item's own account only", () => {
    expect(itemBelongsToAccount({ account_name: "acme" }, "Acme")).toBe(true);
    expect(itemBelongsToAccount({ account_name: "Beta" }, "Acme")).toBe(false);
  });
  it("Admin takes account-less items but not other accounts' items", () => {
    expect(itemBelongsToAccount({ account_name: null }, "Admin")).toBe(true);
    expect(itemBelongsToAccount({ account_name: "Acme" }, "Admin")).toBe(false);
    expect(itemBelongsToAccount({ account_name: null }, "Acme")).toBe(false);
  });
});

describe("trackedSecondsByDay", () => {
  it("sums several blocks for one item on one day", () => {
    const m = trackedSecondsByDay([
      ev({ id: 1, calendar_id: "work_tracking", agentpm_airtable_id: "recA", start_datetime: "2026-10-12T16:00:00Z", end_datetime: "2026-10-12T16:15:00Z" }),
      ev({ id: 2, calendar_id: "work_tracking", agentpm_airtable_id: "recA", start_datetime: "2026-10-12T18:00:00Z", end_datetime: "2026-10-12T18:30:00Z" }),
      ev({ id: 3, calendar_id: "primary", agentpm_airtable_id: "recA" }),
    ]);
    expect([...m.values()]).toEqual([2700]);
  });
});

describe("projectForActionItem", () => {
  it("finds the project that lists the item", () => {
    const p = proj({ id: 5, action_ids: ["recA"] });
    expect(projectForActionItem("recA", [p])?.id).toBe(5);
    expect(projectForActionItem("recZ", [p])).toBeNull();
  });
  it("resolves an item under a goal to the goal's parent project", () => {
    const goal = proj({ id: 9, kind: "goal", action_ids: ["recG"] });
    const parent = proj({ id: 5, goal_ids: ["9"] });
    expect(projectForActionItem("recG", [goal, parent])?.id).toBe(5);
  });
  it("an orphan goal resolves to nothing rather than to the goal itself", () => {
    expect(projectForActionItem("recG", [proj({ id: 9, kind: "goal", action_ids: ["recG"] })])).toBeNull();
  });
});
