import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
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

const reportError = vi.hoisted(() => vi.fn());
vi.mock("../../context/AppErrorContext", () => ({
  useAppError: () => ({ reportError }),
  AppErrorProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
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

const contacts: any[] = [
  { ...mockContact, id: 1, name: "Ann Lee", team: "Platform", email: "ann@x.com", timezone: "America/Chicago" },
  { ...mockContact, id: 2, name: "Di Ames", team: "Platform", email: "di@x.com", timezone: "Asia/Kolkata" },
  { ...mockContact, id: 3, name: "Cy Dunn", team: "Platform", email: "cy@x.com", timezone: "" },
];
const members = [{ ...mockTeamMembers[0], email: "alice@example.com" }];

let patches: Record<string, unknown>[] = [];
let posts: Record<string, unknown>[] = [];
let accountPatches: Record<string, unknown>[] = [];
let savedText = "";
let failAccountPatch = false;

function register() {
  patches = [];
  posts = [];
  accountPatches = [];
  failAccountPatch = false;
  const account = {
    ...mockAccount,
    team_members: members.map((m) => ({ id: m.id, full_name: m.full_name, title: m.title, email: m.email, avatar_url: "", slack_handle: "" })),
  };
  server.use(
    http.get("/api/v1/accounts/accounts/:id/", () => HttpResponse.json({ ...account, primary_contact_text: savedText })),
    http.patch("/api/v1/accounts/accounts/:id/", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      accountPatches.push(body);
      if (failAccountPatch) return HttpResponse.json({ detail: "no" }, { status: 500 });
      return HttpResponse.json({ ...account, ...body });
    }),
    http.get("/api/v1/accounts/accounts/:id/notes/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/accounts/:id/calendar-events/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/accounts/:id/reminders/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/accounts/:id/quick-links/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/contacts/", () => HttpResponse.json({ results: contacts, count: contacts.length })),
    http.post("/api/v1/accounts/contacts/", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      posts.push(body);
      return HttpResponse.json({ ...mockContact, id: 9, ...body }, { status: 201 });
    }),
    http.patch("/api/v1/accounts/contacts/:id/", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      patches.push(body);
      return HttpResponse.json({ ...contacts[0], ...body });
    }),
    http.get("/api/v1/accounts/projects/", () => HttpResponse.json({ results: [], count: 0 })),
    http.get("/api/v1/team/members/", () => HttpResponse.json({ results: members, count: members.length })),
    http.get("/api/v1/team/profiles/me/", () => new HttpResponse(null, { status: 404 })),
    http.get("/api/v1/airtable/action-items/", () => HttpResponse.json([])),
    http.get("/api/v1/airtable/meetings/", () => HttpResponse.json({ results: [] })),
    http.get("/api/v1/airtable/accounts/", () => HttpResponse.json({ results: [mockAirtableAccount] })),
    http.get("/api/v1/airtable/action-items/field-options/", () => HttpResponse.json({ status: ["Open"], priority: ["High"] })),
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


describe("AccountDetailPage — starred contact is the sidebar Primary Contact", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    savedText = "";
    reportError.mockClear();
    register();
    // the PATCH echoes the right contact
    server.use(
      http.patch("/api/v1/accounts/contacts/:id/", async ({ request, params }) => {
        const body = (await request.json()) as Record<string, unknown>;
        patches.push(body);
        const c = contacts.find((x) => String(x.id) === params.id)!;
        return HttpResponse.json({ ...c, ...body, updated_at: "2030-01-01T00:00:00Z" });
      }),
    );
  });

  const primary = () => screen.getByText("Primary Contact").parentElement!.parentElement!;

  it("shows a starred contact and updates immediately when another is starred", async () => {
    contacts[0].is_main_poc = true;
    contacts[0].updated_at = "2026-01-01T00:00:00Z";
    await renderPage();
    await waitFor(() => expect(primary().textContent).toContain("Ann Lee"));
    fireEvent.click(screen.getByTitle("Di Ames · Engineer"));
    fireEvent.click(await screen.findByLabelText("Set as main point of contact"));
    await waitFor(() => expect(primary().textContent).toContain("Di Ames"));
    expect(patches).toContainEqual({ is_main_poc: true });
    await waitFor(() => expect(accountPatches).toEqual([{ primary_contact_text: "Di Ames" }]));
    expect(primary().textContent).toContain("Di Ames");
    contacts[0].is_main_poc = false;
  });

  it("falls back to the account's own primary contact when the star is removed", async () => {
    contacts[1].is_main_poc = true;
    savedText = "Di Ames";
    await renderPage();
    await waitFor(() => expect(primary().textContent).toContain("Di Ames"));
    fireEvent.click(screen.getByTitle("Di Ames · Engineer"));
    fireEvent.click(await screen.findByLabelText("Unset main point of contact"));
    await waitFor(() => expect(primary().textContent).not.toContain("Di Ames"));
    expect(accountPatches).toEqual([{ primary_contact_text: "" }]);
    contacts[1].is_main_poc = false;
  });

  it("moves to the next starred contact when the saved one is unstarred", async () => {
    contacts[0].is_main_poc = true;
    contacts[0].updated_at = "2026-01-01T00:00:00Z";
    contacts[1].is_main_poc = true;
    contacts[1].updated_at = "2026-03-01T00:00:00Z";
    savedText = "Di Ames";
    await renderPage();
    await waitFor(() => expect(primary().textContent).toContain("Di Ames"));
    fireEvent.click(screen.getByTitle("Di Ames · Engineer"));
    fireEvent.click(await screen.findByLabelText("Unset main point of contact"));
    await waitFor(() => expect(accountPatches).toEqual([{ primary_contact_text: "Ann Lee" }]));
    expect(primary().textContent).toContain("Ann Lee");
    contacts[0].is_main_poc = false;
    contacts[1].is_main_poc = false;
  });

  it("does not overwrite a different saved value when a contact is unstarred", async () => {
    contacts[1].is_main_poc = true;
    savedText = "Someone Else";
    await renderPage();
    await waitFor(() => expect(primary().textContent).toContain("Someone Else"));
    fireEvent.click(screen.getByTitle("Di Ames · Engineer"));
    fireEvent.click(await screen.findByLabelText("Unset main point of contact"));
    await waitFor(() => expect(patches).toContainEqual({ is_main_poc: false }));
    expect(accountPatches).toEqual([]);
    expect(primary().textContent).toContain("Someone Else");
    contacts[1].is_main_poc = false;
  });

  it("reverts and shows the error when saving the account fails", async () => {
    await renderPage();
    failAccountPatch = true;
    fireEvent.click(screen.getByTitle("Di Ames · Engineer"));
    fireEvent.click(await screen.findByLabelText("Set as main point of contact"));
    await waitFor(() => expect(accountPatches).toEqual([{ primary_contact_text: "Di Ames" }]));
    await waitFor(() => expect(reportError).toHaveBeenCalledWith("Could not save the primary contact.", "AccountDetailPage"));
    contacts[1].is_main_poc = false;
  });

  it("unstarring a contact that is not the primary leaves the field alone", async () => {
    contacts[0].is_main_poc = true;
    contacts[0].updated_at = "2026-02-01T00:00:00Z";
    contacts[2].is_main_poc = true;
    contacts[2].updated_at = "2026-01-01T00:00:00Z";
    await renderPage();
    await waitFor(() => expect(primary().textContent).toContain("Ann Lee"));
    fireEvent.click(screen.getByTitle("Cy Dunn · Engineer"));
    fireEvent.click(await screen.findByLabelText("Unset main point of contact"));
    await waitFor(() => expect(patches).toContainEqual({ is_main_poc: false }));
    expect(primary().textContent).toContain("Ann Lee");
    contacts[0].is_main_poc = false;
    contacts[2].is_main_poc = false;
  });
});

describe("mainContactName", () => {
  it("picks the most recently updated starred contact, or null", async () => {
    const { mainContactName } = await import("../AccountDetailPage");
    const c = (id: number, star: boolean, at: string) => ({ ...mockContact, id, name: `N${id}`, is_main_poc: star, updated_at: at });
    expect(mainContactName([c(1, false, "2030"), c(2, false, "2031")])).toBeNull();
    expect(mainContactName([c(1, true, "2026-01"), c(2, true, "2026-03"), c(3, false, "2027")])).toBe("N2");
  });
});
