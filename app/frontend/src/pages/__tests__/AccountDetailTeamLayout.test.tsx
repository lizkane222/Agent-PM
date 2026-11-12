import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockAccount, mockAirtableAccount, mockContact } from "../../test/handlers/accounts";
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
vi.mock("../../components/shared/RichTextMentionEditor", () => ({
  default: React.forwardRef(({ value, onChange }: { value: string; onChange: (v: string) => void }, ref: React.Ref<{ clear: () => void }>) => {
    React.useImperativeHandle(ref, () => ({ clear: () => onChange("") }));
    return <textarea value={value} onChange={(e) => onChange(e.target.value)} />;
  }),
  plainToHtml: (t: string) => t,
}));

const contacts = [
  { ...mockContact, id: 1, name: "Ann Lee", team: "Platform", is_main_poc: false },
  { ...mockContact, id: 2, name: "Bo Chen", team: "Platform", is_main_poc: true },
  { ...mockContact, id: 3, name: "Cy Dunn", team: "", is_main_poc: false },
  { ...mockContact, id: 4, name: "Di Ames", team: "Apps", is_main_poc: false },
];
let patches: Array<{ id: string; body: Record<string, unknown> }> = [];

function register() {
  patches = [];
  const live = contacts.map((c) => ({ ...c }));
  server.use(
    http.get("/api/v1/accounts/accounts/:id/", () => HttpResponse.json(mockAccount)),
    http.get("/api/v1/accounts/accounts/:id/notes/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/accounts/:id/calendar-events/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/accounts/:id/reminders/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/accounts/:id/quick-links/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/contacts/", () => HttpResponse.json({ results: live, count: live.length })),
    http.patch("/api/v1/accounts/contacts/:id/", async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      patches.push({ id: String(params.id), body });
      const row = live.find((c) => String(c.id) === String(params.id))!;
      Object.assign(row, body);
      return HttpResponse.json(row);
    }),
    http.get("/api/v1/accounts/projects/", () => HttpResponse.json({ results: [], count: 0 })),
    http.get("/api/v1/team/members/", () => HttpResponse.json({ results: mockTeamMembers, count: mockTeamMembers.length })),
    http.get("/api/v1/team/profiles/me/", () => new HttpResponse(null, { status: 404 })),
    http.get("/api/v1/airtable/action-items/", () => HttpResponse.json([])),
    http.get("/api/v1/airtable/meetings/", () => HttpResponse.json({ results: [] })),
    http.get("/api/v1/airtable/accounts/", () => HttpResponse.json({ results: [mockAirtableAccount] })),
    http.get("/api/v1/airtable/action-items/field-options/", () =>
      HttpResponse.json({ status: ["Open"], priority: ["High"] })),
  );
}

async function renderPage() {
  const { default: AccountDetailPage } = await import("../AccountDetailPage");
  render(
    <MemoryRouter initialEntries={["/accounts/1"]}>
      <Routes><Route path="/accounts/:id" element={<AccountDetailPage />} /></Routes>
    </MemoryRouter>
  );
  await screen.findByTitle("Ann Lee · Engineer");
}


function stubWidths(container: number, chip: number) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.getAttribute("data-testid") === "contact-team-groups" ? container : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.closest("[data-team-chips]") ? chip : 0;
  });
}

describe("AccountDetailPage — team layout and selected frames", () => {
  beforeEach(() => { vi.resetModules(); localStorage.clear(); register(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("stacks teams when widths are unknown (jsdom)", async () => {
    await renderPage();
    expect(screen.getByTestId("contact-team-groups")).toHaveAttribute("data-team-layout", "stacked");
  });

  it("lays teams out side by side when all contacts do not fit on one row", async () => {
    stubWidths(300, 100); // 4 contacts x 100 > 300
    await renderPage();
    const el = screen.getByTestId("contact-team-groups");
    expect(el).toHaveAttribute("data-team-layout", "row");
    expect(el.className).toContain("flex-row");
  });

  it("keeps separate rows when every contact fits on one row", async () => {
    stubWidths(2000, 100);
    await renderPage();
    expect(screen.getByTestId("contact-team-groups")).toHaveAttribute("data-team-layout", "stacked");
  });

  it("selected team members get the same rounded-rectangle frame as selected contacts", async () => {
    const member = mockTeamMembers[0];
    server.use(http.get("/api/v1/accounts/accounts/:id/", () => HttpResponse.json({
      ...mockAccount,
      team_members: [{ id: member.id, full_name: member.full_name, title: member.title, email: member.email, avatar_url: "", slack_handle: "" }],
    })));
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Select for email" }));
    const btn = (await screen.findAllByTitle(member.full_name))[0];
    fireEvent.click(btn);
    const frame = btn.closest("[data-team-chip-frame]")!;
    expect(frame).toHaveAttribute("data-team-chip-frame", "selected");
    expect(frame.className).toContain("rounded-lg");
    expect(frame.className).toContain("p-1 -m-1");
    expect(frame.className).not.toContain("rounded-full");
    expect(btn.className).not.toContain("ring-2");
  });
});
