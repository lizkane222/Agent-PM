import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockAgentSessions } from "../../test/handlers/agents";
import { mockAgentSkill } from "../../test/handlers/skills";
import { EXPORT_ITEM_DRAG_KEY } from "../../components/ExportBar";
import type { AgentSession } from "../../types";

vi.mock("../../components/pagebuilder/PageBuilder", () => ({ default: () => <div /> }));

vi.mock("../../assets/icons/Conversation.svg?react", () => ({ default: () => <svg /> }));

import ChatPage from "../ChatPage";

const session = (messages: AgentSession["messages"]): AgentSession =>
  ({ ...mockAgentSessions[0]!, id: 5, title: "Pricing chat", messages });

const msg = (id: number, role: "user" | "assistant", content: string, extra = {}) =>
  ({ id, role, content, input_tokens: 0, output_tokens: 0, tool_calls: [], created_at: "2026-11-10T10:00:00Z", ...extra });

function serve(sessions: AgentSession[]) {
  server.use(http.get("/api/v1/agents/sessions/", () => HttpResponse.json({ results: sessions, count: sessions.length })));
}
const ACCESS_KEY = "agentpm_access";
const renderPage = () => render(<MemoryRouter><ChatPage /></MemoryRouter>);

function dropData(item: object) {
  const data: Record<string, string> = { [EXPORT_ITEM_DRAG_KEY]: JSON.stringify(item) };
  return { types: [EXPORT_ITEM_DRAG_KEY], getData: (k: string) => data[k] ?? "", dropEffect: "", effectAllowed: "" };
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  // The streaming fetch bypasses axios, so it needs a token that has not expired.
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "");
  localStorage.setItem(ACCESS_KEY, `${b64({ alg: "none" })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`);
});

