import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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

function LocationProbe() {
  return <div data-testid="loc">{useLocation().pathname}</div>;
}

async function renderPage(path = "/team") {
  const { default: TeamPage } = await import("../TeamPage");
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/team" element={<TeamPage />} />
        <Route path="/profile/:memberId" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

/** The staff drawer opens from the profile page's "Manage" link: /team?member=<id>. */
async function renderPageWithDrawer(memberIndex = 0) {
  await renderPage(`/team?member=${mockTeamMembers[memberIndex].id}`);
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

  it("clicking a member card opens the detail sidebar, with the Public section, and does not navigate", async () => {
    await renderPage();
    await waitFor(() => screen.getByText(mockTeamMembers[0].full_name));

    fireEvent.click(screen.getByText(mockTeamMembers[0].full_name));

    await waitFor(() => expect(screen.getByTestId("member-public-section")).toBeInTheDocument());
    // Still on /team: the profile route (which renders the "loc" probe) was not navigated to.
    expect(screen.queryByTestId("loc")).not.toBeInTheDocument();
  });

  it("hides Edit Member from a non-admin looking at someone else", async () => {
    vi.mocked(useCurrentUser).mockReturnValue({ ...mockUserProfile, id: 999, is_staff: false, access_level: "basic" });
    await renderPageWithDrawer();
    await waitFor(() => expect(screen.getByTestId("member-public-section")).toBeInTheDocument());
    expect(screen.queryByText("Edit Member")).not.toBeInTheDocument();
  });

  it("shows Edit Member to a non-admin on their own card, with only personal fields editable", async () => {
    vi.mocked(useCurrentUser).mockReturnValue({ ...mockUserProfile, id: mockTeamMembers[0].user!, is_staff: false, access_level: "basic" });
    await renderPageWithDrawer();
    fireEvent.click(await screen.findByText("Edit Member"));
    expect(await screen.findByLabelText("Full name *")).not.toBeDisabled();
    expect(screen.getByLabelText("Email *")).toBeDisabled();
    expect(screen.queryByText("Delete member")).not.toBeInTheDocument();
  });

  it("shows Edit Member to an admin on anyone's card", async () => {
    vi.mocked(useCurrentUser).mockReturnValue({ ...mockUserProfile, id: 999, is_staff: true, access_level: "admin" });
    await renderPageWithDrawer();
    expect(await screen.findByText("Edit Member")).toBeInTheDocument();
  });

  it("previews a member's accounts on their card", async () => {
    server.use(
      http.get("/api/v1/accounts/accounts/", () =>
        HttpResponse.json({
          count: 1,
          results: [{ id: 7, company_name: "Acme Corp", status: "active", industry: "", team_members: [{ id: mockTeamMembers[0].id, full_name: "Alice Smith", title: "", avatar_url: "" }] }],
        })
      )
    );
    await renderPage();
    const box = await screen.findByTestId(`member-accounts-${mockTeamMembers[0].id}`);
    expect(box).toHaveTextContent("Acme Corp");
    expect(box).not.toHaveTextContent("active"); // name only, no status
    expect(screen.queryByTestId(`member-accounts-more-${mockTeamMembers[0].id}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`member-accounts-${mockTeamMembers[1].id}`)).not.toBeInTheDocument();
  });

  it("adds … on a card whose accounts overflow three rows, and the sidebar lists them all", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: 100 + i, company_name: `Account ${i}`, status: "active", industry: "",
      team_members: [{ id: mockTeamMembers[0].id, full_name: "Alice Smith", title: "", avatar_url: "" }],
    }));
    server.use(http.get("/api/v1/accounts/accounts/", () => HttpResponse.json({ count: 12, results: many })));
    // jsdom does no layout: report the chip box as taller than its three-row cap.
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(200);
    const client = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(78);
    try {
      await renderPageWithDrawer(); // opens member 0's sidebar
      expect(await screen.findByTestId(`member-accounts-more-${mockTeamMembers[0].id}`)).toHaveTextContent("…");
      expect(screen.queryByTestId(`member-accounts-more-${mockTeamMembers[1].id}`)).not.toBeInTheDocument();
      // Full list in the sidebar (card chip + sidebar row for each).
      // The sidebar's linked-accounts list has a remove button per account, so it holds all 12.
      await waitFor(() => expect(screen.getByLabelText("Remove from Account 11")).toBeInTheDocument());
    } finally {
      scroll.mockRestore(); client.mockRestore();
    }
  });

  it("shows a member's time zone on their card only when configured", async () => {
    server.use(
      http.get("/api/v1/team/members/", () =>
        HttpResponse.json({
          count: 2,
          results: [
            { ...mockTeamMembers[0], timezone: "America/Los_Angeles", timezone_source: "self" },
            { ...mockTeamMembers[1], timezone: "", timezone_source: "" },
          ],
        })
      )
    );
    await renderPage();
    expect(await screen.findByTestId(`member-timezone-${mockTeamMembers[0].id}`)).toHaveTextContent("America/Los Angeles");
    // The current time in that zone sits next to it (matches what Intl says for that zone).
    const expected = new Intl.DateTimeFormat(undefined, { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" }).format(new Date());
    expect(screen.getByTestId(`member-time-${mockTeamMembers[0].id}`).textContent).toMatch(/\d/);
    expect([expected, new Intl.DateTimeFormat(undefined, { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" }).format(new Date(Date.now() + 60000))])
      .toContain(screen.getByTestId(`member-time-${mockTeamMembers[0].id}`).textContent);
    expect(screen.queryByTestId(`member-timezone-${mockTeamMembers[1].id}`)).not.toBeInTheDocument();
  });

  it("shows the zone without a time when the browser doesn't know the zone", async () => {
    server.use(http.get("/api/v1/team/members/", () => HttpResponse.json({ count: 1, results: [{ ...mockTeamMembers[0], timezone: "Mars/Olympus" }] })));
    await renderPage();
    expect(await screen.findByTestId(`member-timezone-${mockTeamMembers[0].id}`)).toHaveTextContent("Mars/Olympus");
    expect(screen.queryByTestId(`member-time-${mockTeamMembers[0].id}`)).not.toBeInTheDocument();
  });

  it("Sort lists the selected roles first", async () => {
    await renderPage();
    await waitFor(() => screen.getByText(mockTeamMembers[0].full_name));
    const order = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    const before = order();
    fireEvent.click(screen.getByRole("button", { name: /Sort/ }));
    // Pick the role of the member who is currently listed last.
    const lastLabel = before[before.length - 1]!;
    fireEvent.click(within(screen.getByRole("menu")).getByLabelText(new RegExp(lastLabel, "i")));
    expect(order()[0]).toBe(lastLabel);
  });

  it("only people with 'manager' in their title are offered as a manager", async () => {
    server.use(
      http.get("/api/v1/team/members/", () =>
        HttpResponse.json({
          count: 3,
          results: [
            { ...mockTeamMembers[0], id: 1, full_name: "Alice Smith", title: "Engineering Manager" },
            { ...mockTeamMembers[1], id: 2, full_name: "Bob Jones", title: "Sales Engineer", manager: null, manager_name: null },
            { ...mockTeamMembers[1], id: 3, full_name: "Cara Lee", title: "Senior MANAGER, Sales", manager: null, manager_name: null },
          ],
        })
      )
    );
    await renderPage();
    await waitFor(() => screen.getByText("Bob Jones"));
    fireEvent.click(screen.getByText("+ Add member"));
    const options = within(screen.getByLabelText("Manager")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["No manager", "Alice Smith", "Cara Lee"]);
  });

  it("/team?member=<id> opens the staff detail panel for that member", async () => {
    vi.mocked(useCurrentUser).mockReturnValue({ ...mockUserProfile, id: 999, is_staff: true, access_level: "admin" });
    await renderPageWithDrawer();
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
    await renderPageWithDrawer();

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
    await renderPageWithDrawer();

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

    await renderPageWithDrawer();

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

    await renderPageWithDrawer();

    await waitFor(() =>
      expect(screen.getByText(mockTeamMemberDocuments[0].name)).toBeInTheDocument()
    );

    fireEvent.click(screen.getByLabelText(`Remove ${mockTeamMemberDocuments[0].name}`));

    await waitFor(() => expect(deleteCalled).toBe(true));
    await waitFor(() => expect(screen.getByText("No linked docs.")).toBeInTheDocument());
  });
});
