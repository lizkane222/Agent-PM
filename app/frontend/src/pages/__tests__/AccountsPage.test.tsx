import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import type { TeamMember } from "../../types";

// ── Cross-cutting mocks (same pattern as ActionItemsPage.test.tsx) ─────────────

vi.mock("../../context/ExportContext", () => ({
  ExportProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useExport: () => ({
    exportMode: false,
    items: [],
    toggleMode: vi.fn(),
    toggleItem: vi.fn(),
    isSelected: vi.fn(() => false),
    clearItems: vi.fn(),
    count: 0,
  }),
}));

vi.mock("../../components/comments/CommentContext", () => ({
  useCommentContext: () => ({ openComments: vi.fn(), closeComments: vi.fn() }),
  useRightClickComment: () => ({ onContextMenu: vi.fn() }),
  CommentProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../../lib/appLog", () => ({
  addLog: vi.fn(),
  getLogs: vi.fn(() => []),
  getLogsForResource: vi.fn(() => []),
}));

vi.mock("../../assets/icons/Corporate.svg?react", () => ({ default: () => null }));

// Hoisted so the mocked module and the tests share one spy. `reportError` is the app's
// only error channel, so asserting on it is how a silent failure becomes visible.
const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("../../context/AppErrorContext", () => ({
  useAppError: () => ({ reportError }),
  AppErrorProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── Mock data — more than the backend's default page size of 50 ────────────────

function makeMembers(count: number): TeamMember[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    user: null,
    full_name: `Member ${String(i).padStart(2, "0")}`,
    email: `member${i}@example.com`,
    title: "",
    department: "",
    tags: [],
    manager: null,
    manager_name: null,
    slack_handle: "",
    avatar_url: "",
    joined_at: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  }));
}

const allMembers = makeMembers(60);

async function renderPage() {
  const { default: AccountsPage } = await import("../AccountsPage");
  render(
    <MemoryRouter>
      <AccountsPage />
    </MemoryRouter>
  );
}

describe("AccountsPage — team members sidebar", () => {
  it("requests a page_size large enough to avoid the backend's default 50-item page", async () => {
    // Mirrors the real ClientPageSizePagination behaviour: without a wide-enough
    // ?page_size=, only the first 50 of 60 members would come back.
    server.use(
      http.get("/api/v1/accounts/accounts/", () =>
        HttpResponse.json({ results: [], count: 0 })
      ),
      http.get("/api/v1/team/members/", ({ request }) => {
        const pageSize = Number(new URL(request.url).searchParams.get("page_size") ?? "50");
        const results = allMembers.slice(0, Math.min(pageSize, allMembers.length));
        return HttpResponse.json({ results, count: allMembers.length });
      })
    );

    await renderPage();

    fireEvent.click(screen.getByText("Team Members"));

    // Member 59 only appears if the request asked for more than the default 50.
    await waitFor(() => expect(screen.getByText("Member 59")).toBeInTheDocument());
    expect(screen.getByText("Member 00")).toBeInTheDocument();
  });
});

// ── Cloud Coach membership push on a member drop ───────────────────────────────
//
// Dragging a team member onto an account links them locally AND, when that account has
// exactly one Salesforce-linked project, adds them to it in Cloud Coach so they can log
// time against it. The outcome rides back on the PATCH response.

const ACME = {
  id: 1,
  company_name: "Acme Corp",
  industry: "Tech",
  status: "active",
  arr: 0,
  team_members: [],
  notes: [],
};

/** jsdom has no DataTransfer, so drops carry a hand-built stub — see CLAUDE.md. */
function memberDataTransfer(memberId: number) {
  const data: Record<string, string> = { memberId: String(memberId) };
  return {
    getData: (key: string) => data[key] ?? "",
    setData: (key: string, value: string) => { data[key] = value; },
    types: Object.keys(data),
    effectAllowed: "copy",
    dropEffect: "copy",
  } as unknown as DataTransfer;
}