describe("ChatPage", () => {
  it("shows the empty state with no sessions", async () => {
    serve([]);
    renderPage();
    expect(await screen.findByText("Agent PM is ready")).toBeInTheDocument();
  });

  it("starter buttons never animate (no shaking)", async () => {
    serve([]);
    renderPage();
    const btn = await screen.findByRole("button", { name: /How do I use this app/ });
    expect(btn.style.animationName).toBe("");
    expect(document.querySelector("style")?.textContent ?? "").not.toMatch(/jitter/);
  });

  it("clicking the Agent title starts a new conversation, like + New", async () => {
    serve([session([msg(1, "user", "hello there"), msg(2, "assistant", "hi")])]);
    renderPage();
    expect(await screen.findByText("hello there")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Agent$/ }));
    expect(await screen.findByText("Agent PM is ready")).toBeInTheDocument();
    expect(localStorage.getItem("agentpm_last_session_id")).toBeNull();
  });

  it("renders attached records as chips and keeps the text readable", async () => {
    const content = "Compare these\n\n---\n\n## Acme (account)\nName: Acme\nARR: 10\n\n---\n\n## Fix billing (action_item)\nDue Friday";
    serve([session([msg(1, "user", content)])]);
    renderPage();
    const chips = await screen.findAllByTestId("attachment-chip");
    expect(chips.map((c) => c.getAttribute("data-attachment-type"))).toEqual(["account", "action_item"]);
    expect(screen.getByText("Compare these")).toBeInTheDocument();
    // The wall of text is not on screen until a chip is opened.
    expect(screen.queryByText(/ARR: 10/)).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByTitle("Show full content")[0]!);
    expect(screen.getByTestId("attachment-content")).toHaveTextContent("ARR: 10");
  });

  it("reveals tokens and cost under an assistant reply", async () => {
    serve([session([
      msg(1, "user", "q"),
      msg(2, "assistant", "answer", { input_tokens: 1200, output_tokens: 300, cost_usd: "0.0081" }),
    ])]);
    renderPage();
    const toggle = await screen.findByRole("button", { name: "tokens · cost" });
    expect(screen.queryByText(/1,500 tokens/)).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.getByText(/1,500 tokens \(1,200 in · 300 out\) · \$0\.0081/)).toBeInTheDocument();
  });

  it("shows no usage toggle on a message with no recorded tokens", async () => {
    serve([session([msg(1, "user", "q"), msg(2, "assistant", "answer")])]);
    renderPage();
    await screen.findByText("answer");
    expect(screen.queryByRole("button", { name: "tokens · cost" })).not.toBeInTheDocument();
  });

  it("accepts export-tray pills dropped on the chat and sends them with the message", async () => {
    serve([]);
    let body: { message: string } | null = null;
    server.use(http.post("/api/v1/agents/sessions/send/", async ({ request }) => {
      body = (await request.json()) as { message: string };
      return new HttpResponse("ok", { headers: { "X-Session-Id": "9" } });
    }));
    renderPage();
    await screen.findByText("Agent PM is ready");
    const zone = screen.getByTestId("chat-drop-zone");
    const item = { id: "account:1", type: "account", label: "Acme", summary: "Customer", content: "Name: Acme\nARR: 10" };

    // dragover only exposes types, and must be accepted (default prevented) for drop to fire.
    const over = fireEvent.dragOver(zone, { dataTransfer: { types: [EXPORT_ITEM_DRAG_KEY] } });
    expect(over).toBe(false);
    // An unrelated drag is not accepted.
    expect(fireEvent.dragOver(zone, { dataTransfer: { types: ["Files"] } })).toBe(true);

    fireEvent.drop(zone, { dataTransfer: dropData(item) });
    fireEvent.drop(zone, { dataTransfer: dropData(item) }); // duplicate ignored
    const pending = await screen.findByTestId("pending-attachments");
    expect(pending.querySelectorAll("[data-testid=attachment-chip]")).toHaveLength(1);

    await userEvent.type(screen.getByPlaceholderText(/Or just start typing/), "Look at this");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.message).toContain("Look at this");
    expect(body!.message).toContain("## Acme (account)\nName: Acme\nARR: 10"); // full content reaches the model
    await waitFor(() => expect(screen.queryByTestId("pending-attachments")).not.toBeInTheDocument());
    // And the sent bubble shows a chip, not the raw text.
    expect((await screen.findAllByTestId("attachment-chip")).length).toBe(1);
    expect(screen.queryByText(/ARR: 10/)).not.toBeInTheDocument();
  });

  it("can send attachments alone and remove a pending one", async () => {
    serve([]);
    renderPage();
    await screen.findByText("Agent PM is ready");
    const zone = screen.getByTestId("chat-drop-zone");
    fireEvent.drop(zone, { dataTransfer: dropData({ id: "note:1", type: "note", label: "N", summary: "s", content: "c" }) });
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Remove N" }));
    expect(screen.queryByTestId("pending-attachments")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("shows an export-to-chat payload as attachments", async () => {
    serve([]);
    server.use(http.post("/api/v1/agents/sessions/send/", () => new HttpResponse("sure", { headers: { "X-Session-Id": "3" } })));
    sessionStorage.setItem("agentpm_export_to_chat",
      ["I've selected the following content to export. Please ask me how I'd like to compile it:\n", "## Acme (account)\nsummary line\nsecret second line"].join("\n\n---\n\n"));
    renderPage();
    expect(await screen.findByTestId("attachment-chip")).toHaveAttribute("data-attachment-type", "account");
    expect(screen.queryByText(/secret second line/)).not.toBeInTheDocument();
  });

  describe("slash skill lookup", () => {
    const serveSkills = () => server.use(http.get("/api/v1/skills/agent-skills/", () =>
      HttpResponse.json({ count: 1, next: null, previous: null, results: [mockAgentSkill({ id: 9, name: "weekly-update", description: "Weekly status" })] })));

    it("typing / lists skills, filters, and inserts the chosen one without sending", async () => {
      serve([]); serveSkills();
      let sent = 0;
      server.use(http.post("/api/v1/agents/sessions/send/", () => { sent++; return new HttpResponse("ok"); }));
      renderPage();
      const box = await screen.findByPlaceholderText(/for skills/) as HTMLTextAreaElement;
      fireEvent.change(box, { target: { value: "/wee", selectionStart: 4 } });
      const opt = await screen.findByText("/weekly-update");
      expect(screen.queryByText("/twilio-account-setup")).not.toBeInTheDocument();
      fireEvent.keyDown(box, { key: "Enter" });
      expect(box.value).toBe("/weekly-update ");
      expect(sent).toBe(0);
      expect(opt).toBeDefined();
    });
  });

  it("agent bubbles use the chat bubble surface variable, not the page background", async () => {
    serve([session([msg(1, "user", "hi"), msg(2, "assistant", "hello back")])]);
    renderPage();
    const text = await screen.findByText("hello back");
    const bubble = text.closest("p")!.parentElement as HTMLElement;
    expect(bubble.style.background).toContain("--chat-agent-bubble");
  });
});
