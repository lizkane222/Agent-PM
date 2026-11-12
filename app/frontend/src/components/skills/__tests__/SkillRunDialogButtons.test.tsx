import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { mockAgentSkill, mockRunResult } from "../../../test/handlers/skills";
import SkillRunDialog, { describeLaunchError } from "../SkillRunDialog";
import { VOICE_LAUNCH_EVENT } from "../../VoiceButton";

beforeAll(() => { if (!document.elementFromPoint) document.elementFromPoint = () => document.body; });

let injected: { text: string; send?: boolean; run_id?: string }[];
let voice: { key?: string }[];
const onChat = (e: Event) => injected.push((e as CustomEvent).detail);
const onVoice = (e: Event) => voice.push((e as CustomEvent).detail);

beforeEach(() => {
  injected = []; voice = [];
  window.addEventListener("chat-inject", onChat);
  window.addEventListener(VOICE_LAUNCH_EVENT, onVoice);
  server.use(http.get("/api/v1/accounts/accounts/", () => HttpResponse.json({
    count: 1, next: null, previous: null, results: [{ id: 1, company_name: "Acme Corp" }],
  })));
});
afterEach(() => {
  window.removeEventListener("chat-inject", onChat);
  window.removeEventListener(VOICE_LAUNCH_EVENT, onVoice);
});

const skill = (over = {}) => mockAgentSkill({ context_defaults: { needs_accounts: true }, ...over });
async function openDialog(mode: "chat" | "run" | "voice" = "run", s = skill()) {
  render(<SkillRunDialog skill={s} mode={mode} onClose={() => {}} />);
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByRole("checkbox", { name: "Acme Corp" });
  return dialog;
}
const pick = (d: HTMLElement) => fireEvent.click(within(d).getByRole("checkbox", { name: "Acme Corp" }));

describe("SkillRunDialog — Run, Chat and Voice together", () => {
  it("offers all three buttons whichever way it was opened", async () => {
    for (const mode of ["run", "chat", "voice"] as const) {
      const { unmount } = render(<SkillRunDialog skill={skill()} mode={mode} onClose={() => {}} />);
      const d = await screen.findByRole("dialog");
      for (const name of ["Run skill", "Send to chat", "Start voice session"]) {
        expect(within(d).getByRole("button", { name }), `${mode}: ${name}`).toBeInTheDocument();
      }
      unmount();
    }
  });

  it("the button for the way it was opened is the filled one", async () => {
    const d = await openDialog("voice");
    pick(d);
    expect(within(d).getByRole("button", { name: "Start voice session" }).style.background).toContain("var(--twilio-red");
    expect(within(d).getByRole("button", { name: "Run skill" }).style.background).toBe("transparent");
  });

  it("all three are disabled until a required account is chosen", async () => {
    const d = await openDialog();
    for (const name of ["Run skill", "Send to chat", "Start voice session"]) expect(within(d).getByRole("button", { name })).toBeDisabled();
    pick(d);
    for (const name of ["Run skill", "Send to chat", "Start voice session"]) expect(within(d).getByRole("button", { name })).toBeEnabled();
  });

  it("Run skill puts the prompt in chat AND asks for it to be sent", async () => {
    server.use(http.post("/api/v1/skills/agent-skills/1/run/", () => HttpResponse.json(mockRunResult({ prompt: "GO" }))));
    const d = await openDialog("chat");
    pick(d);
    fireEvent.click(within(d).getByRole("button", { name: "Run skill" }));
    await waitFor(() => expect(injected).toHaveLength(1));
    expect(injected[0]).toMatchObject({ text: "GO", send: true });
  });

  it("Send to chat only puts the prompt in the chat box (no send)", async () => {
    server.use(http.post("/api/v1/skills/agent-skills/1/run/", () => HttpResponse.json(mockRunResult({ prompt: "GO" }))));
    const d = await openDialog("run");
    pick(d);
    fireEvent.click(within(d).getByRole("button", { name: "Send to chat" }));
    await waitFor(() => expect(injected).toHaveLength(1));
    expect(injected[0].text).toBe("GO");
    expect(injected[0].send).toBeUndefined();
  });

  it("Start voice session calls voice-start and launches with the key, not chat", async () => {
    server.use(http.post("/api/v1/skills/agent-skills/1/voice-start/", () => HttpResponse.json({ key: "VK", script: "s", warnings: [] })));
    const d = await openDialog("chat");
    pick(d);
    fireEvent.click(within(d).getByRole("button", { name: "Start voice session" }));
    await waitFor(() => expect(voice).toHaveLength(1));
    expect(voice[0].key).toBe("VK");
    expect(injected).toEqual([]);
  });

  it("every button sends the same input (accounts, date range)", async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post("/api/v1/skills/agent-skills/1/run/", async ({ request }) => { bodies.push(await request.json() as Record<string, unknown>); return HttpResponse.json(mockRunResult()); }),
      http.post("/api/v1/skills/agent-skills/1/voice-start/", async ({ request }) => { bodies.push(await request.json() as Record<string, unknown>); return HttpResponse.json({ key: "K", script: "", warnings: [] }); }),
    );
    for (const name of ["Run skill", "Send to chat", "Start voice session"]) {
      const { unmount } = render(<SkillRunDialog skill={skill({ instructions: "x ${date_range}" })} mode="run" onClose={() => {}} />);
      const d = await screen.findByRole("dialog");
      await within(d).findByRole("checkbox", { name: "Acme Corp" });
      pick(d);
      fireEvent.click(within(d).getByRole("button", { name: "Last week" }));
      fireEvent.click(within(d).getByRole("button", { name }));
      await waitFor(() => expect(bodies.length).toBeGreaterThan(0));
      unmount();
      const last = bodies.at(-1)!;
      expect(last, name).toMatchObject({ account_ids: [1], date_range: "last-week" });
    }
    expect(bodies).toHaveLength(3);
  });

  it("only the pressed button shows its working text; the others are locked meanwhile", async () => {
    let release: () => void = () => {};
    server.use(http.post("/api/v1/skills/agent-skills/1/run/", async () => {
      await new Promise<void>((r) => { release = r; });
      return HttpResponse.json(mockRunResult());
    }));
    const d = await openDialog();
    pick(d);
    fireEvent.click(within(d).getByRole("button", { name: "Send to chat" }));
    expect(await within(d).findByRole("button", { name: "Sending…" })).toBeDisabled();
    expect(within(d).getByRole("button", { name: "Run skill" })).toBeDisabled();
    expect(within(d).getByRole("button", { name: "Start voice session" })).toBeDisabled();
    release();
  });
});

