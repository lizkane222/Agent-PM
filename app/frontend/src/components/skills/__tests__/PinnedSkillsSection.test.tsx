import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { mockAgentSkill, mockPagePin, mockRunResult } from "../../../test/handlers/skills";
import { mockUserProfile } from "../../../test/handlers/team";
import PinnedSkillsSection from "../PinnedSkillsSection";
import { VOICE_LAUNCH_EVENT } from "../../VoiceButton";
import type { PagePin } from "../../../types/agents";

let mockProfile: Record<string, unknown> | null = { ...mockUserProfile, access_level: "basic", is_staff: false };
vi.mock("../../../context/CurrentUserContext", () => ({ useCurrentUser: () => mockProfile }));
vi.mock("../../VoiceButton", async (orig) => ({ ...(await orig<typeof import("../../VoiceButton")>()) }));

const PINS = "/api/v1/skills/page-pins/";
const SKILLS = "/api/v1/skills/agent-skills/";
const page = <T,>(results: T[]) => HttpResponse.json({ count: results.length, next: null, previous: null, results });

const weekly = mockAgentSkill({ id: 1, name: "weekly-update", description: "Weekly account summary" });
const other = mockAgentSkill({ id: 2, name: "renewal-check", description: "Check renewals" });
const draft = mockAgentSkill({ id: 3, name: "half-done", status: "draft" });

/** Click the skill's name to slide its icon buttons into view, then press one of them. */
async function choose(action: string) {
  fireEvent.click(await screen.findByRole("button", { name: /^Weekly Update/ }));
  fireEvent.click(await screen.findByRole("button", { name: action }));
}
function servePins(pins: PagePin[]) { server.use(http.get(PINS, () => HttpResponse.json({ results: pins }))); }
function serveSkills(skills = [weekly, other, draft]) { server.use(http.get(SKILLS, () => page(skills))); }

let chat: { text: string; run_id?: string }[];
let voice: { key?: string }[];
const onChat = (e: Event) => chat.push((e as CustomEvent).detail);
const onVoice = (e: Event) => voice.push((e as CustomEvent).detail);

beforeEach(() => {
  mockProfile = { ...mockUserProfile, access_level: "basic", is_staff: false };
  chat = []; voice = [];
  window.addEventListener("chat-inject", onChat);
  window.addEventListener(VOICE_LAUNCH_EVENT, onVoice);
  serveSkills();
});
afterEach(() => {
  window.removeEventListener("chat-inject", onChat);
  window.removeEventListener(VOICE_LAUNCH_EVENT, onVoice);
});

describe("PinnedSkillsSection — the list", () => {
  it("says so when nothing is pinned", async () => {
    render(<PinnedSkillsSection page="calendar" variant="row" />);
    expect(await screen.findByText("No Claude skills pinned here yet.")).toBeInTheDocument();
  });

  it("shows each pinned skill as a 'Pinned to my page' styled button", async () => {
    servePins([mockPagePin({ skill: weekly })]);
    render(<PinnedSkillsSection page="calendar" variant="row" />);
    const button = await screen.findByRole("button", { name: /^Weekly Update/ });
    const chip = screen.getByTestId("pinned-chip");
    expect(chip).toHaveStyle({ border: "1px solid rgba(226,35,26,0.3)", color: "var(--twilio-red, #e22)" });
    expect(chip).toHaveStyle({ background: "rgba(226,35,26,0.08)" });
    expect(button).toHaveAttribute("title", "Weekly account summary");
  });

  it("the calendar variant can use a white button background", async () => {
    servePins([mockPagePin({ skill: weekly })]);
    render(<PinnedSkillsSection page="calendar" variant="row" chipBackground="#fff" />);
    await screen.findByRole("button", { name: /^Weekly Update/ });
    expect(screen.getByTestId("pinned-chip")).toHaveStyle({ background: "#fff" });
  });

  it("row: one scrolling line that never wraps, so many skills scroll sideways", async () => {
    servePins([mockPagePin({ id: 1, skill: weekly }), mockPagePin({ id: 2, skill: other })]);
    render(<PinnedSkillsSection page="calendar" variant="row" />);
    await screen.findByRole("button", { name: /^Weekly Update/ });
    const row = screen.getByTestId("pinned-skills-calendar");
    expect(row).toHaveStyle({ overflowX: "auto", whiteSpace: "nowrap", display: "flex" });
    expect(row.getAttribute("data-variant")).toBe("row");
  });

  it("row, centred: sizes to its content so it centres when it fits and scrolls (from the left edge) when it doesn't", async () => {
    servePins([mockPagePin({ skill: weekly })]);
    render(<PinnedSkillsSection page="action-items" variant="row" align="center" />);
    await screen.findByRole("button", { name: /^Weekly Update/ });
    expect(screen.getByTestId("pinned-skills-action-items")).toHaveStyle({ width: "max-content", margin: "0 auto" });
  });

  it("column: a vertical list with the dropdown below it", async () => {
    servePins([mockPagePin({ page: "reminders", skill: weekly })]);
    render(<PinnedSkillsSection page="reminders" variant="column" />);
    await screen.findByRole("button", { name: /^Weekly Update/ });
    expect(screen.getByTestId("pinned-skills-reminders")).toHaveStyle({ flexDirection: "column" });
    expect(screen.getByLabelText("Pin a Claude Skill to this page")).toBeInTheDocument();
  });

  it("collapsible: always present but closed until opened", async () => {
    servePins([mockPagePin({ page: "layouts", skill: weekly })]);
    render(<PinnedSkillsSection page="layouts" variant="collapsible" />);
    const toggle = await screen.findByRole("button", { name: /Claude Skills \(1\)/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /^Weekly Update/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Pin a Claude Skill to this page")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /^Weekly Update/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Pin a Claude Skill to this page")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByRole("button", { name: /^Weekly Update/ })).not.toBeInTheDocument();
  });

  it("collapsible stays visible (showing zero) when nothing is pinned", async () => {
    render(<PinnedSkillsSection page="layouts" variant="collapsible" />);
    expect(await screen.findByRole("button", { name: /Claude Skills \(0\)/ })).toBeInTheDocument();
  });
});

