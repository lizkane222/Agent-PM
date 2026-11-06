import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import ClaudeSkillsPage from "../ClaudeSkillsPage";
import { mockAgentSkill } from "../../test/handlers/skills";
import { apiClient } from "../../lib/api";

// SVG-as-component imports have no jsdom transform; stub each one the page pulls in.
vi.mock("../../assets/icons/Code.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/Product Logos/logo-messagingx-red.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/Product Logos/logo-programmable-voice-red.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/Product Logos/logo-taskrouter-red.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/Product Logos/logo-notify-red.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/Product Logos/logo-sync-red.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/Product Logos/logo-trust-hub-red.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/Product Logos/logo-understand-red.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/Product Logos/virtual-agent-logo-red.svg?react", () => ({ default: () => null }));
vi.mock("../../components/CommentIcon", () => ({ default: () => null }));

vi.mock("../../hooks/useLogGlow", () => ({ useLogGlow: () => {} }));
vi.mock("../../context/CurrentUserContext", () => ({
  useCurrentUser: () => ({ id: 1, is_staff: false, role: "member" }),
}));
vi.mock("../../components/comments/CommentContext", () => ({
  useCommentContext: () => ({ openComments: () => {} }),
  useRightClickComment: () => () => {},
}));
vi.mock("../../lib/auth", () => ({
  getAccessToken: vi.fn(() => null),
  getRefreshToken: vi.fn(() => null),
  isTokenExpired: vi.fn(() => false),
  refreshAccessToken: vi.fn(() => Promise.resolve("")),
  clearTokens: vi.fn(),
  logout: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <ClaudeSkillsPage />
    </MemoryRouter>,
  );
}

// The sidebar button for an entry, found by the exact text of its name. A role+name regex
// cannot tell "Meetings" from "Meetings with Colleagues": the accessible name also carries
// the icon and the operation chips.
function entryButton(name: string): HTMLElement {
  const label = screen.getByText(name, { exact: true });
  return label.closest("button") as HTMLElement;
}

function openCapabilities() {
  renderPage();
  fireEvent.click(screen.getByRole("button", { name: "Agent Capabilities" }));
}

describe("ClaudeSkillsPage tabs", () => {
  it("offers the three tabs for a non-admin", () => {
    renderPage();
    for (const label of ["Agent PM Skills", "Twilio Skills", "Agent Capabilities"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "Agent PM Tools" })).not.toBeInTheDocument();
  });
});

