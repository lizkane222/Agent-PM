import React from "react";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
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

describe("AccountDetailPage — customer contacts", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    register();
  });

  it("groups contacts by team: A-Z, no-team last, starred first", async () => {
    await renderPage();
    const groups = screen.getAllByTestId("contact-team-group");
    expect(groups.map((g) => g.querySelector("p")!.textContent)).toEqual(["Apps", "Platform", "No team"]);
    const platform = within(groups[1]).getAllByTitle(/·/).map((b) => b.getAttribute("title")!.split(" ·")[0]);
    expect(platform).toEqual(["Bo Chen", "Ann Lee"]);
    expect(within(groups[1]).getByLabelText("Unstar Bo Chen")).toHaveTextContent("★");
  });

  it("clicking another profile switches the panel directly and highlights it", async () => {
    await renderPage();
    fireEvent.click(screen.getByTitle("Ann Lee · Engineer"));
    expect(await screen.findByDisplayValue("Ann Lee")).toBeInTheDocument();
    expect(screen.getByTitle("Ann Lee · Engineer")).toHaveAttribute("data-selected", "true");
    fireEvent.click(screen.getByTitle("Di Ames · Engineer"));
    expect(await screen.findByDisplayValue("Di Ames")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Ann Lee")).not.toBeInTheDocument();
    expect(screen.getByTitle("Di Ames · Engineer")).toHaveAttribute("data-selected", "true");
    expect(screen.getByTitle("Ann Lee · Engineer")).not.toHaveAttribute("data-selected");
  });

  it("saves unsaved edits when switching to another profile", async () => {
    await renderPage();
    fireEvent.click(screen.getByTitle("Ann Lee · Engineer"));
    const team = await screen.findByPlaceholderText("Their internal team");
    fireEvent.change(team, { target: { value: "Security" } });
    fireEvent.click(screen.getByTitle("Di Ames · Engineer"));
    await waitFor(() => expect(patches.find((p) => p.id === "1")?.body.team).toBe("Security"));
  });

  it("stars from the list row", async () => {
    await renderPage();
    fireEvent.click(screen.getByLabelText("Star Ann Lee"));
    await waitFor(() => expect(patches).toEqual([{ id: "1", body: { is_main_poc: true } }]));
    await waitFor(() => expect(screen.getByLabelText("Unstar Ann Lee")).toBeInTheDocument());
  });

  it("stars from the profile panel", async () => {
    await renderPage();
    fireEvent.click(screen.getByTitle("Di Ames · Engineer"));
    fireEvent.click(await screen.findByLabelText("Set as main point of contact"));
    await waitFor(() => expect(patches).toEqual([{ id: "4", body: { is_main_poc: true } }]));
    expect(await screen.findByLabelText("Unset main point of contact")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Unstar Di Ames")).toBeInTheDocument());
  });

  it("add form offers existing team names and sends the team", async () => {
    let body: Record<string, unknown> | null = null;
    server.use(http.post("/api/v1/accounts/contacts/", async ({ request }) => {
      body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ ...mockContact, id: 9, ...body }, { status: 201 });
    }));
    await renderPage();
    const header = screen.getAllByText(/ Team$/).find((e) => e.parentElement?.querySelector("button")?.textContent === "+ Add")!;
    fireEvent.click(within(header.parentElement!).getByRole("button", { name: "+ Add" }));
    const dl = document.getElementById("contact-team-suggestions")!;
    expect([...dl.querySelectorAll("option")].map((o) => o.getAttribute("value"))).toEqual(["Apps", "Platform"]);
    const modal = screen.getByText("Add Customer Contact").parentElement!.parentElement!;
    fireEvent.change(within(modal).getAllByRole("textbox")[0], { target: { value: "New Person" } });
    fireEvent.change(screen.getByPlaceholderText(/Their internal team, e\.g\./), { target: { value: "Apps" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Contact" }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.team).toBe("Apps");
  });
});