describe("PinnedSkillsSection — adding and removing", () => {
  it("offers only approved skills that aren't already pinned", async () => {
    servePins([mockPagePin({ skill: weekly })]);
    render(<PinnedSkillsSection page="calendar" variant="column" />);
    const select = await screen.findByLabelText("Pin a Claude Skill to this page");
    await waitFor(() => expect(within(select).getByRole("option", { name: "Renewal Check" })).toBeInTheDocument());
    expect(within(select).queryByRole("option", { name: "Weekly Update" })).not.toBeInTheDocument();   // already pinned
    expect(within(select).queryByRole("option", { name: "Half Done" })).not.toBeInTheDocument();       // draft
  });

  it("adding sends a personal pin and shows it", async () => {
    let body: Record<string, unknown> = {};
    let pins: PagePin[] = [];
    server.use(
      http.get(PINS, () => HttpResponse.json({ results: pins })),
      http.post(PINS, async ({ request }) => { body = (await request.json()) as Record<string, unknown>; pins = [mockPagePin({ id: 5, page: "reminders", skill: other })]; return HttpResponse.json(pins[0], { status: 201 }); }),
    );
    render(<PinnedSkillsSection page="reminders" variant="column" />);
    const select = await screen.findByLabelText("Pin a Claude Skill to this page");
    await waitFor(() => expect(within(select).getByRole("option", { name: "Renewal Check" })).toBeInTheDocument());
    fireEvent.change(select, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    expect(await screen.findByRole("button", { name: /^Renewal Check/ })).toBeInTheDocument();
    expect(body).toEqual({ page: "reminders", skill_id: 2, everyone: false });
  });

  it("non-admins never see 'Show for everyone'", async () => {
    render(<PinnedSkillsSection page="calendar" variant="column" />);
    const select = await screen.findByLabelText("Pin a Claude Skill to this page");
    await waitFor(() => expect(within(select).getByRole("option", { name: "Weekly Update" })).toBeInTheDocument());
    fireEvent.change(select, { target: { value: "1" } });
    expect(screen.queryByLabelText(/Show for everyone/)).not.toBeInTheDocument();
  });

  it("an admin can tick 'Show for everyone', and the pin is sent as an everyone-pin", async () => {
    mockProfile = { ...mockUserProfile, access_level: "admin", is_staff: true };
    let body: Record<string, unknown> = {};
    server.use(http.post(PINS, async ({ request }) => { body = (await request.json()) as Record<string, unknown>; return HttpResponse.json(mockPagePin({ scope: "everyone" }), { status: 201 }); }));
    render(<PinnedSkillsSection page="calendar" variant="column" />);
    const select = await screen.findByLabelText("Pin a Claude Skill to this page");
    await waitFor(() => expect(within(select).getByRole("option", { name: "Weekly Update" })).toBeInTheDocument());
    fireEvent.change(select, { target: { value: "1" } });
    fireEvent.click(screen.getByLabelText(/Show for everyone/));
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    await waitFor(() => expect(body).toEqual({ page: "calendar", skill_id: 1, everyone: true }));
  });

  it("an admin who leaves it unticked pins just for themselves", async () => {
    mockProfile = { ...mockUserProfile, access_level: "admin", is_staff: true };
    let body: Record<string, unknown> = {};
    server.use(http.post(PINS, async ({ request }) => { body = (await request.json()) as Record<string, unknown>; return HttpResponse.json(mockPagePin(), { status: 201 }); }));
    render(<PinnedSkillsSection page="calendar" variant="column" />);
    const select = await screen.findByLabelText("Pin a Claude Skill to this page");
    await waitFor(() => expect(within(select).getByRole("option", { name: "Weekly Update" })).toBeInTheDocument());
    fireEvent.change(select, { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    await waitFor(() => expect(body.everyone).toBe(false));
  });

  it("shows the server's reason when a pin is refused", async () => {
    server.use(http.post(PINS, () => HttpResponse.json({ detail: "That skill isn't available to pin." }, { status: 404 })));
    render(<PinnedSkillsSection page="calendar" variant="column" />);
    const select = await screen.findByLabelText("Pin a Claude Skill to this page");
    await waitFor(() => expect(within(select).getByRole("option", { name: "Weekly Update" })).toBeInTheDocument());
    fireEvent.change(select, { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("isn't available to pin");
  });

  it("removes a pin you own", async () => {
    let deleted = "";
    let pins = [mockPagePin({ id: 8, skill: weekly })];
    server.use(
      http.get(PINS, () => HttpResponse.json({ results: pins })),
      http.delete(`${PINS}:id/`, ({ params }) => { deleted = String(params.id); pins = []; return new HttpResponse(null, { status: 204 }); }),
    );
    render(<PinnedSkillsSection page="calendar" variant="row" />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Weekly Update from this page" }));
    await waitFor(() => expect(deleted).toBe("8"));
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Weekly Update/ })).not.toBeInTheDocument());
  });

  it("an everyone-pin can't be removed by a non-admin (no ✕) and is labelled", async () => {
    servePins([mockPagePin({ scope: "everyone", can_remove: false, skill: weekly })]);
    render(<PinnedSkillsSection page="calendar" variant="row" />);
    const chip = await screen.findByRole("button", { name: /^Weekly Update/ });
    expect(chip).toHaveTextContent("everyone");
    expect(chip).toHaveAttribute("title", expect.stringContaining("pinned for everyone"));
    expect(screen.queryByRole("button", { name: /Remove Weekly Update/ })).not.toBeInTheDocument();
  });

  it("an admin does get the ✕ on an everyone-pin", async () => {
    mockProfile = { ...mockUserProfile, access_level: "admin", is_staff: true };
    servePins([mockPagePin({ scope: "everyone", can_remove: true, skill: weekly })]);
    render(<PinnedSkillsSection page="calendar" variant="row" />);
    expect(await screen.findByRole("button", { name: "Remove Weekly Update from this page" })).toBeInTheDocument();
  });
});

describe("PinnedSkillsSection — running a pinned skill", () => {
  it("the chat icon puts it in the chat box, tagged with the page, and hands the Console run id to the chat", async () => {
    let body: Record<string, unknown> = {};
    servePins([mockPagePin({ skill: weekly })]);
    server.use(http.post(`${SKILLS}1/run/`, async ({ request }) => {
      body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json(mockRunResult({ prompt: "/weekly-update\n\ngo", run_id: "run-abc" }));
    }));
    render(<PinnedSkillsSection page="calendar" variant="row" />);
    await choose("Add Weekly Update to the chat box");
    await waitFor(() => expect(chat).toEqual([{ text: "/weekly-update\n\ngo", run_id: "run-abc" }]));
    expect(body).toMatchObject({ page: "calendar" });
    expect(body).not.toHaveProperty("account_ids");
  });

  it("on an account page it runs for that account", async () => {
    let body: Record<string, unknown> = {};
    servePins([mockPagePin({ page: "account-detail", skill: weekly })]);
    server.use(http.post(`${SKILLS}1/run/`, async ({ request }) => { body = (await request.json()) as Record<string, unknown>; return HttpResponse.json(mockRunResult()); }));
    render(<PinnedSkillsSection page="account-detail" variant="column" context={{ accountIds: [42] }} />);
    await choose("Add Weekly Update to the chat box");
    await waitFor(() => expect(body).toMatchObject({ page: "account-detail", account_ids: [42] }));
  });

  it("a skill that needs accounts runs straight away when the page supplies one — no dialog", async () => {
    const needy = mockAgentSkill({ id: 1, name: "weekly-update", context_defaults: { needs_accounts: true } });
    servePins([mockPagePin({ page: "account-detail", skill: needy })]);
    server.use(http.post(`${SKILLS}1/run/`, () => HttpResponse.json(mockRunResult())));
    render(<PinnedSkillsSection page="account-detail" variant="column" context={{ accountIds: [42] }} />);
    await choose("Add Weekly Update to the chat box");
    await waitFor(() => expect(chat).toHaveLength(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("…but opens the run dialog (pre-filled with that account) when the page doesn't supply one", async () => {
    const needy = mockAgentSkill({ id: 1, name: "weekly-update", context_defaults: { needs_accounts: true } });
    servePins([mockPagePin({ skill: needy })]);
    server.use(http.get("/api/v1/accounts/accounts/", () => page([{ id: 1, company_name: "Acme Corp" }])));
    render(<PinnedSkillsSection page="calendar" variant="row" />);
    await choose("Add Weekly Update to the chat box");
    expect(await screen.findByRole("dialog", { name: "Run weekly-update" })).toBeInTheDocument();
    expect(chat).toEqual([]);
  });

  it("a skill with templates always asks which one", async () => {
    const tpl = mockAgentSkill({ id: 1, name: "weekly-update", templates: [{ key: "a", title: "Weekly", body_html: "<p>x</p>" }] });
    servePins([mockPagePin({ page: "account-detail", skill: tpl })]);
    render(<PinnedSkillsSection page="account-detail" variant="column" context={{ accountIds: [42] }} />);
    await choose("Add Weekly Update to the chat box");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("the voice icon starts a voice session for the skill", async () => {
    servePins([mockPagePin({ skill: weekly })]);
    server.use(http.post(`${SKILLS}1/voice-start/`, () => HttpResponse.json({ key: "VK", script: "S", warnings: [], run_id: "r1" })));
    render(<PinnedSkillsSection page="calendar" variant="row" />);
    await choose("Start a voice session with Weekly Update");
    await waitFor(() => expect(voice).toHaveLength(1));
    expect(voice[0]).toMatchObject({ key: "VK" });
    expect(chat).toEqual([]);
  });

  it("a refused run (e.g. the daily token limit) shows the reason on the chip", async () => {
    servePins([mockPagePin({ skill: weekly })]);
    server.use(http.post(`${SKILLS}1/run/`, () => HttpResponse.json({ detail: "You've reached your daily token limit." }, { status: 403 })));
    render(<PinnedSkillsSection page="calendar" variant="row" />);
    await choose("Add Weekly Update to the chat box");
    expect(await screen.findByRole("status")).toHaveTextContent("daily token limit");
    expect(chat).toEqual([]);
  });
});

describe("PinnedSkillsSection — the sliding chip", () => {
  it("shows only the name until it is clicked, then swaps to Run / Chat / Voice", async () => {
    servePins([mockPagePin({ skill: weekly })]);
    render(<PinnedSkillsSection page="calendar" variant="row" />);
    const name = await screen.findByRole("button", { name: /^Weekly Update/ });
    expect(screen.getByTestId("pinned-chip")).toHaveAttribute("data-open", "false");
    expect(screen.queryByRole("button", { name: "Run Weekly Update" })).not.toBeInTheDocument();   // hidden = not focusable
    fireEvent.click(name);
    expect(screen.getByTestId("pinned-chip")).toHaveAttribute("data-open", "true");
    for (const n of ["Run Weekly Update", "Add Weekly Update to the chat box", "Start a voice session with Weekly Update"]) {
      expect(screen.getByRole("button", { name: n })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: /^Weekly Update/ })).not.toBeInTheDocument();
  });

  it("slides back when the pointer leaves, and on Escape", async () => {
    servePins([mockPagePin({ skill: weekly })]);
    render(<PinnedSkillsSection page="calendar" variant="row" />);
    fireEvent.click(await screen.findByRole("button", { name: /^Weekly Update/ }));
    fireEvent.mouseLeave(screen.getByRole("group", { name: "Weekly Update" }));
    expect(screen.getByTestId("pinned-chip")).toHaveAttribute("data-open", "false");
    fireEvent.click(await screen.findByRole("button", { name: /^Weekly Update/ }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Run Weekly Update" }), { key: "Escape" });
    expect(screen.getByTestId("pinned-chip")).toHaveAttribute("data-open", "false");
  });

  it("Run puts the prompt in the chat and asks it to be sent", async () => {
    servePins([mockPagePin({ skill: weekly })]);
    server.use(http.post(`${SKILLS}1/run/`, () => HttpResponse.json(mockRunResult({ prompt: "/weekly-update\n\ngo", run_id: "run-1" }))));
    render(<PinnedSkillsSection page="calendar" variant="row" />);
    await choose("Run Weekly Update");
    await waitFor(() => expect(chat).toEqual([{ text: "/weekly-update\n\ngo", run_id: "run-1", send: true }]));
    expect(screen.getByTestId("pinned-chip")).toHaveAttribute("data-open", "false");
  });

  it("the placeholder reads 'Pin a Claude Skill'", async () => {
    servePins([]);
    serveSkills();
    render(<PinnedSkillsSection page="calendar" variant="row" />);
    expect(await screen.findByRole("option", { name: "Pin a Claude Skill" })).toBeInTheDocument();
  });
});