describe("Agent Capabilities tab", () => {
  it("lists every record type, including the voice-era ones", () => {
    openCapabilities();
    for (const name of [
      "Action Items",
      "Meetings",
      "Calendar Events",
      "Accounts",
      "Messaging & Calls",
      "Time Logging (Cloud Coach)",
      "Email & Messages",
      "Meetings with Colleagues",
      "Contact a Colleague",
    ]) {
      expect(entryButton(name)).toBeInTheDocument();
    }
  });

  it("explains the account fallback and fuzzy matching on Action Items", () => {
    openCapabilities();
    fireEvent.click(entryButton("Action Items"));
    expect(screen.getByText(/closest real account/i)).toBeInTheDocument();
    expect(screen.getByText(/under No Account/i)).toBeInTheDocument();
    // Confirmation is now enforced by the server in chat as well as on a call.
    expect(screen.getByText(/Deleting always asks you to confirm first/i)).toBeInTheDocument();
  });

  it("shows the tools behind Messaging & Calls and warns they need confirmation", () => {
    openCapabilities();
    fireEvent.click(entryButton("Messaging & Calls"));
    expect(screen.getByText("send_sms")).toBeInTheDocument();
    expect(screen.getByText("make_phone_call")).toBeInTheDocument();
    expect(screen.getByText(/Needs your confirmation first/i)).toBeInTheDocument();
  });

  it("shows the tools behind Time Logging", () => {
    openCapabilities();
    fireEvent.click(entryButton("Time Logging (Cloud Coach)"));
    for (const tool of ["find_cloud_coach_project", "preview_time_log_week", "log_time_week"]) {
      expect(screen.getByText(tool)).toBeInTheDocument();
    }
    expect(screen.getByText(/Needs your confirmation first/i)).toBeInTheDocument();
  });

  it("shows the tools behind Email & Messages", () => {
    openCapabilities();
    fireEvent.click(entryButton("Email & Messages"));
    for (const tool of ["get_emails", "get_slack_messages", "get_meeting_notes_from_email"]) {
      expect(screen.getByText(tool)).toBeInTheDocument();
    }
  });

  it("shows the colleague-meeting tools and warns that inviting needs confirmation", () => {
    openCapabilities();
    fireEvent.click(entryButton("Meetings with Colleagues"));
    for (const tool of ["find_person", "get_colleague_availability", "invite_to_meeting"]) {
      expect(screen.getByText(tool)).toBeInTheDocument();
    }
    expect(screen.getByText(/Inviting needs your confirmation first/i)).toBeInTheDocument();
    expect(screen.getByText(/never what their meetings are/i)).toBeInTheDocument();
  });

  it("lists the three Public-profile actions under Contact a Colleague", () => {
    openCapabilities();
    fireEvent.click(entryButton("Contact a Colleague"));
    expect(screen.getByText("find_person / email_person")).toBeInTheDocument();
    expect(screen.getByText("leave_note_for")).toBeInTheDocument();
    // Scheduling is described, and points at the gated invite path rather than a second one.
    expect(screen.getByText(/Schedule a call: find a time/i)).toBeInTheDocument();
    // Emailing sends nothing; a note needs a yes.
    expect(screen.getByText(/Emailing only opens a draft link and sends nothing/i)).toBeInTheDocument();
    expect(screen.getByText(/Leaving a note needs your confirmation first/i)).toBeInTheDocument();
  });

  it("shows an example prompt for each new voice-era entry", () => {
    openCapabilities();
    const examples: Record<string, RegExp> = {
      "Messaging & Calls": /Text 415 555 0100/,
      "Time Logging (Cloud Coach)": /Log my time for this week/,
      "Email & Messages": /Any new email from Acme/,
      "Meetings with Colleagues": /free 30 minutes for me and Melissa Ramirez/,
      "Contact a Colleague": /Leave a note for Ana Diaz/,
    };
    for (const [entry, example] of Object.entries(examples)) {
      fireEvent.click(entryButton(entry));
      expect(screen.getByText(example)).toBeInTheDocument();
    }
  });
});


