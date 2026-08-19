import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import KanbanCard from "../KanbanCard";
import { reloadFocusPins } from "../../../hooks/useFocusPins";
import type { AirtableActionItem } from "../../../types";

vi.mock("../../comments/CommentContext", () => ({
  useCommentContext: () => ({ openComments: vi.fn(), closeComments: vi.fn() }),
  CommentProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../../../hooks/useExportTray", () => ({
  useExportTray: () => ({ addToTray: vi.fn(), isSelected: vi.fn(() => false), exportMode: false }),
}));

vi.mock("../../../assets/icons/Corporate.svg?react", () => ({ default: () => null }));

const mockItem: AirtableActionItem = {
  id: 1,
  airtable_id: "recAAA001",
  account: 1,
  account_name: "Acme Corp",
  task: "Fix billing issue",
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
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  marked_done_at: null,
  last_synced: "",
};

beforeEach(() => {
  localStorage.clear();
  reloadFocusPins();
  server.use(
    http.get("/api/v1/airtable/action-items/field-options/", () =>
      HttpResponse.json({
        status: ["Open", "In Progress", "Done", "Blocked", "Backlogged"],
        priority: ["Low", "Medium", "High", "Critical"],
      })
    )
  );
});

function renderCard(overrides: Partial<AirtableActionItem> = {}) {
  return render(
    <KanbanCard item={{ ...mockItem, ...overrides }} onStatusChange={vi.fn()} />
  );
}

describe("calendar KanbanCard", () => {
  it("renders the task title", () => {
    renderCard();
    expect(screen.getByText("Fix billing issue")).toBeInTheDocument();
  });

  it("right-click offers Pin to Focus alongside the existing actions", () => {
    renderCard();
    fireEvent.contextMenu(screen.getByText("Fix billing issue"));

    expect(screen.getByText("Pin to Focus")).toBeInTheDocument();
    expect(screen.getByText("Open details")).toBeInTheDocument();
    expect(screen.getByText("Mark as Done")).toBeInTheDocument();
  });

  it("clicking Pin to Focus writes the shared actionFocusPins key", async () => {
    renderCard();
    fireEvent.contextMenu(screen.getByText("Fix billing issue"));
    fireEvent.click(screen.getByText("Pin to Focus"));

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("actionFocusPins") ?? "[]")).toEqual(["recAAA001"])
    );
  });

  it("shows the pin badge in the top-right when pinned elsewhere in the app", () => {
    localStorage.setItem("actionFocusPins", JSON.stringify(["recAAA001"]));
    reloadFocusPins();

    renderCard();

    const badge = screen.getByTitle("Pinned to Focus");
    // Consistent corner across every card variant in the app.
    expect(badge.className).toContain("top-1.5");
    expect(badge.className).toContain("right-1.5");
    expect(badge.className).not.toContain("bottom-1.5");
  });

  it("flips the menu label to Unpin from Focus once pinned", async () => {
    renderCard();
    fireEvent.contextMenu(screen.getByText("Fix billing issue"));
    fireEvent.click(screen.getByText("Pin to Focus"));
    await waitFor(() => expect(screen.getByTitle("Pinned to Focus")).toBeInTheDocument());

    fireEvent.contextMenu(screen.getByText("Fix billing issue"));
    expect(screen.getByText("Unpin from Focus")).toBeInTheDocument();
  });

  it("does not offer to pin a local-* blank card", () => {
    renderCard({ airtable_id: "local-1" });
    fireEvent.contextMenu(screen.getByText("Fix billing issue"));

    expect(screen.getByText("Open details")).toBeInTheDocument();
    expect(screen.queryByText("Pin to Focus")).not.toBeInTheDocument();
  });
});
