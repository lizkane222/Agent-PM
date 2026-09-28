import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import ActionItemsSidebar from "../ActionItemsSidebar";
import { reloadActionItemZones } from "../../../hooks/useActionItemZoneSets";
import { reloadFocusPins } from "../../../hooks/useFocusPins";
import type { AirtableActionItem } from "../../../types";

/**
 * An action item's fields are edited in the shared `ActionItemModal` and nowhere else.
 *
 * The card used to expand into its own inline form with a click-outside commit — a second
 * implementation of the modal's field set that could disagree with it about what a field means
 * or when it saves. Now the card is collapsed-only and a click opens the modal.
 *
 * Rendered against `components/calendar/ActionItemsSidebar` because the copy that actually
 * renders on /calendar is CalendarPage's own local one, which is not exported. The structural
 * half of this guard lives in `sidebarOrderingParity.test.ts` so the live copy cannot drift.
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

// The real modal drags in TipTap (which needs elementFromPoint) plus its own fetches. The stub
// surfaces the item it was handed, which is all these assertions need.
vi.mock("../../account/ActionItemModal", () => ({
  ActionItemModal: ({ item, onClose }: { item: AirtableActionItem; onClose: () => void }) => (
    <div data-testid="action-item-modal" data-item={item.airtable_id}>
      <span>{item.task}</span>
      <button onClick={onClose}>Close modal</button>
    </div>
  ),
}));

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
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    marked_done_at: null,
    last_synced: "",
    ...overrides,
  };
}

function serve(items: AirtableActionItem[]) {
  const patched: Array<Record<string, unknown>> = [];
  server.use(
    http.get("/api/v1/airtable/action-items/", () => HttpResponse.json(items)),
    http.get("/api/v1/airtable/accounts/", () => HttpResponse.json({ results: [], count: 0 })),
    http.get("/api/v1/team/members/", () => HttpResponse.json({ results: [], count: 0 })),
    http.get("/api/v1/airtable/action-items/field-options/", () =>
      HttpResponse.json({
        status: ["Open", "In Progress", "Done", "Blocked", "Backlogged"],
        priority: ["Low", "Medium", "High", "Critical"],
      })),
    http.get("/api/v1/scheduler/scheduled-occurrences/", () =>
      HttpResponse.json({ results: [], count: 0 })),
    http.patch("/api/v1/airtable/action-items/:id/fields/", async ({ request }) => {
      const body = await request.json() as Record<string, unknown>;
      patched.push(body);
      return HttpResponse.json({ ...items[0], ...body });
    }),
  );
  return patched;
}

const ITEM = item({ airtable_id: "recAAA", task: "Composite Keys Data Graph Issue" });

describe("calendar action-items sidebar: modal-only editing", () => {
  beforeEach(() => {
    localStorage.clear();
    reloadActionItemZones();
    reloadFocusPins();
  });

  it("clicking a card opens the ActionItemModal for that item", async () => {
    serve([ITEM]);
    render(<ActionItemsSidebar />);

    const card = await screen.findByText("Composite Keys Data Graph Issue");
    expect(screen.queryByTestId("action-item-modal")).not.toBeInTheDocument();

    fireEvent.click(card);

    const modal = await screen.findByTestId("action-item-modal");
    expect(modal).toHaveAttribute("data-item", "recAAA");
  });

  it("does not render an inline editor in place of the card", async () => {
    serve([ITEM]);
    render(<ActionItemsSidebar />);

    // Resolve the card before opening the modal — the modal stub renders the task text too,
    // so afterwards the text matches twice.
    const card = (await screen.findByText("Composite Keys Data Graph Issue"))
      .closest("div[draggable]");
    expect(card).not.toBeNull();

    fireEvent.click(card!);
    await screen.findByTestId("action-item-modal");

    // The inline editor's giveaway was a text input seeded with the task, rendered inside the
    // card itself. Scoped to the card: the sidebar's own search box is a legitimate input.
    expect(
      card!.querySelectorAll("input:not([type=hidden]), textarea, select, [contenteditable=true]"),
    ).toHaveLength(0);
  });

  it("closing the modal returns to the collapsed card", async () => {
    serve([ITEM]);
    render(<ActionItemsSidebar />);

    fireEvent.click(await screen.findByText("Composite Keys Data Graph Issue"));
    fireEvent.click(await screen.findByText("Close modal"));

    await waitFor(() =>
      expect(screen.queryByTestId("action-item-modal")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Composite Keys Data Graph Issue")).toBeInTheDocument();
  });

  it('offers "Edit details" on right-click, which opens the modal', async () => {
    serve([ITEM]);
    render(<ActionItemsSidebar />);

    fireEvent.contextMenu(await screen.findByText("Composite Keys Data Graph Issue"));
    const edit = await screen.findByText("Edit details");
    // The old label was "Expand", which described the inline editor that no longer exists.
    expect(screen.queryByText("Expand")).not.toBeInTheDocument();

    fireEvent.click(edit);
    expect(await screen.findByTestId("action-item-modal")).toHaveAttribute("data-item", "recAAA");
  });

  it('keeps "Mark as Done" as a one-click status change, not a form', async () => {
    // A single known field is not field editing, so it stays on the menu.
    const patched = serve([ITEM]);
    render(<ActionItemsSidebar />);

    fireEvent.contextMenu(await screen.findByText("Composite Keys Data Graph Issue"));
    fireEvent.click(await screen.findByText("Mark as Done"));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0]).toMatchObject({ status: "Done" });
    expect(screen.queryByTestId("action-item-modal")).not.toBeInTheDocument();
  });

  it("the Done/Reopen label follows the item, not a stale local form copy", async () => {
    // `marked_done_at` must be recent: the sidebar only lists Done items from the last
    // DONE_WINDOW_DAYS, so a stale one legitimately does not render at all.
    serve([item({
      airtable_id: "recDONE",
      task: "Already finished",
      status: "Done",
      marked_done_at: new Date().toISOString(),
    })]);
    render(<ActionItemsSidebar />);

    fireEvent.contextMenu(await screen.findByText("Already finished"));
    expect(await screen.findByText("Reopen")).toBeInTheDocument();
    expect(screen.queryByText("Mark as Done")).not.toBeInTheDocument();
  });

  it("opens the modal for the item named by expandItemId", async () => {
    serve([ITEM, item({ airtable_id: "recBBB", task: "Other work" })]);
    render(<ActionItemsSidebar expandItemId="recBBB" />);

    const modal = await screen.findByTestId("action-item-modal");
    expect(modal).toHaveAttribute("data-item", "recBBB");
  });
});