describe("SkillRunDialog — says what went wrong", () => {
  it("shows the server's message when there is one", async () => {
    server.use(http.post("/api/v1/skills/agent-skills/1/run/", () => HttpResponse.json({ detail: "Skill is not approved (status: draft)." }, { status: 400 })));
    const d = await openDialog();
    pick(d);
    fireEvent.click(within(d).getByRole("button", { name: "Run skill" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent("Skill is not approved (status: draft).");
  });

  it("explains a rejected request that carries no message (an HTML error page)", async () => {
    server.use(http.post("/api/v1/skills/agent-skills/1/run/", () => new HttpResponse("<html>Bad request</html>", { status: 400, headers: { "Content-Type": "text/html" } })));
    const d = await openDialog();
    pick(d);
    fireEvent.click(within(d).getByRole("button", { name: "Send to chat" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent("The server rejected the request (400).");
  });

  it("describeLaunchError covers throttling, server errors, sign-out and a dead connection", () => {
    const http = (status: number, data?: unknown) => ({ response: { status, data } });
    expect(describeLaunchError(http(429))).toMatch(/Too many requests/);
    expect(describeLaunchError(http(500))).toMatch(/server hit an error \(500\)/);
    expect(describeLaunchError(http(401))).toMatch(/session has expired/);
    expect(describeLaunchError(http(403, { message: "Over your daily limit." }))).toBe("Over your daily limit.");
    expect(describeLaunchError(http(400, { error: "Bad thing" }))).toBe("Bad thing");
    expect(describeLaunchError({ message: "Network Error" })).toMatch(/Couldn't reach the server/);
    expect(describeLaunchError({ code: "ECONNABORTED" })).toMatch(/took too long/);
    expect(describeLaunchError(new Error("boom"))).toBe("Couldn't run this skill (boom).");
  });
});
