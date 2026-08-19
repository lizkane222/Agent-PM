import { http, HttpResponse } from "msw";
import type { Reminder, CalendarEvent } from "../../types";

export const mockReminders: Reminder[] = [
  {
    id: 1,
    created_by: 1,
    created_by_username: "alice",
    title: "Follow up with client",
    body: "",
    resource_type: "general",
    resource_id: null,
    resource_label: "",
    due_at: "2026-07-30T09:00:00Z",
    notify_in_app: true,
    notify_slack: false,
    notify_push: false,
    notify_sms: false,
    status: "pending",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
  },
  {
    id: 2,
    created_by: 1,
    created_by_username: "alice",
    title: "Send proposal",
    body: "",
    resource_type: "general",
    resource_id: null,
    resource_label: "",
    due_at: "2026-08-01T09:00:00Z",
    notify_in_app: true,
    notify_slack: false,
    notify_push: false,
    notify_sms: false,
    status: "pending",
    created_at: "2026-07-02T00:00:00Z",
    updated_at: "2026-07-02T00:00:00Z",
  },
];

export const mockCalendarEvents: CalendarEvent[] = [
  {
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
    google_event_id: "",
    meet_link: "",
    calendar_id: "",
    is_synced: false,
    agentpm_airtable_id: "",
    attendees: [],
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
  },
  {
    id: 2,
    owner: 1,
    owner_username: "alice",
    title: "Customer Demo",
    description: "",
    location: "",
    start_datetime: "2026-07-29T14:00:00Z",
    end_datetime: "2026-07-29T15:00:00Z",
    all_day: false,
    status: "confirmed",
    account: 5,
    account_name: "Acme Corp",
    google_event_id: "",
    meet_link: "",
    calendar_id: "",
    is_synced: false,
    agentpm_airtable_id: "",
    attendees: [],
    created_at: "2026-07-02T00:00:00Z",
    updated_at: "2026-07-02T00:00:00Z",
  },
];

export const schedulerHandlers = [
  http.get("/api/v1/scheduler/reminders/", () =>
    HttpResponse.json({ results: mockReminders, count: mockReminders.length })
  ),
  http.post("/api/v1/scheduler/reminders/", async ({ request }) => {
    const body = await request.json() as Partial<Reminder>;
    return HttpResponse.json(
      { id: 99, created_by: 1, created_by_username: "alice", status: "pending", ...body },
      { status: 201 }
    );
  }),
  http.patch("/api/v1/scheduler/reminders/:id/", async ({ request }) => {
    const body = await request.json() as Partial<Reminder>;
    return HttpResponse.json({ ...mockReminders[0], ...body });
  }),
  http.delete("/api/v1/scheduler/reminders/:id/", () =>
    new HttpResponse(null, { status: 204 })
  ),
  http.post("/api/v1/scheduler/reminders/:id/dismiss/", () =>
    HttpResponse.json({ ...mockReminders[0], status: "dismissed" })
  ),
  http.post("/api/v1/scheduler/reminders/:id/snooze/", () =>
    HttpResponse.json({ ...mockReminders[0], status: "snoozed" })
  ),
  http.get("/api/v1/scheduler/events/", () =>
    HttpResponse.json(mockCalendarEvents)
  ),
  // The scheduler-side mirror of action items, read by RolePage and ProfilePage.
  // Distinct from /airtable/action-items/ in test/handlers/action_items.ts.
  http.get("/api/v1/scheduler/action-items/", () =>
    HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
  ),
];
