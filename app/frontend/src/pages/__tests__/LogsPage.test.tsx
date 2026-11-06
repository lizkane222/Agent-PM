import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockCalendarEvents } from "../../test/handlers/scheduler";
import { mockReminders } from "../../test/handlers/scheduler";
import { mockFeedbackItems } from "../../test/handlers/feedback";
import { mockNotification } from "../../test/handlers/profile";
import { mockEventUpdate } from "../../test/handlers/realtime";

// ── Mock cross-cutting deps ──────────────────────────────────────────────────

vi.mock("../../lib/appLog", () => ({
  getLogs: vi.fn(() => []),
  getLogsForResource: vi.fn(() => []),
  LOG_STORAGE_KEY: "app_log",
  syncLogsFromBackend: vi.fn(),
}));

vi.mock("../../assets/icons/Notification.svg?react", () => ({ default: () => null }));

// Token stats APIs — used by the Tokens tab
server.use(
  http.get("/api/v1/agents/sessions/token-stats/", () =>
    HttpResponse.json({ total_input: 0, total_output: 0, session_count: 0 })
  ),
  http.get("/api/v1/skills/skills/token-stats/", () =>
    HttpResponse.json({ total_input: 0, total_output: 0, invocation_count: 0 })
  ),
  http.get("/api/v1/comments/", () =>
    HttpResponse.json({ results: [], count: 0 })
  )
);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function renderPage() {
  const { default: LogsPage } = await import("../LogsPage");
  render(
    <MemoryRouter>
      <LogsPage />
    </MemoryRouter>
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("LogsPage", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("renders the tab bar", async () => {
    await renderPage();
    expect(screen.getByText("Events")).toBeInTheDocument();
    expect(screen.getByText("Reminders")).toBeInTheDocument();
    expect(screen.getByText("Feedback")).toBeInTheDocument();
  });

  describe("Events tab", () => {
    function serveUpdates(rows: ReturnType<typeof mockEventUpdate>[]) {
      server.use(http.get("/api/v1/realtime/activity/event-updates/", () => HttpResponse.json({ results: rows })));
    }

    it("lists changes made to events, each labelled by what happened", async () => {
      serveUpdates([
        mockEventUpdate({ id: 1, event_type: "calendar_event.created", title: 'Event created: "Kickoff"' }),
        mockEventUpdate({ id: 2, event_type: "calendar_event.updated", title: 'Event updated: "Sync" (title, time)' }),
        mockEventUpdate({ id: 3, event_type: "calendar_event.time_logged", title: 'Time logged: "Review" — 1h to Acme' }),
        mockEventUpdate({ id: 4, event_type: "meeting_notes", title: "Gong notes added to Siemens Call", metadata: { account_name: "Siemens" } }),
      ]);
      await renderPage();
      fireEvent.click(screen.getByText("Events"));

      expect(await screen.findByText('Event created: "Kickoff"')).toBeInTheDocument();
      expect(screen.getByText('Event updated: "Sync" (title, time)')).toBeInTheDocument();
      expect(screen.getByText("Gong notes added to Siemens Call")).toBeInTheDocument();
      for (const label of ["Created", "Updated", "Time logged", "Notes added"]) {
        expect(screen.getByText(label)).toBeInTheDocument();
      }
      expect(screen.getAllByTestId("event-update")).toHaveLength(4);
    });

    it("does not list calendar events that were merely scheduled", async () => {
      // The calendar has events (the default handler serves them); the tab must ignore them.
      await renderPage();
      fireEvent.click(screen.getByText("Events"));

      expect(await screen.findByText("No event updates yet.")).toBeInTheDocument();
      expect(screen.queryByText(mockCalendarEvents[0].title)).not.toBeInTheDocument();
    });

    it("offers no calendar link for a deleted event", async () => {
      serveUpdates([
        mockEventUpdate({ id: 5, event_type: "calendar_event.deleted", title: 'Event deleted: "Old"' }),
        mockEventUpdate({ id: 6, event_type: "calendar_event.created", title: 'Event created: "New"' }),
      ]);
      await renderPage();
      fireEvent.click(screen.getByText("Events"));

      await screen.findByText('Event deleted: "Old"');
      expect(screen.getAllByRole("link", { name: "View calendar" })).toHaveLength(1);
    });
  });

  it("Reminders tab shows reminder titles", async () => {
    await renderPage();
    fireEvent.click(screen.getByText("Reminders"));
    await waitFor(() =>
      expect(screen.getByText(mockReminders[0].title)).toBeInTheDocument()
    );
  });

  it("Feedback tab shows feedback items", async () => {
    await renderPage();
    fireEvent.click(screen.getByText("Feedback"));
    await waitFor(() =>
      expect(screen.getByText(mockFeedbackItems[0].description)).toBeInTheDocument()
    );
  });

  describe("Notifications tab", () => {
    function serveNotifications(rows: ReturnType<typeof mockNotification>[]) {
      server.use(
        http.get("/api/v1/team/notifications/", () =>
          HttpResponse.json({ results: rows, count: rows.length, next: null, previous: null })
        )
      );
    }

    it("lists the meeting-notes notifications that appeared as pop-ups", async () => {
      serveNotifications([
        mockNotification({
          id: 11, kind: "meeting_notes", title: "Gong notes added to Siemens Call",
          link: "/accounts/6?meeting=3", created_at: new Date().toISOString(),
        }),
      ]);
      await renderPage();
      fireEvent.click(screen.getByText("Notifications"));

      expect(await screen.findByText("Gong notes added to Siemens Call")).toBeInTheDocument();
      expect(screen.getByText("Meeting notes")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/accounts/6?meeting=3");
    });

    it("does not list reminder history twice", async () => {
      serveNotifications([mockNotification({ id: 12, kind: "reminder", title: "⏰ Call Acme" })]);
      await renderPage();
      fireEvent.click(screen.getByText("Notifications"));

      await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
      expect(screen.queryAllByTestId("recorded-notification")).toHaveLength(0);
    });
  });
});
