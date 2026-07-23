import { http, HttpResponse } from "msw";
import type { TeamMember } from "../../types";

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

export const teamHandlers = [
  http.get("/api/v1/team/members/", () =>
    HttpResponse.json({ results: mockTeamMembers, count: mockTeamMembers.length })
  ),
  http.patch("/api/v1/team/members/:id/", async ({ request }) => {
    const body = await request.json() as Partial<TeamMember>;
    return HttpResponse.json({ ...mockTeamMembers[0], ...body });
  }),
];
