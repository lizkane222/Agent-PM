import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { server } from "../../../test/msw-server";
import ActionItemsSidebar from "../ActionItemsSidebar";
import ColumnSortButton from "../../account/ColumnSortButton";
import { useColumnSort, sortByMoved } from "../../../hooks/useStatusArrivalOrder";
import { ACTION_ITEM_ZONES_KEY, reloadActionItemZones } from "../../../hooks/useActionItemZoneSets";
import { reloadFocusPins } from "../../../hooks/useFocusPins";
import type { AirtableActionItem } from "../../../types";

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

const DAY = 24 * 60 * 60 * 1000;
const ago = (n: number) => new Date(Date.now() - n * DAY).toISOString();

function item(o: Partial<AirtableActionItem> & { airtable_id: string; task: string }): AirtableActionItem {
  return {
    id: Number(o.airtable_id.replace(/\D/g, "")) || 1, account: null, account_name: null, task_details: "",
    status: "Open", priority: "High", due_date: null, estimated_time: 0, time_spent: 0, prep_time: 0,
    slack_thread_url: "", salesforce_task_id: "", assignee_airtable_id: "", assignee_name: "", reminder: null,
    reminder_id: null, reminder_due_at: null, reminder_status: null, linked_meeting: null, linked_meeting_name: null,
    created_at: ago(30), updated_at: ago(30), marked_done_at: null, last_synced: "", ...o,
  };
}

// A is newer by creation (default order puts it first) but moved long ago; B is the reverse.
const A = item({ airtable_id: "rec-1", task: "Alpha task", created_at: ago(1), status_changed_at: ago(20) });
const B = item({ airtable_id: "rec-2", task: "Bravo task", created_at: ago(10), status_changed_at: ago(2) });

function serve(items: AirtableActionItem[]) {
  server.use(
    http.get("/api/v1/airtable/action-items/", () => HttpResponse.json(items)),
    http.get("/api/v1/airtable/accounts/", () => HttpResponse.json({ results: [], count: 0 })),
    http.get("/api/v1/team/members/", () => HttpResponse.json({ results: [], count: 0 })),
    http.get("/api/v1/airtable/action-items/field-options/", () =>
      HttpResponse.json({ status: ["Open", "In Progress", "Done", "Blocked", "Backlogged"], priority: ["Low", "Medium", "High", "Critical"] })),
    http.get("/api/v1/scheduler/scheduled-occurrences/", () => HttpResponse.json({ results: [], count: 0 })),
  );
}

const pos = (el: Element) => Array.from(document.querySelectorAll("*")).indexOf(el);
const before = (a: Element, b: Element) => pos(a) < pos(b);

beforeEach(() => {
  localStorage.clear();
  reloadActionItemZones();
  reloadFocusPins();
});

function OtherSurface() {
  const { sortDirection, toggleSort } = useColumnSort();
  return (
    <div data-testid="other">
      <span data-testid="dir">{sortDirection("Open") ?? "default"}</span>
      <ColumnSortButton status="Open" direction={sortDirection("Open")} onToggle={toggleSort} />
    </div>
  );
}

describe("shared column sort", () => {
  it("sortByMoved orders by status_changed_at, falling back to updated_at then created_at", () => {
    const noStamp = item({ airtable_id: "rec-3", task: "C", created_at: ago(5), updated_at: ago(5) });
    expect(sortByMoved([A, B], "newest").map((i) => i.task)).toEqual(["Bravo task", "Alpha task"]);
    expect(sortByMoved([B, A], "oldest").map((i) => i.task)).toEqual(["Alpha task", "Bravo task"]);
    expect(sortByMoved([A, noStamp], "newest")[0].task).toBe("C");
  });

  it("sidebar status sections have the toggle, positional sections do not", async () => {
    localStorage.setItem(ACTION_ITEM_ZONES_KEY, JSON.stringify({ "rec-9": "active" }));
    reloadActionItemZones();
    serve([A, B, item({ airtable_id: "rec-9", task: "Tracked one", status: "In Progress" })]);
    render(<ActionItemsSidebar />);
    await waitFor(() => expect(screen.getByText("Alpha task")).toBeInTheDocument());
    const open = document.querySelector('[data-section="open"]') as HTMLElement;
    const tracking = document.querySelector('[data-section="tracking"]') as HTMLElement;
    expect(within(open).getByRole("button", { name: /Sort Open newest first/ })).toBeInTheDocument();
    expect(within(tracking).queryByRole("button")).toBeNull();
  });

  it("keeps created_at-desc until clicked, then sorts by when items moved, and shares state with another surface", async () => {
    serve([A, B]);
    render(<><ActionItemsSidebar /><OtherSurface /></>);
    await waitFor(() => expect(screen.getByText("Alpha task")).toBeInTheDocument());
    expect(before(screen.getByText("Alpha task"), screen.getByText("Bravo task"))).toBe(true);

    const open = document.querySelector('[data-section="open"]') as HTMLElement;
    fireEvent.click(within(open).getByRole("button", { name: /Sort Open newest first/ }));
    expect(before(screen.getByText("Bravo task"), screen.getByText("Alpha task"))).toBe(true);
    // The other surface sees the same direction without any prop passing.
    expect(screen.getByTestId("dir").textContent).toBe("newest");

    // Toggling on the other surface flips the sidebar.
    fireEvent.click(within(screen.getByTestId("other")).getByRole("button"));
    expect(screen.getByTestId("dir").textContent).toBe("oldest");
    expect(before(screen.getByText("Alpha task"), screen.getByText("Bravo task"))).toBe(true);
  });
});

describe("every status-column surface is wired to the shared store", () => {
  const read = (f: string) => readFileSync(resolve(__dirname, "../../..", f), "utf8");
  it.each([
    ["pages/ActionItemsPage.tsx", 2],
    ["components/calendar/MeetingDetail.tsx", 1],
    ["components/account/ProjectGoals.tsx", 1],
    ["components/calendar/ActionItemsSidebar.tsx", 1],
    ["pages/CalendarPage.tsx", 1],
  ])("%s renders ColumnSortButton from useColumnSort", (file, minButtons) => {
    const src = read(file);
    expect(src).toContain("useColumnSort");
    expect((src.match(/<ColumnSortButton/g) ?? []).length).toBeGreaterThanOrEqual(minButtons);
  });
});
