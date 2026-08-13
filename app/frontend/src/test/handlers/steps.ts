import { http, HttpResponse } from "msw";
import type { ActionItemStep } from "../../types";

export const mockStep = (overrides: Partial<ActionItemStep> = {}): ActionItemStep => ({
  id: 1,
  action_item: 10,
  title: "Test step",
  status: "Open",
  order: 0,
  created_at: "2026-08-07T00:00:00Z",
  ...overrides,
});

export const stepsHandlers = [
  http.get("/api/v1/airtable/steps/", () =>
    HttpResponse.json([mockStep()])
  ),
  http.post("/api/v1/airtable/steps/", async ({ request }) => {
    const body = await request.json() as Partial<ActionItemStep>;
    return HttpResponse.json(mockStep({ ...body, id: 99 }), { status: 201 });
  }),
  http.patch("/api/v1/airtable/steps/:id/", async ({ request }) => {
    const body = await request.json() as Partial<ActionItemStep>;
    return HttpResponse.json(mockStep(body));
  }),
  http.delete("/api/v1/airtable/steps/:id/", () =>
    new HttpResponse(null, { status: 204 })
  ),
];
