import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { ActionItemCard } from "../ActionItemCard";
import { reloadFocusPins } from "../../../hooks/useFocusPins";
import { resetCommentSummaries } from "../../../lib/commentSummaryStore";
import { resetRequestCache } from "../../../lib/requestCache";
import type { AirtableActionItem } from "../../../types";

vi.mock("../../../components/comments/CommentContext", () => ({
  useCommentContext: () => ({ openComments: vi.fn(), closeComments: vi.fn() }),
  CommentProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../../../hooks/useExportTray", () => ({
  useExportTray: () => ({
    addToTray: vi.fn(),
    isSelected: vi.fn(() => false),
    exportMode: false,
  }),
}));

vi.mock("../ActionItemCardOccurrences", () => ({
  ActionItemCardOccurrences: () => null,
}));

vi.mock("../ActionItemModal", () => ({
  ActionItemModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="action-item-modal">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

const mockItem: AirtableActionItem = {
  id: 1,
  airtable_id: "recAAA001",
  account: 1,
  account_name: "Acme Corp",
  task: "Fix billing issue",
  task_details: "See ticket #42",
  status: "Open",
  priority: "High",
  due_date: "2026-08-15",
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
  linked_meeting: null,
  linked_meeting_name: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  marked_done_at: null,
  last_synced: "",
};

beforeEach(() => {
  resetCommentSummaries();
  resetRequestCache();
  server.use(
    http.get("/api/v1/scheduler/scheduled-occurrences/", () =>
      HttpResponse.json({ results: [], count: 0 })
    )
  );
});

/** Serve a comment rollup for the mock item. */
function withComments(count: number, contents: string[]) {
  server.use(
    http.get("/api/v1/comments/comments/summary/", () =>
      HttpResponse.json({
        results: {
          "1": {
            count,
            comments: contents.map((content, i) => ({
              id: i + 1,
              resource_id: 1,
              author: 42,
              author_display: "Liz Kane",
              content,
              created_at: "2026-01-01T00:00:00Z",
            })),
          },
        },
      })
    )
  );
}

describe("ActionItemCard", () => {
  it("renders the task title", () => {
    render(<ActionItemCard item={mockItem} />);
    expect(screen.getByText("Fix billing issue")).toBeInTheDocument();
  });

  it("clicking the card opens the modal", async () => {
    render(<ActionItemCard item={mockItem} />);
    fireEvent.click(screen.getByText("Fix billing issue"));
    await waitFor(() => expect(screen.getByTestId("action-item-modal")).toBeInTheDocument());
  });

  it("right-clicking shows the context menu", () => {
    render(<ActionItemCard item={mockItem} />);
    fireEvent.contextMenu(screen.getByText("Fix billing issue"));
    expect(screen.getByText("Open details")).toBeInTheDocument();
    expect(screen.getByText("Mark as Done")).toBeInTheDocument();
    expect(screen.getByText("Copy task name")).toBeInTheDocument();
    expect(screen.getByText("Add comment")).toBeInTheDocument();
  });

  it("shows existing comments on the card itself", async () => {
    withComments(2, ["need to add diagram as artifact", "sent it"]);
    render(<ActionItemCard item={mockItem} />);

    await waitFor(() =>
      expect(screen.getByText("need to add diagram as artifact")).toBeInTheDocument()
    );
    expect(screen.getByText("sent it")).toBeInTheDocument();
  });

  it("shows no comment preview on an item with no comments", async () => {
    render(<ActionItemCard item={mockItem} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("comment-preview-list")).not.toBeInTheDocument();
  });

  it("puts the comment count in the right-click menu label", async () => {
    withComments(4, ["one"]);
    render(<ActionItemCard item={mockItem} />);
    await waitFor(() => expect(screen.getByText("one", { exact: false })).toBeInTheDocument());

    fireEvent.contextMenu(screen.getByText("Fix billing issue"));
    expect(screen.getByText("Comments (4)")).toBeInTheDocument();
    expect(screen.queryByText("Add comment")).not.toBeInTheDocument();
  });

  it("offers no comment entry or preview for a local-* draft", async () => {
    let called = false;
    server.use(
      http.get("/api/v1/comments/comments/summary/", () => {
        called = true;
        return HttpResponse.json({ results: {} });
      })
    );
    render(<ActionItemCard item={{ ...mockItem, airtable_id: "local-abc" }} />);
    await new Promise((r) => setTimeout(r, 20));

    expect(called).toBe(false);
    fireEvent.contextMenu(screen.getByText("Fix billing issue"));
    expect(screen.getByText("Add comment")).toBeInTheDocument();
    expect(screen.queryByTestId("comment-preview-list")).not.toBeInTheDocument();
  });

  it("shows Reopen when item is Done", () => {
    render(<ActionItemCard item={{ ...mockItem, status: "Done" }} />);
    fireEvent.contextMenu(screen.getByText("Fix billing issue"));
    expect(screen.getByText("Reopen")).toBeInTheDocument();
    expect(screen.queryByText("Mark as Done")).not.toBeInTheDocument();
  });

  it("shows Delete option when onDeleted is provided", () => {
    render(<ActionItemCard item={mockItem} onDeleted={vi.fn()} />);
    fireEvent.contextMenu(screen.getByText("Fix billing issue"));
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("does not show Delete when onDeleted is not provided", () => {
    render(<ActionItemCard item={mockItem} />);
    fireEvent.contextMenu(screen.getByText("Fix billing issue"));
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
  });

  it("context menu Open details click opens the modal", async () => {
    render(<ActionItemCard item={mockItem} />);
    fireEvent.contextMenu(screen.getByText("Fix billing issue"));
    fireEvent.click(screen.getByText("Open details"));
    await waitFor(() => expect(screen.getByTestId("action-item-modal")).toBeInTheDocument());
  });

  it("context menu Mark as Done calls PATCH", async () => {
    let patched = false;
    server.use(
      http.patch("/api/v1/airtable/action-items/:id/fields/", () => {
        patched = true;
        return HttpResponse.json({ ...mockItem, status: "Done" });
      })
    );
    render(<ActionItemCard item={mockItem} onUpdated={vi.fn()} />);
    fireEvent.contextMenu(screen.getByText("Fix billing issue"));
    fireEvent.click(screen.getByText("Mark as Done"));
    await waitFor(() => expect(patched).toBe(true));
  });

  it("Escape closes the context menu", async () => {
    render(<ActionItemCard item={mockItem} />);
    fireEvent.contextMenu(screen.getByText("Fix billing issue"));
    expect(screen.getByText("Open details")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Open details")).not.toBeInTheDocument());
  });

  it("prepends contextMenuItems above built-in items", () => {
    const customItem = { label: "Custom action", onClick: vi.fn() };
    render(<ActionItemCard item={mockItem} contextMenuItems={[customItem]} />);
    fireEvent.contextMenu(screen.getByText("Fix billing issue"));
    expect(screen.getByText("Custom action")).toBeInTheDocument();
    expect(screen.getByText("Open details")).toBeInTheDocument();
  });

  // ── Focus pins ──────────────────────────────────────────────────────────────

  describe("focus pins", () => {
    beforeEach(() => {
      localStorage.clear();
      reloadFocusPins();
    });

    it("offers Pin to Focus in the context menu", () => {
      render(<ActionItemCard item={mockItem} />);
      fireEvent.contextMenu(screen.getByText("Fix billing issue"));
      expect(screen.getByText("Pin to Focus")).toBeInTheDocument();
    });

    it("clicking Pin to Focus writes the shared actionFocusPins key", async () => {
      render(<ActionItemCard item={mockItem} />);
      fireEvent.contextMenu(screen.getByText("Fix billing issue"));
      fireEvent.click(screen.getByText("Pin to Focus"));

      await waitFor(() =>
        expect(JSON.parse(localStorage.getItem("actionFocusPins") ?? "[]")).toEqual(["recAAA001"])
      );
    });

    it("shows the pin badge and flips the menu label once pinned", async () => {
      render(<ActionItemCard item={mockItem} />);
      fireEvent.contextMenu(screen.getByText("Fix billing issue"));
      fireEvent.click(screen.getByText("Pin to Focus"));

      await waitFor(() => expect(screen.getByTitle("Pinned to Focus")).toBeInTheDocument());

      fireEvent.contextMenu(screen.getByText("Fix billing issue"));
      expect(screen.getByText("Unpin from Focus")).toBeInTheDocument();
      expect(screen.queryByText("Pin to Focus")).not.toBeInTheDocument();
    });

    it("reflects a pin set elsewhere in the app", () => {
      localStorage.setItem("actionFocusPins", JSON.stringify(["recAAA001"]));
      reloadFocusPins();

      render(<ActionItemCard item={mockItem} />);

      expect(screen.getByTitle("Pinned to Focus")).toBeInTheDocument();
    });

    it("keeps injected contextMenuItems above the pin entry", () => {
      render(<ActionItemCard item={mockItem} contextMenuItems={[{ label: "Custom action", onClick: vi.fn() }]} />);
      fireEvent.contextMenu(screen.getByText("Fix billing issue"));

      const custom = screen.getByText("Custom action");
      const pin = screen.getByText("Pin to Focus");
      expect(custom.compareDocumentPosition(pin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("does not offer to pin a local-* blank card", () => {
      render(<ActionItemCard item={{ ...mockItem, airtable_id: "local-1" }} />);
      fireEvent.contextMenu(screen.getByText("Fix billing issue"));

      // promoteBlankItem replaces that id, so a pin against it would be orphaned.
      expect(screen.getByText("Open details")).toBeInTheDocument();
      expect(screen.queryByText("Pin to Focus")).not.toBeInTheDocument();
    });
  });
});
