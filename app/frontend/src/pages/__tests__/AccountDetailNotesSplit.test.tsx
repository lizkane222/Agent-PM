/**
 * The old single "Meeting Notes" section is now two: Account Notes and Meeting Notes Timeline,
 * each folding on its own, with the previous fold preference carried over to both.
 */
import React from "react";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockAccount, mockAirtableAccount } from "../../test/handlers/accounts";
import { mockTeamMembers } from "../../test/handlers/team";
import {
  ACCOUNT_SECTION_COLLAPSE_KEY, ACCOUNT_SECTION_IDS, NOTES_SPLIT_MIGRATION_KEY,
  migrateNotesSplitCollapse, reloadAccountSectionCollapse,
} from "../../hooks/useAccountSectionCollapse";

global.ResizeObserver = class ResizeObserver { observe() {} unobserve() {} disconnect() {} };

vi.mock("../../lib/appLog", () => ({
  addLog: vi.fn(), fetchSharedLogsForResource: vi.fn(async () => []), getLogs: vi.fn(() => []),
  getLogsForResource: vi.fn(() => []), syncLogsFromBackend: vi.fn(), LOG_STORAGE_KEY: "app_log",
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
vi.mock("../../components/shared/RichTextMentionEditor", () => ({
  default: React.forwardRef(() => <textarea data-testid="description-editor" />),
  plainToHtml: (t: string) => t,
}));

function dt() {
  const store: Record<string, string> = {};
  return {
    setData: (k: string, v: string) => { store[k.toLowerCase()] = v; },
    getData: (k: string) => store[k.toLowerCase()] ?? "",
    get types() { return Object.keys(store); },
    effectAllowed: "all",
  };
}

let projectPatches: Array<Record<string, unknown>>;
let noteDeletes: number;

function register() {
  projectPatches = [];
  noteDeletes = 0;
  const note = { id: 21, account: 1, author: 1, author_display: "A", content: "remember the renewal", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", references: [] };
  const project = { id: 7, account: 1, name: "Alpha", description: "", url: "", position: 0, action_ids: [], meeting_ids: [], goal_ids: [], resources: [], note_refs: [], sf_data: {}, sf_project_id: "", kind: "project", created_at: "" };
  let current = project;
  server.use(
    http.get("/api/v1/accounts/accounts/:id/", () => HttpResponse.json({ ...mockAccount, team_members: [] })),
    http.get("/api/v1/accounts/accounts/:id/notes/", () => HttpResponse.json([note])),
    http.delete("/api/v1/accounts/accounts/:id/notes/:noteId/", () => { noteDeletes++; return new HttpResponse(null, { status: 204 }); }),
    http.get("/api/v1/accounts/accounts/:id/calendar-events/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/accounts/:id/reminders/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/accounts/:id/quick-links/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/contacts/", () => HttpResponse.json({ results: [], count: 0 })),
    http.get("/api/v1/accounts/projects/", () => HttpResponse.json({ results: [current], count: 1 })),
    http.get("/api/v1/accounts/project-members/", () => HttpResponse.json({ results: [], count: 0 })),
    http.patch("/api/v1/accounts/projects/:id/", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      projectPatches.push(body);
      current = { ...current, ...body } as typeof project;
      return HttpResponse.json(current);
    }),
    http.get("/api/v1/team/members/", () => HttpResponse.json({ results: mockTeamMembers, count: mockTeamMembers.length })),
    http.get("/api/v1/team/profiles/me/", () => new HttpResponse(null, { status: 404 })),
    http.get("/api/v1/airtable/action-items/", () => HttpResponse.json([])),
    http.get("/api/v1/airtable/meetings/", () => HttpResponse.json({ results: [] })),
    http.get("/api/v1/airtable/accounts/", () => HttpResponse.json({ results: [mockAirtableAccount] })),
  );
}

async function renderPage() {
  const { default: Page } = await import("../AccountDetailPage");
  return render(
    <MemoryRouter initialEntries={["/accounts/1"]}>
      <Routes><Route path="/accounts/:id" element={<Page />} /></Routes>
    </MemoryRouter>,
  );
}

describe("Account Detail — Account Notes / Meeting Notes Timeline split", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    reloadAccountSectionCollapse();
    register();
  });

  it("renders two sections with their own ids and toggles", async () => {
    await renderPage();
    const accountNotes = (await screen.findByRole("button", { name: "Collapse Account Notes" })).closest("[data-section]")!;
    const timeline = screen.getByRole("button", { name: "Collapse Meeting Notes Timeline" }).closest("[data-section]")!;
    expect(accountNotes.getAttribute("data-section")).toBe(ACCOUNT_SECTION_IDS.accountNotes);
    expect(timeline.getAttribute("data-section")).toBe(ACCOUNT_SECTION_IDS.meetingNotes);
    expect(within(timeline as HTMLElement).getByTestId("meeting-notes-timeline")).toBeTruthy();
    expect(within(accountNotes as HTMLElement).queryByTestId("meeting-notes-timeline")).toBeNull();
    expect(screen.queryByRole("button", { name: "Collapse Meeting Notes" })).toBeNull();
  });

  it("folds each independently", async () => {
    await renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Collapse Account Notes" }));
    expect(screen.getByRole("button", { name: "Expand Account Notes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Collapse Meeting Notes Timeline" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Collapse Meeting Notes Timeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand Account Notes" }));
    expect(screen.getByRole("button", { name: "Collapse Account Notes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Expand Meeting Notes Timeline" })).toBeTruthy();
  });

  it("carries a folded old 'Meeting Notes' section over to BOTH new sections, once", async () => {
    localStorage.setItem(ACCOUNT_SECTION_COLLAPSE_KEY, JSON.stringify(["meeting-notes", "timeline"]));
    migrateNotesSplitCollapse();
    reloadAccountSectionCollapse();
    await renderPage();
    expect(await screen.findByRole("button", { name: "Expand Account Notes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Expand Meeting Notes Timeline" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Expand Timeline" })).toBeTruthy();
    // Unfolding Account Notes later is not undone by a reload.
    fireEvent.click(screen.getByRole("button", { name: "Expand Account Notes" }));
    migrateNotesSplitCollapse();
    expect(JSON.parse(localStorage.getItem(ACCOUNT_SECTION_COLLAPSE_KEY)!)).not.toContain("account-notes");
    expect(localStorage.getItem(NOTES_SPLIT_MIGRATION_KEY)).toBe("1");
  });

  it("migration does nothing for someone who had the old section open", () => {
    localStorage.setItem(ACCOUNT_SECTION_COLLAPSE_KEY, JSON.stringify(["timeline"]));
    migrateNotesSplitCollapse();
    expect(JSON.parse(localStorage.getItem(ACCOUNT_SECTION_COLLAPSE_KEY)!)).toEqual(["timeline"]);
  });

  it("dragging an Account Note onto a project links it, persists note_refs, shows the chip, and unlink keeps the note", async () => {
    await renderPage();
    const row = (await screen.findByText("remember the renewal")).closest("li")!;
    const project = await screen.findByTestId("project-row-7");
    const d = dt();
    fireEvent.dragStart(row, { dataTransfer: d });
    fireEvent.dragOver(project, { dataTransfer: d });
    fireEvent.drop(project, { dataTransfer: d });

    await waitFor(() => expect(projectPatches.length).toBeGreaterThan(0));
    expect(projectPatches[0].note_refs).toEqual([{ kind: "account_note", id: "21", label: "remember the renewal" }]);
    expect(await within(row).findByTestId("note-linked-badge")).toHaveTextContent("In: Alpha");
    expect(within(screen.getByTestId("project-row-7")).getByTestId("goal-note-row")).toHaveTextContent("remember the renewal");

    fireEvent.click(screen.getByRole("button", { name: "Unlink note" }));
    await waitFor(() => expect(projectPatches.at(-1)?.note_refs).toEqual([]));
    expect(noteDeletes).toBe(0);
    expect(screen.getByText("remember the renewal")).toBeTruthy();
    expect(within(row).queryByTestId("note-linked-badge")).toBeNull();
  });
});