describe("Agent Capabilities — records added with the MCP policy layer", () => {
  it("lists the new record types", () => {
    openCapabilities();
    for (const name of ["Reminders", "Artifacts", "Projects & Goals", "Steps, Dependencies & Tasks",
                        "Comments & Feedback", "Workspace"]) {
      expect(entryButton(name)).toBeInTheDocument();
    }
  });

  it("shows the reminder tools and that deleting stays in the app", () => {
    openCapabilities();
    fireEvent.click(entryButton("Reminders"));
    for (const tool of ["list_reminders", "create_reminder", "update_reminder"]) {
      expect(screen.getByText(tool)).toBeInTheDocument();
    }
    expect(screen.getByText(/delete them in the app/i)).toBeInTheDocument();
  });

  it("says meetings are notes-only and can no longer be deleted by the agent", () => {
    openCapabilities();
    fireEvent.click(entryButton("Meetings"));
    expect(screen.queryByText("delete_meeting")).not.toBeInTheDocument();
    expect(screen.getByText(/Gong or Zoom summary notes/i)).toBeInTheDocument();
    expect(screen.getByText(/Meetings can't be deleted by the agent/i)).toBeInTheDocument();
  });

  it("says texts and calls only go to numbers on file", () => {
    openCapabilities();
    fireEvent.click(entryButton("Messaging & Calls"));
    expect(screen.getByText(/number on file for you or a teammate/i)).toBeInTheDocument();
  });
});

describe("New Agent PM skill — capabilities come from the server", () => {
  async function openCapabilityPicker() {
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "+ New" })[0]);
    const picker = await screen.findByTestId("capability-picker");
    fireEvent.click(within(picker).getByRole("button", { name: "View full list" }));
    // Groups are collapsed until opened; searching opens them all.
    fireEvent.change(within(picker).getByLabelText("Search capabilities"), { target: { value: "_" } });
    return picker;
  }

  it("offers only the tools the server marks skill-safe", async () => {
    const picker = await openCapabilityPicker();
    await waitFor(() => expect(within(picker).getByRole("checkbox", { name: "create_reminder" })).toBeInTheDocument());
    for (const tool of ["search_records", "create_action_item", "update_meeting"]) {
      expect(within(picker).getByRole("checkbox", { name: tool })).toBeInTheDocument();
    }
    // Deletes and outbound tools are never offered, even though the server lists them.
    for (const tool of ["delete_action_item", "send_sms", "delete_meeting"]) {
      expect(within(picker).queryByRole("checkbox", { name: tool })).not.toBeInTheDocument();
    }
  });

  it("follows the server when the registry changes", async () => {
    server.use(http.get("/api/v1/agents/tools/", () => HttpResponse.json({ tools: [
      { name: "list_tasks", group: "read", description: "x", skill_safe: true, requires_confirmation: false },
    ] })));
    const picker = await openCapabilityPicker();
    await waitFor(() => expect(within(picker).getByRole("checkbox", { name: "list_tasks" })).toBeInTheDocument());
    expect(within(picker).queryByRole("checkbox", { name: "create_action_item" })).not.toBeInTheDocument();
  });

  it("selecting a capability adds it as a removable chip", async () => {
    const picker = await openCapabilityPicker();
    fireEvent.click(await within(picker).findByRole("checkbox", { name: "search_records" }));
    expect(within(picker).getByRole("button", { name: /✓ search_records/ })).toBeInTheDocument();
    expect(within(picker).getByText(/1 of \d+ selected/)).toBeInTheDocument();
  });
});

describe("Agent Capabilities sidebar badges", () => {
  it("shows each operation kind once per entry, even when an entry has several tools of that kind", () => {
    openCapabilities();
    const accounts = entryButton("Accounts");
    // Accounts has several Create / Update / Read tools; the sidebar still reads one of each.
    for (const kind of ["Create", "Read", "Update"]) {
      expect(within(accounts).getAllByText(kind, { exact: true })).toHaveLength(1);
    }
  });
});

// ── New skill form: context, attachments, chaining, Generate wording ──────────────