async function renderWithAccount(patchHandler: Parameters<typeof http.patch>[1]) {
  server.use(
    http.get("/api/v1/accounts/accounts/", () =>
      HttpResponse.json({ results: [ACME], count: 1 })
    ),
    http.get("/api/v1/team/members/", () =>
      HttpResponse.json({ results: [allMembers[0]], count: 1 })
    ),
    http.patch("/api/v1/accounts/accounts/:id/", patchHandler),
  );
  await renderPage();
  await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());
}

function dropMemberOnAcme(memberId = 1) {
  const card = screen.getByText("Acme Corp").closest("[draggable]") as HTMLElement;
  fireEvent.drop(card, { dataTransfer: memberDataTransfer(memberId) });
}

describe("AccountsPage — Cloud Coach member push", () => {
  it("shows the toast when the server reports a push", async () => {
    await renderWithAccount(() =>
      HttpResponse.json({
        ...ACME,
        team_members: [{ id: 1, full_name: "Member 00", title: "" }],
        cloud_coach_pushes: [{
          status: "pushed",
          member_name: "Member 00",
          project_name: "Acme Rollout",
          message: "Member 00 added to Acme Rollout in Cloud Coach.",
        }],
      })
    );

    dropMemberOnAcme();

    const toast = await screen.findByTestId("cloud-coach-toast");
    expect(toast).toHaveTextContent("Member 00 added to Acme Rollout in Cloud Coach.");
    expect(toast).toHaveAttribute("data-tone", "ok");
  });

  it("warns when the push could not find a free project role", async () => {
    await renderWithAccount(() =>
      HttpResponse.json({
        ...ACME,
        team_members: [{ id: 1, full_name: "Member 00", title: "" }],
        cloud_coach_pushes: [{
          status: "no_free_slot",
          member_name: "Member 00",
          project_name: "Acme Rollout",
          message: "Every project role on Acme Rollout is already filled.",
        }],
      })
    );

    dropMemberOnAcme();

    const toast = await screen.findByTestId("cloud-coach-toast");
    expect(toast).toHaveAttribute("data-tone", "warn");
    expect(toast).toHaveTextContent("already filled");
  });

  it("shows no toast when the response carries no push", async () => {
    // The common case: the account has no Salesforce-linked project, or several. Every
    // pre-existing consumer of this endpoint must see an unchanged surface.
    await renderWithAccount(() =>
      HttpResponse.json({
        ...ACME,
        team_members: [{ id: 1, full_name: "Member 00", title: "" }],
      })
    );

    dropMemberOnAcme();

    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());
    expect(screen.queryByTestId("cloud-coach-toast")).not.toBeInTheDocument();
  });

  it("reports a rejected drop instead of failing silently", async () => {
    // handleMemberDrop had no .catch at all, so a 403 from the team-member allowlist in
    // AccountViewSet._validate_account_write_fks left the card silently unchanged and the
    // rejection unhandled.
    reportError.mockClear();
    await renderWithAccount(() =>
      HttpResponse.json({ detail: "You cannot add team members…" }, { status: 403 })
    );

    dropMemberOnAcme();

    await waitFor(() => expect(reportError).toHaveBeenCalled());
    expect(reportError.mock.calls[0][0]).toMatch(/Could not add that team member/);
    expect(screen.queryByTestId("cloud-coach-toast")).not.toBeInTheDocument();
  });

  it("reports a failed push through the error channel as well as the toast", async () => {
    // The toast confirms *something* happened; reportError is what puts it in the error
    // log, since a silent partial success is the worst outcome here.
    reportError.mockClear();
    await renderWithAccount(() =>
      HttpResponse.json({
        ...ACME,
        team_members: [{ id: 1, full_name: "Member 00", title: "" }],
        cloud_coach_pushes: [{
          status: "error",
          member_name: "Member 00",
          project_name: "Acme Rollout",
          message: "Salesforce rejected adding Member 00 to Acme Rollout.",
        }],
      })
    );

    dropMemberOnAcme();

    await waitFor(() => expect(reportError).toHaveBeenCalled());
    expect(reportError.mock.calls[0][0]).toMatch(/Salesforce rejected/);
  });
});
