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
vi.mock("../../components/shared/RichTextMentionEditor", () => ({
  default: ({ value, onChange, placeholder, onSubmit }: { value: string; onChange: (v: string) => void; placeholder?: string; onSubmit?: () => void }) => (
    <textarea
      data-testid="description-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && onSubmit) { e.preventDefault(); onSubmit(); }
      }}
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

/** The card root (the draggable wrapper) for the card whose name input holds `taskName`. */
function cardFor(taskName: string): HTMLElement {
  const input = screen.getByDisplayValue(taskName);
  const card = input.closest("[draggable='true']");
  if (!card) throw new Error(`no draggable card wrapping "${taskName}"`);
  return card as HTMLElement;
}

/**
 * The panel element for a zone, found by walking up from its header text.
 *
 * Matches only the `<p>` header: the same label also appears as a `<span>` pill on the
 * Views grid's ghost cards ("this item is staged elsewhere"), which would otherwise make
 * the lookup ambiguous.
 */
function zonePanel(label: string): HTMLElement {
  const header = screen.getAllByText(label).find((el) => el.tagName === "P");
  if (!header) throw new Error(`no zone header found for "${label}"`);
  // Walk up to the DropZone root, which is the drop target carrying the rounded card bg.
  let el: HTMLElement | null = header;
  while (el && !el.className.includes("shadow-blue-md")) el = el.parentElement;
  if (!el) throw new Error(`no panel found for zone "${label}"`);
  return el;
}

const stageTodayPanel = () => zonePanel("Stage Today");

/** The Pinned In Progress container. */
function pinnedSection(): HTMLElement {
  let el: HTMLElement | null = screen.getByText("Pinned In Progress");
  while (el && !el.className.includes("bg-violet-50")) el = el.parentElement;
  if (!el) throw new Error("Pinned In Progress section not found");
  return el;
}

/**
 * The card root inside the Pinned In Progress section for `taskName`.
 *
 * Pinned cards use the standard card body, which renders the task as text rather than an
 * editable input, so `cardFor` (which searches by display value) cannot find them.
 */
function pinnedCardFor(taskName: string): HTMLElement {
  const label = within(pinnedSection()).getByText(taskName);
  const card = label.closest("[draggable='true']");
  if (!card) throw new Error(`no pinned card wrapping "${taskName}"`);
  return card as HTMLElement;
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

  it("Pinned In Progress sits below the Unstaged / Stage Today / Currently Tracking row", async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText("Stage Today")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^Focus$/i }));

    const section = screen.getByText("Pinned In Progress");
    for (const zoneLabel of ["Unstaged", "Stage Today", "Currently Tracking"]) {
      const zone = screen.getByText(zoneLabel);
      // DOCUMENT_POSITION_PRECEDING on the section means the zone comes first in the DOM.
      expect(section.compareDocumentPosition(zone) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    }
  });

  it("clicking Exit Focus hides the Pinned In Progress section", async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText("Stage Today")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^Focus$/i }));
    expect(screen.getByText("Pinned In Progress")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /exit focus/i }));
    expect(screen.queryByText("Pinned In Progress")).not.toBeInTheDocument();
  });

  it("right-click Pin to Focus hoists the card into Pinned In Progress", async () => {
    // Item with no account defaults to the "today" zone (compact card layout)
    server.use(
      http.get("/api/v1/airtable/action-items/", () =>
        HttpResponse.json([{ ...mockItem, account: null, account_name: null }])
      )
    );
    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Stage Today")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^Focus$/i }));
    const stagePanel = stageTodayPanel();
    expect(within(stagePanel).getByDisplayValue("Fix billing issue")).toBeInTheDocument();

    fireEvent.contextMenu(cardFor("Fix billing issue"));
    fireEvent.click(screen.getByText("Pin to Focus"));

    await waitFor(() => expect(screen.getByText("1 pinned")).toBeInTheDocument());

    // Single-mount: the card now lives in the Pinned section and nowhere else, so its
    // unsaved form state can't be duplicated across two mounted cards.
    expect(within(pinnedSection()).getByText("Fix billing issue")).toBeInTheDocument();
    expect(within(stageTodayPanel()).queryByDisplayValue("Fix billing issue")).not.toBeInTheDocument();
    expect(screen.getByTitle("Pinned to Focus")).toBeInTheDocument();
  });

  it("pinned cards are card-width and laid out in a wrapping row", async () => {
    server.use(
      http.get("/api/v1/airtable/action-items/", () => HttpResponse.json([ITEM_A, ITEM_B]))
    );
    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Stage Today")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^Focus$/i }));

    for (const task of ["Alpha task", "Beta task"]) {
      fireEvent.contextMenu(cardFor(task));
      fireEvent.click(screen.getByText("Pin to Focus"));
    }
    await waitFor(() => expect(screen.getByText("2 pinned")).toBeInTheDocument());

    // A wrapping row, not one full-width card per line.
    const row = pinnedCardFor("Alpha task").parentElement!.parentElement!;
    expect(row.className).toContain("flex-wrap");
    expect(row.className).not.toContain("flex-col");

    // Each card is constrained to the app's standard card width rather than the
    // container's width.
    for (const task of ["Alpha task", "Beta task"]) {
      expect(pinnedCardFor(task).parentElement!.className).toContain("w-44");
    }
  });

  it("the pinned card shows name, account and status in the standard card body", async () => {
    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Stage Today")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^Focus$/i }));
    // mockItem has an account, so it lives in the Views zone and renders the standard card.
    fireEvent.contextMenu(screen.getByText("Fix billing issue"));
    fireEvent.click(screen.getByText("Pin to Focus"));
    await waitFor(() => expect(screen.getByText("1 pinned")).toBeInTheDocument());

    const pinned = pinnedSection();
    expect(within(pinned).getByText("Fix billing issue")).toBeInTheDocument();
    expect(within(pinned).getByText("Acme Corp")).toBeInTheDocument();
    expect(within(pinned).getByText("Open")).toBeInTheDocument();
    // Plus the pill saying which zone it actually lives in.
    expect(within(pinned).getByText("Views")).toBeInTheDocument();
  });

  it("right-click Unpin from Focus returns the card to its zone", async () => {
    server.use(
      http.get("/api/v1/airtable/action-items/", () =>
        HttpResponse.json([{ ...mockItem, account: null, account_name: null }])
      )
    );
    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Stage Today")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^Focus$/i }));
    fireEvent.contextMenu(cardFor("Fix billing issue"));
    fireEvent.click(screen.getByText("Pin to Focus"));
    await waitFor(() => expect(screen.getByText("1 pinned")).toBeInTheDocument());

    // Unpin from the card itself — the menu label has flipped.
    fireEvent.contextMenu(pinnedCardFor("Fix billing issue"));
    fireEvent.click(screen.getByText("Unpin from Focus"));

    await waitFor(() => expect(screen.queryByText("1 pinned")).not.toBeInTheDocument());
    expect(within(stageTodayPanel()).getByDisplayValue("Fix billing issue")).toBeInTheDocument();
    expect(screen.queryByTitle("Pinned to Focus")).not.toBeInTheDocument();
  });

  it("pins are written to the shared actionFocusPins key", async () => {
    server.use(
      http.get("/api/v1/airtable/action-items/", () =>
        HttpResponse.json([{ ...mockItem, account: null, account_name: null }])
      )
    );
    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Stage Today")).toBeInTheDocument());

    fireEvent.contextMenu(cardFor("Fix billing issue"));
    fireEvent.click(screen.getByText("Pin to Focus"));

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("actionFocusPins") ?? "[]")).toEqual(["recAAA001"])
    );
  });

  it("does not offer Pin to Focus on an unstaged blank card", async () => {
    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Unstaged")).toBeInTheDocument());

    // Blank cards carry throwaway local-* ids that promoteBlankItem replaces, so pinning
    // one would orphan the pin forever.
    const blank = screen.getByPlaceholderText("Name or short description");
    const card = blank.closest("[draggable='true']") as HTMLElement;
    fireEvent.contextMenu(card);

    expect(screen.getByText("Open details")).toBeInTheDocument();
    expect(screen.queryByText("Pin to Focus")).not.toBeInTheDocument();
  });

  it("the old inline pin emoji is gone from every card", async () => {
    server.use(
      http.get("/api/v1/airtable/action-items/", () =>
        HttpResponse.json([{ ...mockItem, account: null, account_name: null }])
      )
    );
    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Stage Today")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^Focus$/i }));
    expect(document.body.textContent).not.toContain("📌");
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
    expect(screen.getByText("Pin to Focus")).toBeInTheDocument();
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
    expect(screen.getByText("Pin to Focus")).toBeInTheDocument();
  });

  // ── Checklist in the expanded card modal ──────────────────────────────────────

  it("the expanded card modal shows the checklist", async () => {
    server.use(
      http.get("/api/v1/airtable/steps/", () =>
        HttpResponse.json([
          { id: 1, action_item: 1, title: "Step one", status: "Done", order: 0, created_at: "2026-08-18T00:00:00Z" },
          { id: 2, action_item: 1, title: "Step two", status: "Open", order: 1, created_at: "2026-08-18T00:00:00Z" },
        ])
      )
    );
    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Fix billing issue")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Fix billing issue"));
    await waitFor(() => expect(screen.getByText("Edit Action Item")).toBeInTheDocument());

    expect(screen.getByText("Checklist")).toBeInTheDocument();
    expect(screen.getByText("Step one")).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("puts the checklist in its own section right below the description", async () => {
    server.use(http.get("/api/v1/airtable/steps/", () => HttpResponse.json([])));
    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Fix billing issue")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Fix billing issue"));
    await waitFor(() => expect(screen.getByText("Edit Action Item")).toBeInTheDocument());

    const modal = screen.getByText("Edit Action Item").closest("div.bg-white") as HTMLElement;
    const description = within(modal).getAllByTestId("description-editor")[0];
    const checklist = within(modal).getByText("Checklist");

    // Checklist follows the description, and sits above the status/priority pill row.
    expect(description.compareDocumentPosition(checklist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(description.contains(checklist)).toBe(false);
  });

  it("the description placeholder no longer mentions steps", async () => {
    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Stage Today")).toBeInTheDocument());

    expect(screen.queryByPlaceholderText(/steps/i)).not.toBeInTheDocument();
  });

  // ── Per-card collapse ─────────────────────────────────────────────────────────

  it("collapsing a Stage Today card keeps title, status and account visible", async () => {
    server.use(
      http.get("/api/v1/airtable/action-items/", () =>
        HttpResponse.json([{ ...mockItem, account: null, account_name: null }])
      )
    );
    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Stage Today")).toBeInTheDocument());

    const panel = stageTodayPanel();
    // Expanded: the editor and the Save button are present.
    expect(within(panel).getByTestId("description-editor")).toBeInTheDocument();

    fireEvent.click(within(panel).getByTitle("Collapse card"));

    const collapsed = stageTodayPanel();
    expect(within(collapsed).getByText("Fix billing issue")).toBeInTheDocument();
    expect(within(collapsed).getByText("Open")).toBeInTheDocument();
    expect(within(collapsed).queryByTestId("description-editor")).not.toBeInTheDocument();
    expect(within(collapsed).queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(within(collapsed).getByTitle("Expand card")).toBeInTheDocument();
  });

  it("a collapsed card still shows its account", async () => {
    // mockItem has an account but lives in the Views zone, so stage it first. That also
    // puts a "Stage Today" ghost pill in the Views grid, hence the more specific anchor.
    localStorage.setItem("actionItemZones", JSON.stringify({ recAAA001: "today" }));
    await renderPageStable();
    await waitFor(() => expect(screen.getByDisplayValue("Fix billing issue")).toBeInTheDocument());

    const panel = stageTodayPanel();
    fireEvent.click(within(panel).getByTitle("Collapse card"));

    const collapsed = stageTodayPanel();
    expect(within(collapsed).getByText("Fix billing issue")).toBeInTheDocument();
    expect(within(collapsed).getByText("Acme Corp")).toBeInTheDocument();
    expect(within(collapsed).getByText("Open")).toBeInTheDocument();
  });

  it("expanding a collapsed card restores the full body", async () => {
    server.use(
      http.get("/api/v1/airtable/action-items/", () =>
        HttpResponse.json([{ ...mockItem, account: null, account_name: null }])
      )
    );
    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Stage Today")).toBeInTheDocument());

    fireEvent.click(within(stageTodayPanel()).getByTitle("Collapse card"));
    expect(within(stageTodayPanel()).queryByTestId("description-editor")).not.toBeInTheDocument();

    fireEvent.click(within(stageTodayPanel()).getByTitle("Expand card"));
    expect(within(stageTodayPanel()).getByTestId("description-editor")).toBeInTheDocument();
  });

  it("card collapse persists so it survives navigation", async () => {
    server.use(
      http.get("/api/v1/airtable/action-items/", () =>
        HttpResponse.json([{ ...mockItem, account: null, account_name: null }])
      )
    );
    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Stage Today")).toBeInTheDocument());

    fireEvent.click(within(stageTodayPanel()).getByTitle("Collapse card"));

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("actionItemCardCollapsed-v1") ?? "[]"))
        .toEqual(["recAAA001"])
    );
  });

  it("a collapsed card is still draggable and still right-clickable", async () => {
    server.use(
      http.get("/api/v1/airtable/action-items/", () =>
        HttpResponse.json([{ ...mockItem, account: null, account_name: null }])
      )
    );
    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Stage Today")).toBeInTheDocument());

    fireEvent.click(within(stageTodayPanel()).getByTitle("Collapse card"));

    const card = within(stageTodayPanel()).getByText("Fix billing issue")
      .closest("[draggable='true']") as HTMLElement;
    expect(card).toBeTruthy();

    fireEvent.contextMenu(card);
    expect(screen.getByText("Pin to Focus")).toBeInTheDocument();
    expect(screen.getByText("Open details")).toBeInTheDocument();
  });

  it("Currently Tracking cards are collapsible too", async () => {
    localStorage.setItem("actionItemZones", JSON.stringify({ recAAA001: "active" }));
    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Currently Tracking")).toBeInTheDocument());

    const panel = zonePanel("Currently Tracking");
    fireEvent.click(within(panel).getByTitle("Collapse card"));

    const collapsed = zonePanel("Currently Tracking");
    expect(within(collapsed).getByText("Fix billing issue")).toBeInTheDocument();
    expect(within(collapsed).getByTitle("Expand card")).toBeInTheDocument();
  });

  it("Pinned In Progress cards are collapsible too", async () => {
    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Stage Today")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^Focus$/i }));
    fireEvent.contextMenu(screen.getByText("Fix billing issue"));
    fireEvent.click(screen.getByText("Pin to Focus"));
    await waitFor(() => expect(screen.getByText("1 pinned")).toBeInTheDocument());

    fireEvent.click(within(pinnedSection()).getByTitle("Collapse card"));

    const pinned = pinnedSection();
    expect(within(pinned).getByText("Fix billing issue")).toBeInTheDocument();
    expect(within(pinned).getByText("Acme Corp")).toBeInTheDocument();
    expect(within(pinned).getByText("Open")).toBeInTheDocument();
    expect(within(pinned).getByTitle("Expand card")).toBeInTheDocument();
  });

  it("Views grid cards have no collapse toggle", async () => {
    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Fix billing issue")).toBeInTheDocument());

    // Per-card collapse is scoped to the staging columns and the pinned row; the Views grid
    // collapses by account row instead.
    const viewsPanel = zonePanel("Views");
    expect(within(viewsPanel).queryByTitle("Collapse card")).not.toBeInTheDocument();
  });

  // ── Collapse all ──────────────────────────────────────────────────────────────

  // The account name appears both in the row header and on each card's account badge, so
  // these tests key off the header's collapse toggle rather than the bare text.
  const acmeToggle = () => screen.getByTitle(/(Collapse|Expand) Acme Corp/i);

  it("Collapse all hides every account row body and flips its own label", async () => {
    await renderPageStable();
    await waitFor(() => expect(acmeToggle()).toBeInTheDocument());

    // Expanded: the account's card is on screen.
    expect(screen.getByText("Fix billing issue")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /collapse all/i }));

    // Headers stay, bodies go.
    expect(screen.getByTitle(/Expand Acme Corp/i)).toBeInTheDocument();
    expect(screen.getByTitle(/Expand No Account/i)).toBeInTheDocument();
    expect(screen.queryByText("Fix billing issue")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /expand all/i })).toBeInTheDocument();
  });

  it("Collapse all persists the canonical group keys", async () => {
    await renderPageStable();
    await waitFor(() => expect(acmeToggle()).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /collapse all/i }));

    const stored: string[] = JSON.parse(localStorage.getItem("actionItemsCollapsedAccounts-v1") ?? "[]");
    // Lowercased account name, so the Views grid and Projects view agree on one key.
    expect(stored).toContain("acme corp");
    expect(stored).toContain("__none__");
  });

  it("Expand all re-expands the rows", async () => {
    await renderPageStable();
    await waitFor(() => expect(acmeToggle()).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /collapse all/i }));
    expect(screen.queryByText("Fix billing issue")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /expand all/i }));
    expect(screen.getByText("Fix billing issue")).toBeInTheDocument();
  });

  it("collapsing a single row shows its open count and keeps the bulk button on Collapse all", async () => {
    await renderPageStable();
    await waitFor(() => expect(acmeToggle()).toBeInTheDocument());

    fireEvent.click(screen.getByTitle(/Collapse Acme Corp/i));

    expect(screen.queryByText("Fix billing issue")).not.toBeInTheDocument();
    expect(screen.getByText("1 open")).toBeInTheDocument();
    // The No Account row is untouched, so the bulk button still offers "Collapse all".
    expect(screen.getByRole("button", { name: /collapse all/i })).toBeInTheDocument();
  });

  it("collapse state survives a switch to Projects view and back", async () => {
    await renderPageStable();
    await waitFor(() => expect(acmeToggle()).toBeInTheDocument());

    fireEvent.click(screen.getByTitle(/Collapse Acme Corp/i));
    expect(screen.queryByText("Fix billing issue")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    // Same shared store keyed on the canonical name, so the group is collapsed here too.
    await waitFor(() => expect(screen.getByText("1 open")).toBeInTheDocument());
    expect(screen.queryByText("Fix billing issue")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Accounts" }));
    await waitFor(() => expect(acmeToggle()).toBeInTheDocument());
    expect(screen.queryByText("Fix billing issue")).not.toBeInTheDocument();
  });

  // ── Drag to reorder within Stage Today ────────────────────────────────────────

  const ITEM_A = { ...mockItem, id: 1, airtable_id: "recAAA", task: "Alpha task", account: null, account_name: null };
  const ITEM_B = { ...mockItem, id: 2, airtable_id: "recBBB", task: "Beta task", account: null, account_name: null };

  /** jsdom's getBoundingClientRect returns all zeros, so every hover would read as
   *  "drop above". Give each card wrapper a real 100px-tall box. */
  function stubCardRects() {
    return vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 100, height: 100, left: 0, right: 200, width: 200, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
  }

  const DT = () => ({ setDragImage: vi.fn(), setData: vi.fn(), getData: vi.fn(() => ""), effectAllowed: "", dropEffect: "", types: [] });

  /**
   * Dispatch a dragover carrying real pointer coordinates.
   *
   * fireEvent.dragOver cannot be used here: jsdom does not implement DragEvent, so RTL
   * falls back to a plain Event and silently drops clientY — the handler would then read
   * `undefined` and always resolve to "insert below". A MouseEvent named "dragover" is
   * picked up by React's root listener and keeps its coordinates.
   */
  function dragOverAt(target: HTMLElement, clientY: number) {
    const ev = new MouseEvent("dragover", { bubbles: true, cancelable: true, clientY });
    Object.defineProperty(ev, "dataTransfer", { value: DT() });
    fireEvent(target, ev);
  }

  function stagedTaskOrder(): string[] {
    return within(stageTodayPanel())
      .getAllByPlaceholderText("Name or short description")
      .map((el) => (el as HTMLInputElement).value);
  }

  it("dropping a card above another reorders Stage Today and persists the order", async () => {
    server.use(
      http.get("/api/v1/airtable/action-items/", () => HttpResponse.json([ITEM_A, ITEM_B]))
    );
    await renderPageStable();
    await waitFor(() => expect(screen.getByDisplayValue("Alpha task")).toBeInTheDocument());

    expect(stagedTaskOrder()).toEqual(["Alpha task", "Beta task"]);

    const rects = stubCardRects();
    try {
      const beta = cardFor("Beta task");
      fireEvent.dragStart(beta, { dataTransfer: DT() });
      // Hover the top half of Alpha's wrapper → "insert above Alpha".
      dragOverAt(cardFor("Alpha task").parentElement!, 10);
      fireEvent.drop(stageTodayPanel(), { dataTransfer: DT() });

      await waitFor(() => expect(stagedTaskOrder()).toEqual(["Beta task", "Alpha task"]));
      expect(JSON.parse(localStorage.getItem("actionItemOrder") ?? "{}").today)
        .toEqual(["recBBB", "recAAA"]);
    } finally {
      rects.mockRestore();
    }
  });

  it("an item with no recorded order sorts below ordered ones", async () => {
    localStorage.setItem("actionItemOrder", JSON.stringify({ today: ["recBBB"] }));
    server.use(
      http.get("/api/v1/airtable/action-items/", () => HttpResponse.json([ITEM_A, ITEM_B]))
    );
    await renderPageStable();
    await waitFor(() => expect(screen.getByDisplayValue("Alpha task")).toBeInTheDocument());

    expect(stagedTaskOrder()).toEqual(["Beta task", "Alpha task"]);
  });

  it("adopts a new order from another tab via a storage event", async () => {
    server.use(
      http.get("/api/v1/airtable/action-items/", () => HttpResponse.json([ITEM_A, ITEM_B]))
    );
    await renderPageStable();
    await waitFor(() => expect(screen.getByDisplayValue("Alpha task")).toBeInTheDocument());
    expect(stagedTaskOrder()).toEqual(["Alpha task", "Beta task"]);

    fireEvent(window, new StorageEvent("storage", {
      key: "actionItemOrder",
      newValue: JSON.stringify({ today: ["recBBB", "recAAA"] }),
    }));

    await waitFor(() => expect(stagedTaskOrder()).toEqual(["Beta task", "Alpha task"]));
  });

  it("reordering within Currently Tracking fires no status PATCH and no calendar event", async () => {
    // Both items already in the active zone.
    localStorage.setItem("actionItemZones", JSON.stringify({ recAAA: "active", recBBB: "active" }));
    const statusCalls: string[] = [];
    const eventCalls: string[] = [];
    server.use(
      http.get("/api/v1/airtable/action-items/", () => HttpResponse.json([ITEM_A, ITEM_B])),
      http.patch("/api/v1/airtable/action-items/:airtableId/status/", ({ params }) => {
        statusCalls.push(String(params.airtableId));
        return HttpResponse.json(ITEM_A);
      }),
      http.post("/api/v1/scheduler/events/", async ({ request }) => {
        eventCalls.push(String(request.url));
        return HttpResponse.json({ id: 99 });
      })
    );
    await renderPageStable();
    await waitFor(() => expect(screen.getByDisplayValue("Alpha task")).toBeInTheDocument());

    const rects = stubCardRects();
    try {
      fireEvent.dragStart(cardFor("Beta task"), { dataTransfer: DT() });
      dragOverAt(cardFor("Alpha task").parentElement!, 10);
      fireEvent.drop(zonePanel("Currently Tracking"), { dataTransfer: DT() });

      await waitFor(() =>
        expect(JSON.parse(localStorage.getItem("actionItemOrder") ?? "{}").active)
          .toEqual(["recBBB", "recAAA"])
      );
      // A same-zone drop is a reorder, not a re-entry into "In Progress".
      expect(statusCalls).toEqual([]);
      expect(eventCalls).toEqual([]);
    } finally {
      rects.mockRestore();
    }
  });

  // ── Display completeness ──────────────────────────────────────────────────────

  it("rescues an item stranded in a zone that no longer renders", async () => {
    // Older builds could leave "complete" behind; no panel renders it.
    localStorage.setItem("actionItemZones", JSON.stringify({ recAAA001: "complete" }));
    await renderPageStable();

    await waitFor(() => expect(screen.getByText("Fix billing issue")).toBeInTheDocument());
    expect(JSON.parse(localStorage.getItem("actionItemZones") ?? "{}").recAAA001).toBe("accounts");
  });

  it("shows items whose account matches no known account under an Unmatched row", async () => {
    server.use(
      http.get("/api/v1/airtable/action-items/", () =>
        HttpResponse.json([{ ...mockItem, account: 99, account_name: "Ghost Industries" }])
      )
    );
    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Unmatched account")).toBeInTheDocument());

    // Without the catch-all row this card would render nowhere at all.
    expect(screen.getByText("Fix billing issue")).toBeInTheDocument();
  });

  it("requests both account lists with a widened page_size", async () => {
    const requested: string[] = [];
    server.use(
      http.get("/api/v1/airtable/accounts/", ({ request }) => {
        requested.push(request.url);
        return HttpResponse.json({ results: [{ id: 1, airtable_id: "recACCT1", name: "Acme Corp" }], count: 1 });
      }),
      http.get("/api/v1/accounts/accounts/", ({ request }) => {
        requested.push(request.url);
        return HttpResponse.json({ results: [], count: 0 });
      })
    );
    await renderPageStable();
    await waitFor(() => expect(screen.getByTitle(/Collapse Acme Corp/i)).toBeInTheDocument());

    // Both endpoints are paginated at 50 by default; the grid needs every account or it
    // silently hides the items belonging to the ones it didn't fetch.
    expect(requested).toHaveLength(2);
    for (const url of requested) expect(url).toContain("page_size=500");
  });

  // ── Cross-account drops ───────────────────────────────────────────────────────
  // Moving a card from an account you have expanded to one you have collapsed, in both
  // account-grouped views. "Beta Inc" deliberately owns no items, so it is also the
  // zero-item case: an account you have never filed work under is exactly when you need
  // it to be a drop target.

  describe("dragging an action item to another account", () => {
    /** Bodies of every account PATCH the page sent, in order. */
    let fieldPatches: Array<Record<string, unknown>>;

    beforeEach(() => {
      fieldPatches = [];
      server.use(
        http.get("/api/v1/airtable/accounts/", () =>
          HttpResponse.json({
            results: [
              { id: 1, airtable_id: "recACCT1", name: "Acme Corp" },
              { id: 2, airtable_id: "recACCT2", name: "Beta Inc" },
            ],
            count: 2,
          })
        ),
        http.patch("/api/v1/airtable/action-items/:id/fields/", async ({ request, params }) => {
          const body = (await request.json()) as Record<string, unknown>;
          fieldPatches.push({ ...body, __id: params.id });
          return HttpResponse.json({ ...mockItem, ...body });
        })
      );
    });

    /** Collapse account groups by key before the page mounts. */
    async function collapseGroups(...keys: string[]) {
      const { reloadAccountGroupCollapse, ACCOUNT_COLLAPSE_KEY } =
        await import("../../hooks/useAccountGroupCollapse");
      localStorage.setItem(ACCOUNT_COLLAPSE_KEY, JSON.stringify(keys));
      // No storage event fires in the document that wrote, so the module-level store has
      // to be told to re-read.
      reloadAccountGroupCollapse();
    }

    /** The Views-grid row (or Projects-view group card) containing `el`. */
    function rowContaining(el: HTMLElement, marker: string): HTMLElement {
      let node: HTMLElement | null = el;
      while (node && !node.className.includes(marker)) node = node.parentElement;
      if (!node) throw new Error(`no ancestor matching "${marker}"`);
      return node;
    }

    /** The Views-grid card for `taskName` — its cards render the task as text, not an input. */
    function gridCardFor(taskName: string): HTMLElement {
      const card = screen.getByText(taskName).closest("[draggable='true']");
      if (!card) throw new Error(`no draggable card for "${taskName}"`);
      return card as HTMLElement;
    }

    /**
     * Dispatch a dragleave that actually carries `relatedTarget`.
     *
     * The same trap as `dragOverAt`: jsdom has no `DragEvent`, so RTL falls back to a plain
     * `Event` and silently drops `relatedTarget` — every dragleave would then read as
     * "the pointer left", which is precisely the behaviour under test. `MouseEvent` keeps it.
     */
    function dragLeaveTo(target: HTMLElement, relatedTarget: Node | null) {
      const ev = new MouseEvent("dragleave", { bubbles: true, cancelable: true, relatedTarget });
      Object.defineProperty(ev, "dataTransfer", { value: DT() });
      fireEvent(target, ev);
    }

    function dragCardOnto(card: HTMLElement, target: HTMLElement) {
      fireEvent.dragStart(card, { dataTransfer: DT() });
      fireEvent.dragOver(target, { dataTransfer: DT() });
      fireEvent.drop(target, { dataTransfer: DT() });
    }

    /**
     * Switch to the Projects view.
     *
     * The Views grid's account rows carry a `title` on their collapse toggle and the
     * Projects headers do not, so its absence is the signal that the swap has happened.
     */
    async function switchToProjects() {
      fireEvent.click(screen.getByRole("button", { name: "Projects" }));
      await waitFor(() => {
        expect(screen.queryByTitle(/Collapse Acme Corp/i)).not.toBeInTheDocument();
        expect(screen.queryByTitle(/Expand Beta Inc/i)).not.toBeInTheDocument();
      });
    }

    // ── Views grid ──────────────────────────────────────────────────────────────

    it("files a card under a collapsed account row in the Views grid", async () => {
      await collapseGroups("beta inc");
      await renderPageStable();
      await waitFor(() => expect(screen.getByTitle(/Expand Beta Inc/i)).toBeInTheDocument());

      const betaRow = rowContaining(screen.getByTitle(/Expand Beta Inc/i), "border-b border-gray-100");
      dragCardOnto(gridCardFor("Fix billing issue"), betaRow);

      await waitFor(() => expect(fieldPatches).toHaveLength(1));
      expect(fieldPatches[0]).toMatchObject({ account_name: "Beta Inc", account: 2, __id: "recAAA001" });
    });

    it("shows a drop hint on a collapsed row only while a card is in the air", async () => {
      await collapseGroups("beta inc");
      await renderPageStable();
      await waitFor(() => expect(screen.getByTitle(/Expand Beta Inc/i)).toBeInTheDocument());

      // A collapsed row has always accepted drops but said nothing about it. The hint is
      // drag-only, so the resting grid is unchanged.
      expect(screen.queryAllByTestId("collapsed-drop-hint")).toHaveLength(0);

      fireEvent.dragStart(gridCardFor("Fix billing issue"), { dataTransfer: DT() });
      await waitFor(() => expect(screen.getAllByTestId("collapsed-drop-hint").length).toBeGreaterThan(0));

      const betaRow = rowContaining(screen.getByTitle(/Expand Beta Inc/i), "border-b border-gray-100");
      fireEvent.dragOver(betaRow, { dataTransfer: DT() });
      await waitFor(() =>
        expect(within(betaRow).getByTestId("collapsed-drop-hint")).toHaveTextContent("Drop to file under Beta Inc")
      );
    });

    it("does not PATCH when a card is dropped on the account it is already filed under", async () => {
      await renderPageStable();
      await waitFor(() => expect(screen.getByTitle(/Collapse Acme Corp/i)).toBeInTheDocument());

      const acmeRow = rowContaining(screen.getByTitle(/Collapse Acme Corp/i), "border-b border-gray-100");
      dragCardOnto(gridCardFor("Fix billing issue"), acmeRow);

      // Airtable answers `""` where the app writes null, so a strict field compare would
      // report an unchanged account as changed and fire a pointless write.
      await new Promise((r) => setTimeout(r, 20));
      expect(fieldPatches).toHaveLength(0);
    });

    it("dragging from Stage Today onto another account's row in the Views grid does not reassign it", async () => {
      localStorage.setItem("actionItemZones", JSON.stringify({ recAAA001: "today" }));
      await renderPageStable();
      await waitFor(() => expect(screen.getByDisplayValue("Fix billing issue")).toBeInTheDocument());

      // Acme owns this card; drop it on Beta's row instead — an easy accident, since
      // unstaging and re-filing land on the same grid.
      const betaRow = rowContaining(screen.getByTitle(/Collapse Beta Inc/i), "border-b border-gray-100");
      dragCardOnto(cardFor("Fix billing issue"), betaRow);

      await new Promise((r) => setTimeout(r, 20));
      expect(fieldPatches).toHaveLength(0);
      // Unstaged into Views — it lands under its own account (Acme), not the row it was
      // dropped on. The account picker in the modal is the only way to actually reassign it.
      const acmeRow = rowContaining(screen.getByTitle(/Collapse Acme Corp/i), "border-b border-gray-100");
      await waitFor(() => expect(within(acmeRow).getByText("Fix billing issue")).toBeInTheDocument());
      expect(within(betaRow).queryByText("Fix billing issue")).not.toBeInTheDocument();
      expect(JSON.parse(localStorage.getItem("actionItemZones") ?? "{}").recAAA001).toBe("accounts");
    });

    it("dragging from Currently Tracking onto another account's row in the Views grid does not reassign it", async () => {
      localStorage.setItem("actionItemZones", JSON.stringify({ recAAA001: "active" }));
      await renderPageStable();
      await waitFor(() => expect(screen.getByDisplayValue("Fix billing issue")).toBeInTheDocument());

      const betaRow = rowContaining(screen.getByTitle(/Collapse Beta Inc/i), "border-b border-gray-100");
      dragCardOnto(cardFor("Fix billing issue"), betaRow);

      await new Promise((r) => setTimeout(r, 20));
      expect(fieldPatches).toHaveLength(0);
      const acmeRow = rowContaining(screen.getByTitle(/Collapse Acme Corp/i), "border-b border-gray-100");
      await waitFor(() => expect(within(acmeRow).getByText("Fix billing issue")).toBeInTheDocument());
      expect(JSON.parse(localStorage.getItem("actionItemZones") ?? "{}").recAAA001).toBe("accounts");
    });

    it("keeps the row highlight while the cursor crosses the row's own children", async () => {
      await collapseGroups("beta inc");
      await renderPageStable();
      await waitFor(() => expect(screen.getByTitle(/Expand Beta Inc/i)).toBeInTheDocument());

      fireEvent.dragStart(gridCardFor("Fix billing issue"), { dataTransfer: DT() });
      const label = screen.getByTitle(/Expand Beta Inc/i);
      const betaRow = rowContaining(label, "border-b border-gray-100");

      const hint = () => within(betaRow).getByTestId("collapsed-drop-hint");
      fireEvent.dragOver(betaRow, { dataTransfer: DT() });
      await waitFor(() => expect(hint()).toHaveTextContent("Drop to file under Beta Inc"));

      // dragleave bubbles from every child. Clearing the shared dragOverZone on each
      // crossing re-renders the whole page mid-drag, which reads as a dead drop target.
      dragLeaveTo(label, betaRow);
      expect(hint()).toHaveTextContent("Drop to file under Beta Inc");

      // Genuinely leaving the row still clears it.
      dragLeaveTo(betaRow, document.body);
      await waitFor(() => expect(hint()).toHaveTextContent("Drop here"));
    });

    it("never blanks the grid to a loading screen after a drop", async () => {
      // The post-drop refetch is held open so the loading window is genuinely observable.
      // Without the delay MSW answers inside a microtask and a loud reload would flash and
      // clear before any assertion could see it — the test would pass either way.
      let itemFetches = 0;
      server.use(
        http.get("/api/v1/airtable/action-items/", async () => {
          itemFetches += 1;
          if (itemFetches > 1) await new Promise((r) => setTimeout(r, 250));
          return HttpResponse.json([mockItem]);
        })
      );
      await collapseGroups("beta inc");
      await renderPageStable();
      await waitFor(() => expect(screen.getByTitle(/Expand Beta Inc/i)).toBeInTheDocument());

      // lib/api.ts broadcasts actionItemsUpdated from a response interceptor after every
      // action-item mutation, and this page listens to its own broadcast — so the PATCH
      // used to trigger a full reload that replaced the whole board with "Loading…".
      const betaRow = rowContaining(screen.getByTitle(/Expand Beta Inc/i), "border-b border-gray-100");
      dragCardOnto(gridCardFor("Fix billing issue"), betaRow);

      await waitFor(() => expect(fieldPatches).toHaveLength(1));
      // Wait past the debounce so the refetch is actually in flight, then assert the board
      // is still on screen rather than replaced.
      await waitFor(() => expect(itemFetches).toBe(2));
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
      // The board is still there, and it already shows the result: the card is now counted
      // under Beta Inc, whose collapsed row hides the card itself.
      const collapsedBeta = rowContaining(screen.getByTitle(/Expand Beta Inc/i), "border-b border-gray-100");
      expect(within(collapsedBeta).getByText("1 open")).toBeInTheDocument();
      expect(screen.getByTitle(/Collapse Acme Corp/i)).toBeInTheDocument();
    });

    it("coalesces the reload broadcasts from a single two-field drop", async () => {
      let itemFetches = 0;
      server.use(
        http.get("/api/v1/airtable/action-items/", () => {
          itemFetches += 1;
          return HttpResponse.json([
            mockItem,
            { ...mockItem, id: 2, airtable_id: "recBBB002", account: 2, account_name: "Beta Inc", task: "Beta chore" },
          ]);
        }),
        http.patch("/api/v1/airtable/action-items/:id/status/", async ({ request, params }) => {
          fieldPatches.push({ ...(await request.json() as Record<string, unknown>), __id: params.id });
          return HttpResponse.json({});
        })
      );
      await renderPageStable();
      await waitFor(() => expect(screen.getByTitle(/Collapse Beta Inc/i)).toBeInTheDocument());
      await switchToProjects();
      await waitFor(() => expect(screen.getByText("Beta chore")).toBeInTheDocument());
      const afterMount = itemFetches;

      // A drop on another group's status column PATCHes the account and the status, so two
      // broadcasts arrive back to back. Two overlapping reloads can apply their setAllItems
      // in either order, so collapsing them is a correctness fix, not only a request saving.
      const betaGroup = screen.getByTestId("project-group-beta inc");
      const doneColumn = rowContaining(within(betaGroup).getByText("Done"), "flex flex-col rounded-lg");
      fireEvent.dragStart(screen.getByText("Fix billing issue").closest("[draggable='true']") as HTMLElement, { dataTransfer: DT() });
      fireEvent.drop(doneColumn, { dataTransfer: DT() });

      await waitFor(() => expect(fieldPatches.length).toBeGreaterThanOrEqual(2));
      await new Promise((r) => setTimeout(r, 500));
      expect(itemFetches - afterMount).toBe(1);
    });

    // ── Projects view ───────────────────────────────────────────────────────────

    it("gives every known account a group in the Projects view, even with no items", async () => {
      await renderPageStable();
      await waitFor(() => expect(screen.getByTitle(/Collapse Acme Corp/i)).toBeInTheDocument());
      await switchToProjects();

      // Groups used to be derived from the items alone, so an account with no work on it
      // had no header — and therefore no way to receive the first card filed under it.
      await waitFor(() => expect(screen.getByTestId("project-group-beta inc")).toBeInTheDocument());
      expect(screen.getByTestId("project-group-acme corp")).toBeInTheDocument();
      expect(screen.getByTestId("project-group-__none__")).toBeInTheDocument();

      // An empty group is the header alone — five blank status columns per unused account
      // would bury the ones with work in them.
      const beta = screen.getByTestId("project-group-beta inc");
      expect(within(beta).getByText("Beta Inc")).toBeInTheDocument();
      expect(within(beta).queryByText("In Progress")).not.toBeInTheDocument();
      expect(within(screen.getByTestId("project-group-acme corp")).getByText("In Progress")).toBeInTheDocument();
    });

    it("files a card under a collapsed account group in the Projects view", async () => {
      await collapseGroups("beta inc");
      await renderPageStable();
      await waitFor(() => expect(screen.getByTitle(/Expand Beta Inc/i)).toBeInTheDocument());
      await switchToProjects();
      await waitFor(() => expect(screen.getByText("Beta Inc")).toBeInTheDocument());

      const betaGroup = screen.getByTestId("project-group-beta inc");
      dragCardOnto(screen.getByText("Fix billing issue").closest("[draggable='true']") as HTMLElement, betaGroup);

      await waitFor(() => expect(fieldPatches).toHaveLength(1));
      expect(fieldPatches[0]).toMatchObject({ account_name: "Beta Inc", account: 2, __id: "recAAA001" });
    });

    it("a Projects-view drop from Views/Projects itself still reassigns the account without moving the card out of its zone", async () => {
      localStorage.setItem("actionItemZones", JSON.stringify({ recAAA001: "accounts" }));
      await renderPageStable();
      await waitFor(() => expect(screen.getByTitle(/Collapse Acme Corp/i)).toBeInTheDocument());
      await switchToProjects();
      await waitFor(() => expect(screen.getByText("Beta Inc")).toBeInTheDocument());

      const betaGroup = screen.getByTestId("project-group-beta inc");
      dragCardOnto(screen.getByText("Fix billing issue").closest("[draggable='true']") as HTMLElement, betaGroup);

      await waitFor(() => expect(fieldPatches).toHaveLength(1));
      // Projects renders every real item whatever its zone, so a drop there must not
      // silently yank the card out of its zone.
      expect(JSON.parse(localStorage.getItem("actionItemZones") ?? "{}").recAAA001).toBe("accounts");
    });

    it("a Projects-view drop from Stage Today does not reassign the account", async () => {
      localStorage.setItem("actionItemZones", JSON.stringify({ recAAA001: "today" }));
      await renderPageStable();
      await waitFor(() => expect(screen.getByTitle(/Collapse Acme Corp/i)).toBeInTheDocument());
      await switchToProjects();
      await waitFor(() => expect(screen.getByText("Beta Inc")).toBeInTheDocument());

      const betaGroup = screen.getByTestId("project-group-beta inc");
      dragCardOnto(screen.getByText("Fix billing issue").closest("[draggable='true']") as HTMLElement, betaGroup);

      // An accidental drop on the wrong group while unstaging must not reassign the
      // account — only the modal reassigns an account for a card coming out of Stage
      // Today / Currently Tracking. Zone is untouched too, same as the reassign case.
      await new Promise((r) => setTimeout(r, 20));
      expect(fieldPatches).toHaveLength(0);
      expect(JSON.parse(localStorage.getItem("actionItemZones") ?? "{}").recAAA001).toBe("today");
    });

    it("a Projects-view drop from Currently Tracking does not reassign the account", async () => {
      localStorage.setItem("actionItemZones", JSON.stringify({ recAAA001: "active" }));
      await renderPageStable();
      await waitFor(() => expect(screen.getByTitle(/Collapse Acme Corp/i)).toBeInTheDocument());
      await switchToProjects();
      await waitFor(() => expect(screen.getByText("Beta Inc")).toBeInTheDocument());

      const betaGroup = screen.getByTestId("project-group-beta inc");
      dragCardOnto(screen.getByText("Fix billing issue").closest("[draggable='true']") as HTMLElement, betaGroup);

      await new Promise((r) => setTimeout(r, 20));
      expect(fieldPatches).toHaveLength(0);
      expect(JSON.parse(localStorage.getItem("actionItemZones") ?? "{}").recAAA001).toBe("active");
    });

    it("still reassigns the account when dropped from Unstaged", async () => {
      localStorage.setItem("actionItemZones", JSON.stringify({ recAAA001: "unstaged" }));
      await renderPageStable();
      await waitFor(() => expect(screen.getByTitle(/Collapse Acme Corp/i)).toBeInTheDocument());
      await switchToProjects();
      await waitFor(() => expect(screen.getByText("Beta Inc")).toBeInTheDocument());

      const betaGroup = screen.getByTestId("project-group-beta inc");
      dragCardOnto(screen.getByText("Fix billing issue").closest("[draggable='true']") as HTMLElement, betaGroup);

      // Assigning a blank's first account is the one Unstaged interaction that must
      // still work — it's how a brand-new item gets filed in the first place.
      await waitFor(() => expect(fieldPatches).toHaveLength(1));
      expect(fieldPatches[0]).toMatchObject({ account_name: "Beta Inc", account: 2, __id: "recAAA001" });
    });

    it("a drop on another group's status column sets both the account and the status", async () => {
      // Both groups need an item so both render a status board.
      server.use(
        http.get("/api/v1/airtable/action-items/", () =>
          HttpResponse.json([
            mockItem,
            { ...mockItem, id: 2, airtable_id: "recBBB002", account: 2, account_name: "Beta Inc", task: "Beta chore" },
          ])
        ),
        http.patch("/api/v1/airtable/action-items/:id/status/", async ({ request, params }) => {
          fieldPatches.push({ ...(await request.json() as Record<string, unknown>), __id: params.id });
          return HttpResponse.json({});
        })
      );
      await renderPageStable();
      await waitFor(() => expect(screen.getByTitle(/Collapse Beta Inc/i)).toBeInTheDocument());
      await switchToProjects();
      await waitFor(() => expect(screen.getByText("Beta chore")).toBeInTheDocument());

      const betaGroup = screen.getByTestId("project-group-beta inc");
      const doneColumn = rowContaining(within(betaGroup).getByText("Done"), "flex flex-col rounded-lg");
      const card = screen.getByText("Fix billing issue").closest("[draggable='true']") as HTMLElement;

      fireEvent.dragStart(card, { dataTransfer: DT() });
      fireEvent.drop(doneColumn, { dataTransfer: DT() });

      // Before this, only the status changed — the card kept Acme Corp and so snapped
      // straight back into the group it had been dragged out of.
      await waitFor(() => expect(fieldPatches.length).toBeGreaterThanOrEqual(2));
      expect(fieldPatches).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ account_name: "Beta Inc", account: 2, __id: "recAAA001" }),
          expect.objectContaining({ status: "Done", __id: "recAAA001" }),
        ])
      );
    });
  });
});
