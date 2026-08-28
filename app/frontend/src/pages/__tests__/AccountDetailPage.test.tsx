import React from "react";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockAccount, mockAccountNote, mockAirtableAccount, mockProject, mockProjectMember } from "../../test/handlers/accounts";
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

// ── Mock data ─────────────────────────────────────────────────────────────────

/**
 * Always genuinely in the future, and always after `itemBeforeMeeting.due_date` but before
 * `itemAfterMeeting.due_date`. Previously hardcoded to a fixed calendar day, which silently
 * turned the "Before Next Meeting" button off — and these tests red — once that day passed.
 */
function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const FUTURE_MEETING_DATE = daysFromNow(10);

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
  zoom_notes: "",
  zoom_url: "",
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
const itemBeforeMeeting = makeItem({ airtable_id: "recD001", id: 4, task: "Before task", assignee_name: "Alice Smith", due_date: daysFromNow(5) });
const itemAfterMeeting  = makeItem({ airtable_id: "recE002", id: 5, task: "After task",  assignee_name: "Bob Jones",   due_date: daysFromNow(20) });

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

describe("AccountDetailPage — Project Goals", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    registerHandlers();
  });

  it("New Project opens the full Salesforce-field modal, not a single input", async () => {
    await renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /new project/i }));
    expect(screen.getByText("Project Name")).toBeInTheDocument();
    expect(screen.getByText("Salesforce Project ID")).toBeInTheDocument();
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("System Information")).toBeInTheDocument();
    // The old flow was a bare text input with no other fields.
    expect(screen.queryByPlaceholderText("Project name…")).not.toBeInTheDocument();
  });

  it("sends the full field set on create — url and sf_data are no longer dropped", async () => {
    let createdBody: Record<string, unknown> | null = null;
    server.use(
      http.post("/api/v1/accounts/projects/", async ({ request }) => {
        createdBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...mockProject, id: 42, ...createdBody }, { status: 201 });
      }),
    );
    await renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /new project/i }));
    const modal = await screen.findByTestId("project-details-modal");
    const [nameInput, urlInput] = within(modal).getAllByRole("textbox");
    fireEvent.change(nameInput, { target: { value: "Segment Data Deletion" } });
    fireEvent.change(urlInput, { target: { value: "https://salesforce.example.com/proj" } });
    fireEvent.click(within(modal).getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(createdBody).not.toBeNull());
    expect(createdBody!.url).toBe("https://salesforce.example.com/proj");
    expect(createdBody!.action_ids).toEqual([]);
    expect(createdBody!.sf_data).toEqual({});
    expect(createdBody!.kind).toBe("project");
  });

  it("restores url, resources and sf_data on reload instead of blanking them", async () => {
    server.use(
      http.get("/api/v1/accounts/projects/", () => HttpResponse.json({
        results: [{
          ...mockProject, id: 7, name: "Segment Data Deletion",
          url: "https://sf.example.com/proj7",
          resources: [{ id: "artifact-1", label: "Design Doc", url: "https://docs.example.com" }],
          sf_data: { health: "Green" }, sf_project_id: "a0B777",
        }],
        count: 1,
      })),
    );
    await renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Segment Data Deletion/i }));
    expect(screen.getByDisplayValue("https://sf.example.com/proj7")).toBeInTheDocument();
    expect(screen.getByDisplayValue("a0B777")).toBeInTheDocument();
  });

  it("shows a project's team members as avatars on its card without opening the modal", async () => {
    server.use(
      http.get("/api/v1/accounts/projects/", () => HttpResponse.json({
        results: [{ ...mockProject, id: 7, name: "Segment Data Deletion" }], count: 1,
      })),
      http.get("/api/v1/accounts/project-members/", () => HttpResponse.json({
        results: [{ ...mockProjectMember, id: 1, project: 7, team_member_name: "Ashley Shadday" }],
        count: 1, next: null, previous: null,
      })),
    );
    await renderPage();
    await screen.findByRole("button", { name: /Segment Data Deletion/i });
    expect(await screen.findByTitle("Ashley Shadday")).toBeInTheDocument();
  });
});

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

  // ── Column ordering ──────────────────────────────────────────────────────────

  describe("status column ordering", () => {
    /**
     * The status column whose header reads `status`.
     *
     * Anchored on the header's exact class string, not just "font-semibold": every card also
     * renders its own status as a bold pill, so a looser match picks up cards too. And the
     * column is the header's *parent* — going one level higher lands on the grid, whose
     * `within()` then sees every column at once and which has no `onDrop` at all.
     */
    function column(section: HTMLElement, status: string): HTMLElement {
      const header = within(section)
        .getAllByText(status)
        .find((el) => el.className.startsWith("flex items-center gap-1.5 text-xs font-semibold"));
      if (!header) throw new Error(`no kanban header for "${status}"`);
      const col = header.parentElement;
      if (!col) throw new Error(`no column body for "${status}"`);
      return col;
    }

    /** Task names in the order they are rendered inside a column. */
    function tasksIn(section: HTMLElement, status: string, names: string[]): string[] {
      const col = column(section, status);
      return names.filter((n) => within(col).queryByText(n) !== null).sort((a, b) => {
        const ea = within(col).getByText(a);
        const eb = within(col).getByText(b);
        // Node.compareDocumentPosition: 4 == b follows a.
        return ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });
    }

    it("orders Open oldest-first, newest at the bottom", async () => {
      registerHandlers([
        makeItem({ airtable_id: "recN3", id: 3, task: "Newest open", created_at: "2026-03-01T00:00:00Z" }),
        makeItem({ airtable_id: "recN1", id: 1, task: "Oldest open", created_at: "2026-01-01T00:00:00Z" }),
        makeItem({ airtable_id: "recN2", id: 2, task: "Middle open", created_at: "2026-02-01T00:00:00Z" }),
      ]);
      await renderPage();
      const section = await getSection();
      await waitFor(() => within(section).getByText("Oldest open"));

      // The API order is deliberately shuffled; the column must not echo it.
      expect(tasksIn(section, "Open", ["Newest open", "Oldest open", "Middle open"]))
        .toEqual(["Oldest open", "Middle open", "Newest open"]);
    });

    it("orders Done by marked_done_at, not creation order", async () => {
      registerHandlers([
        makeItem({
          airtable_id: "recD1", id: 1, task: "Made first, finished last", status: "Done",
          created_at: "2026-01-01T00:00:00Z", marked_done_at: "2026-06-01T00:00:00Z",
        }),
        makeItem({
          airtable_id: "recD2", id: 2, task: "Made last, finished first", status: "Done",
          created_at: "2026-05-01T00:00:00Z", marked_done_at: "2026-02-01T00:00:00Z",
        }),
      ]);
      await renderPage();
      const section = await getSection();
      await waitFor(() => within(section).getByText("Made first, finished last"));

      expect(tasksIn(section, "Done", ["Made first, finished last", "Made last, finished first"]))
        .toEqual(["Made last, finished first", "Made first, finished last"]);
    });

    it("puts a card dragged into In Progress at the bottom of that column", async () => {
      registerHandlers([
        // Listed first and created long before the item already in the column, so both the
        // raw API order and creation order would put it on top. Arrival order must win.
        makeItem({ airtable_id: "recP2", id: 2, task: "Just moved", status: "Open", created_at: "2020-01-01T00:00:00Z" }),
        makeItem({ airtable_id: "recP1", id: 1, task: "Already running", status: "In Progress", created_at: "2026-01-01T00:00:00Z" }),
      ]);
      server.use(
        http.patch("/api/v1/airtable/action-items/:id/status/", () => HttpResponse.json({}))
      );
      await renderPage();
      const section = await getSection();
      await waitFor(() => within(section).getByText("Just moved"));

      const inProgress = column(section, "In Progress");
      fireEvent.drop(inProgress, {
        dataTransfer: {
          getData: (k: string) => (k === "kanbanItemId" ? "recP2" : ""),
          types: ["kanbanitemid"],
        },
      });

      await waitFor(() => expect(within(inProgress).queryByText("Just moved")).toBeInTheDocument());
      expect(tasksIn(section, "In Progress", ["Already running", "Just moved"]))
        .toEqual(["Already running", "Just moved"]);
    });

    it("keeps two successive drags in the order they were made", async () => {
      registerHandlers([
        makeItem({ airtable_id: "recQ1", id: 1, task: "Dragged second", status: "Open", created_at: "2026-01-01T00:00:00Z" }),
        makeItem({ airtable_id: "recQ2", id: 2, task: "Dragged first", status: "Open", created_at: "2026-02-01T00:00:00Z" }),
      ]);
      server.use(
        http.patch("/api/v1/airtable/action-items/:id/status/", () => HttpResponse.json({}))
      );
      await renderPage();
      const section = await getSection();
      await waitFor(() => within(section).getByText("Dragged first"));

      const blocked = column(section, "Blocked");
      const dropOn = (id: string) =>
        fireEvent.drop(blocked, {
          dataTransfer: { getData: (k: string) => (k === "kanbanItemId" ? id : ""), types: ["kanbanitemid"] },
        });

      dropOn("recQ2");
      await waitFor(() => expect(within(blocked).queryByText("Dragged first")).toBeInTheDocument());
      dropOn("recQ1");
      await waitFor(() => expect(within(blocked).queryByText("Dragged second")).toBeInTheDocument());

      // Creation order would give the reverse; the column is a log of what you moved.
      expect(tasksIn(section, "Blocked", ["Dragged first", "Dragged second"]))
        .toEqual(["Dragged first", "Dragged second"]);
    });
  });

  // ── Accounts not linked to an Airtable record ────────────────────────────────
  //
  // Per-user Admin accounts have a blank airtable_id and are never linked to the shared
  // Airtable "ADMIN" record, but their action items and meetings do live under it. The page
  // used to skip the Airtable fetch entirely for such accounts and render nothing.
  describe("account with no airtable_id", () => {
    const unlinkedAccount: Account = { ...mockAccountWithMembers, airtable_id: "", company_name: "Admin" };

    it("scopes action items and meetings by account_name instead", async () => {
      const scopes: Record<string, string | null> = {};
      server.use(
        http.get("/api/v1/accounts/accounts/:id/", () => HttpResponse.json(unlinkedAccount)),
        http.get("/api/v1/airtable/action-items/", ({ request }) => {
          const url = new URL(request.url);
          scopes.itemsName = url.searchParams.get("account_name");
          scopes.itemsId = url.searchParams.get("account");
          return HttpResponse.json([itemAlice, itemBob]);
        }),
        http.get("/api/v1/airtable/meetings/", ({ request }) => {
          scopes.meetingsName = new URL(request.url).searchParams.get("account_name");
          return HttpResponse.json({ results: [mockMeetingFuture] });
        }),
      );

      await renderPage();
      const section = await getSection();

      // The items actually render — this is the reported symptom.
      await waitFor(() => expect(within(section).getByText("Alice task")).toBeInTheDocument());
      expect(within(section).getByText("Bob task")).toBeInTheDocument();

      // Scoped by name, with no bogus `?account=` on the request.
      expect(scopes.itemsName).toBe("Admin");
      expect(scopes.itemsId).toBeNull();
      expect(scopes.meetingsName).toBe("Admin");
    });

    it("does not request the Airtable account record when there is nothing to look up", async () => {
      let airtableAccountsCalled = false;
      server.use(
        http.get("/api/v1/accounts/accounts/:id/", () => HttpResponse.json(unlinkedAccount)),
        http.get("/api/v1/airtable/accounts/", () => {
          airtableAccountsCalled = true;
          return HttpResponse.json({ results: [] });
        }),
      );

      await renderPage();
      const section = await getSection();
      await waitFor(() => within(section).getByRole("button", { name: "All" }));

      expect(airtableAccountsCalled).toBe(false);
    });

    it("still scopes by airtable_id when the account is linked", async () => {
      // The page issues more than one action-items request (ArtifactsPanel makes its own,
      // scoped by the numeric AirtableAccount PK), so collect them all rather than
      // recording only the last.
      const calls: { id: string | null; name: string | null }[] = [];
      server.use(
        http.get("/api/v1/airtable/action-items/", ({ request }) => {
          const url = new URL(request.url);
          calls.push({ id: url.searchParams.get("account"), name: url.searchParams.get("account_name") });
          return HttpResponse.json([itemAlice]);
        }),
      );

      await renderPage();
      const section = await getSection();
      await waitFor(() => expect(within(section).getByText("Alice task")).toBeInTheDocument());

      expect(calls.some((c) => c.id === "recACME001")).toBe(true);
      // A linked account never falls back to the name scope.
      expect(calls.every((c) => c.name === null)).toBe(true);
    });
  });
});

