import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { mockAgentSkill, mockRunResult } from "../../../test/handlers/skills";
import SkillLaunchButtons from "../SkillLaunchButtons";
import { usesDateRange } from "../SkillRunDialog";
import { TIMEFRAME_PRESETS, DEFAULT_TIMEFRAME, customRange } from "../../../lib/timeframes";
import { VOICE_LAUNCH_EVENT } from "../../VoiceButton";

beforeAll(() => { if (!document.elementFromPoint) document.elementFromPoint = () => document.body; });

let chat: string[];
let voice: { key?: string; script: string; title?: string }[];
const onChat = (e: Event) => chat.push((e as CustomEvent).detail.text);
const onVoice = (e: Event) => voice.push((e as CustomEvent).detail);

beforeEach(() => {
  chat = []; voice = [];
  window.addEventListener("chat-inject", onChat);
  window.addEventListener(VOICE_LAUNCH_EVENT, onVoice);
  server.use(http.get("/api/v1/accounts/accounts/", () => HttpResponse.json({
    count: 2, next: null, previous: null,
    results: [{ id: 1, company_name: "Acme Corp" }, { id: 2, company_name: "Globex" }],
  })));
});
afterEach(() => {
  window.removeEventListener("chat-inject", onChat);
  window.removeEventListener(VOICE_LAUNCH_EVENT, onVoice);
});

describe("SkillLaunchButtons — text sources (Twilio skills, tools, examples)", () => {
  const source = { kind: "text" as const, title: "Call Recordings", chatText: "/twilio-call-recordings", voiceText: "Explain recording." };

  it("offers both Use in Chat and Use in Voice Session", () => {
    render(<SkillLaunchButtons source={source} />);
    expect(screen.getByRole("button", { name: "Use in Chat" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use in Voice Session" })).toBeInTheDocument();
  });

  it("Use in Chat injects the text without any request", async () => {
    render(<SkillLaunchButtons source={source} />);
    fireEvent.click(screen.getByRole("button", { name: "Use in Chat" }));
    await waitFor(() => expect(chat).toEqual(["/twilio-call-recordings"]));
    expect(voice).toEqual([]);
  });

  it("Use in Voice stores the brief server-side and launches with only the key", async () => {
    let body: unknown;
    server.use(http.post("/api/v1/skills/voice-launch/", async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ key: "KEY1", script: "Task: Call Recordings. Explain recording." });
    }));
    render(<SkillLaunchButtons source={source} />);
    fireEvent.click(screen.getByRole("button", { name: "Use in Voice Session" }));
    await waitFor(() => expect(voice).toHaveLength(1));
    expect(body).toEqual({ title: "Call Recordings", text: "Explain recording." });
    expect(voice[0]).toMatchObject({ key: "KEY1", title: "Call Recordings" });
    expect(chat).toEqual([]);
  });

  it("reports a failed voice start instead of failing silently", async () => {
    server.use(http.post("/api/v1/skills/voice-launch/", () => HttpResponse.json({ detail: "text is required." }, { status: 400 })));
    render(<SkillLaunchButtons source={source} />);
    fireEvent.click(screen.getByRole("button", { name: "Use in Voice Session" }));
    expect(await screen.findByRole("status")).toHaveTextContent("text is required.");
    expect(voice).toEqual([]);
  });
});

describe("SkillLaunchButtons — Agent PM skills", () => {
  it("a skill with no inputs needed runs straight away in chat", async () => {
    let runBody: unknown;
    server.use(http.post("/api/v1/skills/agent-skills/1/run/", async ({ request }) => {
      runBody = await request.json();
      return HttpResponse.json(mockRunResult({ prompt: "/test-skill\n\nDo the thing" }));
    }));
    render(<SkillLaunchButtons source={{ kind: "agent-skill", skill: mockAgentSkill() }} />);
    fireEvent.click(screen.getByRole("button", { name: "Use in Chat" }));
    await waitFor(() => expect(chat).toEqual(["/test-skill\n\nDo the thing"]));
    expect(runBody).toMatchObject({ args: {} });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a skill with no inputs needed starts voice through voice-start", async () => {
    server.use(http.post("/api/v1/skills/agent-skills/1/voice-start/", () =>
      HttpResponse.json({ key: "VK", script: "Workflow: test-skill.", warnings: [] })));
    render(<SkillLaunchButtons source={{ kind: "agent-skill", skill: mockAgentSkill() }} />);
    fireEvent.click(screen.getByRole("button", { name: "Use in Voice Session" }));
    await waitFor(() => expect(voice).toEqual([{ key: "VK", script: "Workflow: test-skill.", title: "test-skill" }]));
  });

  it("a skill that needs accounts opens the run dialog instead of running blind", async () => {
    const skill = mockAgentSkill({ context_defaults: { needs_accounts: true } });
    render(<SkillLaunchButtons source={{ kind: "agent-skill", skill }} />);
    fireEvent.click(screen.getByRole("button", { name: "Use in Chat" }));
    const dialog = await screen.findByRole("dialog", { name: "Run test-skill" });
    expect(dialog).toBeInTheDocument();
    expect(chat).toEqual([]);
  });

  it("is disabled, with the reason, for a skill that isn't approved", () => {
    render(<SkillLaunchButtons source={{ kind: "agent-skill", skill: mockAgentSkill({ status: "draft" }) }}
      disabled disabledReason="Skill must be approved before running" />);
    for (const name of ["Use in Chat", "Use in Voice Session"]) {
      const b = screen.getByRole("button", { name });
      expect(b).toBeDisabled();
      expect(b).toHaveAttribute("title", "Skill must be approved before running");
    }
  });

  it("surfaces the server's message when a run is refused", async () => {
    server.use(http.post("/api/v1/skills/agent-skills/1/run/", () =>
      HttpResponse.json({ detail: "Skill is not approved (status: draft)." }, { status: 400 })));
    render(<SkillLaunchButtons source={{ kind: "agent-skill", skill: mockAgentSkill() }} />);
    fireEvent.click(screen.getByRole("button", { name: "Use in Chat" }));
    expect(await screen.findByRole("status")).toHaveTextContent("not approved");
    expect(chat).toEqual([]);
  });
});

