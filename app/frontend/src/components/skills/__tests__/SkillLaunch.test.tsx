import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { mockAgentSkill, mockRunResult } from "../../../test/handlers/skills";
import SkillLaunchButtons from "../SkillLaunchButtons";
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