// ── GET Meeting Notes ─────────────────────────────────────────────────────────

/**
 * The button scans the user's Gong/Zoom recap emails for meetings that have no AI
 * summary yet. It deliberately scans *every* meeting the user can see, not just this
 * account's, so the request must carry no account filter — and it re-reads this
 * account's meetings afterwards so an imported summary appears without a reload.
 */
describe("AccountDetailPage — GET Meeting Notes", () => {
  const SCAN_PATH = "/api/v1/integrations/gmail/meeting-notes/";

  const emptyReport = {
    days: 30,
    account_name: "",
    scanned_emails: 3,
    scanned_meetings: 2,
    updated: [],
    skipped: [],
    errors: [],
    summaries_truncated: false,
    max_summaries: 25,
  };

  beforeEach(() => {
    // vi.resetModules() is not optional here. The kanban block above calls it, which
    // detaches the module instance that test/setup.ts holds a reference to — so its
    // resetRequestCache() then clears a stale copy and the page's live GET cache
    // (lib/requestCache.ts, 10s TTL) survives into the next test. A fresh module graph
    // per test gives each one an empty cache, so the meetings re-read below is really
    // observed at the network layer.
    vi.resetModules();
    localStorage.clear();
    registerHandlers();
  });

  async function clickButton() {
    const button = await screen.findByRole("button", { name: /GET Meeting Notes/i });
    fireEvent.click(button);
    return button;
  }

  /** Find a result row by its combined text — the provider name is its own <span>. */
  function rowMatching(pattern: RegExp): HTMLElement | undefined {
    return within(screen.getByRole("status"))
      .getAllByRole("listitem")
      .find((li) => pattern.test(li.textContent ?? ""));
  }

  it("renders the button in the Timeline header", async () => {
    await renderPage();
    expect(await screen.findByRole("button", { name: /GET Meeting Notes/i })).toBeInTheDocument();
  });

  it("scopes the scan to this account", async () => {
    let body: unknown = "not called";
    server.use(
      http.post(SCAN_PATH, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(emptyReport);
      })
    );

    await renderPage();
    await clickButton();

    // Scoped by airtable_id, not just the display name: a Django company_name that has
    // drifted from its AirtableAccount name would otherwise match nothing.
    await waitFor(() => expect(body).not.toBe("not called"));
    expect(body).toEqual({
      account: mockAirtableAccount.airtable_id,
      account_name: mockAccountWithMembers.company_name,
    });
  });

  it("reports the scan counts when nothing was found", async () => {
    server.use(http.post(SCAN_PATH, () => HttpResponse.json(emptyReport)));

    await renderPage();
    await clickButton();

    expect(await screen.findByText(/No new meeting notes found for Acme Corp/i)).toBeInTheDocument();
    expect(screen.getByText(/3 recap emails against 2 meetings/i)).toBeInTheDocument();
  });

  it("lists each updated meeting with its provider", async () => {
    server.use(
      http.post(SCAN_PATH, () => HttpResponse.json({
        ...emptyReport,
        updated: [{
          meeting_id: 1, airtable_id: "recMTG001", meeting_name: "Q3 Review",
          date: "2026-08-10T10:00:00Z", account_name: "Acme Corp", sources: ["gong"],
        }],
      }))
    );

    await renderPage();
    await clickButton();

    expect(await screen.findByText(/Added notes to 1 meeting/i)).toBeInTheDocument();
    // The provider sits in its own <span> for capitalisation, so match on the row's
    // full text rather than a single text node.
    expect(rowMatching(/Q3 Review.*gong/i)).toBeTruthy();
  });

  it("does not name the account on rows, since every row is this account", async () => {
    server.use(
      http.post(SCAN_PATH, () => HttpResponse.json({
        ...emptyReport,
        updated: [{
          meeting_id: 1, airtable_id: "recMTG001", meeting_name: "Q3 Review",
          date: null, account_name: "Acme Corp", sources: ["zoom"],
        }],
      }))
    );

    await renderPage();
    await clickButton();

    await screen.findByText(/Added notes to 1 meeting/i);
    const row = rowMatching(/Q3 Review/);
    expect(row).toBeTruthy();
    expect(row!.textContent).not.toMatch(/Acme Corp/);
  });

  it("says when the per-run summary limit was reached", async () => {
    server.use(
      http.post(SCAN_PATH, () => HttpResponse.json({
        ...emptyReport, summaries_truncated: true, max_summaries: 25,
      }))
    );

    await renderPage();
    await clickButton();

    expect(await screen.findByText(/Stopped at the per-run limit of 25/i)).toBeInTheDocument();
  });

  it("re-reads this account's meetings so an imported summary shows up", async () => {
    let meetingFetches = 0;
    server.use(
      http.get("/api/v1/airtable/meetings/", () => {
        meetingFetches += 1;
        return HttpResponse.json({ results: [mockMeetingFuture] });
      }),
      http.post(SCAN_PATH, () => HttpResponse.json(emptyReport)),
    );

    await renderPage();
    // Wait for the button (proves the account loaded) before counting: the initial
    // meetings fetch is chained after it and can outlast waitFor's 1s default.
    await screen.findByRole("button", { name: /GET Meeting Notes/i });
    await waitFor(() => expect(meetingFetches).toBeGreaterThan(0), { timeout: 3000 });
    const before = meetingFetches;

    await clickButton();

    // The scan is a POST, which clears the client's GET cache (lib/requestCache.ts),
    // so this really does hit the network rather than replaying the pre-scan response.
    await waitFor(() => expect(meetingFetches).toBeGreaterThan(before), { timeout: 3000 });
  });

  it("shows the backend's message when Gmail is not connected", async () => {
    server.use(
      http.post(SCAN_PATH, () =>
        HttpResponse.json({ detail: "Gmail not connected. Connect Gmail from Settings." }, { status: 400 })
      )
    );

    await renderPage();
    await clickButton();

    expect(await screen.findByRole("alert")).toHaveTextContent(/Gmail not connected/i);
  });

  it("falls back to a generic message when the error has no detail", async () => {
    server.use(http.post(SCAN_PATH, () => new HttpResponse(null, { status: 500 })));

    await renderPage();
    await clickButton();

    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not read Gmail/i);
  });

  it("disables the button while the scan is in flight", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    server.use(
      http.post(SCAN_PATH, async () => {
        await gate;
        return HttpResponse.json(emptyReport);
      })
    );

    await renderPage();
    const button = await clickButton();

    await waitFor(() => expect(button).toBeDisabled());
    expect(screen.getByText(/Checking email…/i)).toBeInTheDocument();

    release?.();
    await waitFor(() => expect(button).not.toBeDisabled());
  });
});

