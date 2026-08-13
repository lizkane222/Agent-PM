import React from "react";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockAccount, mockAirtableAccount } from "../../test/handlers/accounts";
import type { Account } from "../../types";
import { mockTeamMembers } from "../../test/handlers/team";

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

vi.mock("../../lib/appLog", () => ({
  addLog: vi.fn(),
  getLogs: vi.fn(() => []),
  getLogsForResource: vi.fn(() => []),
  syncLogsFromBackend: vi.fn(),
  LOG_STORAGE_KEY: "app_log",
}));

vi.mock("../../context/CurrentUserContext", () => ({
  useCurrentUser: () => null,
  CurrentUserProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../../components/comments/CommentContext", () => ({
  useCommentContext: () => ({ openComments: vi.fn(), closeComments: vi.fn() }),
  useRightClickComment: () => ({ onContextMenu: vi.fn() }),
  CommentProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../../assets/icons/Corporate.svg?react", () => ({ default: () => null }));

// ── Mock data ─────────────────────────────────────────────────────────────────

const FUTURE_MEETING_DATE = "2026-08-15";

const mockMeetingFuture = {
  id: 1,
  airtable_id: "recMTG001",
  account: 1,
  account_name: "Acme Corp",
  name: "Q3 Review",
  date: FUTURE_MEETING_DATE,
  duration: 60,
  expected_topics: "",
  gong_notes: "",
  gong_url: "",
  customer_slack: "",
  account_team_slack: "",
  last_synced: "2026-01-01T00:00:00Z",
};

const makeItem = (overrides: object) => ({
  id: 1,
  airtable_id: "recAAA001",
  account: 1,
  account_name: "Acme Corp",
  task: "Default task",
  task_details: "",
  status: "Open",
  priority: "High",
  // null due_date keeps items out of the AccountTimeline day cells
  due_date: null as string | null,
  estimated_time: 0,
  time_spent: 0,
  prep_time: 0,
  slack_thread_url: "",
  salesforce_task_id: "",
  assignee_airtable_id: "",
  assignee_name: "",
  reminder: null,
  reminder_id: null,
  reminder_due_at: null,
  reminder_status: null,
  linked_meeting: null,
  linked_meeting_name: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  marked_done_at: null,
  last_synced: "",
  ...overrides,
});

// Account with Alice Smith and Bob Jones as team members so their filter chips render.
const mockAccountWithMembers: Account = {
  ...mockAccount,
  team_members: mockTeamMembers.map(m => ({
    id: m.id,
    full_name: m.full_name,
    title: m.title,
    email: m.email,
    avatar_url: m.avatar_url,
    slack_handle: m.slack_handle,
  })),
};

// Items without due_date so they only appear in the kanban board, not the timeline.
const itemAlice = makeItem({ airtable_id: "recAAA001", id: 1, task: "Alice task", assignee_name: "Alice Smith" });
const itemBob   = makeItem({ airtable_id: "recBBB002", id: 2, task: "Bob task",   assignee_name: "Bob Jones" });
const itemNone  = makeItem({ airtable_id: "recCCC003", id: 3, task: "Unassigned task", assignee_name: "" });

// Items with due_dates for the Before Next Meeting test.
const itemBeforeMeeting = makeItem({ airtable_id: "recD001", id: 4, task: "Before task", assignee_name: "Alice Smith", due_date: "2026-08-10" });
const itemAfterMeeting  = makeItem({ airtable_id: "recE002", id: 5, task: "After task",  assignee_name: "Bob Jones",   due_date: "2026-08-20" });

function registerHandlers(items = [itemAlice, itemBob, itemNone]) {
  server.use(
    http.get("/api/v1/accounts/accounts/:id/", () => HttpResponse.json(mockAccountWithMembers)),
    http.get("/api/v1/accounts/accounts/:id/notes/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/accounts/:id/calendar-events/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/accounts/:id/reminders/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/accounts/:id/quick-links/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/contacts/", () => HttpResponse.json({ results: [], count: 0 })),
    http.get("/api/v1/accounts/projects/", () => HttpResponse.json({ results: [], count: 0 })),
    http.get("/api/v1/team/members/", () => HttpResponse.json({ results: mockTeamMembers, count: mockTeamMembers.length })),
    http.get("/api/v1/team/profiles/me/", () => new HttpResponse(null, { status: 404 })),
    http.get("/api/v1/airtable/action-items/", () => HttpResponse.json(items)),
    http.get("/api/v1/airtable/meetings/", () => HttpResponse.json({ results: [mockMeetingFuture] })),
    http.get("/api/v1/airtable/accounts/", () => HttpResponse.json({ results: [mockAirtableAccount] })),
    http.get("/api/v1/airtable/action-items/field-options/", () =>
      HttpResponse.json({ status: ["Open", "In Progress", "Done", "Blocked", "Backlogged"], priority: ["Critical", "High", "Medium", "Low"] })
    ),
  );
}

async function renderPage() {
  const { default: AccountDetailPage } = await import("../AccountDetailPage");
  render(
    <MemoryRouter initialEntries={["/accounts/1"]}>
      <Routes>
        <Route path="/accounts/:id" element={<AccountDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

// Convenience: get the action items section (scoped so timeline duplicates don't interfere).
async function getSection() {
  return await screen.findByTestId("action-items-section");
}

// Convenience: get the view selector bar (scoped so NewActionItemCard's "Unassigned" pill doesn't interfere).
function getViewBar(section: HTMLElement) {
  return within(section).getByTestId("kanban-view-bar");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AccountDetailPage — kanban views", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    registerHandlers();
  });

  it("shows loading state before data arrives", async () => {
    server.use(
      http.get("/api/v1/accounts/accounts/:id/", async () => {
        await new Promise(r => setTimeout(r, 50));
        return HttpResponse.json(mockAccountWithMembers);
      })
    );
    await renderPage();
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
  });

  it("renders view selector bar with All, Unassigned, Before Next Meeting, and member buttons", async () => {
    await renderPage();
    const section = await getSection();
    await waitFor(() => within(section).getByRole("button", { name: "All" }));
    const bar = getViewBar(section);
    expect(within(bar).getByRole("button", { name: "Unassigned" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Before Next Meeting" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Alice Smith" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Bob Jones" })).toBeInTheDocument();
  });

  it("member filter bar only lists members on the current account, not every org member", async () => {
    const outsideMember = { ...mockTeamMembers[0], id: 99, full_name: "Carol Diaz", email: "carol@example.com" };
    server.use(
      http.get("/api/v1/team/members/", () =>
        HttpResponse.json({ results: [...mockTeamMembers, outsideMember], count: mockTeamMembers.length + 1 })
      )
    );
    await renderPage();
    const section = await getSection();
    await waitFor(() => within(section).getByRole("button", { name: "All" }));
    const bar = getViewBar(section);
    expect(within(bar).getByRole("button", { name: "Alice Smith" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Bob Jones" })).toBeInTheDocument();
    expect(within(bar).queryByRole("button", { name: "Carol Diaz" })).not.toBeInTheDocument();
  });

  it("default All view shows all action items in the kanban", async () => {
    await renderPage();
    const section = await getSection();
    await waitFor(() => within(section).getByText("Alice task"));
    expect(within(section).getByText("Bob task")).toBeInTheDocument();
    expect(within(section).getByText("Unassigned task")).toBeInTheDocument();
  });

  it("member filter shows only that member's items in the kanban", async () => {
    await renderPage();
    const section = await getSection();
    await waitFor(() => within(section).getByText("Alice task"));

    fireEvent.click(within(section).getByRole("button", { name: "Alice Smith" }));

    expect(within(section).getByText("Alice task")).toBeInTheDocument();
    expect(within(section).queryByText("Bob task")).not.toBeInTheDocument();
    expect(within(section).queryByText("Unassigned task")).not.toBeInTheDocument();
  });

  it("Unassigned filter shows only items with no assignee", async () => {
    await renderPage();
    const section = await getSection();
    await waitFor(() => within(section).getByText("Unassigned task"));

    fireEvent.click(within(getViewBar(section)).getByRole("button", { name: "Unassigned" }));

    expect(within(section).getByText("Unassigned task")).toBeInTheDocument();
    expect(within(section).queryByText("Alice task")).not.toBeInTheDocument();
    expect(within(section).queryByText("Bob task")).not.toBeInTheDocument();
  });

  it("multi-select: selecting two members shows items for both", async () => {
    await renderPage();
    const section = await getSection();
    await waitFor(() => within(section).getByText("Alice task"));

    fireEvent.click(within(section).getByRole("button", { name: "Alice Smith" }));
    fireEvent.click(within(section).getByRole("button", { name: "Bob Jones" }));

    expect(within(section).getByText("Alice task")).toBeInTheDocument();
    expect(within(section).getByText("Bob task")).toBeInTheDocument();
    expect(within(section).queryByText("Unassigned task")).not.toBeInTheDocument();
  });

  it("All button resets member filter and shows all items", async () => {
    await renderPage();
    const section = await getSection();
    await waitFor(() => within(section).getByText("Alice task"));

    fireEvent.click(within(section).getByRole("button", { name: "Alice Smith" }));
    expect(within(section).queryByText("Bob task")).not.toBeInTheDocument();

    fireEvent.click(within(section).getByRole("button", { name: "All" }));
    expect(within(section).getByText("Bob task")).toBeInTheDocument();
    expect(within(section).getByText("Unassigned task")).toBeInTheDocument();
  });

  it("Before Next Meeting shows split layout with due-before label and Other items column", async () => {
    registerHandlers([itemBeforeMeeting, itemAfterMeeting]);
    await renderPage();
    const section = await getSection();
    await waitFor(() => within(section).getByRole("button", { name: "Before Next Meeting" }));

    fireEvent.click(within(section).getByRole("button", { name: "Before Next Meeting" }));

    expect(within(section).getByText(/Due on or before: Q3 Review/)).toBeInTheDocument();
    expect(within(section).getByText("Other items")).toBeInTheDocument();
  });

  it("Before Next Meeting button is hidden when no future meeting exists", async () => {
    server.use(
      http.get("/api/v1/airtable/meetings/", () =>
        HttpResponse.json({ results: [{ ...mockMeetingFuture, date: "2025-01-01" }] })
      )
    );
    await renderPage();
    const section = await getSection();
    await waitFor(() => within(section).getByRole("button", { name: "All" }));
    expect(within(section).queryByRole("button", { name: "Before Next Meeting" })).not.toBeInTheDocument();
  });

  it("New creation form appears in the compound column", async () => {
    await renderPage();
    const section = await getSection();
    await waitFor(() => within(section).getByText("New"));
    expect(within(section).getByText("New")).toBeInTheDocument();
  });
});
