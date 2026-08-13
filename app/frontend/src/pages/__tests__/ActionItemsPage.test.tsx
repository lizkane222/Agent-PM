import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";

// ResizeObserver is not available in jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// TipTap's Placeholder extension calls elementFromPoint which jsdom lacks
vi.mock("../../components/action-items/ActionItemDescriptionEditor", () => ({
  default: ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => (
    <textarea
      data-testid="description-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  ),
  plainToHtml: (text: string) => text,
}));

// ── Export context mock ───────────────────────────────────────────────────────
// Mutable so individual tests can enable export mode before rendering.
let mockExportMode = false;
const mockToggleItem = vi.fn();
const mockIsSelected = vi.fn(() => false);

vi.mock("../../context/ExportContext", () => ({
  ExportProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useExport: () => ({
    exportMode: mockExportMode,
    items: [],
    toggleMode: vi.fn(),
    toggleItem: mockToggleItem,
    isSelected: mockIsSelected,
    clearItems: vi.fn(),
    count: 0,
  }),
}));

// ── Other cross-cutting mocks ─────────────────────────────────────────────────

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

vi.mock("../../assets/icons/Checklist.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/Corporate.svg?react", () => ({ default: () => null }));

// ── Mock data ─────────────────────────────────────────────────────────────────

const mockItem = {
  id: 1,
  airtable_id: "recAAA001",
  account: 1,
  account_name: "Acme Corp",
  task: "Fix billing issue",
  task_details: "See ticket #42",
  status: "Open",
  priority: "High",
  due_date: "2026-08-01",
  estimated_time: 0,
  time_spent: 0,
  prep_time: 0,
  slack_thread_url: "",
  salesforce_task_id: "",
  assignee_airtable_id: "",
  assignee_name: "Alice",
  reminder: null,
  reminder_id: null,
  reminder_due_at: null,
  reminder_status: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  marked_done_at: null,
  last_synced: "",
};

function registerBaseHandlers() {
  server.use(
    http.get("/api/v1/airtable/action-items/", () =>
      HttpResponse.json([mockItem])
    ),
    http.get("/api/v1/airtable/accounts/", () =>
      HttpResponse.json({ results: [{ id: 1, airtable_id: "recACCT1", name: "Acme Corp" }], count: 1 })
    ),
    http.get("/api/v1/accounts/accounts/", () =>
      HttpResponse.json({ results: [], count: 0 })
    ),
    http.get("/api/v1/team/profiles/me/", () =>
      new HttpResponse(null, { status: 404 })
    ),
    http.get("/api/v1/team/members/", () =>
      HttpResponse.json({ results: [], count: 0 })
    ),
    http.get("/api/v1/airtable/action-items/field-options/", () =>
      HttpResponse.json({ status: ["Open", "In Progress", "Done", "Blocked", "Backlogged"], priority: ["Low", "Medium", "High", "Critical"] })
    ),
    http.get("/api/v1/airtable/action-items/next-meeting-at/", () =>
      HttpResponse.json({ next_meeting_at: null })
    )
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function renderPage() {
  const { default: ActionItemsPage } = await import("../ActionItemsPage");
  render(
    <MemoryRouter>
      <ActionItemsPage />
    </MemoryRouter>
  );
}

/**
 * Renders the page while fake timers are active so the blankCount useEffect's
 * `setTimeout(() => setAllItems([blank]), 0)` is frozen during the initial
 * act() flush.  Real timers are restored immediately after — vi.useRealTimers()
 * discards all pending fake-clock entries, so the frozen timeout is gone and
 * waitFor() works normally.  Without this, MSW's instant responses cause
 * load() to complete (microtask) before the setTimeout macrotask fires, and
 * the fire-after-load race permanently resets allItems to blank-only.
 */
async function renderPageStable() {
  vi.useFakeTimers();
  await renderPage();
  vi.useRealTimers();
}

/**
 * Renders the page inside AppErrorProvider so that reportError() calls
 * actually populate the error banner (role="alert").  Without the provider,
 * reportError is a no-op and no banner ever renders.
 */
async function renderPageStableWithErrors() {
  const [{ default: ActionItemsPage }, { AppErrorProvider }] = await Promise.all([
    import("../ActionItemsPage"),
    import("../../context/AppErrorContext"),
  ]);
  vi.useFakeTimers();
  render(
    <MemoryRouter>
      <AppErrorProvider>
        <ActionItemsPage />
      </AppErrorProvider>
    </MemoryRouter>
  );
  vi.useRealTimers();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ActionItemsPage", () => {
  beforeEach(() => {
    mockExportMode = false;
    mockToggleItem.mockClear();
    mockIsSelected.mockReturnValue(false);
    vi.resetModules();
    localStorage.clear();
    registerBaseHandlers();
  });

  afterEach(() => {
    // Restore real timers in case a test activated fake timers.
    vi.useRealTimers();
  });

  it("renders loading state initially", async () => {
    server.use(
      http.get("/api/v1/airtable/action-items/", async () => {
        await new Promise((r) => setTimeout(r, 50));
        return HttpResponse.json([mockItem]);
      })
    );
    await renderPage();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/loading/i)).not.toBeInTheDocument());
  });

  it("renders kanban zones after data loads", async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText("Stage Today")).toBeInTheDocument());
    expect(screen.getByText("Currently Tracking")).toBeInTheDocument();
    expect(screen.getByText("Unstaged")).toBeInTheDocument();
  });

  it("renders the accounts kanban with the loaded item in the Accounts zone", async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText("Accounts")).toBeInTheDocument());
    // "Acme Corp" appears as both the account group header and the item badge.
    expect(screen.getAllByText("Acme Corp").length).toBeGreaterThan(0);
  });

  it("StatusBoardView: export overlay appears on items when exportMode is on", async () => {
    mockExportMode = true;

    await renderPageStable();
    // Wait for the Accounts zone to appear
    await waitFor(() => expect(screen.getByText("Accounts")).toBeInTheDocument());

    // Switch to "By Status" view
    fireEvent.click(screen.getByRole("button", { name: "By Status" }));

    // The item task text should be visible in the status board
    await waitFor(() => expect(screen.getByText("Fix billing issue")).toBeInTheDocument());

    // The export overlay button should be in the DOM
    const overlayButtons = screen.getAllByRole("button").filter((btn) =>
      btn.style.position === "absolute"
    );
    expect(overlayButtons.length).toBeGreaterThan(0);
  });

  it("StatusBoardView: clicking export overlay calls toggleItem, not onExpand", async () => {
    mockExportMode = true;

    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Accounts")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "By Status" }));
    await waitFor(() => expect(screen.getByText("Fix billing issue")).toBeInTheDocument());

    // Scope to the specific item wrapper to avoid picking up overlay buttons
    // from the always-visible Unstaged/Stage-Today zones (blank cards).
    const itemText = screen.getByText("Fix billing issue");
    const wrapper = itemText.closest("[style*='position: relative']") as HTMLElement;
    const overlayButton = wrapper?.querySelector("button[style*='position: absolute']") as HTMLButtonElement;
    expect(overlayButton).toBeTruthy();
    fireEvent.click(overlayButton);

    expect(mockToggleItem).toHaveBeenCalledWith(
      expect.objectContaining({
        id: `action_item:${mockItem.airtable_id}`,
        type: "action_item",
        label: mockItem.task,
      })
    );
    // Detail modal should NOT have opened (no "Update status" text visible)
    expect(screen.queryByText("Update status")).not.toBeInTheDocument();
  });

  it("DueDateView: export overlay appears on items when exportMode is on", async () => {
    mockExportMode = true;

    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Accounts")).toBeInTheDocument());

    // Switch to "By Due Date" view
    fireEvent.click(screen.getByRole("button", { name: "By Due Date" }));

    await waitFor(() => expect(screen.getByText("Fix billing issue")).toBeInTheDocument());

    const overlayButtons = screen.getAllByRole("button").filter((btn) =>
      btn.style.position === "absolute"
    );
    expect(overlayButtons.length).toBeGreaterThan(0);
  });

  it("DueDateView: clicking export overlay calls toggleItem", async () => {
    mockExportMode = true;

    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Accounts")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "By Due Date" }));
    await waitFor(() => expect(screen.getByText("Fix billing issue")).toBeInTheDocument());

    // Scope to the specific item wrapper (same reason as the StatusBoardView test).
    const itemText = screen.getByText("Fix billing issue");
    const wrapper = itemText.closest("[style*='position: relative']") as HTMLElement;
    const overlayButton = wrapper?.querySelector("button[style*='position: absolute']") as HTMLButtonElement;
    expect(overlayButton).toBeTruthy();
    fireEvent.click(overlayButton);

    expect(mockToggleItem).toHaveBeenCalledWith(
      expect.objectContaining({
        id: `action_item:${mockItem.airtable_id}`,
        type: "action_item",
      })
    );
  });

  it("no export overlay when exportMode is off", async () => {
    mockExportMode = false;

    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Accounts")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "By Status" }));
    await waitFor(() => expect(screen.getByText("Fix billing issue")).toBeInTheDocument());

    const overlayButtons = screen.getAllByRole("button").filter((btn) =>
      btn.style.position === "absolute"
    );
    expect(overlayButtons.length).toBe(0);
  });

  // ── Local-draft (blank card) tests ───────────────────────────────────────────

  it("blank cards are present in the Unstaged zone after load", async () => {
    await renderPageStable();
    await waitFor(() =>
      expect(screen.getAllByPlaceholderText("Name or short description").length).toBeGreaterThan(0)
    );
  });

  it("saving a blank card fires POST to create an action item", async () => {
    let postBody: unknown = null;
    server.use(
      http.post("/api/v1/airtable/action-items/", async ({ request }) => {
        postBody = await request.json();
        return HttpResponse.json({ ...mockItem, airtable_id: "recNEW001", id: 2 }, { status: 201 });
      })
    );
    await renderPageStable();
    await waitFor(() =>
      expect(screen.getAllByPlaceholderText("Name or short description").length).toBeGreaterThan(0)
    );

    fireEvent.change(screen.getAllByPlaceholderText("Name or short description")[0], {
      target: { value: "My new task" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);

    await waitFor(() => expect(postBody).not.toBeNull());
    expect((postBody as { task: string }).task).toBe("My new task");
  });

  it("inline save replaces local-draft item after POST success", async () => {
    // Return both items from GET after the POST fires so the refetch shows the promoted item.
    let serverItems = [mockItem];
    server.use(
      http.get("/api/v1/airtable/action-items/", () => HttpResponse.json(serverItems)),
      http.post("/api/v1/airtable/action-items/", () => {
        const promoted = { ...mockItem, airtable_id: "recNEW001", id: 2, task: "My new task" };
        serverItems = [mockItem, promoted];
        return HttpResponse.json(promoted, { status: 201 });
      })
    );
    await renderPageStable();
    await waitFor(() =>
      expect(screen.getAllByPlaceholderText("Name or short description").length).toBeGreaterThan(0)
    );

    fireEvent.change(screen.getAllByPlaceholderText("Name or short description")[0], {
      target: { value: "My new task" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);

    // After promotion + refetch, the task text appears in the accounts zone compact card.
    await waitFor(() => expect(screen.getByText("My new task")).toBeInTheDocument());
  });

  it("promotion API error shows error banner", async () => {
    server.use(
      http.post("/api/v1/airtable/action-items/", () => new HttpResponse(null, { status: 500 }))
    );
    await renderPageStableWithErrors();
    await waitFor(() =>
      expect(screen.getAllByPlaceholderText("Name or short description").length).toBeGreaterThan(0)
    );

    fireEvent.change(screen.getAllByPlaceholderText("Name or short description")[0], {
      target: { value: "Fail task" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("handleSaveItem API error shows error banner", async () => {
    // Item with no account_name defaults to "today" zone, which renders an inline Save button.
    server.use(
      http.get("/api/v1/airtable/action-items/", () =>
        HttpResponse.json([{ ...mockItem, account: null, account_name: null }])
      ),
      http.patch("/api/v1/airtable/action-items/:airtableId/fields/", () =>
        new HttpResponse(null, { status: 500 })
      )
    );
    await renderPageStableWithErrors();
    await waitFor(() => expect(screen.getByDisplayValue("Fix billing issue")).toBeInTheDocument());

    const realInput = screen.getByDisplayValue("Fix billing issue");
    const card = realInput.closest("[draggable='true']") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  // ── Focus mode ────────────────────────────────────────────────────────────────

  it("Focus button is rendered in the page header", async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText("Stage Today")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^Focus$/i })).toBeInTheDocument();
  });

  it("clicking Focus shows Pinned In Progress section and Exit Focus button", async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText("Stage Today")).toBeInTheDocument());

    expect(screen.queryByText("Pinned In Progress")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Focus$/i }));

    expect(screen.getByText("Pinned In Progress")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /exit focus/i })).toBeInTheDocument();
  });

  it("clicking Exit Focus hides the Pinned In Progress section", async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText("Stage Today")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^Focus$/i }));
    expect(screen.getByText("Pinned In Progress")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /exit focus/i }));
    expect(screen.queryByText("Pinned In Progress")).not.toBeInTheDocument();
  });

  it("pin button on Stage Today card pins item to Pinned In Progress", async () => {
    // Item with no account defaults to "today" zone where pin buttons appear
    server.use(
      http.get("/api/v1/airtable/action-items/", () =>
        HttpResponse.json([{ ...mockItem, account: null, account_name: null }])
      )
    );
    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Stage Today")).toBeInTheDocument());

    // Enter focus mode to reveal pin buttons
    fireEvent.click(screen.getByRole("button", { name: /^Focus$/i }));
    expect(screen.getByText("Pinned In Progress")).toBeInTheDocument();

    // Pin buttons are in the DOM (opacity controlled by CSS hover, still accessible)
    const pinButton = screen.getByTitle("Pin to Focus");
    fireEvent.click(pinButton);

    // Pinned count label should update
    await waitFor(() => expect(screen.getByText("1 pinned")).toBeInTheDocument());

    // Unpin button visible on the pinned card
    expect(screen.getByTitle("Unpin")).toBeInTheDocument();
    // Pin badge now shows permanently on the original card
    expect(screen.getByTitle("Pinned to Focus")).toBeInTheDocument();
  });

  it("unpinning from Pinned In Progress removes item from section", async () => {
    server.use(
      http.get("/api/v1/airtable/action-items/", () =>
        HttpResponse.json([{ ...mockItem, account: null, account_name: null }])
      )
    );
    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Stage Today")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^Focus$/i }));
    fireEvent.click(screen.getByTitle("Pin to Focus"));
    await waitFor(() => expect(screen.getByText("1 pinned")).toBeInTheDocument());

    // Unpin via the Pinned section's unpin button
    fireEvent.click(screen.getByTitle("Unpin"));
    await waitFor(() => expect(screen.queryByText("1 pinned")).not.toBeInTheDocument());
    expect(screen.queryByTitle("Unpin")).not.toBeInTheDocument();
  });

  // ── Right-click context menus ─────────────────────────────────────────────────

  it("right-clicking a KanbanCard shows the context menu", async () => {
    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Accounts")).toBeInTheDocument());

    // The compact accounts-zone card for the loaded item should be in the DOM
    const taskText = screen.getByText("Fix billing issue");
    fireEvent.contextMenu(taskText);

    expect(screen.getByText("Open details")).toBeInTheDocument();
    expect(screen.getByText("Mark as Done")).toBeInTheDocument();
    expect(screen.getByText("Copy task name")).toBeInTheDocument();
    expect(screen.getByText("Add comment")).toBeInTheDocument();
  });

  it("Escape closes the KanbanCard context menu", async () => {
    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Accounts")).toBeInTheDocument());

    fireEvent.contextMenu(screen.getByText("Fix billing issue"));
    expect(screen.getByText("Open details")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Open details")).not.toBeInTheDocument());
  });

  it("right-clicking a StatusBoard card shows the context menu", async () => {
    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Accounts")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "By Status" }));
    await waitFor(() => expect(screen.getByText("Fix billing issue")).toBeInTheDocument());

    fireEvent.contextMenu(screen.getByText("Fix billing issue"));
    expect(screen.getByText("Open details")).toBeInTheDocument();
    expect(screen.getByText("Mark as Done")).toBeInTheDocument();
    expect(screen.getByText("Copy task name")).toBeInTheDocument();
    expect(screen.getByText("Add comment")).toBeInTheDocument();
  });

  it("right-clicking a DueDate card shows the context menu", async () => {
    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Accounts")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "By Due Date" }));
    await waitFor(() => expect(screen.getByText("Fix billing issue")).toBeInTheDocument());

    fireEvent.contextMenu(screen.getByText("Fix billing issue"));
    expect(screen.getByText("Open details")).toBeInTheDocument();
    expect(screen.getByText("Mark as Done")).toBeInTheDocument();
    expect(screen.getByText("Copy task name")).toBeInTheDocument();
    expect(screen.getByText("Add comment")).toBeInTheDocument();
  });
});
