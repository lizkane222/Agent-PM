import { http, HttpResponse } from "msw";
import type {
  Account,
  AccountArtifact,
  AccountNote,
  AccountProject,
  AccountQuickLink,
  AirtableAccount,
  AirtableMeeting,
  CustomerContact,
} from "../../types";

export const mockAccount: Account = {
  id: 1,
  company_name: "Acme Corp",
  airtable_id: "recACME001",
  website: "https://acme.com",
  industry: "Technology",
  status: "active",
  arr: "100000",
  owner: 1,
  owner_username: "alice",
  primary_contact: null,
  primary_contact_name: null,
  team_members: [],
  notes_count: 1,
  created_by: 1,
  is_admin_account: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

export const mockAccountNote: AccountNote = {
  id: 1,
  account: 1,
  author: 1,
  author_username: "alice",
  author_display: "Alice",
  content: "Test note",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

export const mockContact: CustomerContact = {
  id: 1,
  account: 1,
  name: "Bob",
  role: "Engineer",
  description: "",
  email: "bob@acme.com",
  airtable_id: "",
  notes_count: 0,
  notes: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

export const mockProject: AccountProject = {
  id: 1,
  account: 1,
  name: "Q3 Launch",
  description: "Q3 launch plan",
  url: "",
  position: 0,
  action_ids: [],
  meeting_ids: [],
  goal_ids: [],
  resources: [],
  created_at: "2026-01-01T00:00:00Z",
};

export const mockArtifact: AccountArtifact = {
  id: 1,
  account: 1,
  artifact_type: "link",
  name: "Product Spec",
  url: "https://docs.google.com/document/d/abc",
  secondary_url: "",
  icon_key: "google_docs",
  file_url: null,
  mime_type: "",
  file_size: null,
  uploaded_by: null,
  uploaded_by_username: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

export const mockCodeArtifact: AccountArtifact = {
  id: 2,
  account: 1,
  artifact_type: "file",
  name: "utils.js",
  url: null,
  secondary_url: "",
  icon_key: "file_code",
  file_url: "https://storage.example.com/utils.js",
  mime_type: "text/javascript",
  file_size: 2048,
  uploaded_by: 1,
  uploaded_by_username: "alice",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

export const mockAirtableAccount: AirtableAccount = {
  id: 1,
  airtable_id: "recACME001",
  name: "Acme Corp",
  email_domain: "acme.com",
  health_score: "green",
  next_meeting: null,
  open_ticket_count: 0,
  time_budget: 0,
  total_meeting_duration: 0,
  salesforce_account_id: "",
  segment_workspaces: "",
  last_synced: "2026-01-01T00:00:00Z",
};

export const mockAirtableMeeting: AirtableMeeting = {
  id: 1,
  airtable_id: "recMTG001",
  account: 1,
  account_name: "Acme Corp",
  name: "Q3 Kickoff",
  date: "2026-07-01",
  duration: 60,
  expected_topics: "",
  gong_notes: "",
  gong_url: "",
  zoom_notes: "",
  zoom_url: "",
  customer_slack: "",
  account_team_slack: "",
  last_synced: "2026-01-01T00:00:00Z",
};

export const mockQuickLink: AccountQuickLink = {
  id: 1,
  account: 1,
  name: "Dashboard",
  url: "https://acme.com/dashboard",
  position: 0,
  created_by: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

export const accountHandlers = [
  http.get("/api/v1/accounts/accounts/", () =>
    HttpResponse.json({ count: 1, next: null, previous: null, results: [mockAccount] })
  ),
  // MUST stay ahead of the ":id" handler below — MSW matches in registration order and
  // ":id" would otherwise capture "artifacts-batch" as an account ID.
  http.get("/api/v1/accounts/accounts/artifacts-batch/", ({ request }) => {
    const ids = new URL(request.url).searchParams.get("ids");
    if (!ids) return HttpResponse.json([]);
    return HttpResponse.json([mockArtifact, mockCodeArtifact]);
  }),
  http.get("/api/v1/accounts/accounts/:id/", () =>
    HttpResponse.json(mockAccount)
  ),
  http.get("/api/v1/accounts/admin-account/", () =>
    HttpResponse.json(mockAccount)
  ),
  http.get("/api/v1/accounts/accounts/:id/notes/", () =>
    HttpResponse.json([mockAccountNote])
  ),
  http.get("/api/v1/accounts/accounts/:id/calendar-events/", () =>
    HttpResponse.json([])
  ),
  http.get("/api/v1/accounts/accounts/:id/reminders/", () =>
    HttpResponse.json([])
  ),
  http.get("/api/v1/accounts/contacts/", () =>
    HttpResponse.json({ results: [mockContact], count: 1 })
  ),
  http.get("/api/v1/accounts/accounts/:id/quick-links/", () =>
    HttpResponse.json([mockQuickLink])
  ),
  http.get("/api/v1/accounts/projects/", () =>
    HttpResponse.json({ results: [mockProject], count: 1 })
  ),
  http.post("/api/v1/accounts/projects/", async ({ request }) => {
    const body = await request.json() as Partial<AccountProject>;
    return HttpResponse.json({ ...mockProject, id: 99, ...body }, { status: 201 });
  }),
  http.patch("/api/v1/accounts/projects/:id/", async ({ request }) => {
    const body = await request.json() as Partial<AccountProject>;
    return HttpResponse.json({ ...mockProject, ...body });
  }),
  http.delete("/api/v1/accounts/projects/:id/", () =>
    new HttpResponse(null, { status: 204 })
  ),
  // Artifacts
  http.get("/api/v1/accounts/accounts/:id/artifacts/", () =>
    HttpResponse.json([mockArtifact, mockCodeArtifact])
  ),
  http.patch("/api/v1/accounts/artifacts/:id/", async ({ request }) => {
    const body = await request.json() as Partial<AccountArtifact>;
    return HttpResponse.json({ ...mockArtifact, ...body });
  }),
  http.delete("/api/v1/accounts/artifacts/:id/", () =>
    new HttpResponse(null, { status: 204 })
  ),
  // Airtable meetings + accounts used by useAccountDetail Layer 2
  http.get("/api/v1/airtable/meetings/", () =>
    HttpResponse.json({ results: [mockAirtableMeeting] })
  ),
  http.get("/api/v1/airtable/accounts/", () =>
    HttpResponse.json({ results: [mockAirtableAccount] })
  ),
  // Meeting-summary saves. Registered before "meetings/:id/" so the notes sub-paths
  // aren't captured as a meeting ID; each echoes the field it was given so a test can
  // assert the panel wrote to the right column.
  http.patch("/api/v1/airtable/meetings/:id/gong-notes/", async ({ request }) => {
    const body = await request.json() as { gong_notes?: string };
    return HttpResponse.json({ ...mockAirtableMeeting, gong_notes: body.gong_notes ?? "" });
  }),
  http.patch("/api/v1/airtable/meetings/:id/zoom-notes/", async ({ request }) => {
    const body = await request.json() as { zoom_notes?: string };
    return HttpResponse.json({ ...mockAirtableMeeting, zoom_notes: body.zoom_notes ?? "" });
  }),
  http.patch("/api/v1/airtable/meetings/by-event/:eventId/gong-notes/", async ({ request }) => {
    const body = await request.json() as { gong_notes?: string };
    return HttpResponse.json({ ...mockAirtableMeeting, gong_notes: body.gong_notes ?? "" });
  }),
  http.patch("/api/v1/airtable/meetings/by-event/:eventId/zoom-notes/", async ({ request }) => {
    const body = await request.json() as { zoom_notes?: string };
    return HttpResponse.json({ ...mockAirtableMeeting, zoom_notes: body.zoom_notes ?? "" });
  }),
  http.get("/api/v1/airtable/meetings/:id/", () =>
    HttpResponse.json(mockAirtableMeeting)
  ),
  // Airtable event linking
  http.post("/api/v1/airtable/categorize/", () =>
    HttpResponse.json({ detail: "ok" })
  ),
  http.post("/api/v1/airtable/event-links/batch/", () =>
    HttpResponse.json({ results: [] })
  ),
  http.get("/api/v1/airtable/event-link/", () =>
    HttpResponse.json({ results: [] })
  ),
];