describe("New Agent PM skill — builds on other things", () => {
  async function openForm() {
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "+ New" })[0]);
    await screen.findByTestId("capability-picker");
  }

  it("says Generate designs the INSTRUCTIONS from the description, outside the button", async () => {
    await openForm();
    expect(screen.getByText(/Claude will design the/i)).toHaveTextContent(/instructions.*description/i);
    expect(screen.getByRole("button", { name: /Generate instructions with Claude/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Generate with Claude$/ })).not.toBeInTheDocument();
  });

  it("puts the Twilio-skill picker below the description and above the Generate button", async () => {
    await openForm();
    const description = screen.getByPlaceholderText(/Use when the user asks for a weekly summary/);
    const picker = screen.getByTestId("twilio-skill-picker");
    const generate = screen.getByRole("button", { name: /Generate instructions with Claude/i });
    const before = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(description, picker)).toBe(true);
    expect(before(screen.getByTestId("capability-picker"), generate)).toBe(true);
    expect(before(screen.getByTestId("chained-skill-picker"), generate)).toBe(true);
    expect(before(picker, generate)).toBe(true);
  });

  it("searching Twilio skills multiselects them as flags on the page", async () => {
    await openForm();
    const box = within(screen.getByTestId("twilio-skill-picker")).getByLabelText("TWILIO SKILLS");
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "recordings" } });
    fireEvent.mouseDown(screen.getByRole("option", { name: /Call Recordings/ }));
    fireEvent.change(box, { target: { value: "conference" } });
    fireEvent.mouseDown(screen.getByRole("option", { name: /Conference Calls/ }));
    const flags = screen.getByTestId("twilio-skill-picker");
    expect(within(flags).getByRole("button", { name: "Remove Call Recordings" })).toBeInTheDocument();
    expect(within(flags).getByRole("button", { name: "Remove Conference Calls" })).toBeInTheDocument();
  });

  it("offers only approved skills to chain", async () => {
    server.use(http.get("/api/v1/skills/agent-skills/", () => HttpResponse.json({
      count: 2, next: null, previous: null,
      results: [mockAgentSkill({ id: 1, name: "weekly-update", status: "approved" }), mockAgentSkill({ id: 2, name: "half-baked", status: "draft" })],
    })));
    await openForm();
    const box = within(screen.getByTestId("chained-skill-picker")).getByLabelText("BUILD ON OTHER AGENT PM SKILLS");
    fireEvent.focus(box);
    await waitFor(() => expect(screen.getByRole("option", { name: /weekly-update/ })).toBeInTheDocument());
    expect(screen.queryByRole("option", { name: /half-baked/ })).not.toBeInTheDocument();
  });

  it("sends the selections to Generate so the instructions use them", async () => {
    let body: Record<string, unknown> = {};
    server.use(http.post("/api/v1/skills/agent-skills/generate/", async ({ request }) => {
      body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ name: "x", description: "d", instructions: "Do it", allowed_tools: [], needs_script: false, script: "" });
    }));
    await openForm();
    fireEvent.change(screen.getByPlaceholderText(/Use when the user asks for a weekly summary/), { target: { value: "Weekly summary" } });
    const box = within(screen.getByTestId("twilio-skill-picker")).getByLabelText("TWILIO SKILLS");
    fireEvent.focus(box);
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Call Recordings/ }));
    fireEvent.click(screen.getByLabelText(/Ask for the account\(s\) to run this for each time/));
    fireEvent.click(screen.getByRole("button", { name: /Generate instructions with Claude/i }));
    await waitFor(() => expect(body.description).toBe("Weekly summary"));
    expect(body.context).toMatchObject({ twilio_skills: ["twilio-call-recordings"], needs_accounts: true });
  });

  it("saves the new fields and uploads attachments after the skill exists", async () => {
    let created: Record<string, unknown> = {};
    // jsdom stringifies FormData before MSW sees it (see ActionItemModal.test), so read the
    // real FormData off the outgoing request config instead of the intercepted body.
    const uploads: { file: string; name: string | null }[] = [];
    const id = apiClient.interceptors.request.use((config) => {
      if (config.data instanceof FormData && String(config.url).includes("/attachments/")) {
        uploads.push({ file: (config.data.get("file") as File).name, name: config.data.get("name") as string | null });
      }
      return config;
    });
    server.use(
      http.post("/api/v1/skills/agent-skills/", async ({ request }) => {
        created = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(mockAgentSkill({ id: 42, name: "weekly-update", status: "draft" }), { status: 201 });
      }),
      http.post("/api/v1/skills/agent-skills/42/attachments/", () =>
        HttpResponse.json({ id: 1, name: "impact.md", url: "", file_url: "", mime_type: "", file_size: 4, has_text: true, artifact: null, uploaded_by_username: "x", created_at: "" }, { status: 201 })),
    );
    try {
      await openForm();
      fireEvent.change(screen.getByPlaceholderText(/e\.g\. Weekly Account Summary/), { target: { value: "Weekly Update" } });
      fireEvent.change(screen.getByPlaceholderText(/Use when the user asks for a weekly summary/), { target: { value: "Weekly updates" } });
      fireEvent.change(screen.getByPlaceholderText(/Search for all accounts with status Active/), { target: { value: "1. Do it" } });
      const box = within(screen.getByTestId("twilio-skill-picker")).getByLabelText("TWILIO SKILLS");
      fireEvent.focus(box);
      fireEvent.mouseDown(await screen.findByRole("option", { name: /Call Recordings/ }));
      fireEvent.click(screen.getByLabelText(/Ask for the account\(s\) to run this for each time/));
      fireEvent.change(screen.getByTestId("attachment-input"), { target: { files: [new File(["# hi"], "impact.md", { type: "text/markdown" })] } });
      fireEvent.click(screen.getByRole("button", { name: "Save as Draft" }));
      await waitFor(() => expect(uploads).toEqual([{ file: "impact.md", name: "impact.md" }]));
      expect(created).toMatchObject({
        name: "weekly-update", twilio_skills: ["twilio-call-recordings"], chained_skills: [], templates: [],
        context_defaults: { needs_accounts: true },
      });
      expect(await screen.findByRole("button", { name: "Review with Claude" })).toBeInTheDocument();
    } finally { apiClient.interceptors.request.eject(id); }
  });

  it("tells the user when an attachment couldn't be uploaded instead of dropping it", async () => {
    server.use(
      http.post("/api/v1/skills/agent-skills/", () => HttpResponse.json(mockAgentSkill({ id: 43, name: "weekly-update", status: "draft" }), { status: 201 })),
      http.post("/api/v1/skills/agent-skills/43/attachments/", () => HttpResponse.json({ detail: "That file is larger than 15 MB." }, { status: 400 })),
    );
    await openForm();
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Weekly Account Summary/), { target: { value: "Weekly Update" } });
    fireEvent.change(screen.getByPlaceholderText(/Use when the user asks for a weekly summary/), { target: { value: "Weekly updates" } });
    fireEvent.change(screen.getByPlaceholderText(/Search for all accounts with status Active/), { target: { value: "1. Do it" } });
    fireEvent.change(screen.getByTestId("attachment-input"), { target: { files: [new File(["x"], "huge.pdf")] } });
    fireEvent.click(screen.getByRole("button", { name: "Save as Draft" }));
    expect(await screen.findByText(/couldn't attach: huge\.pdf/i)).toBeInTheDocument();
  });

  it("the Slack picker is shown, disabled, until Slack is connected", async () => {
    await openForm();
    expect(await screen.findByText(/Slack isn't connected yet/i)).toBeInTheDocument();
  });
});

