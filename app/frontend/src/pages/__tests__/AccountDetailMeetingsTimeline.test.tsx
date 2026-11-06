import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockAccount, mockAirtableAccount } from "../../test/handlers/accounts";
import type { Account } from "../../types";
import { mockTeamMembers } from "../../test/handlers/team";

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

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

vi.mock("../../assets/icons/Corporate.svg?react", () => ({ default: () => null }));

// TipTap's Placeholder extension calls elementFromPoint which jsdom lacks.
// The stub mirrors the real editor's Enter contract (bare Enter → onSubmit,
// Shift+Enter → newline) so page tests exercise the same keyboard path the
// real component does. The real implementation is covered directly in
// components/shared/__tests__/RichTextMentionEditor.test.tsx.
vi.mock("../../components/shared/RichTextMentionEditor", () => ({
  default: React.forwardRef(({ value, onChange, placeholder, onSubmit, onKeyDownCapture }: { value: string; onChange: (v: string) => void; placeholder?: string; onSubmit?: () => void; onKeyDownCapture?: (e: React.KeyboardEvent) => void }, ref: React.Ref<{ clear: () => void }>) => {
    React.useImperativeHandle(ref, () => ({ clear: () => onChange("") }));
    return (
      <textarea
        data-testid="description-editor"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onKeyDown={(e) => {
          onKeyDownCapture?.(e);
          if (e.key === "Enter" && !e.shiftKey && onSubmit) { e.preventDefault(); onSubmit(); }
        }}
      />
    );
  }),
  plainToHtml: (text: string) => text,
}));


function weekdayIso(): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  const dow = d.getDay();
  if (dow === 6) d.setDate(d.getDate() - 1);
  if (dow === 0) d.setDate(d.getDate() - 2);
  return d.toISOString();
}
const DAY = weekdayIso();
const DESC = "<br>One tap mobile<br>+1646...#,,,,*346111# US (New York)<br><br>---<br><br>Join by SIP<br>• ";

const meeting = (over: object = {}) => ({
  id: 1, airtable_id: "recMTG001", account: 1, account_name: "Acme Corp", name: "Q3 Review",
  date: DAY.slice(0, 10), duration: 60, expected_topics: "", gong_notes: "Recap:\n- real notes here that matter", gong_url: "",
  zoom_notes: "", zoom_url: "", customer_slack: "", account_team_slack: "", last_synced: "2026-01-01T00:00:00Z", ...over,
});
const calEvent = (over: object = {}) => ({
  id: 77, owner: 1, owner_username: "alice", account: 1, account_name: "Acme Corp", google_event_id: "g77",
  title: "Sync with Acme", description: DESC, location: "", start_datetime: DAY, end_datetime: DAY,
  all_day: false, status: "confirmed", attendees: [], meet_link: "", calendar_id: "primary", is_synced: true,
  agentpm_airtable_id: "recMTG001", project: 5, project_name: "Rollout", created_at: "", updated_at: "", ...over,
});

function register(meetings: object[], events: object[]) {
  server.use(
    http.get("/api/v1/accounts/accounts/:id/", () => HttpResponse.json(mockAccount as Account)),
    http.get("/api/v1/accounts/accounts/:id/notes/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/accounts/:id/calendar-events/", () => HttpResponse.json(events)),
    http.get("/api/v1/accounts/accounts/:id/reminders/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/accounts/:id/quick-links/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/contacts/", () => HttpResponse.json({ results: [], count: 0 })),
    http.get("/api/v1/accounts/projects/", () => HttpResponse.json({ results: [], count: 0 })),
    http.get("/api/v1/team/members/", () => HttpResponse.json({ results: mockTeamMembers, count: mockTeamMembers.length })),
    http.get("/api/v1/team/profiles/me/", () => new HttpResponse(null, { status: 404 })),
    http.get("/api/v1/airtable/action-items/", () => HttpResponse.json([])),
    http.get("/api/v1/airtable/meetings/", () => HttpResponse.json({ results: meetings })),
    http.get("/api/v1/airtable/accounts/", () => HttpResponse.json({ results: [mockAirtableAccount] })),
  );
}
async function renderPage() {
  const { default: AccountDetailPage } = await import("../AccountDetailPage");
  render(
    <MemoryRouter initialEntries={["/accounts/1"]}>
      <Routes><Route path="/accounts/:id" element={<AccountDetailPage />} /></Routes>
    </MemoryRouter>
  );
}

