import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockAgentSkill, mockPagePin, pagePinsFor } from "../../test/handlers/skills";

// ResizeObserver is not available in jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// TipTap's Placeholder extension calls elementFromPoint which jsdom lacks
vi.mock("../../components/shared/RichTextMentionEditor", () => ({
  default: ({ value, onChange, placeholder, onSubmit, minHeightClassName }: { value: string; onChange: (v: string) => void; placeholder?: string; onSubmit?: () => void; minHeightClassName?: string }) => (
    <textarea
      data-testid="description-editor"
      data-height-class={minHeightClassName}
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

  it("opens on the Accounts view: one group per account, with its item on a status board", async () => {
    await renderPageStable();
    const group = await screen.findByTestId("project-group-acme corp");
    // The name is both the group header and the card's account badge.
    expect(within(group).getAllByText("Acme Corp").length).toBeGreaterThan(0);
    expect(within(group).getByText("Fix billing issue")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accounts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Projects" })).toBeInTheDocument();
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
    // An unedited Save sends nothing (only changed fields are PATCHed), so edit first.
    fireEvent.change(realInput, { target: { value: "Fix billing issue v2" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("card Save sends only edited fields, so a stale time_spent can't overwrite tracked time", async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.get("/api/v1/airtable/action-items/", () =>
        HttpResponse.json([{ ...mockItem, account: null, account_name: null, time_spent: 600 }])
      ),
      http.patch("/api/v1/airtable/action-items/:airtableId/fields/", async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ ...mockItem, task: "Renamed" });
      })
    );
    await renderPageStableWithErrors();
    await waitFor(() => expect(screen.getByDisplayValue("Fix billing issue")).toBeInTheDocument());

    const realInput = screen.getByDisplayValue("Fix billing issue");
    const card = realInput.closest("[draggable='true']") as HTMLElement;
    fireEvent.change(realInput, { target: { value: "Renamed" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ task: "Renamed" });
  });

  it("card Save with no edits sends no request", async () => {
    let patches = 0;
    server.use(
      http.get("/api/v1/airtable/action-items/", () =>
        HttpResponse.json([{ ...mockItem, account: null, account_name: null }])
      ),
      http.patch("/api/v1/airtable/action-items/:airtableId/fields/", () => {
        patches += 1;
        return HttpResponse.json(mockItem);
      })
    );
    await renderPageStableWithErrors();
    await waitFor(() => expect(screen.getByDisplayValue("Fix billing issue")).toBeInTheDocument());
    const card = screen.getByDisplayValue("Fix billing issue").closest("[draggable='true']") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(patches).toBe(0);
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
    // The badge shows on the pinned card (and on its copy in the Accounts view, if it has an account).
    expect(screen.getAllByTitle("Pinned to Focus").length).toBeGreaterThan(0);
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
    await waitFor(() => expect(screen.getByLabelText("Est. Time (min)")).toBeInTheDocument());
    // Standard shared modal: attachment buttons are present.
    for (const name of ["Upload", "Add Link", "+ Artifact"]) {
      expect(screen.getByRole("button", { name: new RegExp(name.replace("+", "\\+")) })).toBeInTheDocument();
    }

    expect(screen.getByText("Checklist")).toBeInTheDocument();
    expect(screen.getByText("Step one")).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("Save in the standard modal PATCHes /airtable/action-items/<id>/fields/", async () => {
    const bodies: Record<string, unknown>[] = [];
    let patchedUrl = "";
    server.use(
      http.patch("/api/v1/airtable/action-items/:id/fields/", async ({ request }) => {
        patchedUrl = new URL(request.url).pathname;
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ ...mockItem, task: "Renamed" });
      })
    );
    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Fix billing issue")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Fix billing issue"));
    await waitFor(() => expect(screen.getByLabelText("Est. Time (min)")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Task"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save changes$/ }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(patchedUrl).toMatch(/\/airtable\/action-items\/[^/]+\/fields\/$/);
    expect(bodies[0]).toMatchObject({ task: "Renamed" });
  });

  it("puts the checklist in its own section right below the description", async () => {
    server.use(http.get("/api/v1/airtable/steps/", () => HttpResponse.json([])));
    await renderPageStable();
    await waitFor(() => expect(screen.getByText("Fix billing issue")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Fix billing issue"));
    await waitFor(() => expect(screen.getByLabelText("Est. Time (min)")).toBeInTheDocument());

    const modal = screen.getByTestId("action-item-modal-panel");
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

  // ── Live Tracking (server-owned timers) ───────────────────────────────────────

  describe("Live Tracking", () => {
    function serveTimers(initiallyRunning: string[] = []) {
      const calls: string[] = [];
      // Stateful like the server, so a refetch after start/stop sees the change.
      const running = new Set(initiallyRunning);
      server.use(
        http.get("/api/v1/airtable/timers/", () =>
          HttpResponse.json({
            results: [...running].map((id) => ({
              id: 1, action_item: id, task: "Alpha task", account_name: null,
              started_at: new Date(Date.now() - 90_000).toISOString(), ended_at: null, seconds: 0, calendar_event: 900,
            })),
          })
        ),
        http.post("/api/v1/airtable/timers/:action/", async ({ params, request }) => {
          const body = (await request.json()) as { airtable_id: string };
          calls.push(`${params.action}:${body.airtable_id}`);
          if (params.action === "start") running.add(body.airtable_id); else running.delete(body.airtable_id);
          if (params.action === "start") {
            return HttpResponse.json({ session: { id: 1, action_item: body.airtable_id, task: "Alpha task", account_name: null, started_at: new Date().toISOString(), ended_at: null, seconds: 0, calendar_event: 900 } }, { status: 201 });
          }
          return HttpResponse.json({
            session: { id: 1, action_item: body.airtable_id, task: "Alpha task", account_name: null, started_at: new Date().toISOString(), ended_at: new Date().toISOString(), seconds: 90, calendar_event: 900 },
            item: { ...ITEM_A, time_spent: 90, tracked_time: 90 },
          });
        }),
        // The old client-side protocol must not come back.
        http.post("/api/v1/airtable/time-logs/", () => { calls.push("time-logs"); return HttpResponse.json({}); }),
        http.post("/api/v1/scheduler/events/", () => { calls.push("create-event"); return HttpResponse.json({ id: 99 }); }),
        http.get("/api/v1/airtable/action-items/", () => HttpResponse.json([ITEM_A])),
      );
      return calls;
    }

    it("Track starts a server timer and makes no client-side calendar or time-log writes", async () => {
      localStorage.setItem("actionItemZones", JSON.stringify({ recAAA: "active" }));
      const calls = serveTimers();
      await renderPageStable();
      await waitFor(() => expect(screen.getByDisplayValue("Alpha task")).toBeInTheDocument());

      fireEvent.click(within(zonePanel("Currently Tracking")).getByRole("button", { name: "Track" }));

      await waitFor(() => expect(calls).toContain("start:recAAA"));
      expect(await within(zonePanel("Currently Tracking")).findByRole("button", { name: "Stop" })).toBeInTheDocument();
      expect(calls).not.toContain("create-event");
      expect(calls).not.toContain("time-logs");
    });

    it("a timer running on the server shows as running after a reload", async () => {
      localStorage.setItem("actionItemZones", JSON.stringify({ recAAA: "active" }));
      serveTimers(["recAAA"]);
      await renderPageStable();
      await waitFor(() => expect(screen.getByText("Currently Tracking")).toBeInTheDocument());
      expect(await within(zonePanel("Currently Tracking")).findByRole("button", { name: "Stop" })).toBeInTheDocument();
      // 90s running — the clock reflects server start time, not when this tab mounted.
      expect(within(zonePanel("Currently Tracking")).getByText(/^0?1:3\d$/)).toBeInTheDocument();
    });

    it("Stop logs via the server and shows the new tracked total", async () => {
      localStorage.setItem("actionItemZones", JSON.stringify({ recAAA: "active" }));
      const calls = serveTimers(["recAAA"]);
      await renderPageStable();
      await waitFor(() => expect(screen.getByText("Currently Tracking")).toBeInTheDocument());
      fireEvent.click(await within(zonePanel("Currently Tracking")).findByRole("button", { name: "Stop" }));
      await waitFor(() => expect(calls).toContain("stop:recAAA"));
      expect(await within(zonePanel("Currently Tracking")).findByRole("button", { name: "Track" })).toBeInTheDocument();
      expect(calls).not.toContain("time-logs");
    });

    it("dragging a running card out of Currently Tracking stops it exactly once", async () => {
      localStorage.setItem("actionItemZones", JSON.stringify({ recAAA: "active" }));
      const calls = serveTimers(["recAAA"]);
      await renderPageStable();
      await waitFor(() => expect(screen.getByText("Currently Tracking")).toBeInTheDocument());
      await within(zonePanel("Currently Tracking")).findByRole("button", { name: "Stop" });

      fireEvent.dragStart(cardFor("Alpha task"), { dataTransfer: DT() });
      fireEvent.drop(zonePanel("Stage Today"), { dataTransfer: DT() });

      await waitFor(() => expect(calls.filter((c) => c.startsWith("stop:"))).toEqual(["stop:recAAA"]));
    });
  });

  // ── Display completeness ──────────────────────────────────────────────────────

  it("rescues an item stranded in a zone that no longer renders", async () => {
    // Older builds could leave "complete" behind; no panel renders it.
    localStorage.setItem("actionItemZones", JSON.stringify({ recAAA001: "complete" }));
    await renderPageStable();

    await waitFor(() => expect(screen.getByText("Fix billing issue")).toBeInTheDocument());
    expect(JSON.parse(localStorage.getItem("actionItemZones") ?? "{}").recAAA001).toBe("accounts");
  });

  it("shows items whose account matches no known account in a group of their own", async () => {
    server.use(
      http.get("/api/v1/airtable/action-items/", () =>
        HttpResponse.json([{ ...mockItem, account: 99, account_name: "Ghost Industries" }])
      )
    );
    await renderPageStable();
    const group = await screen.findByTestId("project-group-ghost industries");

    // Without the catch-all group this card would render nowhere at all.
    expect(within(group).getByText("Fix billing issue")).toBeInTheDocument();
    // It is not a place a card can be filed into, so no star either.
    expect(within(group).queryByRole("button", { name: /auto-assign/i })).not.toBeInTheDocument();
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

    function dragCardOnto(card: HTMLElement, target: HTMLElement) {
      fireEvent.dragStart(card, { dataTransfer: DT() });
      fireEvent.dragOver(target, { dataTransfer: DT() });
      fireEvent.drop(target, { dataTransfer: DT() });
    }

    // ── Accounts view (default) ─────────────────────────────────────────────────



    it("does not PATCH when a card is dropped on the account it is already filed under", async () => {
      await renderPageStable();
      await waitFor(() => expect(screen.getByTitle(/Collapse Acme Corp/i)).toBeInTheDocument());

      const acmeRow = screen.getByTestId("project-group-acme corp");
      dragCardOnto(gridCardFor("Fix billing issue"), acmeRow);

      // Airtable answers `""` where the app writes null, so a strict field compare would
      // report an unchanged account as changed and fire a pointless write.
      await new Promise((r) => setTimeout(r, 20));
      expect(fieldPatches).toHaveLength(0);
    });



    it("dropping on the Views panel itself (not a specific row) still moves the card out of Stage Today", async () => {
      // Every row/deck in the panel calls stopPropagation on its own drop — this is the
      // panel-level fallback for a drop that lands on the header, the padding, or between
      // rows, none of which have their own drop target. Without it, a drop that misses
      // every row silently did nothing and the card never left Stage Today.
      localStorage.setItem("actionItemZones", JSON.stringify({ recAAA001: "today" }));
      await renderPageStable();
      await waitFor(() => expect(screen.getByDisplayValue("Fix billing issue")).toBeInTheDocument());

      const viewsPanel = screen.getByText("Views").closest("div.shadow-blue-md") as HTMLElement;
      dragCardOnto(cardFor("Fix billing issue"), viewsPanel);

      expect(fieldPatches).toHaveLength(0);
      const acmeRow = screen.getByTestId("project-group-acme corp");
      await waitFor(() => expect(within(acmeRow).getByText("Fix billing issue")).toBeInTheDocument());
      expect(JSON.parse(localStorage.getItem("actionItemZones") ?? "{}").recAAA001).toBe("accounts");
    });

    it("dropping directly on an account row does not also trigger the panel-level fallback", async () => {
      // Regression guard for the stopPropagation added alongside the panel fallback above —
      // a row drop must fire exactly once, not once specifically and once generically.
      await renderPageStable();
      await waitFor(() => expect(screen.getByTitle(/Collapse Acme Corp/i)).toBeInTheDocument());

      const betaRow = screen.getByTestId("project-group-beta inc");
      dragCardOnto(gridCardFor("Fix billing issue"), betaRow);

      await waitFor(() => expect(fieldPatches).toHaveLength(1));
      await new Promise((r) => setTimeout(r, 20));
      expect(fieldPatches).toHaveLength(1);
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
      await waitFor(() => expect(screen.getByTestId("project-group-beta inc")).toBeInTheDocument());

      // lib/api.ts broadcasts actionItemsUpdated from a response interceptor after every
      // action-item mutation, and this page listens to its own broadcast — so the PATCH
      // used to trigger a full reload that replaced the whole board with "Loading…".
      const betaRow = screen.getByTestId("project-group-beta inc");
      dragCardOnto(gridCardFor("Fix billing issue"), betaRow);

      await waitFor(() => expect(fieldPatches).toHaveLength(1));
      // Wait past the debounce so the refetch is actually in flight, then assert the board
      // is still on screen rather than replaced.
      await waitFor(() => expect(itemFetches).toBe(2));
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
      // The board is still there, and it already shows the result: the card is now counted
      // under Beta Inc, whose collapsed row hides the card itself.
      const collapsedBeta = screen.getByTestId("project-group-beta inc");
      expect(within(collapsedBeta).getByText("1 open")).toBeInTheDocument();
      expect(screen.getByTestId("project-group-acme corp")).toBeInTheDocument();
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
      await waitFor(() => expect(screen.getByTestId("project-group-beta inc")).toBeInTheDocument());
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

    it("gives every known account a group in the Projects view, even with no items", async () => {
      await renderPageStable();
      await waitFor(() => expect(screen.getByTitle(/Collapse Acme Corp/i)).toBeInTheDocument());

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
      await waitFor(() => expect(screen.getByTestId("project-group-beta inc")).toBeInTheDocument());
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
      await waitFor(() => expect(screen.getByText("Beta Inc")).toBeInTheDocument());

      const betaGroup = screen.getByTestId("project-group-beta inc");
      dragCardOnto(screen.getByText("Fix billing issue").closest("[draggable='true']") as HTMLElement, betaGroup);

      // An accidental drop on the wrong group while unstaging must not reassign the
      // account — only the modal reassigns an account for a card coming out of Stage
      // Today / Currently Tracking. It still leaves Stage Today, though: the whole
      // point of the drag was to unstage, and Projects has no other way to do that.
      await new Promise((r) => setTimeout(r, 20));
      expect(fieldPatches).toHaveLength(0);
      expect(JSON.parse(localStorage.getItem("actionItemZones") ?? "{}").recAAA001).toBe("accounts");
    });

    it("a Projects-view drop from Currently Tracking does not reassign the account", async () => {
      localStorage.setItem("actionItemZones", JSON.stringify({ recAAA001: "active" }));
      await renderPageStable();
      await waitFor(() => expect(screen.getByTitle(/Collapse Acme Corp/i)).toBeInTheDocument());
      await waitFor(() => expect(screen.getByText("Beta Inc")).toBeInTheDocument());

      const betaGroup = screen.getByTestId("project-group-beta inc");
      dragCardOnto(screen.getByText("Fix billing issue").closest("[draggable='true']") as HTMLElement, betaGroup);

      await new Promise((r) => setTimeout(r, 20));
      expect(fieldPatches).toHaveLength(0);
      expect(JSON.parse(localStorage.getItem("actionItemZones") ?? "{}").recAAA001).toBe("accounts");
    });

    it("still reassigns the account when dropped from Unstaged", async () => {
      localStorage.setItem("actionItemZones", JSON.stringify({ recAAA001: "unstaged" }));
      await renderPageStable();
      await waitFor(() => expect(screen.getByTitle(/Collapse Acme Corp/i)).toBeInTheDocument());
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
      await waitFor(() => expect(screen.getByTestId("project-group-beta inc")).toBeInTheDocument());
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

  // ── Accounts view (star) and the Projects view ────────────────────────────────

  describe("Accounts view: the star", () => {
    it("puts the star in the account's header, and clicking it sets the auto-assign account", async () => {
      await renderPageStable();
      const group = await screen.findByTestId("project-group-acme corp");
      const star = within(group).getByRole("button", { name: /auto-assign blank cards to acme corp/i });
      // In the header, not in the board below it.
      expect(within(screen.getByTestId("account-header-acme corp")).getByRole("button", { name: /auto-assign/i })).toBe(star);
      expect(star).toHaveAttribute("aria-pressed", "false");

      fireEvent.click(star);

      expect(localStorage.getItem("actionItemStarredAccount")).toBe("at-1");
      expect(within(group).getByRole("button", { name: /remove auto-assign from acme corp/i })).toHaveAttribute("aria-pressed", "true");

      fireEvent.click(within(group).getByRole("button", { name: /remove auto-assign/i }));
      expect(localStorage.getItem("actionItemStarredAccount")).toBeNull();
    });

    it("starring is not nested inside the collapse toggle (no button in a button)", async () => {
      await renderPageStable();
      const header = await screen.findByTestId("account-header-acme corp");
      for (const b of within(header).getAllByRole("button")) {
        expect(b.querySelector("button")).toBeNull();
      }
    });

    it("the old Mine/Team toggle and Views-grid decks are gone", async () => {
      await renderPageStable();
      await screen.findByTestId("project-group-acme corp");
      expect(screen.queryByRole("button", { name: /^mine$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^team$/i })).not.toBeInTheDocument();
    });
  });

  describe("saved view", () => {
    it.each([["projects"], ["kanban"]])("the old '%s' id opens the Accounts view", async (legacy) => {
      localStorage.setItem("actionItemsView", legacy);
      await renderPageStable();
      await screen.findByTestId("project-group-acme corp");
      expect(screen.queryByTestId("projects-account-acme corp")).not.toBeInTheDocument();
    });

    it("an old 'status' or 'due' id is kept", async () => {
      localStorage.setItem("actionItemsView", "due");
      await renderPageStable();
      await waitFor(() => expect(screen.queryByTestId("project-group-acme corp")).not.toBeInTheDocument());
      expect(screen.queryByText("Stage Today")).toBeInTheDocument();
    });

    it("remembers the chosen view under the new key", async () => {
      await renderPageStable();
      await screen.findByTestId("project-group-acme corp");
      fireEvent.click(screen.getByRole("button", { name: "Projects" }));
      expect(localStorage.getItem("actionItemsView-v2")).toBe("projects");
    });
  });

  describe("Projects view", () => {
    const ITEMS = [
      { ...mockItem, id: 1, airtable_id: "recAAA001", task: "In project", status: "Open" },
      { ...mockItem, id: 2, airtable_id: "recBBB002", task: "In goal", status: "In Progress" },
      { ...mockItem, id: 3, airtable_id: "recCCC003", task: "On both", status: "Done" },
      { ...mockItem, id: 4, airtable_id: "recDDD004", task: "No project yet", status: "Open" },
    ];
    const proj = (over: Record<string, unknown>) => ({
      id: 1, account: 10, name: "", description: "", url: "", position: 0, action_ids: [], meeting_ids: [],
      goal_ids: [], resources: [], sf_data: {}, sf_project_id: "", kind: "project", created_at: "", ...over,
    });
    let projectPatches: Array<{ id: string; body: Record<string, unknown> }>;
    let projects: ReturnType<typeof proj>[];

    beforeEach(() => {
      projectPatches = [];
      projects = [
        proj({ id: 1, name: "Rollout", goal_ids: ["2"], action_ids: ["recAAA001", "recCCC003"] }),
        proj({ id: 2, name: "Hit 90% adoption", kind: "goal", action_ids: ["recBBB002", "recCCC003"] }),
        proj({ id: 3, name: "Second project", position: 1 }),
      ];
      server.use(
        http.get("/api/v1/airtable/action-items/", () => HttpResponse.json(ITEMS)),
        http.get("/api/v1/accounts/accounts/", () =>
          HttpResponse.json({ results: [{ id: 10, company_name: "Acme Corp" }], count: 1 })
        ),
        http.get("/api/v1/accounts/projects/", () =>
          HttpResponse.json({ results: projects, count: projects.length })
        ),
        http.patch("/api/v1/accounts/projects/:id/", async ({ request, params }) => {
          const body = (await request.json()) as Record<string, unknown>;
          projectPatches.push({ id: String(params.id), body });
          const row = projects.find((p) => String(p.id) === params.id)!;
          Object.assign(row, body);
          return HttpResponse.json(row);
        })
      );
    });

    async function openProjects() {
      await renderPageStable();
      await screen.findByTestId("project-group-acme corp");
      fireEvent.click(screen.getByRole("button", { name: "Projects" }));
      return await screen.findByTestId("projects-account-acme corp");
    }

    it("nests account > project > goal > action items, listing an item once", async () => {
      const acme = await openProjects();
      const project = await within(acme).findByTestId("project-1");
      const goal = within(project).getByTestId("goal-2");

      expect(within(project).getByText("Rollout")).toBeInTheDocument();
      expect(within(goal).getByText("Hit 90% adoption")).toBeInTheDocument();
      expect(within(goal).getByText("In goal")).toBeInTheDocument();
      // On the project's own list too, but shown once — under the goal.
      expect(within(goal).getByText("On both")).toBeInTheDocument();
      expect(within(acme).getAllByText("On both")).toHaveLength(1);
      expect(within(project).getByText("In project")).toBeInTheDocument();
      // A project with nothing on it still has its row.
      expect(within(acme).getByTestId("project-3")).toBeInTheDocument();
      // Not on any project: its own bucket.
      expect(within(within(acme).getByTestId("no-project-acme corp")).getByText("No project yet")).toBeInTheDocument();
    });

    it("gives every account a row, and loads all projects in one request", async () => {
      const urls: string[] = [];
      server.use(http.get("/api/v1/accounts/projects/", ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json({ results: projects, count: projects.length });
      }));
      await openProjects();
      expect(urls).toHaveLength(1);
      expect(urls[0]).toContain("page_size=500");
    });

    it("clicking an item opens the usual modal", async () => {
      const acme = await openProjects();
      fireEvent.click(within(acme).getByText("In project"));
      await waitFor(() => expect(screen.getByLabelText("Est. Time (min)")).toBeInTheDocument());
    });

    it("'Project > Status' groups each project's, goal's and 'No project' items under status headings", async () => {
      const acme = await openProjects();
      // By project (default): no status headings.
      expect(within(acme).queryByTestId("status-group-project:1-Open")).not.toBeInTheDocument();

      fireEvent.click(within(acme).getByRole("button", { name: "Project > Status" }));

      expect(within(acme).getByTestId("status-group-project:1-Open")).toHaveTextContent("Open");
      expect(within(within(acme).getByTestId("status-group-project:1-Open")).getByText("In project")).toBeInTheDocument();
      expect(within(within(acme).getByTestId("status-group-goal:2-In Progress")).getByText("In goal")).toBeInTheDocument();
      expect(within(within(acme).getByTestId("status-group-goal:2-Done")).getByText("On both")).toBeInTheDocument();
      expect(within(within(acme).getByTestId("status-group-noproject:acme corp-Open")).getByText("No project yet")).toBeInTheDocument();
      // Still deduplicated.
      expect(within(acme).getAllByText("On both")).toHaveLength(1);
      // The choice is remembered per account.
      expect(JSON.parse(localStorage.getItem("actionItemsProjectsLayout-v1") ?? "{}")["acme corp"]).toBe("project-status");

      fireEvent.click(within(acme).getByRole("button", { name: "By project" }));
      expect(within(acme).queryByTestId("status-group-project:1-Open")).not.toBeInTheDocument();
    });

    function dragRow(taskText: string) {
      const row = screen.getByText(taskText).closest("[draggable='true']") as HTMLElement;
      fireEvent.dragStart(row, { dataTransfer: DT() });
      return row;
    }
    const DT = () => ({ setDragImage: vi.fn(), setData: vi.fn(), getData: vi.fn(() => ""), effectAllowed: "", dropEffect: "", types: [] });

    it("dragging an item onto another project moves it: added there, removed from where it was", async () => {
      const acme = await openProjects();
      dragRow("In project");
      const target = within(within(acme).getByTestId("project-3")).getByText("Second project").closest("[role='button']") as HTMLElement;
      fireEvent.dragOver(target, { dataTransfer: DT() });
      fireEvent.drop(target, { dataTransfer: DT() });

      await waitFor(() => expect(projectPatches).toHaveLength(2));
      expect(projectPatches).toEqual(expect.arrayContaining([
        { id: "3", body: { action_ids: ["recAAA001"] } },
        { id: "1", body: { action_ids: ["recCCC003"] } },
      ]));
      // The view re-reads and shows it under its new project.
      await waitFor(() => expect(within(within(acme).getByTestId("project-3")).getByText("In project")).toBeInTheDocument());
    });

    it("a project drop is handled by the row alone: the panel's catch-all drop does not also run", async () => {
      // The Accounts panel has a native capture-phase listener that unstages any card dropped
      // outside a "specific" target. In a real browser that listener ran first on a project
      // row, cleared the drag, and the row's own handler never fired — the move silently did
      // nothing. (jsdom doesn't flush React between listeners, so the visible symptom can't be
      // reproduced here; the side effect — the card being unstaged — can.)
      localStorage.setItem("actionItemZones", JSON.stringify({ recAAA001: "today" }));
      const acme = await openProjects();
      dragRow("In project");
      const target = within(within(acme).getByTestId("project-3")).getByText("Second project").closest("[role='button']") as HTMLElement;
      fireEvent.dragOver(target, { dataTransfer: DT() });
      fireEvent.drop(target, { dataTransfer: DT() });

      await waitFor(() => expect(projectPatches.length).toBeGreaterThan(0));
      expect(JSON.parse(localStorage.getItem("actionItemZones") ?? "{}").recAAA001).toBe("today");
    });

    it("a drop anywhere inside a project's section counts, and the whole section highlights", async () => {
      const acme = await openProjects();
      dragRow("No project yet");
      const project = within(acme).getByTestId("project-1");
      // Over one of the project's own item rows — nowhere near the title row.
      const insideRow = within(project).getByText("In project");
      fireEvent.dragOver(insideRow, { dataTransfer: DT() });

      // The outer section is outlined, not just its title row.
      expect(project.style.outline).toContain("solid");
      expect(project.style.outline).toContain("#818cf8");
      expect(within(project).getByText("Drop to move here")).toBeInTheDocument();

      fireEvent.drop(insideRow, { dataTransfer: DT() });
      await waitFor(() => expect(projectPatches).toEqual([
        { id: "1", body: { action_ids: ["recAAA001", "recCCC003", "recDDD004"] } },
      ]));
    });

    it("inside a goal, the goal (not its parent project) is the target and the only section highlighted", async () => {
      const acme = await openProjects();
      dragRow("No project yet");
      const project = within(acme).getByTestId("project-1");
      const goal = within(project).getByTestId("goal-2");
      const insideGoal = within(goal).getByText("In goal");
      fireEvent.dragOver(insideGoal, { dataTransfer: DT() });

      expect(goal.style.outline).toContain("solid");
      expect(project.style.outline).toBe("");

      fireEvent.drop(insideGoal, { dataTransfer: DT() });
      await waitFor(() => expect(projectPatches).toEqual([
        { id: "2", body: { action_ids: ["recBBB002", "recCCC003", "recDDD004"] } },
      ]));
    });

    it("leaving a section clears its highlight", async () => {
      const acme = await openProjects();
      dragRow("No project yet");
      const project = within(acme).getByTestId("project-3");
      fireEvent.dragOver(project, { dataTransfer: DT() });
      expect(project.style.outline).toContain("solid");
      fireEvent.dragLeave(project, { relatedTarget: document.body });
      expect(project.style.outline).toBe("");
    });

    it("dropping on the 'No project' row takes the item off every project and goal", async () => {
      const acme = await openProjects();
      dragRow("On both");
      const none = within(acme).getByTestId("no-project-acme corp").querySelector("[role='button']") as HTMLElement;
      fireEvent.dragOver(none, { dataTransfer: DT() });
      fireEvent.drop(none, { dataTransfer: DT() });

      await waitFor(() => expect(projectPatches).toHaveLength(2));
      expect(projectPatches).toEqual(expect.arrayContaining([
        { id: "1", body: { action_ids: ["recAAA001"] } },
        { id: "2", body: { action_ids: ["recBBB002"] } },
      ]));
    });

    it("a project of another account is not a drop target for this item", async () => {
      projects.push(proj({ id: 9, account: 77, name: "Elsewhere" }));
      server.use(
        http.get("/api/v1/accounts/accounts/", () =>
          HttpResponse.json({ results: [{ id: 10, company_name: "Acme Corp" }, { id: 77, company_name: "Beta Inc" }], count: 2 })
        ),
        http.get("/api/v1/airtable/accounts/", () =>
          HttpResponse.json({ results: [{ id: 1, airtable_id: "recACCT1", name: "Acme Corp" }, { id: 2, airtable_id: "recACCT2", name: "Beta Inc" }], count: 2 })
        ),
      );
      const acme = await openProjects();
      dragRow("In project");
      // Acme's rows offer a drop; Beta's project (a different account) does not.
      expect(within(acme).getAllByText("Drop here").length).toBeGreaterThan(0);
      const beta = screen.getByTestId("projects-account-beta inc");
      expect(within(beta).getByText("Elsewhere")).toBeInTheDocument();
      expect(within(beta).queryByText(/drop here/i)).not.toBeInTheDocument();
      const elsewhere = within(beta).getByText("Elsewhere").closest("[role='button']") as HTMLElement;
      fireEvent.dragOver(elsewhere, { dataTransfer: DT() });
      fireEvent.drop(elsewhere, { dataTransfer: DT() });
      await new Promise((r) => setTimeout(r, 30));
      expect(projectPatches).toHaveLength(0);
    });

    it("a failed move says so and changes nothing", async () => {
      server.use(http.patch("/api/v1/accounts/projects/:id/", () => new HttpResponse(null, { status: 403 })));
      const acme = await openProjects();
      dragRow("In project");
      const target = within(within(acme).getByTestId("project-3")).getByText("Second project").closest("[role='button']") as HTMLElement;
      fireEvent.dragOver(target, { dataTransfer: DT() });
      fireEvent.drop(target, { dataTransfer: DT() });
      await new Promise((r) => setTimeout(r, 50));
      expect(within(within(acme).getByTestId("project-1")).getByText("In project")).toBeInTheDocument();
    });
  });

  describe("dragging a card out of Pinned In Progress", () => {
    const DT = () => ({ setDragImage: vi.fn(), setData: vi.fn(), getData: vi.fn(() => ""), effectAllowed: "", dropEffect: "", types: [] });

    async function pinFixBilling() {
      await renderPageStable();
      await waitFor(() => expect(screen.getByText("Stage Today")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: /^Focus$/i }));
      fireEvent.contextMenu(screen.getByText("Fix billing issue"));
      fireEvent.click(screen.getByText("Pin to Focus"));
      await waitFor(() => expect(screen.getByText("1 pinned")).toBeInTheDocument());
    }

    it.each([["Stage Today"], ["Currently Tracking"]])(
      "a pinned card dropped on %s shows up there and leaves the Pinned section",
      async (panel) => {
        await pinFixBilling();
        fireEvent.dragStart(pinnedCardFor("Fix billing issue"), { dataTransfer: DT() });
        fireEvent.drop(zonePanel(panel), { dataTransfer: DT() });

        await waitFor(() =>
          expect(within(zonePanel(panel)).getByDisplayValue("Fix billing issue")).toBeInTheDocument()
        );
        expect(within(pinnedSection()).queryByText("Fix billing issue")).not.toBeInTheDocument();
        // Still pinned, and still mounted exactly once.
        expect(screen.getByText(/1 pinned/)).toBeInTheDocument();
        expect(screen.getAllByDisplayValue("Fix billing issue")).toHaveLength(1);
      }
    );

    it("dragging it back to Views returns it to the Pinned section", async () => {
      await pinFixBilling();
      fireEvent.dragStart(pinnedCardFor("Fix billing issue"), { dataTransfer: DT() });
      fireEvent.drop(stageTodayPanel(), { dataTransfer: DT() });
      await waitFor(() =>
        expect(within(stageTodayPanel()).getByDisplayValue("Fix billing issue")).toBeInTheDocument()
      );

      fireEvent.dragStart(cardFor("Fix billing issue"), { dataTransfer: DT() });
      fireEvent.drop(zonePanel("Views"), { dataTransfer: DT() });
      await waitFor(() =>
        expect(within(pinnedSection()).getByText("Fix billing issue")).toBeInTheDocument()
      );
    });
  });

  describe("long descriptions on cards", () => {
    it("caps the description height and scrolls inside it, in a column card and an Unstaged card", async () => {
      const long = "<ul>" + Array.from({ length: 60 }, (_, i) => `<li>line ${i}</li>`).join("") + "</ul>";
      server.use(
        http.get("/api/v1/airtable/action-items/", () =>
          HttpResponse.json([{ ...mockItem, account: null, account_name: null, task_details: long }])
        )
      );
      await renderPageStable();
      await waitFor(() => expect(screen.getByDisplayValue("Fix billing issue")).toBeInTheDocument());
      // Every description editor on a card (Stage Today's compact card and Unstaged's
      // full card) must cap its height; the stub exposes the class the page passes.
      const editors = screen.getAllByTestId("description-editor");
      expect(editors.length).toBeGreaterThan(0);
      for (const e of editors) {
        expect(e.getAttribute("data-height-class")).toContain("max-h-40");
        expect(e.getAttribute("data-height-class")).toContain("overflow-y-auto");
      }
    });
  });

  describe("export tray open, and the Unstaged column", () => {
    it("shows exactly one New card under Unstaged, even on a wide window", async () => {
      // jsdom is 1024px wide; the old code showed two blanks from 1100px up.
      const prev = window.innerWidth;
      Object.defineProperty(window, "innerWidth", { value: 1600, configurable: true });
      try {
        await assertOneBlank();
      } finally {
        Object.defineProperty(window, "innerWidth", { value: prev, configurable: true });
      }
    });

    async function assertOneBlank() {
      await renderPageStable();
      await waitFor(() =>
        expect(screen.getAllByPlaceholderText("Name or short description").length).toBeGreaterThan(0)
      );
      const blanks = screen.getAllByPlaceholderText("Name or short description")
        .filter((el) => (el as HTMLInputElement).value === "");
      expect(blanks).toHaveLength(1);
    }

    it("keeps a select control on each staged card but never covers the card with a button", async () => {
      mockExportMode = true;
      await renderPageStable();
      const controls = await screen.findAllByTestId("export-select");
      expect(controls.length).toBeGreaterThan(0);
      for (const c of controls) {
        // A small non-<button> corner control: a full-card <button> blocks dragging and
        // is an unreliable drop target.
        expect(c.tagName).not.toBe("BUTTON");
        expect(c.style.inset).toBe("");
        expect(c.style.width).toBe("18px");
      }
    });

    it("selecting does not paint a highlight over the card, and toggles via the control", async () => {
      mockExportMode = true;
      mockIsSelected.mockReturnValue(true);
      try {
        await renderPageStable();
        const controls = await screen.findAllByTestId("export-select");
        expect(controls[0]).toHaveTextContent("✓");
        expect(controls[0].parentElement?.style.background ?? "").toBe("");
        fireEvent.click(controls[0]);
        expect(mockToggleItem).toHaveBeenCalled();
      } finally {
        mockIsSelected.mockReturnValue(false);
      }
    });
  });
});

describe("ActionItemsPage — pinned Claude skills", () => {
  const pinned = () => server.use(pagePinsFor("action-items", [
    mockPagePin({ id: 1, page: "action-items", skill: mockAgentSkill({ id: 1, name: "weekly-update" }) }),
  ]));

  it("shows them in a row at the top, between the title and the existing buttons", async () => {
    pinned();
    await renderPageStable();
    const row = await screen.findByTestId("action-items-skills-row");
    await within(row).findByRole("button", { name: /^Weekly Update/ });
    const title = screen.getByRole("heading", { name: /Action Items/ });
    const refresh = screen.getByRole("button", { name: /Refresh/ });
    expect(title.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.compareDocumentPosition(refresh) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.parentElement).toBe(title.closest("div")!.parentElement);           // same header row as the title
  });

  it("takes the free space between them and scrolls when the buttons are wider than it", async () => {
    await renderPageStable();
    const row = await screen.findByTestId("action-items-skills-row");
    expect(row).toHaveClass("flex-1", "min-w-0", "overflow-x-auto");
  });

  it("centres the buttons when they fit, without clipping the first one when they don't", async () => {
    pinned();
    await renderPageStable();
    const list = await screen.findByTestId("pinned-skills-action-items");
    expect(list).toHaveStyle({ width: "max-content", margin: "0 auto" });
  });

  it("keeps the title from being squeezed", async () => {
    await renderPageStable();
    const title = await screen.findByRole("heading", { name: /Action Items/ });
    expect(title.parentElement).toHaveClass("shrink-0");
  });
});
