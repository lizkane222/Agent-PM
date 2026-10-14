import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockTeamMembers, mockTeamMemberDocuments, mockUserProfile } from "../../test/handlers/team";
import { useCurrentUser } from "../../context/CurrentUserContext";

// ── Mock cross-cutting deps ──────────────────────────────────────────────────

vi.mock("../../lib/appLog", () => ({
  addLog: vi.fn(),
  fetchSharedLogsForResource: vi.fn(async () => []),
  getLogs: vi.fn(() => []),
  getLogsForResource: vi.fn(() => []),
}));

vi.mock("../../context/CurrentUserContext", () => ({
  useCurrentUser: vi.fn(() => null),
  CurrentUserProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("../../assets/icons/Corporate.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/Team.svg?react", () => ({ default: () => null }));

// Accounts endpoint must be handled (TeamPage fetches accounts on mount)
server.use(
  http.get("/api/v1/accounts/accounts/", () =>
    HttpResponse.json({ results: [], count: 0 })
  )
);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function renderPage() {
  const { default: TeamPage } = await import("../TeamPage");
  render(
    <MemoryRouter>
      <TeamPage />
    </MemoryRouter>
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("TeamPage", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(useCurrentUser).mockReturnValue(null);
  });

  it("shows loading state initially", async () => {
    server.use(
      http.get("/api/v1/team/members/", async () => {
        await new Promise((r) => setTimeout(r, 50));
        return HttpResponse.json({ results: mockTeamMembers, count: mockTeamMembers.length });
      })
    );
    await renderPage();
    expect(screen.getByText("Loading team members…")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Loading team members…")).not.toBeInTheDocument());
  });

  it("renders member names when data is loaded", async () => {
    await renderPage();
    await waitFor(() =>
      expect(screen.getByText(mockTeamMembers[0].full_name)).toBeInTheDocument()
    );
    expect(screen.getByText(mockTeamMembers[1].full_name)).toBeInTheDocument();
  });

  it("shows 0 members in header when list is empty", async () => {
    server.use(
      http.get("/api/v1/team/members/", () =>
        HttpResponse.json({ results: [], count: 0 })
      )
    );
    await renderPage();
    await waitFor(() =>
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument()
    );
    expect(screen.getByText(/0 member/i)).toBeInTheDocument();
  });

  it("clicking a member card opens the detail panel", async () => {
    await renderPage();
    await waitFor(() => screen.getByText(mockTeamMembers[0].full_name));

    // Click the first member card
    fireEvent.click(screen.getByText(mockTeamMembers[0].full_name));

    // The detail panel shows "Edit Member" button
    await waitFor(() =>
      expect(screen.getByText("Edit Member")).toBeInTheDocument()
    );
  });

  it("shows the backend validation message instead of crashing when create fails with 400", async () => {
    server.use(
      http.post("/api/v1/team/members/", () =>
        HttpResponse.json(
          { email: ["team member with this email already exists."] },
          { status: 400 }
        )
      )
    );
    await renderPage();
    await waitFor(() => screen.getByText(mockTeamMembers[0].full_name));

    fireEvent.click(screen.getByText("+ Add member"));
    fireEvent.change(screen.getByLabelText("Full name *"), {
      target: { value: "Dup Test" },
    });
    fireEvent.change(screen.getByLabelText("Email *"), {
      target: { value: mockTeamMembers[0].email },
    });
    fireEvent.click(screen.getByText("Add member"));

    await waitFor(() =>
      expect(
        screen.getByText("team member with this email already exists.")
      ).toBeInTheDocument()
    );
    // The modal stays open so the user can correct the email, rather than
    // silently closing on a failed save.
    expect(screen.getByText("Add Team Member")).toBeInTheDocument();
  });

  // ── Linked docs ──────────────────────────────────────────────────────────

  it("shows linked docs in the detail sidebar", async () => {
    server.use(
      http.get(`/api/v1/team/members/${mockTeamMembers[0].id}/documents/`, () =>
        HttpResponse.json(mockTeamMemberDocuments)
      )
    );
    await renderPage();
    await waitFor(() => screen.getByText(mockTeamMembers[0].full_name));
    fireEvent.click(screen.getByText(mockTeamMembers[0].full_name));

    await waitFor(() =>
      expect(screen.getByText(mockTeamMemberDocuments[0].name)).toBeInTheDocument()
    );
  });

  it("no add/remove controls when viewing someone else's docs", async () => {
    // mockTeamMembers[0].user === 1; a different viewer (id 999) is not the owner and not staff.
    vi.mocked(useCurrentUser).mockReturnValue({ ...mockUserProfile, id: 999 });
    server.use(
      http.get(`/api/v1/team/members/${mockTeamMembers[0].id}/documents/`, () =>
        HttpResponse.json(mockTeamMemberDocuments)
      )
    );
    await renderPage();
    await waitFor(() => screen.getByText(mockTeamMembers[0].full_name));
    fireEvent.click(screen.getByText(mockTeamMembers[0].full_name));

    await waitFor(() =>
      expect(screen.getByText(mockTeamMemberDocuments[0].name)).toBeInTheDocument()
    );
    expect(screen.queryByLabelText(`Remove ${mockTeamMemberDocuments[0].name}`)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Doc name (e.g. Coverage doc)")).not.toBeInTheDocument();
  });

  it("viewing your own profile shows the add-doc form and adding a doc calls the API", async () => {
    // mockTeamMembers[0].user === mockUserProfile.id === 1 — this is the member's own profile.
    vi.mocked(useCurrentUser).mockReturnValue(mockUserProfile);
    server.use(
      http.get(`/api/v1/team/members/${mockTeamMembers[0].id}/documents/`, () =>
        HttpResponse.json([])
      )
    );
    let postedBody: unknown = null;
    server.use(
      http.post(`/api/v1/team/members/${mockTeamMembers[0].id}/documents/`, async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json({ ...mockTeamMemberDocuments[0], ...(postedBody as object) }, { status: 201 });
      })
    );

    await renderPage();
    await waitFor(() => screen.getByText(mockTeamMembers[0].full_name));
    fireEvent.click(screen.getByText(mockTeamMembers[0].full_name));

    await waitFor(() => expect(screen.getByText("No linked docs.")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("Doc name (e.g. Coverage doc)"), {
      target: { value: "Coverage doc" },
    });
    fireEvent.change(screen.getByPlaceholderText("https://..."), {
      target: { value: "https://docs.example.com/coverage" },
    });
    fireEvent.click(screen.getByText("+ Add doc"));

    await waitFor(() =>
      expect(postedBody).toEqual({ name: "Coverage doc", url: "https://docs.example.com/coverage" })
    );
  });

  it("removing a doc calls the API and removes it from the list", async () => {
    vi.mocked(useCurrentUser).mockReturnValue(mockUserProfile);
    server.use(
      http.get(`/api/v1/team/members/${mockTeamMembers[0].id}/documents/`, () =>
        HttpResponse.json(mockTeamMemberDocuments)
      )
    );
    let deleteCalled = false;
    server.use(
      http.delete(`/api/v1/team/member-documents/${mockTeamMemberDocuments[0].id}/`, () => {
        deleteCalled = true;
        server.use(
          http.get(`/api/v1/team/members/${mockTeamMembers[0].id}/documents/`, () =>
            HttpResponse.json([])
          )
        );
        return new HttpResponse(null, { status: 204 });
      })
    );

    await renderPage();
    await waitFor(() => screen.getByText(mockTeamMembers[0].full_name));
    fireEvent.click(screen.getByText(mockTeamMembers[0].full_name));

    await waitFor(() =>
      expect(screen.getByText(mockTeamMemberDocuments[0].name)).toBeInTheDocument()
    );

    fireEvent.click(screen.getByLabelText(`Remove ${mockTeamMemberDocuments[0].name}`));

    await waitFor(() => expect(deleteCalled).toBe(true));
    await waitFor(() => expect(screen.getByText("No linked docs.")).toBeInTheDocument());
  });
});