describe("AccountDetailPage timeline merge + calendar-event panel", () => {
  beforeEach(() => { vi.resetModules(); });

  it("shows one row per meeting: the notes check sits on the calendar event row, no duplicate", async () => {
    register([meeting()], [calEvent()]);
    await renderPage();
    const evBtn = await screen.findByTitle("Sync with Acme");
    const marks = await screen.findAllByTestId("meeting-notes-status");
    expect(marks).toHaveLength(1);
    expect(evBtn.contains(marks[0])).toBe(true);
    expect(marks[0].getAttribute("data-has-notes")).toBe("true");
    // The meeting's own timeline row (button titled with its name) is gone; only the
    // Project Goals drag chip (a div) carries that title.
    expect(screen.queryAllByTitle("Q3 Review").filter((el) => el.tagName === "BUTTON")).toHaveLength(0);
  });

  it("shows a pending marker on the event row when its meeting has no notes", async () => {
    register([meeting({ gong_notes: "" })], [calEvent()]);
    await renderPage();
    const marks = await screen.findAllByTestId("meeting-notes-status");
    expect(marks).toHaveLength(1);
    expect(marks[0].getAttribute("data-has-notes")).toBe("false");
  });

  it("still lists a meeting that has no calendar event, exactly once", async () => {
    register([meeting()], []);
    await renderPage();
    const marks = await screen.findAllByTestId("meeting-notes-status");
    expect(marks).toHaveLength(1);
    expect(marks[0].closest("button")?.getAttribute("title")).toBe("Q3 Review");
  });

  it("opens the Event Details panel from the timeline with real line breaks and the project", async () => {
    register([meeting()], [calEvent()]);
    await renderPage();
    fireEvent.click(await screen.findByTitle("Sync with Acme"));
    const desc = await screen.findByTestId("event-description");
    expect(desc.querySelectorAll("br").length).toBeGreaterThanOrEqual(7);
    expect(desc.textContent).not.toContain("<br>");
    expect(desc.textContent).toContain("One tap mobile");
    expect(screen.getByTestId("event-project").textContent).toContain("Rollout");
  });

  it("opens the same panel when the Project Goals event chip is clicked", async () => {
    register([meeting()], [calEvent()]);
    await renderPage();
    fireEvent.click(await screen.findByTestId("meeting-chip-name"));
    const desc = await screen.findByTestId("event-description");
    expect(desc.textContent).toContain("Join by SIP");
    expect(desc.textContent).not.toContain("<br>");
    expect(screen.getByText("Event Details")).toBeTruthy();
  });

  it("falls back to the meeting panel for a chip with no calendar event", async () => {
    register([meeting()], []);
    await renderPage();
    fireEvent.click(await screen.findByTestId("meeting-chip-name"));
    expect(await screen.findByText("meeting Details")).toBeTruthy();
  });

  it("wraps long event names up to 10 words with an ellipsis, keeping the chip draggable", async () => {
    register([meeting({ name: "one two three four five six seven eight nine ten eleven twelve" })], []);
    await renderPage();
    const name = await screen.findByTestId("meeting-chip-name");
    expect(name.textContent).toBe("one two three four five six seven eight nine ten…");
    expect(name.className).not.toContain("truncate");
    expect(name.parentElement?.getAttribute("draggable")).toBe("true");
  });
});
