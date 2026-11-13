import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockAccount, mockAirtableAccount } from "../../test/handlers/accounts";

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

const member = { id: 7, full_name: "Jane Roe", email: "jane@twilio.com" };
let removeCalls: Array<Record<string, unknown>> = [];

function register() {
  removeCalls = [];
  const account = { ...mockAccount, team_members: [member] };
  server.use(
    http.get("/api/v1/accounts/accounts/:id/", () => HttpResponse.json(account)),
    http.post("/api/v1/accounts/accounts/:id/team-members/remove/", async ({ request }) => {
      removeCalls.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ ...account, team_members: [] });
    }),
    http.get("/api/v1/accounts/accounts/:id/notes/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/accounts/:id/calendar-events/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/accounts/:id/reminders/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/accounts/:id/quick-links/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/contacts/", () => HttpResponse.json({ results: [], count: 0 })),
    http.get("/api/v1/accounts/projects/", () => HttpResponse.json({ results: [], count: 0 })),
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
  return screen.findByRole("button", { name: "Remove Jane Roe" });
}

describe("AccountDetailPage — removing a team member from the account", () => {
  beforeEach(() => { vi.resetModules(); localStorage.clear(); register(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("asks for confirmation naming the person and the account, and sends nothing if cancelled", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const btn = await renderPage();
    fireEvent.click(btn);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toContain("Jane Roe");
    expect(confirm.mock.calls[0][0]).toContain(mockAccount.company_name);
    // give any (wrongly) fired request time to arrive
    await new Promise((r) => setTimeout(r, 50));
    expect(removeCalls).toEqual([]);
    expect(screen.getByRole("button", { name: "Remove Jane Roe" })).toBeInTheDocument();
  });

  it("unlinks the member only after the user confirms", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const btn = await renderPage();
    fireEvent.click(btn);
    await waitFor(() => expect(removeCalls).toEqual([{ member_id: 7 }]));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Remove Jane Roe" })).not.toBeInTheDocument());
  });
});