// ── Enter-to-add on note composers ────────────────────────────────────────────

describe("AccountDetailPage — Enter adds a note", () => {
  const NOTES_PATH = "/api/v1/accounts/accounts/:id/notes/";

  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    registerHandlers();
  });

  /** The account-notes draft composer (the only one mounted on page load). */
  async function getComposer() {
    const boxes = await screen.findAllByPlaceholderText(/Add a note/);
    return boxes[0];
  }

  it("renders a note composer", async () => {
    await renderPage();
    expect(await getComposer()).toBeInTheDocument();
  });

  it("POSTs the note when Enter is pressed — no Add click needed", async () => {
    let body: unknown = "not called";
    server.use(
      http.post(NOTES_PATH, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          id: 99, account: 1, author: 1, author_username: "alice", author_display: "Alice",
          content: "Typed with the keyboard", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
        });
      })
    );

    await renderPage();
    const composer = await getComposer();
    fireEvent.change(composer, { target: { value: "Typed with the keyboard" } });
    fireEvent.keyDown(composer, { key: "Enter" });

    await waitFor(() => expect(body).not.toBe("not called"));
    expect(body).toEqual({ content: "Typed with the keyboard" });
  });

  it("does NOT post on Shift+Enter — that inserts a newline", async () => {
    let calls = 0;
    server.use(http.post(NOTES_PATH, () => { calls += 1; return HttpResponse.json(mockAccountNote); }));

    await renderPage();
    const composer = await getComposer();
    fireEvent.change(composer, { target: { value: "Line one" } });
    fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });

    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toBe(0);
  });

  it("does not post an empty note on Enter", async () => {
    let calls = 0;
    server.use(http.post(NOTES_PATH, () => { calls += 1; return HttpResponse.json(mockAccountNote); }));

    await renderPage();
    const composer = await getComposer();
    fireEvent.keyDown(composer, { key: "Enter" });

    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toBe(0);
  });

  it("posts exactly once per Enter press", async () => {
    let calls = 0;
    server.use(
      http.post(NOTES_PATH, () => {
        calls += 1;
        return HttpResponse.json({ ...mockAccountNote, id: 100 + calls, content: "Once" });
      })
    );

    await renderPage();
    const composer = await getComposer();
    fireEvent.change(composer, { target: { value: "Once" } });
    fireEvent.keyDown(composer, { key: "Enter" });

    await waitFor(() => expect(calls).toBe(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toBe(1);
  });
});
