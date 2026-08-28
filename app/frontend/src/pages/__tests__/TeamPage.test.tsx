import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockTeamMembers } from "../../test/handlers/team";

// ── Mock cross-cutting deps ──────────────────────────────────────────────────

vi.mock("../../lib/appLog", () => ({
  addLog: vi.fn(),
  getLogs: vi.fn(() => []),
  getLogsForResource: vi.fn(() => []),
}));

vi.mock("../../context/CurrentUserContext", () => ({
  useCurrentUser: () => null,
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
});
