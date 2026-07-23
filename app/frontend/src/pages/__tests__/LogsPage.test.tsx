import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockCalendarEvents } from "../../test/handlers/scheduler";
import { mockReminders } from "../../test/handlers/scheduler";
import { mockFeedbackItems } from "../../test/handlers/feedback";

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

  it("Events tab shows calendar event titles", async () => {
    await renderPage();
    fireEvent.click(screen.getByText("Events"));
    await waitFor(() =>
      expect(screen.getByText(mockCalendarEvents[0].title)).toBeInTheDocument()
    );
    expect(screen.getByText(mockCalendarEvents[1].title)).toBeInTheDocument();
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
});
