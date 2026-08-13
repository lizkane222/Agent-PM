import { http, HttpResponse } from "msw";
import type { AirtableActionItem } from "../../types";

export const mockActionItem: AirtableActionItem = {
  id: 1,
  airtable_id: "recAAA001",
  account: 1,
  account_name: "Acme Corp",
  task: "Fix billing",
  task_details: "",
  status: "Open",
  priority: "High",
  due_date: null,
  estimated_time: 0,
  time_spent: 0,
  prep_time: 0,
  slack_thread_url: "",
  salesforce_task_id: "",
  assignee_airtable_id: "",
  assignee_name: "Alice",
  reminder: null,
  reminder_id: null,
  reminder_due_at: null,
  reminder_status: null,
  linked_meeting: null,
  linked_meeting_name: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  marked_done_at: null,
  last_synced: "",
};

export const actionItemHandlers = [
  http.get("/api/v1/airtable/action-items/", () =>
    HttpResponse.json([mockActionItem])
  ),
  http.post("/api/v1/airtable/action-items/", () =>
    HttpResponse.json({ ...mockActionItem, airtable_id: "recNEW001", id: 2 }, { status: 201 })
  ),
  http.patch("/api/v1/airtable/action-items/:airtableId/status/", () =>
    HttpResponse.json(mockActionItem)
  ),
  http.patch("/api/v1/airtable/action-items/:airtableId/fields/", () =>
    HttpResponse.json(mockActionItem)
  ),
  // addLog fires a fire-and-forget POST here; catch it to keep tests clean
  http.post("/api/v1/realtime/activity/", () =>
    new HttpResponse(null, { status: 201 })
  ),
  http.get("/api/v1/airtable/action-items/field-options/", () =>
    HttpResponse.json({ status: ["Open", "In Progress", "Done", "Blocked", "Backlogged"], priority: ["Critical", "High", "Medium", "Low"] })
  ),
];
