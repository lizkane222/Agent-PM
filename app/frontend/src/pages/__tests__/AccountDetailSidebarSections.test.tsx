import React from "react";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockAccount, mockAirtableAccount } from "../../test/handlers/accounts";
import { mockTeamMembers } from "../../test/handlers/team";
import { ACCOUNT_SECTION_COLLAPSE_KEY, reloadAccountSectionCollapse } from "../../hooks/useAccountSectionCollapse";

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

const meeting = (id: number, airtable_id: string, date: string | null) => ({
  id, airtable_id, account: 1, account_name: "Acme Corp", name: `Meeting ${id}`, date, duration: 60,
  expected_topics: "", gong_notes: "", gong_url: "", zoom_notes: "", zoom_url: "", customer_slack: "",
  account_team_slack: "", last_synced: "2026-01-01T00:00:00Z",
});
const calEvent = (id: number, linked: string) => ({
  id, google_event_id: `g${id}`, title: `Cal ${id}`, start_datetime: new Date().toISOString(),
  end_datetime: new Date().toISOString(), agentpm_airtable_id: linked, attendees: [],
});

let account: Record<string, unknown>;
let patches: Array<Record<string, unknown>>;

function register({ meetings = [] as unknown[], events = [] as unknown[] } = {}) {
  patches = [];
  server.use(
    http.get("/api/v1/accounts/accounts/:id/", () => HttpResponse.json(account)),
    http.patch("/api/v1/accounts/accounts/:id/", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      patches.push(body);
      account = { ...account, ...body };
      return HttpResponse.json(account);
    }),
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
  const { default: Page } = await import("../AccountDetailPage");
  return render(
    <MemoryRouter initialEntries={["/accounts/1"]}>
      <Routes><Route path="/accounts/:id" element={<Page />} /></Routes>
    </MemoryRouter>,
  );
}

describe("AccountDetailPage — sidebar fields and section folding", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    reloadAccountSectionCollapse();
    account = { ...mockAccount, team_members: [], slack_channels: [{ workspace: "Acme Corp", channel: "acme-support", url: "https://acme.slack.com/c", type: "customer_facing" }] };
    register();
  });

  it("lists Slack channels with the workspace beside the channel and a badge", async () => {
    await renderPage();
    expect(await screen.findByText("Acme Corp · #acme-support")).toBeInTheDocument();
    expect(screen.getByText("C#")).toBeInTheDocument();
    expect(screen.getByText("Slack # Channels")).toBeInTheDocument();
  });

  it("saves a new Slack channel through the account PATCH", async () => {
    await renderPage();
    fireEvent.click(await screen.findByText("+ Add channel"));
    fireEvent.change(screen.getByLabelText("Slack workspace"), { target: { value: "Twilio" } });
    fireEvent.change(screen.getByLabelText("Slack channel"), { target: { value: "acme-team" } });
    fireEvent.change(screen.getByLabelText("Slack channel URL"), { target: { value: "https://twilio.slack.com/x" } });
    fireEvent.change(screen.getByLabelText("Slack channel type"), { target: { value: "account_team" } });
    fireEvent.click(within(screen.getByTestId("slack-channel-form")).getByText("Save"));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect((patches[0].slack_channels as unknown[]).length).toBe(2);
    expect(await screen.findByText("Twilio · #acme-team")).toBeInTheDocument();
    expect(screen.getByText("A#")).toBeInTheDocument();
  });

  it("masks ARR until the eye is clicked, on every load", async () => {
    const first = await renderPage();
    await screen.findByText("Slack # Channels");
    expect(screen.getByTestId("arr-value")).toHaveTextContent("$••••••");
    expect(screen.queryByText("$100,000")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show ARR" }));
    expect(screen.getByTestId("arr-value")).toHaveTextContent("$100,000");
    first.unmount();
    vi.resetModules();
    await renderPage();
    await screen.findByText("Slack # Channels");
    expect(screen.getByTestId("arr-value")).toHaveTextContent("$••••••");
  });

  it("still lets the team edit ARR", async () => {
    await renderPage();
    await screen.findByText("Slack # Channels");
    fireEvent.click(screen.getByTestId("arr-value"));
    const input = await screen.findByDisplayValue("100000");
    fireEvent.change(input, { target: { value: "250000" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(patches.some((p) => p.arr === "250000")).toBe(true));
  });

  it("sidebar Meetings count agrees with the Timeline: dated meetings plus calendar-only events", async () => {
    register({
      meetings: [meeting(1, "recA", "2026-01-05"), meeting(2, "recB", null)],
      events: [calEvent(10, "recA"), calEvent(11, ""), calEvent(12, "")],
    });
    await renderPage();
    // recA (dated) + its linked event = 1, undated recB = 0, two calendar-only = 2.
    await waitFor(() => expect(screen.getByTestId("sidebar-meeting-count")).toHaveTextContent("3 recorded"));
  });

  it("collapses a main section and remembers it across a remount", async () => {
    const first = await renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Collapse Timeline" }));
    expect(screen.getByRole("button", { name: "Expand Timeline" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(ACCOUNT_SECTION_COLLAPSE_KEY)!)).toContain("timeline");
    first.unmount();
    vi.resetModules();
    await renderPage();
    expect(await screen.findByRole("button", { name: "Expand Timeline" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse Action Items" })).toBeInTheDocument();
  });

  it("makes every main section collapsible", async () => {
    await renderPage();
    await screen.findByText("Slack # Channels");
    for (const t of ["Teams", "Timeline", "Action Items", "Project Goals", "Meeting Notes", "Reminders", "Comments", "Artifacts", "Activity Log", "Email Chain Summary", "Details", "Quick Links"]) {
      expect(screen.getByRole("button", { name: `Collapse ${t}` }), t).toBeInTheDocument();
    }
  });

  it("folds the left sidebar to a narrow rail and back", async () => {
    await renderPage();
    const sidebar = await screen.findByTestId("left-sidebar");
    expect(sidebar.className).toContain("w-56");
    fireEvent.click(within(sidebar).getByRole("button", { name: "Collapse account details sidebar" }));
    expect(sidebar.className).toContain("w-9");
    expect(sidebar.className).not.toContain("w-56");
    fireEvent.click(within(sidebar).getByRole("button", { name: "Expand account details sidebar" }));
    expect(sidebar.className).toContain("w-56");
  });

  it("folds the right detail panel and keeps that choice", async () => {
    const first = await renderPage();
    const right = await screen.findByTestId("right-sidebar");
    expect(right.className).toContain("w-80");
    fireEvent.click(within(right).getByRole("button", { name: "Collapse detail panel" }));
    expect(right.className).toContain("w-9");
    first.unmount();
    vi.resetModules();
    await renderPage();
    expect((await screen.findByTestId("right-sidebar")).className).toContain("w-9");
  });
});