// ── Use in Chat / Use in Voice Session on every tab ───────────────────────────────

describe("Use in Chat and Use in Voice Session are on every skills tab", () => {
  it("Twilio Skills tab: a skill's detail offers both", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Twilio Skills" }));
    fireEvent.click((await screen.findAllByText("Call Recordings"))[0]);
    expect(await screen.findByRole("button", { name: "Use in Chat" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use in Voice Session" })).toBeInTheDocument();
  });

  it("Agent PM Skills tab: an approved skill offers both and is runnable", async () => {
    server.use(http.get("/api/v1/skills/agent-skills/", () => HttpResponse.json({
      count: 1, next: null, previous: null, results: [mockAgentSkill({ name: "weekly-update", status: "approved" })],
    })));
    renderPage();
    fireEvent.click(await screen.findByText(/Weekly Update/i));
    expect(await screen.findByRole("button", { name: "Use in Chat" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Use in Voice Session" })).toBeEnabled();
  });

  it("Agent PM Skills tab: a draft offers both but disabled, with the reason", async () => {
    server.use(http.get("/api/v1/skills/agent-skills/", () => HttpResponse.json({
      count: 1, next: null, previous: null, results: [mockAgentSkill({ name: "weekly-update", status: "draft" })],
    })));
    renderPage();
    fireEvent.click(await screen.findByText(/Weekly Update/i));
    const chat = await screen.findByRole("button", { name: "Use in Chat" });
    expect(chat).toBeDisabled();
    expect(chat).toHaveAttribute("title", "Skill must be approved before running");
    expect(screen.getByRole("button", { name: "Use in Voice Session" })).toBeDisabled();
  });

  it("Agent Capabilities tab: every example prompt has a Voice option that launches it", async () => {
    let body: Record<string, unknown> = {};
    server.use(http.post("/api/v1/skills/voice-launch/", async ({ request }) => {
      body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ key: "EX1", script: "Task" });
    }));
    const launched: unknown[] = [];
    const on = (e: Event) => launched.push((e as CustomEvent).detail);
    window.addEventListener("voice-launch", on);
    try {
      openCapabilities();
      fireEvent.click(entryButton("Time Logging (Cloud Coach)"));
      const voiceButtons = screen.getAllByRole("button", { name: /Use in Voice Session:/ });
      expect(voiceButtons).toHaveLength(3);
      fireEvent.click(voiceButtons[2]);
      await waitFor(() => expect(launched).toHaveLength(1));
      expect(body).toMatchObject({ title: "Time Logging (Cloud Coach)", text: "Log my time for this week to Cloud Coach" });
      expect(launched[0]).toMatchObject({ key: "EX1" });
    } finally { window.removeEventListener("voice-launch", on); }
  });

  it("Agent Capabilities tab: an example still sends to chat when clicked", () => {
    const sent: string[] = [];
    const on = (e: Event) => sent.push((e as CustomEvent).detail.text);
    window.addEventListener("chat-inject", on);
    try {
      openCapabilities();
      fireEvent.click(entryButton("Time Logging (Cloud Coach)"));
      fireEvent.click(screen.getByText(/Log my time for this week to Cloud Coach/));
      expect(sent).toEqual(["Log my time for this week to Cloud Coach"]);
    } finally { window.removeEventListener("chat-inject", on); }
  });
});

describe("Agent PM skill detail — what it builds on", () => {
  it("lists Twilio skills, chained skills, context and the account requirement", async () => {
    server.use(http.get("/api/v1/skills/agent-skills/", () => HttpResponse.json({
      count: 1, next: null, previous: null, results: [mockAgentSkill({
        name: "weekly-update", twilio_skills: ["twilio-call-recordings"], chained_skills: ["base-skill"],
        context_defaults: {
          needs_accounts: true,
          records: [{ resource_type: "meeting", resource_id: 9, label: "Acme QBR" }],
          slack: [{ id: "C1", kind: "channel", label: "#acme-team" }],
        },
        templates: [{ key: "a", title: "Weekly update", body_html: "<p>TEMPLATE BODY</p>" }],
        attachments: [{ id: 5, name: "Impact.md", url: "", file_url: "", mime_type: "", file_size: 10, has_text: true, artifact: null, uploaded_by_username: "x", created_at: "" }],
      })],
    })));
    renderPage();
    fireEvent.click(await screen.findByText(/Weekly Update/i));
    const builds = await screen.findByTestId("skill-builds-on");
    expect(builds).toHaveTextContent("Twilio · Call Recordings");
    expect(builds).toHaveTextContent("Skill · base-skill");
    expect(builds).toHaveTextContent("meeting · Acme QBR");
    expect(builds).toHaveTextContent("Slack · #acme-team");
    expect(builds).toHaveTextContent("Asks for account(s) when run");
    expect(screen.getByText("TEMPLATE BODY")).toBeInTheDocument();
    expect(screen.getByText(/Impact\.md/)).toBeInTheDocument();
  });

  it("viewing an attachment renders its text in-app", async () => {
    server.use(
      http.get("/api/v1/skills/agent-skills/", () => HttpResponse.json({
        count: 1, next: null, previous: null, results: [mockAgentSkill({
          name: "weekly-update", created_by_username: "someone-else",
          attachments: [{ id: 5, name: "Impact.md", url: "", file_url: "", mime_type: "", file_size: 10, has_text: true, artifact: null, uploaded_by_username: "x", created_at: "" }],
        })],
      })),
      http.get("/api/v1/skills/agent-skills/1/attachments/5/", () => HttpResponse.json({
        id: 5, name: "Impact.md", text: "## Friday Update\n\n* Key initiatives", url: "", file_url: "", mime_type: "", file_size: 10, has_text: true, artifact: null, uploaded_by_username: "x", created_at: "",
      })),
    );
    renderPage();
    fireEvent.click(await screen.findByText(/Weekly Update/i));
    fireEvent.click(await screen.findByRole("button", { name: "View" }));
    const dialog = await screen.findByRole("dialog", { name: "Attachment" });
    expect(await within(dialog).findByRole("heading", { name: "Friday Update" })).toBeInTheDocument();
    expect(within(dialog).getByText("Key initiatives")).toBeInTheDocument();
  });
});

// ── Claude recommended tools, inside the new-skill form ───────────────────────────────

describe("New Agent PM skill — Recommend tools with Claude", () => {
  async function openForm() {
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "+ New" })[0]);
    await screen.findByTestId("tool-recommender");
  }
  const describeIt = () => fireEvent.change(screen.getByPlaceholderText(/Use when the user asks for a weekly summary/), { target: { value: "Weekly account summary" } });

  it("sits between the Twilio-skill picker and the capability list, above Generate", async () => {
    await openForm();
    const before = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(screen.getByTestId("twilio-skill-picker"), screen.getByTestId("tool-recommender"))).toBe(true);
    expect(before(screen.getByTestId("tool-recommender"), screen.getByTestId("capability-picker"))).toBe(true);
    expect(before(screen.getByTestId("tool-recommender"), screen.getByRole("button", { name: /Generate instructions with Claude/i }))).toBe(true);
  });

  it("recommends from the description and adds the chosen tools to the capability picker", async () => {
    let body: Record<string, unknown> = {};
    server.use(http.post("/api/v1/skills/agent-skills/recommend-tools/", async ({ request }) => {
      body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ tools: [{ name: "search_records", reason: "find accounts" }, { name: "create_reminder", reason: "set follow-ups" }], limitations: [] });
    }));
    await openForm();
    expect(within(screen.getByTestId("capability-picker")).getByText(/0 of \d+ selected/)).toBeInTheDocument();
    describeIt();
    fireEvent.click(screen.getByRole("button", { name: "Recommend tools with Claude" }));
    expect(await screen.findByText("find accounts")).toBeInTheDocument();
    expect(body).toMatchObject({ description: "Weekly account summary" });
    fireEvent.click(screen.getByLabelText("Recommended: create_reminder"));       // keep only one
    fireEvent.click(screen.getByRole("button", { name: "Add 1 tool" }));
    const picker = screen.getByTestId("capability-picker");
    expect(within(picker).getByText(/1 of \d+ selected/)).toBeInTheDocument();
    expect(within(picker).getByRole("button", { name: /✓ search_records/ })).toBeInTheDocument();
    expect(within(picker).queryByRole("button", { name: /✓ create_reminder/ })).not.toBeInTheDocument();
  });

  it("is unavailable until a description is written", async () => {
    await openForm();
    expect(screen.getByRole("button", { name: "Recommend tools with Claude" })).toBeDisabled();
    describeIt();
    expect(screen.getByRole("button", { name: "Recommend tools with Claude" })).toBeEnabled();
  });

  it("recommended tools are saved with the skill", async () => {
    let created: Record<string, unknown> = {};
    server.use(
      http.post("/api/v1/skills/agent-skills/recommend-tools/", () =>
        HttpResponse.json({ tools: [{ name: "search_records", reason: "find accounts" }], limitations: [] })),
      http.post("/api/v1/skills/agent-skills/", async ({ request }) => {
        created = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(mockAgentSkill({ id: 50, name: "weekly-summary", status: "draft" }), { status: 201 });
      }),
    );
    await openForm();
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Weekly Account Summary/), { target: { value: "Weekly Summary" } });
    describeIt();
    fireEvent.change(screen.getByPlaceholderText(/Search for all accounts with status Active/), { target: { value: "1. Do it" } });
    fireEvent.click(screen.getByRole("button", { name: "Recommend tools with Claude" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add 1 tool" }));
    fireEvent.click(screen.getByRole("button", { name: "Save as Draft" }));
    await waitFor(() => expect(created.allowed_tools).toEqual(["search_records"]));
  });
});
