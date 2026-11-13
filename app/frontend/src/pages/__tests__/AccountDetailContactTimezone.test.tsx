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
  { ...mockContact, id: 1, name: "Ann Lee", team: "Platform", email: "ann@x.com", timezone: "America/Chicago" },
  { ...mockContact, id: 2, name: "Di Ames", team: "Platform", email: "di@x.com", timezone: "Asia/Kolkata" },
  { ...mockContact, id: 3, name: "Cy Dunn", team: "Platform", email: "cy@x.com", timezone: "" },
];
const members = [{ ...mockTeamMembers[0], email: "alice@example.com" }];

let patches: Record<string, unknown>[] = [];
let posts: Record<string, unknown>[] = [];

function register() {
  patches = [];
  posts = [];
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

describe("AccountDetailPage — contact time zones", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    register();
  });

  it("shows each contact's local time on the chip only when a zone is set", async () => {
    await renderPage();
    const ann = screen.getByTitle("Ann Lee · Engineer").parentElement!;
    const cy = screen.getByTitle("Cy Dunn · Engineer").parentElement!;
    expect(within(ann).getByTestId("contact-local-time")).toBeInTheDocument();
    expect(within(cy).queryByTestId("contact-local-time")).not.toBeInTheDocument();
  });

  it("sets the zone on the add-contact modal and sends it", async () => {
    await renderPage();
    const addBtn = screen.getAllByRole("button", { name: "+ Add" }).find((b) => /Team/.test(b.parentElement?.textContent ?? ""))!;
    fireEvent.click(addBtn);
    const modal = screen.getByText("Add Customer Contact").parentElement!.parentElement!;
    fireEvent.change(modal.querySelector("input")!, { target: { value: "Zed" } });
    const tz = within(screen.getByTestId("timezone-field")).getByRole("combobox");
    fireEvent.change(tz, { target: { value: "Germany" } });
    fireEvent.keyDown(tz, { key: "Enter" });
    expect(screen.getByTestId("timezone-resolved").textContent).toContain("Europe/Berlin");
    fireEvent.click(screen.getByRole("button", { name: "Add Contact" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ name: "Zed", timezone: "Europe/Berlin" });
  });

  it("edits the zone in the side panel and saves it", async () => {
    await renderPage();
    fireEvent.click(screen.getByTitle("Cy Dunn · Engineer"));
    await screen.findByDisplayValue("Cy Dunn");
    const tz = within(screen.getByTestId("timezone-field")).getByRole("combobox");
    fireEvent.change(tz, { target: { value: "TX" } });
    fireEvent.keyDown(tz, { key: "Enter" });
    expect(screen.getByTestId("timezone-resolved").textContent).toContain("America/Chicago");
    let scope: HTMLElement = screen.getByTestId("timezone-field");
    while (!within(scope).queryByRole("button", { name: "Save" }) && scope.parentElement) scope = scope.parentElement;
    fireEvent.click(within(scope).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patches.some((p) => p.timezone === "America/Chicago")).toBe(true));
  });

  it("shows the planner for selected people with zones; team members with no zone are listed as having none", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Select for email" }));
    expect(screen.queryByTestId("overlap-planner")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Cy Dunn · Engineer")); // no zone -> still nothing to plan
    expect(screen.queryByTestId("overlap-planner")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Ann Lee · Engineer"));
    fireEvent.click(screen.getByTitle("Di Ames · Engineer"));
    fireEvent.click(await screen.findByTitle("Alice Smith"));
    const planner = await screen.findByTestId("overlap-planner");
    const zones = within(planner).getAllByTestId("planner-row").map((r) => r.getAttribute("data-zone"));
    expect(zones).toContain("America/Chicago");
    expect(zones).toContain("Asia/Kolkata");
    // a team member with no time zone is no longer assumed to be in the viewer's zone
    expect(within(planner).getAllByTestId("row-names")[0].textContent).toBe("You");
    const none = within(planner).getByTestId("planner-no-timezone").textContent;
    expect(none).toContain("Cy Dunn");
    expect(none).toContain("Alice Smith");
    // the existing email list is unchanged by the planner
    expect(screen.getByTestId("email-select-list").textContent).toBe("alice@example.com, ann@x.com, di@x.com, cy@x.com");
  });
});
