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
  { ...mockContact, id: 1, name: "Ann Lee", team: "Platform", email: "ann@x.com", is_main_poc: false },
  { ...mockContact, id: 2, name: "Bo Chen", team: "Platform", email: "ANN@x.com", is_main_poc: false },
  { ...mockContact, id: 3, name: "Cy Dunn", team: "", email: "", is_main_poc: false },
  { ...mockContact, id: 4, name: "Di Ames", team: "Apps", email: "di@x.com", is_main_poc: false },
];
const members = [
  { ...mockTeamMembers[0], email: "alice@example.com" },
  { ...mockTeamMembers[1], email: "" },
];

function register() {
  const account = {
    ...mockAccount,
    team_members: members.map((m) => ({ id: m.id, full_name: m.full_name, title: m.title, email: m.email, avatar_url: "", slack_handle: "" })),
  };
  server.use(
    http.get("/api/v1/accounts/accounts/:id/", () => HttpResponse.json(account)),
    http.get("/api/v1/accounts/accounts/:id/notes/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/accounts/:id/calendar-events/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/accounts/:id/reminders/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/accounts/:id/quick-links/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/contacts/", () => HttpResponse.json({ results: contacts, count: contacts.length })),
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

describe("AccountDetailPage — select for email", () => {
  let writeText: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    register();
    writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  });

  it("selects across both groups, dedupes, notes people without email, and copies", async () => {
    await renderPage();
    expect(screen.queryByTestId("email-select-panel")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select for email" }));
    expect(screen.getByTestId("email-select-panel")).toBeInTheDocument();

    fireEvent.click(await screen.findByTitle("Alice Smith"));
    fireEvent.click(screen.getByTitle("Bob Jones"));
    fireEvent.click(screen.getByTitle("Ann Lee · Engineer"));
    fireEvent.click(screen.getByTitle("Bo Chen · Engineer"));
    fireEvent.click(screen.getByTitle("Cy Dunn · Engineer"));
    fireEvent.click(screen.getByTitle("Di Ames · Engineer"));

    expect(screen.getByTestId("email-select-list").textContent).toBe("alice@example.com, ann@x.com, di@x.com");
    expect(screen.getByTestId("email-select-panel").textContent).toContain("3 emails selected");
    expect(screen.getByTestId("email-select-panel").textContent).toContain("No email: Bob Jones, Cy Dunn");

    fireEvent.click(screen.getByRole("button", { name: "Copy Emails" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("alice@example.com, ann@x.com, di@x.com"));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("clicking a chip in selection mode toggles it and does not open the side panel", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Select for email" }));
    fireEvent.click(screen.getByTitle("Ann Lee · Engineer"));
    expect(screen.queryByDisplayValue("Ann Lee")).not.toBeInTheDocument();
    expect(screen.getByTestId("email-select-list").textContent).toBe("ann@x.com");
    fireEvent.click(screen.getByTitle("Ann Lee · Engineer"));
    expect(screen.getByTestId("email-select-panel").textContent).toContain("0 emails selected");
  });

  it("clicking Select for email again clears the selection and closes the panel", async () => {
    await renderPage();
    const toggle = screen.getByRole("button", { name: "Select for email" });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByTitle("Di Ames · Engineer"));
    fireEvent.click(toggle);
    expect(screen.queryByTestId("email-select-panel")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByTestId("email-select-list").textContent).not.toContain("di@x.com");
    // chips open the panel again outside selection mode
    fireEvent.click(toggle);
    fireEvent.click(screen.getByTitle("Di Ames · Engineer"));
    expect(await screen.findByDisplayValue("Di Ames")).toBeInTheDocument();
  });
});
