import { http, HttpResponse } from "msw";
import type { Reminder } from "../../types";

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
];
