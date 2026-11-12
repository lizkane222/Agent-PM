import { http, HttpResponse } from "msw";
import type { AppNotification, LeftNote, MemberPublicProfile, PublicItem, SalesforceTimeEntry } from "../../types";
import type { TimeAllocation, TimeAllocationRow } from "../../types/salesforce";

export const mockNotification = (overrides: Partial<AppNotification> = {}): AppNotification => ({
  id: 1,
  channel: "in_app",
  kind: "reminder",
  title: "⏰ Call Acme",
  body: "",
  link: "/reminders",
  status: "sent",
  read_at: null,
  created_at: "2026-10-19T12:00:00Z",
  reminder: null,
  fired_for: null,
  can_snooze: false,
  ...overrides,
});

export const mockPublicItem = (overrides: Partial<PublicItem> = {}): PublicItem => ({
  id: 1,
  owner: 2,
  item_type: "artifact_link",
  title: "Team handbook",
  url: "https://example.com/handbook",
  file_url: "",
  body: "",
  ref: {},
  position: 0,
  created_at: "2026-10-19T12:00:00Z",
  updated_at: "2026-10-19T12:00:00Z",
  ...overrides,
});

export const mockMemberProfile = (overrides: Partial<MemberPublicProfile> = {}): MemberPublicProfile => ({
  id: 2,
  user: 2,
  full_name: "Bob Jones",
  email: "bob@example.com",
  title: "Solutions Architect",
  department: "Sales",
  tags: [],
  manager: null,
  manager_name: null,
  slack_handle: "bob",
  avatar_url: "",
  joined_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  is_self: false,
  ...overrides,
});

export const mockLeftNote = (overrides: Partial<LeftNote> = {}): LeftNote => ({
  id: 1,
  author: 2,
  author_name: "Bob Jones",
  body: "Call me",
  created_at: "2026-10-19T12:00:00Z",
  ...overrides,
});

export const mockTimeEntry = (overrides: Partial<SalesforceTimeEntry> = {}): SalesforceTimeEntry => ({
  id: 1,
  sf_id: "",
  project: 1,
  project_name: "Acme Phase 1",
  account_name: "Acme Corp",
  task: null,
  task_subject: "",
  date: "2026-10-20",
  duration_minutes: 60,
  description: "",
  synced_to_sf: false,
  sync_error: "",
  created_at: "2026-10-20T12:00:00Z",
  ...overrides,
});

/** A time-allocation response built from its rows, with the totals derived so a fixture cannot contradict itself. */
export const mockAllocation = (
  rows: TimeAllocationRow[] = [],
  extra: Partial<Pick<TimeAllocation, "inferred_minutes" | "unlinked_calendar_minutes">> = {},
): TimeAllocation => ({
  start: "2026-10-01",
  end: "2026-11-05",
  rows,
  logged_minutes: rows.filter(r => r.source === "logged").reduce((a, r) => a + r.minutes, 0),
  calendar_minutes: rows.filter(r => r.source === "calendar").reduce((a, r) => a + r.minutes, 0),
  inferred_minutes: extra.inferred_minutes ?? 0,
  unlinked_calendar_minutes: extra.unlinked_calendar_minutes ?? 0,
});

const page = <T,>(results: T[]) => ({ count: results.length, next: null, previous: null, results });

export const profileHandlers = [
  // Empty by default so the profile page's Time Allocation panel renders its empty state.
  http.get("/api/v1/salesforce/time-allocation/", () => HttpResponse.json(mockAllocation())),
  http.get("/api/v1/team/notifications/", () => HttpResponse.json(page([mockNotification()]))),
  http.post("/api/v1/team/notifications/mark-read/", () => HttpResponse.json({ updated: 1 })),
  http.get("/api/v1/team/public-items/", () => HttpResponse.json([mockPublicItem()])),
  http.post("/api/v1/team/public-items/", () => HttpResponse.json(mockPublicItem({ id: 9 }), { status: 201 })),
  http.patch("/api/v1/team/public-items/:id/", () => HttpResponse.json(mockPublicItem())),
  http.delete("/api/v1/team/public-items/:id/", () => new HttpResponse(null, { status: 204 })),
  http.get("/api/v1/team/members/:id/profile/", () => HttpResponse.json(mockMemberProfile())),
  http.get("/api/v1/team/members/:id/leave-note/", () => HttpResponse.json([mockLeftNote()])),
  http.post("/api/v1/team/members/:id/leave-note/", () => HttpResponse.json(mockLeftNote(), { status: 201 })),
];
