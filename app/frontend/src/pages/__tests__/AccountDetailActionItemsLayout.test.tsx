import React from "react";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockAccount, mockAirtableAccount, mockArtifact, mockCodeArtifact } from "../../test/handlers/accounts";
import { mockTeamMembers } from "../../test/handlers/team";

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

vi.mock("../../lib/appLog", () => ({
  addLog: vi.fn(),
  fetchSharedLogsForResource: vi.fn(async () => []),
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

// TipTap's Placeholder extension calls elementFromPoint which jsdom lacks.
// The stub mirrors the real editor's Enter contract (bare Enter → onSubmit,
// Shift+Enter → newline) so page tests exercise the same keyboard path the
// real component does. The real implementation is covered directly in
// components/shared/__tests__/RichTextMentionEditor.test.tsx.
vi.mock("../../components/shared/RichTextMentionEditor", () => ({
  default: React.forwardRef(({ value, onChange, placeholder, onSubmit, onKeyDownCapture }: { value: string; onChange: (v: string) => void; placeholder?: string; onSubmit?: () => void; onKeyDownCapture?: (e: React.KeyboardEvent) => void }, ref: React.Ref<{ clear: () => void }>) => {
    React.useImperativeHandle(ref, () => ({ clear: () => onChange("") }));
    return (
      <textarea
        data-testid="description-editor"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onKeyDown={(e) => {
          onKeyDownCapture?.(e);
          if (e.key === "Enter" && !e.shiftKey && onSubmit) { e.preventDefault(); onSubmit(); }
        }}
      />
    );
  }),
  plainToHtml: (text: string) => text,
}));


const base = {
  id: 1, airtable_id: "recAAA001", account: 1, account_name: "Acme Corp", task: "Default task",
  task_details: "", status: "Open", priority: "High", due_date: null as string | null,
  estimated_time: 0, time_spent: 0, prep_time: 0, slack_thread_url: "", salesforce_task_id: "",
  assignee_airtable_id: "", assignee_name: "", reminder: null, reminder_id: null, reminder_due_at: null,
  reminder_status: null, linked_meeting: null, linked_meeting_name: null,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", marked_done_at: null, last_synced: "",
};
const items = [
  { ...base, id: 1, airtable_id: "recA1", task: "Alpha task" },
  { ...base, id: 2, airtable_id: "recB2", task: "Beta task" },
];

function register() {
  server.use(
    http.get("/api/v1/accounts/accounts/:id/", () => HttpResponse.json({ ...mockAccount, team_members: [] })),
    http.get("/api/v1/accounts/accounts/:id/notes/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/accounts/:id/calendar-events/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/accounts/:id/reminders/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/accounts/:id/quick-links/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/contacts/", () => HttpResponse.json({ results: [], count: 0 })),
    http.get("/api/v1/accounts/projects/", () => HttpResponse.json({ results: [], count: 0 })),
    http.get("/api/v1/team/members/", () => HttpResponse.json({ results: mockTeamMembers, count: mockTeamMembers.length })),
    http.get("/api/v1/team/profiles/me/", () => new HttpResponse(null, { status: 404 })),
    http.get("/api/v1/airtable/action-items/", () => HttpResponse.json(items)),
    http.get("/api/v1/airtable/meetings/", () => HttpResponse.json({ results: [] })),
    http.get("/api/v1/airtable/accounts/", () => HttpResponse.json({ results: [mockAirtableAccount] })),
    http.get("/api/v1/airtable/action-items/field-options/", () =>
      HttpResponse.json({ status: ["Open", "In Progress", "Done", "Blocked", "Backlogged"], priority: ["Critical", "High", "Medium", "Low"] })),
  );
}

async function renderPage() {
  const { default: AccountDetailPage } = await import("../AccountDetailPage");
  render(
    <MemoryRouter initialEntries={["/accounts/1"]}>
      <Routes><Route path="/accounts/:id" element={<AccountDetailPage />} /></Routes>
    </MemoryRouter>
  );
}

describe("AccountDetailPage action items — layout and search highlight", () => {
  beforeEach(() => { vi.resetModules(); localStorage.clear(); register(); });

  it("puts the New card at the top of the Blocked/Backlogged column", async () => {
    await renderPage();
    const section = await screen.findByTestId("action-items-section");
    await waitFor(() => within(section).getByText("Alpha task"));
    const slot = within(section).getByTestId("kanban-new-slot");
    const column = slot.parentElement as HTMLElement;
    // Same column element holds Blocked and Backlogged, and the slot comes first.
    expect(column.firstElementChild).toBe(slot);
    expect(within(column).getByText("Blocked")).toBeInTheDocument();
    expect(within(column).getByText("Backlogged")).toBeInTheDocument();
    expect(within(slot).getByText("New")).toBeInTheDocument();
    // And it is no longer a fifth grid column.
    expect(column.parentElement!.children).toHaveLength(4);
  });

  it("highlights the search box while it has a value and reverts when emptied", async () => {
    await renderPage();
    const section = await screen.findByTestId("action-items-section");
    await waitFor(() => within(section).getByText("Alpha task"));
    const input = within(section).getByTestId("kanban-search") as HTMLInputElement;
    expect(input.dataset.filtered).toBe("false");
    expect(input.style.boxShadow).toBe("");
    fireEvent.change(input, { target: { value: "alpha" } });
    expect(input.dataset.filtered).toBe("true");
    expect(input.style.boxShadow).toContain("245,158,11");
    expect(input.style.border).toContain("rgb(245, 158, 11)");
    fireEvent.change(input, { target: { value: "   " } });
    expect(input.dataset.filtered).toBe("false");
    expect(input.style.boxShadow).toBe("");
  });
});

describe("AccountDetailPage artifacts — search / sort / group", () => {
  beforeEach(() => {
    vi.resetModules(); localStorage.clear(); register();
    server.use(http.get("/api/v1/accounts/accounts/:id/artifacts/", () => HttpResponse.json([
      { ...mockArtifact, id: 1, name: "Roadmap deck", uploaded_by_username: "alice" },
      { ...mockCodeArtifact, id: 2, name: "Zeta spec", uploaded_by_username: "bob" },
    ])));
  });

  it("filters, sorts and groups the live artifacts panel", async () => {
    await renderPage();
    const search = await screen.findByTestId("artifact-search");
    await screen.findByText("Roadmap deck");
    fireEvent.change(search, { target: { value: "bob" } });
    expect(screen.queryByText("Roadmap deck")).not.toBeInTheDocument();
    expect(screen.getByText("Zeta spec")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "nothing-matches" } });
    expect(screen.getByTestId("artifact-no-match")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Group artifacts"), { target: { value: "creator" } });
    const headings = screen.getAllByTestId("artifact-group-heading").map((h) => h.textContent);
    expect(headings).toEqual(["alice (1)", "bob (1)"]);
  });
});
