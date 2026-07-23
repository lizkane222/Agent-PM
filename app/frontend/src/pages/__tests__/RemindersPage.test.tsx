import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockReminders } from "../../test/handlers/scheduler";

// ── Mock cross-cutting context hooks ────────────────────────────────────────

vi.mock("../../context/ExportContext", () => ({
  useExport: () => ({
    exportMode: false,
    toggleItem: vi.fn(),
    isSelected: vi.fn(() => false),
  }),
}));

vi.mock("../../context/NotificationDefaultsContext", () => ({
  useNotificationDefaults: () => ({
    defaults: {
      notify_default_in_app: true,
      notify_default_slack: false,
      notify_default_push: false,
      notify_default_sms: false,
    },
    setDefaults: vi.fn(),
  }),
}));

vi.mock("../../components/comments/CommentContext", () => ({
  useRightClickComment: () => ({ onContextMenu: vi.fn() }),
}));

vi.mock("../../lib/appLog", () => ({
  addLog: vi.fn(),
  getLogs: vi.fn(() => []),
  getLogsForResource: vi.fn(() => []),
}));

// SVG imports resolve to empty objects in happy-dom
vi.mock("../../assets/icons/Schedule.svg?react", () => ({ default: () => null }));

// ── Helpers ──────────────────────────────────────────────────────────────────

async function renderPage() {
  const { default: RemindersPage } = await import("../RemindersPage");
  render(
    <MemoryRouter>
      <RemindersPage />
    </MemoryRouter>
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("RemindersPage", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("shows loading state initially", async () => {
    // Delay the response so we can observe the loading state
    server.use(
      http.get("/api/v1/scheduler/reminders/", async () => {
        await new Promise((r) => setTimeout(r, 50));
        return HttpResponse.json({ results: mockReminders, count: mockReminders.length });
      })
    );
    await renderPage();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
  });

  it("shows empty state when there are no reminders", async () => {
    server.use(
      http.get("/api/v1/scheduler/reminders/", () =>
        HttpResponse.json({ results: [], count: 0 })
      )
    );
    await renderPage();
    await waitFor(() =>
      expect(screen.getByText(/No.*reminders/i)).toBeInTheDocument()
    );
  });

  it("renders reminder titles when data is loaded", async () => {
    await renderPage();
    await waitFor(() =>
      expect(screen.getByText(mockReminders[0].title)).toBeInTheDocument()
    );
    expect(screen.getByText(mockReminders[1].title)).toBeInTheDocument();
  });

  it("clicking '+ New Reminder' opens the form", async () => {
    await renderPage();
    await waitFor(() => screen.getByText(mockReminders[0].title));
    fireEvent.click(screen.getByText("+ New Reminder"));
    expect(screen.getByText("New Reminder")).toBeInTheDocument();
  });

  it("clicking Delete button calls deleteReminder with correct id", async () => {
    // Track DELETE requests
    const deleteIds: string[] = [];
    server.use(
      http.delete("/api/v1/scheduler/reminders/:id/", ({ params }) => {
        deleteIds.push(params.id as string);
        return new HttpResponse(null, { status: 204 });
      })
    );

    await renderPage();
    await waitFor(() => screen.getByText(mockReminders[0].title));

    // Click the delete button (title="Delete") on the first reminder
    const deleteButtons = screen.getAllByTitle("Delete");
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => expect(deleteIds).toContain(String(mockReminders[0].id)));
  });

  it("clicking Dismiss button calls dismissReminder with correct id", async () => {
    const dismissedIds: string[] = [];
    server.use(
      http.post("/api/v1/scheduler/reminders/:id/dismiss/", ({ params }) => {
        dismissedIds.push(params.id as string);
        return HttpResponse.json({ ...mockReminders[0], status: "dismissed" });
      })
    );

    await renderPage();
    await waitFor(() => screen.getByText(mockReminders[0].title));

    const dismissButtons = screen.getAllByTitle("Dismiss");
    fireEvent.click(dismissButtons[0]);

    await waitFor(() => expect(dismissedIds).toContain(String(mockReminders[0].id)));
  });
});
