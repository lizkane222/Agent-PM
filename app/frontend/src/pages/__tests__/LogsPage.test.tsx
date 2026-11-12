import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockCalendarEvents } from "../../test/handlers/scheduler";
import { mockReminders } from "../../test/handlers/scheduler";
import { mockFeedbackItems } from "../../test/handlers/feedback";
import { mockNotification } from "../../test/handlers/profile";
import { mockAgentSkill, mockPagePin, mockSkillRun, pagePinsFor } from "../../test/handlers/skills";
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

  it("keeps every tab title on one line in a container wide enough for them", async () => {
    await renderPage();
    const bar = screen.getByTestId("activity-log-tabs");
    const buttons = within(bar).getAllByRole("button");
    expect(buttons.map(b => b.textContent)).toEqual(
      ["Activity", "Console", "Events", "Comments", "Notifications", "Reminders", "Feedback", "Tokens"]
    );
    for (const b of buttons) {
      expect(b.className).toContain("whitespace-nowrap");
      expect(b.className).toContain("shrink-0");
    }
    expect(bar.className).toContain("overflow-x-auto");
    // not capped at the old max-w-3xl (768px), which forced titles to wrap
    const content = screen.getByTestId("activity-log-content");
    expect(content.className).not.toContain("max-w-3xl");
    expect(content.className).toMatch(/max-w-(5xl|6xl|7xl)/);
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

describe("LogsPage — Claude skills and the Console", () => {
  it("lists pinned skills in a column to the right of the log", async () => {
    server.use(pagePinsFor("activity-log", [mockPagePin({ page: "activity-log", skill: mockAgentSkill({ id: 1, name: "weekly-update" }) })]));
    await renderPage();
    const aside = await screen.findByTestId("activity-log-skills-column");
    expect(await within(aside).findByRole("button", { name: /^Weekly Update/ })).toBeInTheDocument();
    expect(aside.previousElementSibling).toHaveTextContent("Activity Log");       // beside the log column, after it
    expect(aside.parentElement).toHaveClass("flex");
  });

  it("has a Console tab that shows skill runs from the server", async () => {
    server.use(http.get("/api/v1/skills/runs/", () => HttpResponse.json({ count: 1, next: null, previous: null, results: [mockSkillRun({ id: "r1", skill_name: "weekly-update", records_created: 2 })] })));
    await renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Console" }));
    const row = await screen.findByTestId("run-r1");
    expect(row).toHaveTextContent("Weekly Update");
    expect(row).toHaveTextContent("2 created");
  });

  it("puts Console right after Activity", async () => {
    await renderPage();
    const tabs = (await screen.findAllByRole("button")).map((b) => b.textContent);
    expect(tabs.indexOf("Console")).toBe(tabs.indexOf("Activity") + 1);
  });
});