describe("SkillRunDialog", () => {
  const needy = () => mockAgentSkill({
    context_defaults: { needs_accounts: true },
    templates: [
      { key: "weekly", title: "Weekly update", body_html: "<p>WEEKLY</p>" },
      { key: "plan", title: "Net-new plan", body_html: "<p>PLAN</p>" },
    ],
    attachments: [{ id: 1, name: "Ref.md", url: "", file_url: "", mime_type: "", file_size: 1, has_text: true, artifact: null, uploaded_by_username: "x", created_at: "" }],
  });
  const open = async (mode: "Use in Chat" | "Use in Voice Session" = "Use in Chat") => {
    render(<SkillLaunchButtons source={{ kind: "agent-skill", skill: needy() }} />);
    fireEvent.click(screen.getByRole("button", { name: mode }));
    return screen.findByRole("dialog");
  };

  it("won't run until an account is chosen when the skill requires one", async () => {
    const dialog = await open();
    await within(dialog).findByRole("checkbox", { name: "Acme Corp" });
    const send = within(dialog).getByRole("button", { name: "Send to chat" });
    expect(send).toBeDisabled();
    expect(send).toHaveAttribute("title", "Choose at least one account");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Acme Corp" }));
    expect(send).toBeEnabled();
  });

  it("sends the chosen accounts and template, and Select all picks every account", async () => {
    let body: Record<string, unknown> = {};
    server.use(http.post("/api/v1/skills/agent-skills/1/run/", async ({ request }) => {
      body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json(mockRunResult({ prompt: "ASSEMBLED PROMPT" }));
    }));
    const dialog = await open();
    await within(dialog).findByRole("checkbox", { name: "Acme Corp" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Select all" }));
    fireEvent.click(within(dialog).getByRole("tab", { name: "Net-new plan" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Send to chat" }));
    await waitFor(() => expect(chat).toEqual(["ASSEMBLED PROMPT"]));
    expect(body).toMatchObject({ account_ids: [1, 2], template_key: "plan" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("mentions the attached documents that will be used", async () => {
    const dialog = await open();
    expect(within(dialog).getByText(/1 attached document will be used as context/)).toBeInTheDocument();
  });

  it("in voice mode it calls voice-start and launches with the returned key", async () => {
    let body: Record<string, unknown> = {};
    server.use(http.post("/api/v1/skills/agent-skills/1/voice-start/", async ({ request }) => {
      body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ key: "VK9", script: "Workflow: test-skill. Accounts: Globex.", warnings: [] });
    }));
    const dialog = await open("Use in Voice Session");
    await within(dialog).findByRole("checkbox", { name: "Globex" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Globex" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Start voice session" }));
    await waitFor(() => expect(voice).toHaveLength(1));
    expect(voice[0]).toMatchObject({ key: "VK9" });
    expect(body).toMatchObject({ account_ids: [2] });
    expect(chat).toEqual([]);
  });

  it("keeps the dialog open to show warnings from the server", async () => {
    server.use(http.post("/api/v1/skills/agent-skills/1/run/", () =>
      HttpResponse.json(mockRunResult({ warnings: ["Chained skill 'x' is unavailable to you and was skipped."] }))));
    const dialog = await open();
    await within(dialog).findByRole("checkbox", { name: "Acme Corp" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Acme Corp" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Send to chat" }));
    expect(await within(dialog).findByText(/unavailable to you and was skipped/)).toBeInTheDocument();
    expect(chat).toHaveLength(1);
  });

  it("shows the server's error and stays open when the run is refused", async () => {
    server.use(http.post("/api/v1/skills/agent-skills/1/run/", () =>
      HttpResponse.json({ detail: "This skill needs at least one account." }, { status: 400 })));
    const dialog = await open();
    await within(dialog).findByRole("checkbox", { name: "Acme Corp" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Acme Corp" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Send to chat" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("needs at least one account");
    expect(chat).toEqual([]);
  });

  it("Cancel closes without sending anything", async () => {
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(chat).toEqual([]);
  });
});

describe("SkillRunDialog — timeframe", () => {
  const withRange = (instructions = "@#--all-meeting-notes-${account_name}-${date_range}") =>
    mockAgentSkill({ instructions, context_defaults: { needs_accounts: true } });
  const openFor = async (skill = withRange()) => {
    render(<SkillLaunchButtons source={{ kind: "agent-skill", skill }} />);
    fireEvent.click(screen.getByRole("button", { name: "Use in Chat" }));
    return screen.findByRole("dialog");
  };
  const group = (d: HTMLElement) => within(d).getByRole("group", { name: /TIMEFRAME/ });
  const sendBody = async (d: HTMLElement, body: { current: Record<string, unknown> }) => {
    await within(d).findByRole("checkbox", { name: "Acme Corp" });
    fireEvent.click(within(d).getByRole("checkbox", { name: "Acme Corp" }));
    fireEvent.click(within(d).getByRole("button", { name: "Send to chat" }));
    await waitFor(() => expect(chat).toHaveLength(1));
    return body.current;
  };
  const capture = () => {
    const body = { current: {} as Record<string, unknown> };
    server.use(http.post("/api/v1/skills/agent-skills/1/run/", async ({ request }) => {
      body.current = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json(mockRunResult({ prompt: "P" }));
    }));
    return body;
  };

  it("offers the default timeframes as buttons when the skill's lookups use a date range", async () => {
    const d = await openFor();
    for (const label of ["Last 7 days", "Last 30 days", "Last 90 days", "This week", "Last week", "This month", "Last month", "This quarter", "Last quarter", "This year", "Last year", "Custom…"]) {
      expect(within(group(d)).getByRole("button", { name: label }), label).toBeInTheDocument();
    }
  });

  it("Last 30 days is selected to begin with", async () => {
    const d = await openFor();
    expect(within(group(d)).getByRole("button", { name: "Last 30 days" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group(d)).getByRole("button", { name: "Last week" })).toHaveAttribute("aria-pressed", "false");
  });

  it("does not ask when the skill has no date range", async () => {
    const d = await openFor(withRange("@#--all-artifacts-${account_name}"));
    expect(within(d).queryByRole("group", { name: /TIMEFRAME/ })).toBeNull();
  });

  it("choosing a button selects only that one", async () => {
    const d = await openFor();
    fireEvent.click(within(group(d)).getByRole("button", { name: "This quarter" }));
    expect(within(group(d)).getByRole("button", { name: "This quarter" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group(d)).getByRole("button", { name: "Last 30 days" })).toHaveAttribute("aria-pressed", "false");
  });

  it("sends the default when nothing is changed", async () => {
    const body = capture();
    const d = await openFor();
    expect(await sendBody(d, body)).toMatchObject({ account_ids: [1], date_range: "last-30-days" });
  });

  it("sends the chosen button's range", async () => {
    const body = capture();
    const d = await openFor();
    fireEvent.click(within(group(d)).getByRole("button", { name: "Last month" }));
    expect(await sendBody(d, body)).toMatchObject({ date_range: "last-month" });
  });

  it("Custom… reveals From and To dates and sends them as a range", async () => {
    const body = capture();
    const d = await openFor();
    expect(within(d).queryByLabelText("From date")).toBeNull();
    fireEvent.click(within(group(d)).getByRole("button", { name: "Custom…" }));
    fireEvent.change(within(d).getByLabelText("From date"), { target: { value: "2026-10-01" } });
    fireEvent.change(within(d).getByLabelText("To date"), { target: { value: "2026-10-31" } });
    expect(await sendBody(d, body)).toMatchObject({ date_range: "2026-10-01..2026-10-31" });
  });

  it("with Custom… chosen but only one date, nothing can be launched yet", async () => {
    const d = await openFor();
    await within(d).findByRole("checkbox", { name: "Acme Corp" });
    fireEvent.click(within(d).getByRole("checkbox", { name: "Acme Corp" }));
    fireEvent.click(within(group(d)).getByRole("button", { name: "Custom…" }));
    fireEvent.change(within(d).getByLabelText("From date"), { target: { value: "2026-10-01" } });
    for (const name of ["Run skill", "Send to chat", "Start voice session"]) {
      expect(within(d).getByRole("button", { name })).toBeDisabled();
      expect(within(d).getByRole("button", { name })).toHaveAttribute("title", "Choose both dates");
    }
    fireEvent.change(within(d).getByLabelText("To date"), { target: { value: "2026-10-31" } });
    expect(within(d).getByRole("button", { name: "Send to chat" })).toBeEnabled();
  });

  it("the From date cannot be set after the To date, and vice versa", async () => {
    const d = await openFor();
    fireEvent.click(within(group(d)).getByRole("button", { name: "Custom…" }));
    fireEvent.change(within(d).getByLabelText("From date"), { target: { value: "2026-10-05" } });
    fireEvent.change(within(d).getByLabelText("To date"), { target: { value: "2026-10-20" } });
    expect(within(d).getByLabelText("From date")).toHaveAttribute("max", "2026-10-20");
    expect(within(d).getByLabelText("To date")).toHaveAttribute("min", "2026-10-05");
  });

  it("switching from Custom… back to a button uses the button", async () => {
    const body = capture();
    const d = await openFor();
    fireEvent.click(within(group(d)).getByRole("button", { name: "Custom…" }));
    fireEvent.change(within(d).getByLabelText("From date"), { target: { value: "2026-10-01" } });
    fireEvent.click(within(group(d)).getByRole("button", { name: "Last week" }));
    expect(within(d).queryByLabelText("From date")).toBeNull();
    expect(await sendBody(d, body)).toMatchObject({ date_range: "last-week" });
  });

  it("shows the server's message when the range can't be read", async () => {
    server.use(http.post("/api/v1/skills/agent-skills/1/run/", () =>
      HttpResponse.json({ detail: "Could not read the date range 'x'." }, { status: 400 })));
    const d = await openFor();
    await within(d).findByRole("checkbox", { name: "Acme Corp" });
    fireEvent.click(within(d).getByRole("checkbox", { name: "Acme Corp" }));
    fireEvent.click(within(d).getByRole("button", { name: "Send to chat" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent("Could not read the date range 'x'.");
  });
});

describe("timeframe presets", () => {
  it("every preset is a range the server reads (the same names its parser accepts)", () => {
    const readable = /^(last-\d+-days|this-week|last-week|this-month|last-month|this-quarter|last-quarter|this-year|last-year)$/;
    for (const p of TIMEFRAME_PRESETS) expect(p.value, p.label).toMatch(readable);
    expect(TIMEFRAME_PRESETS.map((p) => p.value)).toContain(DEFAULT_TIMEFRAME);
  });
  it("customRange joins two dates, and is empty until both are set", () => {
    expect(customRange("2026-10-01", "2026-10-31")).toBe("2026-10-01..2026-10-31");
    expect(customRange("2026-10-01", "")).toBe("");
    expect(customRange("", "2026-10-31")).toBe("");
  });
});

describe("usesDateRange", () => {
  const t = (instructions: string, body_html = "") => ({ instructions, templates: body_html ? [{ key: "a", title: "A", body_html }] : [] });
  it("recognises the placeholder spellings", () => {
    for (const p of ["${date_range}", "${date-range}", "${ Date Range }", "${range}", "${period}"]) expect(usesDateRange(t(`x ${p} y`)), p).toBe(true);
  });
  it("looks in templates too", () => expect(usesDateRange(t("none", "<p>${date_range}</p>"))).toBe(true));
  it("is false for skills without one, and for a literal range", () => {
    expect(usesDateRange(t("@#--all-artifacts-${account_name}"))).toBe(false);
    expect(usesDateRange(t("@#--all-meeting-notes-${account_name}-${october}"))).toBe(false);
  });
});

describe("SkillLaunchButtons — data stored for the agent", () => {
  const skill = mockAgentSkill({ id: 9, name: "big-recap" });

  it("says when a run's data was too big to paste and is stored in parts", async () => {
    server.use(http.post("/api/v1/skills/agent-skills/9/run/", () => HttpResponse.json(
      mockRunResult({ run_id: "r1", data_staged: { parts: 3, characters: 31234 } }))));
    render(<SkillLaunchButtons source={{ kind: "agent-skill", skill }} />);
    fireEvent.click(screen.getByRole("button", { name: "Use in Chat" }));
    expect(await screen.findByRole("status")).toHaveTextContent("31,234 characters of data are stored for the agent to read in 3 parts");
    await waitFor(() => expect(chat).toHaveLength(1));
  });

  it("stays quiet about it for an ordinary run", async () => {
    server.use(http.post("/api/v1/skills/agent-skills/9/run/", () => HttpResponse.json(mockRunResult())));
    render(<SkillLaunchButtons source={{ kind: "agent-skill", skill }} />);
    fireEvent.click(screen.getByRole("button", { name: "Use in Chat" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/^Sent to chat\.$/);
  });
});
