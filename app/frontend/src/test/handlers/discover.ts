import { http, HttpResponse } from "msw";
import type { DiscoverApplet } from "../../types";

export const mockApplets: DiscoverApplet[] = [
  {
    id: 1,
    type: "applet",
    name: "CRM Sync Tool",
    description: "Syncs Salesforce with internal CRM",
    url: "https://example.com/crm-sync",
    category: "Integration",
    author: "Alice Smith",
    tags: ["crm", "salesforce"],
    airtable_id: "rec123",
    submitted_by_username: "alice",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
  },
  {
    id: 2,
    type: "repo",
    name: "Analytics Dashboard",
    description: "Real-time analytics for account health",
    url: "https://github.com/example/analytics",
    category: "Dashboard",
    author: "Bob Jones",
    tags: ["analytics"],
    airtable_id: "rec456",
    submitted_by_username: "bob",
    created_at: "2026-07-02T00:00:00Z",
    updated_at: "2026-07-02T00:00:00Z",
  },
];

export const discoverHandlers = [
  http.get("/api/v1/discover/applets/", () =>
    HttpResponse.json({ results: mockApplets, count: mockApplets.length })
  ),
  http.post("/api/v1/discover/applets/", async ({ request }) => {
    const body = await request.json() as Partial<DiscoverApplet>;
    return HttpResponse.json(
      { id: 99, type: "applet", tags: [], airtable_id: "", submitted_by_username: null,
        created_at: "2026-07-23T00:00:00Z", updated_at: "2026-07-23T00:00:00Z", ...body },
      { status: 201 }
    );
  }),
  http.patch("/api/v1/discover/applets/:id/", async ({ request }) => {
    const body = await request.json() as Partial<DiscoverApplet>;
    return HttpResponse.json({ ...mockApplets[0], ...body });
  }),
  http.delete("/api/v1/discover/applets/:id/", () =>
    new HttpResponse(null, { status: 204 })
  ),
];
