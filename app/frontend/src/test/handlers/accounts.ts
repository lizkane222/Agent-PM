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
  ProjectMember,
  AccountTicket,
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
  primary_contact_text: "",
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
  team: "",
  is_main_poc: false,
  timezone: "",
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
  sf_data: {},
  sf_project_id: "",
  kind: "project",
  created_at: "2026-01-01T00:00:00Z",
};

export const mockProjectMember: ProjectMember = {
  id: 1,
  project: 1,
  team_member: 1,
  team_member_name: "Bob Smith",
  team_member_email: "bob@acme.com",
  team_member_avatar_url: "",
  role: "",
  added_by: 1,
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
  image_url: null,
  mime_type: "",
  file_size: null,
  description: "",
  references: [],
  used_in: [],
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
  image_url: null,
  mime_type: "text/javascript",
  file_size: 2048,
  description: "",
  references: [],
  used_in: [],
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

/** Empty per-account Activity Log response, with every category count present. */
export function activityLogResponse(rows: Array<Record<string, unknown>> = []) {
  const cats = ["activity", "events", "comments", "notifications", "reminders", "feedback", "tokens"];
  const counts = Object.fromEntries(cats.map((c) => [c, rows.filter((r) => r.category === c).length]));
  return { counts, results: rows };
}

export const mockTicket: AccountTicket = {
  id: 501,
  account: 1,
  account_name: "Acme Corp",
  kind: "jira",
  url: "https://jira.example.com/browse/ENG-1",
  external_key: "ENG-1",
  title: "Segment sync fails",
  status: "open",
  notes: "",
  source_created_at: "2026-03-01T10:00:00Z",
  source_updated_at: "2026-03-02T11:30:00Z",
  resolved_at: null,
  created_at: "2026-03-03T00:00:00Z",
  updated_at: "2026-03-03T00:00:00Z",
  created_by_username: "alice",
  found_by_username: "",
  review_state: "confirmed",
  source_subject: "",
  source_sender: "",
  source_snippet: "",
};

export const mockTicketToReview: AccountTicket = {
  ...mockTicket,
  id: 502,
  account: null,
  account_name: "",
  kind: "zendesk",
  url: "https://support.example.com/tickets/77",
  external_key: "77",
  title: "Login broken",
  review_state: "needs_review",
  found_by_username: "alice",
  source_subject: "[Zendesk] Ticket 77",
  source_sender: "support@example.com",
  source_snippet: "A customer reports login errors",
};

export const accountHandlers = [
  // Tickets: default is an empty list so pages that mount the sections need no override.
  http.get("/api/v1/accounts/tickets/", () => HttpResponse.json({ count: 0, next: null, previous: null, results: [] })),
  http.post("/api/v1/accounts/tickets/", async ({ request }) => {
    const body = (await request.json()) as Partial<AccountTicket>;
    return HttpResponse.json({ ...mockTicket, id: 503, ...body }, { status: 201 });
  }),
  http.post("/api/v1/accounts/tickets/:id/assign/", async ({ request, params }) => {
    const body = (await request.json()) as Partial<AccountTicket>;
    return HttpResponse.json({ ...mockTicketToReview, id: Number(params.id), account: body.account ?? null, review_state: "confirmed" });
  }),
  http.patch("/api/v1/accounts/tickets/:id/", async ({ request, params }) => {
    const body = (await request.json()) as Partial<AccountTicket>;
    return HttpResponse.json({ ...mockTicket, id: Number(params.id), ...body });
  }),
  http.delete("/api/v1/accounts/tickets/:id/", () => new HttpResponse(null, { status: 204 })),
  http.get("/api/v1/accounts/accounts/:id/activity-log/", () => HttpResponse.json(activityLogResponse())),
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
  // 404 = "no server timeline": the page falls back to its per-account fetches. Tests of
  // the Mine/Team timeline override this.
  http.get("/api/v1/accounts/accounts/:id/timeline/", () =>
    new HttpResponse(null, { status: 404 })
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
  http.post("/api/v1/accounts/projects/fetch-salesforce/", async ({ request }) => {
    const body = await request.json() as { sf_project_id?: string };
    if (!body.sf_project_id) return HttpResponse.json({ detail: "sf_project_id is required." }, { status: 400 });
    return HttpResponse.json({
      name: "Segment Data Deletion",
      sf_data: { projectStatus: "In Progress", health: "Green" },
      fields_skipped: ["projectSummary"],
    });
  }),
  // Project members
  http.get("/api/v1/accounts/project-members/", () =>
    HttpResponse.json({ results: [mockProjectMember], count: 1, next: null, previous: null })
  ),
  http.post("/api/v1/accounts/project-members/", async ({ request }) => {
    const body = await request.json() as Partial<ProjectMember>;
    return HttpResponse.json({ ...mockProjectMember, id: 99, ...body }, { status: 201 });
  }),
  http.delete("/api/v1/accounts/project-members/:id/", () =>
    new HttpResponse(null, { status: 204 })
  ),
  // Artifacts
  http.get("/api/v1/accounts/accounts/:id/artifacts/", () =>
    HttpResponse.json([mockArtifact, mockCodeArtifact])
  ),
  http.post("/api/v1/accounts/accounts/:id/artifacts/", async ({ request, params }) => {
    // Uploads (files, or links with an image) arrive as multipart, which jsdom hands over
    // stringified — tests assert on those at the axios layer, so just acknowledge them.
    const isMultipart = (request.headers.get("content-type") ?? "").includes("multipart");
    const body = (isMultipart ? {} : await request.json()) as Partial<AccountArtifact>;
    return HttpResponse.json(
      { ...mockArtifact, id: 42, account: Number(params.id), ...body },
      { status: 201 }
    );
  }),
  http.patch("/api/v1/accounts/artifacts/:id/", async ({ request }) => {
    const isMultipart = (request.headers.get("content-type") ?? "").includes("multipart");
    const body = (isMultipart ? {} : await request.json()) as Partial<AccountArtifact>;
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
