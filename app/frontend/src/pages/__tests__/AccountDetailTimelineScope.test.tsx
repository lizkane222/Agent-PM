import React from "react";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
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

const meeting = (over: object = {}) => ({
  id: 1, airtable_id: "recMTG001", account: null, account_name: "", name: "Q3 Review",
  date: DAY.slice(0, 10), duration: 60, expected_topics: "", gong_notes: "Recap:\n- real notes here that matter", gong_url: "",
  zoom_notes: "", zoom_url: "", customer_slack: "", account_team_slack: "", last_synced: "2026-01-01T00:00:00Z", ...over,
});
const calEvent = (over: object = {}) => ({
  id: 77, owner: 1, owner_username: "alice", account: null, account_name: null, google_event_id: "g77",
  title: "Sync with Acme", description: "", location: "", start_datetime: DAY, end_datetime: DAY,
  all_day: false, status: "confirmed", attendees: [], meet_link: "", calendar_id: "primary", is_synced: true,
  agentpm_airtable_id: "", project: null, project_name: null, created_at: "", updated_at: "", ...over,
});

let timelineScopes: string[] = [];
function register(timeline: (scope: string) => object) {
  timelineScopes = [];
  server.use(
    http.get("/api/v1/accounts/accounts/:id/", () => HttpResponse.json(mockAccount as Account)),
    http.get("/api/v1/accounts/accounts/:id/notes/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/accounts/:id/calendar-events/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/accounts/:id/timeline/", ({ request }) => {
      const scope = new URL(request.url).searchParams.get("scope") ?? "";
      timelineScopes.push(scope);
      return HttpResponse.json(timeline(scope));
    }),
    http.get("/api/v1/accounts/accounts/:id/reminders/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/accounts/:id/quick-links/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/contacts/", () => HttpResponse.json({ results: [], count: 0 })),
    http.get("/api/v1/accounts/projects/", () => HttpResponse.json({ results: [], count: 0 })),
    http.get("/api/v1/team/members/", () => HttpResponse.json({ results: mockTeamMembers, count: mockTeamMembers.length })),
    http.get("/api/v1/team/profiles/me/", () => new HttpResponse(null, { status: 404 })),
    http.get("/api/v1/airtable/action-items/", () => HttpResponse.json([])),
    // The account-scoped meeting list does NOT contain the meeting: the importer filed it under no account.
    http.get("/api/v1/airtable/meetings/", () => HttpResponse.json({ results: [] })),
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

describe("AccountDetailPage timeline: notes check, Mine/Team, header note", () => {
  beforeEach(() => { vi.resetModules(); localStorage.clear(); });

  it("shows the notes check on the event row even though the meeting is filed under no account", async () => {
    register(() => ({
      events: [calEvent({ agentpm_airtable_id: "recMTG001" })],
      meetings: [meeting()],
    }));
    await renderPage();
    const evBtn = await screen.findByTitle("Sync with Acme");
    const mark = await within(evBtn).findByTestId("meeting-notes-status");
    expect(mark.getAttribute("data-has-notes")).toBe("true");
    expect(mark.textContent).toBe("✓");
  });

  it("defaults to Mine, requests Team on toggle, and remembers the choice", async () => {
    register((scope) => ({ events: scope === "team" ? [calEvent({ title: "Teammate sync", owner: 2 })] : [], meetings: [] }));
    await renderPage();
    await waitFor(() => expect(timelineScopes).toContain("mine"));
    expect(screen.getByRole("button", { name: "Mine" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Team" }));
    expect(await screen.findByTitle("Teammate sync")).toBeTruthy();
    expect(timelineScopes).toContain("team");
    expect(localStorage.getItem("accountTimelineScope-v1")).toBe("team");
  });

  it("starts on Team when that was the saved choice", async () => {
    localStorage.setItem("accountTimelineScope-v1", "team");
    register(() => ({ events: [], meetings: [] }));
    await renderPage();
    await waitFor(() => expect(timelineScopes).toEqual(["team"]));
    expect(screen.getByRole("button", { name: "Team" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("replaces the GET Meeting Notes button with the sync note (10 minutes: the real beat interval)", async () => {
    register(() => ({ events: [], meetings: [] }));
    await renderPage();
    const note = await screen.findByTestId("timeline-notes-sync-note");
    expect(note.textContent).toMatch(/every 10 minutes/);
    expect(screen.queryByRole("button", { name: /GET Meeting Notes/i })).toBeNull();
    expect(screen.queryByTitle(/GET Meeting Notes/i)).toBeNull();
  });

  it("sizes day columns so exactly five fit the visible width", async () => {
    const spy = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
    try {
      register(() => ({ events: [calEvent()], meetings: [] }));
      await renderPage();
      await screen.findByTitle("Sync with Acme");
      await waitFor(() => {
        const col = document.querySelector<HTMLElement>("[data-today='true']");
        expect(col?.style.width).toBe("195px"); // (1000 - 4 gaps of 6px) / 5
      });
    } finally {
      spy.mockRestore();
    }
  });
});
