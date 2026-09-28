import { http, HttpResponse } from "msw";
import type { TeamMember, TeamMemberDocument, UserProfile } from "../../types";

export const mockUserProfile: UserProfile = {
  id: 1,
  username: "alice",
  email: "alice@example.com",
  is_staff: false,
  display_name: "Alice Smith",
  avatar_url: "",
  title: "Account Executive",
  role: "member",
  phone_number: "",
  timezone: "America/New_York",
  slack_user_id: "",
  google_account_email: "alice@example.com",
  airtable_collaborator_id: "",
  notification_email: true,
  notification_slack: false,
  notify_default_in_app: true,
  notify_default_slack: false,
  notify_default_push: false,
  notify_default_sms: false,
  push_subscription_active: false,
  staff_view_override: false,
  calendar_colors: {},
};

export const mockTeamMembers: TeamMember[] = [
  {
    id: 1,
    user: 1,
    full_name: "Alice Smith",
    email: "alice@example.com",
    title: "Account Executive",
    department: "Sales",
    tags: [],
    manager: null,
    manager_name: null,
    slack_handle: "alice",
    avatar_url: "",
    joined_at: "2024-01-01",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  },
  {
    id: 2,
    user: 2,
    full_name: "Bob Jones",
    email: "bob@example.com",
    title: "Sales Engineer",
    department: "Sales",
    tags: [],
    manager: 1,
    manager_name: "Alice Smith",
    slack_handle: "bob",
    avatar_url: "",
    joined_at: "2024-02-01",
    created_at: "2024-02-01T00:00:00Z",
    updated_at: "2024-02-01T00:00:00Z",
  },
];

export const mockTeamMemberDocuments: TeamMemberDocument[] = [
  {
    id: 1,
    team_member: 1,
    name: "OOO coverage doc",
    url: "https://docs.example.com/coverage",
    position: 0,
    added_by: 1,
    added_by_name: "Alice Smith",
    created_at: "2024-01-05T00:00:00Z",
    updated_at: "2024-01-05T00:00:00Z",
  },
];

export const teamHandlers = [
  http.get("/api/v1/team/profiles/me/", () =>
    HttpResponse.json(mockUserProfile)
  ),
  http.patch("/api/v1/team/profiles/me/", async ({ request }) => {
    const body = await request.json() as Partial<UserProfile>;
    return HttpResponse.json({ ...mockUserProfile, ...body });
  }),
  http.get("/api/v1/team/members/", () =>
    HttpResponse.json({ results: mockTeamMembers, count: mockTeamMembers.length })
  ),
  http.post("/api/v1/team/members/", async ({ request }) => {
    const body = await request.json() as Partial<TeamMember>;
    const newMember: TeamMember = {
      ...mockTeamMembers[0],
      id: 99,
      full_name: body.full_name ?? "New Member",
      email: body.email ?? "new@example.com",
      ...body,
    };
    return HttpResponse.json(newMember, { status: 201 });
  }),
  http.patch("/api/v1/team/members/:id/", async ({ request }) => {
    const body = await request.json() as Partial<TeamMember>;
    return HttpResponse.json({ ...mockTeamMembers[0], ...body });
  }),
  http.delete("/api/v1/team/members/:id/", () =>
    new HttpResponse(null, { status: 204 })
  ),
  // Default: no docs, so every existing TeamPage test's DOM stays unchanged.
  // Tests that exercise the Linked Docs section override with server.use(...).
  http.get("/api/v1/team/members/:id/documents/", () => HttpResponse.json([])),
  http.post("/api/v1/team/members/:id/documents/", async ({ request }) => {
    const body = (await request.json()) as Partial<TeamMemberDocument>;
    const newDoc: TeamMemberDocument = {
      ...mockTeamMemberDocuments[0],
      id: 100,
      name: body.name ?? "New doc",
      url: body.url ?? "https://example.com",
    };
    return HttpResponse.json(newDoc, { status: 201 });
  }),
  http.patch("/api/v1/team/member-documents/:id/", async ({ request }) => {
    const body = (await request.json()) as Partial<TeamMemberDocument>;
    return HttpResponse.json({ ...mockTeamMemberDocuments[0], ...body });
  }),
  http.delete("/api/v1/team/member-documents/:id/", () =>
    new HttpResponse(null, { status: 204 })
  ),
];
