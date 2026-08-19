import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import ActionItemsSidebar from "../ActionItemsSidebar";
import { ACTION_ITEM_ZONES_KEY, reloadActionItemZones } from "../../../hooks/useActionItemZoneSets";
import { FOCUS_PINS_KEY, reloadFocusPins } from "../../../hooks/useFocusPins";
import { DONE_WINDOW_DAYS } from "../../../lib/actionItemSidebarOrder";
import type { AirtableActionItem } from "../../../types";

/**
 * The sidebar's six sections and the filter chip row.
 *
 * The first three sections are positional state (zones + focus pins), the last three are
 * status — so a card's position depends on localStorage as much as on the API payload, and
 * both are set up per test.
 */

vi.mock("../../comments/CommentContext", () => ({
  useCommentContext: () => ({ openComments: vi.fn(), closeComments: vi.fn() }),
  CommentProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../../../hooks/useExportTray", () => ({
  useExportTray: () => ({ addToTray: vi.fn(), isSelected: vi.fn(() => false), exportMode: false }),
}));
vi.mock("../../../context/CurrentUserContext", () => ({
  useCurrentUser: () => null,
  CurrentUserProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../../../assets/icons/Corporate.svg?react", () => ({ default: () => null }));
vi.mock("../../action-items/StepsPanel", () => ({ default: () => null }));

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString();

function item(overrides: Partial<AirtableActionItem> & { airtable_id: string; task: string }): AirtableActionItem {
  return {
    id: Number(overrides.airtable_id.replace(/\D/g, "")) || 1,
    account: null,
    account_name: null,
    task_details: "",
    status: "Open",
    priority: "High",
    due_date: null,
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
    created_at: daysAgo(30),
    updated_at: daysAgo(30),
    marked_done_at: null,
    last_synced: "",
    ...overrides,
  };
}

function serve(items: AirtableActionItem[]) {
  const state = { statusParams: [] as (string | null)[] };
  server.use(
    http.get("/api/v1/airtable/action-items/", ({ request }) => {
      state.statusParams.push(new URL(request.url).searchParams.get("status"));
      return HttpResponse.json(items);
    }),
    http.get("/api/v1/airtable/accounts/", () => HttpResponse.json({ results: [], count: 0 })),
    http.get("/api/v1/team/members/", () => HttpResponse.json({ results: [], count: 0 })),
    http.get("/api/v1/airtable/action-items/field-options/", () =>
      HttpResponse.json({ status: ["Open", "In Progress", "Done", "Blocked", "Backlogged"], priority: ["Low", "Medium", "High", "Critical"] })
    ),
    http.get("/api/v1/scheduler/scheduled-occurrences/", () => HttpResponse.json({ results: [], count: 0 })),
  );
  return state;
}

function setZones(zones: Record<string, string>) {
  localStorage.setItem(ACTION_ITEM_ZONES_KEY, JSON.stringify(zones));
  reloadActionItemZones();
}

function setPins(ids: string[]) {
  localStorage.setItem(FOCUS_PINS_KEY, JSON.stringify(ids));
  reloadFocusPins();
}

/**
 * Section headers are queried by `data-section`, not by their text: "In Progress", "Open" and
 * "Done" all also appear as the status badge on every card, so getByText would be ambiguous.
 */
function section(key: string): HTMLElement | null {
  return document.querySelector(`[data-section="${key}"]`);
}

/** Position in document order, for "this renders above that" assertions. */
function posOf(el: Element): number {
  return Array.from(document.querySelectorAll("*")).indexOf(el);
}

/** Assert a run of elements appears top-to-bottom in the order given. */
function expectOrder(...els: (Element | null)[]) {
  const positions = els.map((el) => {
    expect(el).not.toBeNull();
    return posOf(el!);
  });
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  expect(new Set(positions).size).toBe(positions.length);
}

beforeEach(() => {
  localStorage.clear();
  reloadActionItemZones();
  reloadFocusPins();
});

describe("action items sidebar ordering", () => {
  it("renders the six sections in order, with each card in the right one", async () => {
    setZones({ "rec-1": "active", "rec-2": "today" });
    setPins(["rec-3"]);
    serve([
      item({ airtable_id: "rec-5", task: "An open one", status: "Open" }),
      item({ airtable_id: "rec-6", task: "A done one", status: "Done", marked_done_at: daysAgo(1) }),
      item({ airtable_id: "rec-4", task: "In progress one", status: "In Progress" }),
      item({ airtable_id: "rec-3", task: "A pinned one", status: "Open" }),
      item({ airtable_id: "rec-2", task: "A staged one", status: "Open" }),
      item({ airtable_id: "rec-1", task: "A tracked one", status: "In Progress" }),
    ]);
    render(<ActionItemsSidebar />);
    await waitFor(() => expect(screen.getByText("A tracked one")).toBeInTheDocument());

    expectOrder(
      section("tracking"), screen.getByText("A tracked one"),
      section("staged"), screen.getByText("A staged one"),
      section("pinned"), screen.getByText("A pinned one"),
      section("in_progress"), screen.getByText("In progress one"),
      section("open"), screen.getByText("An open one"),
      section("done"), screen.getByText("A done one"),
    );
    expect(section("tracking")!.textContent).toContain("Currently Tracking");
    expect(section("staged")!.textContent).toContain("Staged Today");
    expect(section("pinned")!.textContent).toContain("Pinned In Progress");
  });

  it("sorts each section newest-first by created_at", async () => {
    serve([
      item({ airtable_id: "rec-1", task: "Oldest", status: "Open", created_at: daysAgo(30) }),
      item({ airtable_id: "rec-2", task: "Newest", status: "Open", created_at: daysAgo(1) }),
      item({ airtable_id: "rec-3", task: "Middle", status: "Open", created_at: daysAgo(10) }),
    ]);
    render(<ActionItemsSidebar />);
    await waitFor(() => expect(screen.getByText("Newest")).toBeInTheDocument());

    expectOrder(screen.getByText("Newest"), screen.getByText("Middle"), screen.getByText("Oldest"));
  });

  it("shows a card that is both tracked and pinned exactly once", async () => {
    setZones({ "rec-1": "active" });
    setPins(["rec-1"]);
    serve([item({ airtable_id: "rec-1", task: "Only once", status: "Open" })]);
    render(<ActionItemsSidebar />);
    await waitFor(() => expect(screen.getByText("Only once")).toBeInTheDocument());

    expect(screen.getAllByText("Only once")).toHaveLength(1);
    expect(section("tracking")).not.toBeNull();
    expect(section("pinned")).toBeNull();
  });

  it("hides a Done item older than the window and keeps a recent one", async () => {
    serve([
      item({ airtable_id: "rec-1", task: "Done recently", status: "Done", marked_done_at: daysAgo(2) }),
      item({
        airtable_id: "rec-2", task: "Done long ago", status: "Done",
        marked_done_at: daysAgo(DONE_WINDOW_DAYS + 5),
      }),
    ]);
    render(<ActionItemsSidebar />);
    await waitFor(() => expect(screen.getByText("Done recently")).toBeInTheDocument());

    expect(screen.queryByText("Done long ago")).not.toBeInTheDocument();
    // The cap is stated, not silent.
    expect(section("done")!.textContent).toContain(`Done · last ${DONE_WINDOW_DAYS} days`);
  });

  it("requests Done alongside the open statuses", async () => {
    const state = serve([item({ airtable_id: "rec-1", task: "Anything", status: "Open" })]);
    render(<ActionItemsSidebar />);
    await waitFor(() => expect(screen.getByText("Anything")).toBeInTheDocument());
    expect(state.statusParams[0]).toBe("Open,In Progress,Done");
  });

  it("renders no section header for an empty group", async () => {
    serve([item({ airtable_id: "rec-1", task: "Just open", status: "Open" })]);
    render(<ActionItemsSidebar />);
    await waitFor(() => expect(screen.getByText("Just open")).toBeInTheDocument());

    expect(section("open")).not.toBeNull();
    for (const key of ["tracking", "staged", "pinned", "in_progress", "done"]) {
      expect(section(key)).toBeNull();
    }
  });

  it("counts the cards in each section header", async () => {
    serve([
      item({ airtable_id: "rec-1", task: "One", status: "Open" }),
      item({ airtable_id: "rec-2", task: "Two", status: "Open" }),
    ]);
    render(<ActionItemsSidebar />);
    await waitFor(() => expect(screen.getByText("One")).toBeInTheDocument());

    expect(section("open")!.textContent).toContain("2");
  });
});

describe("action items sidebar filter flags", () => {
  const dataset = () => serve([
    item({ airtable_id: "rec-1", task: "Tracked card", status: "In Progress" }),
    item({ airtable_id: "rec-2", task: "Staged card", status: "Open" }),
    item({ airtable_id: "rec-3", task: "Pinned card", status: "Open" }),
    item({ airtable_id: "rec-4", task: "Plain in progress", status: "In Progress" }),
    item({ airtable_id: "rec-5", task: "Plain open", status: "Open" }),
    item({ airtable_id: "rec-6", task: "Plain done", status: "Done", marked_done_at: daysAgo(1) }),
  ]);

  function chip(flag: string): HTMLElement {
    return document.querySelector(`[data-flag="${flag}"]`) as HTMLElement;
  }

  beforeEach(() => {
    setZones({ "rec-1": "active", "rec-2": "today" });
    setPins(["rec-3"]);
  });

  it("shows everything with no flag ticked", async () => {
    dataset();
    render(<ActionItemsSidebar />);
    await waitFor(() => expect(screen.getByText("Tracked card")).toBeInTheDocument());

    for (const task of ["Tracked card", "Staged card", "Pinned card", "Plain in progress", "Plain open", "Plain done"]) {
      expect(screen.getByText(task)).toBeInTheDocument();
    }
    expect(chip("tracking")).toHaveAttribute("aria-pressed", "false");
  });

  it("narrows to one flag and back", async () => {
    dataset();
    render(<ActionItemsSidebar />);
    await waitFor(() => expect(screen.getByText("Tracked card")).toBeInTheDocument());

    fireEvent.click(chip("staged"));
    expect(chip("staged")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Staged card")).toBeInTheDocument();
    expect(screen.queryByText("Tracked card")).not.toBeInTheDocument();
    expect(screen.queryByText("Plain open")).not.toBeInTheDocument();

    fireEvent.click(chip("staged"));
    expect(screen.getByText("Tracked card")).toBeInTheDocument();
  });

  it("unions multiple ticked flags", async () => {
    dataset();
    render(<ActionItemsSidebar />);
    await waitFor(() => expect(screen.getByText("Tracked card")).toBeInTheDocument());

    fireEvent.click(chip("staged"));
    fireEvent.click(chip("done"));
    expect(screen.getByText("Staged card")).toBeInTheDocument();
    expect(screen.getByText("Plain done")).toBeInTheDocument();
    expect(screen.queryByText("Plain open")).not.toBeInTheDocument();
  });

  it("reaches a card by status even when it sits in a positional section", async () => {
    // "Open" must find the staged card too, or a flag could only ever match its own section.
    dataset();
    render(<ActionItemsSidebar />);
    await waitFor(() => expect(screen.getByText("Tracked card")).toBeInTheDocument());

    fireEvent.click(chip("open"));
    expect(screen.getByText("Staged card")).toBeInTheDocument();
    expect(screen.getByText("Pinned card")).toBeInTheDocument();
    expect(screen.getByText("Plain open")).toBeInTheDocument();
    // Still rendered under Staged Today, not moved into the Open section.
    expectOrder(section("staged"), screen.getByText("Staged card"));
    // Its status is In Progress, so the Open flag excludes it.
    expect(screen.queryByText("Tracked card")).not.toBeInTheDocument();
  });

  it("clears every flag at once", async () => {
    dataset();
    render(<ActionItemsSidebar />);
    await waitFor(() => expect(screen.getByText("Tracked card")).toBeInTheDocument());

    fireEvent.click(chip("staged"));
    fireEvent.click(chip("pinned"));
    expect(screen.queryByText("Plain open")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Clear"));
    expect(screen.getByText("Plain open")).toBeInTheDocument();
    expect(screen.queryByText("Clear")).not.toBeInTheDocument();
  });

  it("says No matches when the flags exclude everything", async () => {
    setZones({});
    setPins([]);
    dataset();
    render(<ActionItemsSidebar />);
    await waitFor(() => expect(screen.getByText("Plain open")).toBeInTheDocument());

    fireEvent.click(chip("tracking"));
    expect(screen.getByText("No matches.")).toBeInTheDocument();
  });

  it("composes with the text filter", async () => {
    dataset();
    render(<ActionItemsSidebar />);
    await waitFor(() => expect(screen.getByText("Plain open")).toBeInTheDocument());

    fireEvent.click(chip("open"));
    fireEvent.change(screen.getByPlaceholderText("Filter…"), { target: { value: "Plain" } });
    expect(screen.getByText("Plain open")).toBeInTheDocument();
    expect(screen.queryByText("Staged card")).not.toBeInTheDocument();
    expect(screen.queryByText("Plain in progress")).not.toBeInTheDocument();
  });
});
