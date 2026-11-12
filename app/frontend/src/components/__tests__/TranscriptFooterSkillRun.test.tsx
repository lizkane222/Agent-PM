/**
 * A skill launched from a button or a pinned page injects its prompt into the chat box together with
 * a Console run id. The footer must send that id with the skill's own prompt — once — and never
 * attach it to a different message.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";

vi.mock("@twilio/voice-sdk", () => ({ Device: class {}, Call: class {} }));
vi.mock("../VoiceButton", () => ({ default: () => null }));

import TranscriptFooter from "../TranscriptFooter";

const SEND = "/api/v1/agents/sessions/send/";
let bodies: Record<string, unknown>[];

beforeEach(() => {
  bodies = [];
  localStorage.setItem("agentpm_access", "jwt-abc");
  Element.prototype.scrollIntoView = vi.fn();
  server.use(http.post(SEND, async ({ request }) => {
    bodies.push((await request.json()) as Record<string, unknown>);
    return new HttpResponse("ok", { headers: { "X-Session-Id": "7" } });
  }));
});

const inject = (text: string, run_id?: string, sendNow?: boolean) =>
  act(() => { window.dispatchEvent(new CustomEvent("chat-inject", { detail: { text, run_id, send: sendNow } })); });
const box = () => screen.getByRole("textbox") as HTMLTextAreaElement;
const send = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeDisabled());
};

describe("TranscriptFooter — skill run ids", () => {
  it("sends the run id with the skill's own prompt", async () => {
    render(<MemoryRouter><TranscriptFooter /></MemoryRouter>);
    inject("/weekly-update\n\nDo the thing", "run-1");
    await waitFor(() => expect(box().value).toContain("/weekly-update"));
    await send();
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].skill_run_id).toBe("run-1");
    expect(String(bodies[0].message)).toContain("/weekly-update");
  });

  it("still sends it when the user adds to the prompt, as long as it still starts with the skill", async () => {
    render(<MemoryRouter><TranscriptFooter /></MemoryRouter>);
    inject("/weekly-update\n\nDo the thing", "run-2");
    await waitFor(() => expect(box().value).not.toBe(""));
    fireEvent.change(box(), { target: { value: "/weekly-update\n\nDo the thing, but only for Acme" } });
    await send();
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].skill_run_id).toBe("run-2");
  });

  it("does not attach it to a different message the user types instead", async () => {
    render(<MemoryRouter><TranscriptFooter /></MemoryRouter>);
    inject("/weekly-update\n\nDo the thing", "run-3");
    await waitFor(() => expect(box().value).not.toBe(""));
    fireEvent.change(box(), { target: { value: "what's on my calendar today?" } });
    await send();
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].skill_run_id).toBeUndefined();
  });

  it("uses the run id once: sending the same prompt again carries none", async () => {
    render(<MemoryRouter><TranscriptFooter /></MemoryRouter>);
    inject("/weekly-update\n\nDo the thing", "run-4");
    await waitFor(() => expect(box().value).not.toBe(""));
    await send();
    await waitFor(() => expect(bodies).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeDisabled());   // input cleared
    fireEvent.change(box(), { target: { value: "/weekly-update\n\nDo the thing" } });
    await send();
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[0].skill_run_id).toBe("run-4");
    expect(bodies[1].skill_run_id).toBeUndefined();
  });

  it("a prompt injected without a run id (Twilio skills, examples, notes) sends none", async () => {
    render(<MemoryRouter><TranscriptFooter /></MemoryRouter>);
    inject("/twilio-call-recordings");
    await waitFor(() => expect(box().value).not.toBe(""));
    await send();
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].skill_run_id).toBeUndefined();
  });

  it("a newer injection replaces an older, unsent one", async () => {
    render(<MemoryRouter><TranscriptFooter /></MemoryRouter>);
    inject("/first-skill\n\nA", "run-old");
    inject("/second-skill\n\nB", "run-new");
    await waitFor(() => expect(box().value).toContain("/second-skill"));
    await send();
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].skill_run_id).toBe("run-new");
  });

  it("ordinary chat never carries one", async () => {
    render(<MemoryRouter><TranscriptFooter /></MemoryRouter>);
    fireEvent.change(box(), { target: { value: "hello" } });
    await send();
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].skill_run_id).toBeUndefined();
  });
});

describe("TranscriptFooter — Run from a pinned skill sends straight away", () => {
  it("sends the prompt, with its run id, without a click", async () => {
    render(<MemoryRouter><TranscriptFooter /></MemoryRouter>);
    inject("/weekly-update\n\ngo", "run-5", true);
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].skill_run_id).toBe("run-5");
    expect(String(bodies[0].message)).toContain("/weekly-update");
  });

  it("an ordinary injection is only placed in the box", async () => {
    render(<MemoryRouter><TranscriptFooter /></MemoryRouter>);
    inject("/weekly-update\n\ngo", "run-6");
    await waitFor(() => expect(box().value).toContain("/weekly-update"));
    await new Promise((r) => setTimeout(r, 80));
    expect(bodies).toHaveLength(0);
  });

  it("sends only once even though the box re-renders", async () => {
    render(<MemoryRouter><TranscriptFooter /></MemoryRouter>);
    inject("/weekly-update\n\ngo", "run-7", true);
    await waitFor(() => expect(bodies).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 120));
    expect(bodies).toHaveLength(1);
  });
});

describe("TranscriptFooter — messages the chat would refuse", () => {
  const BIG = "/gen-csat\n\n" + "x".repeat(10_500);
  const waitForText = (t: RegExp) => waitFor(() => expect(screen.getByText(t)).toBeInTheDocument());

  it("does not send a message over the cap: says so, keeps the text, and keeps the run id", async () => {
    render(<MemoryRouter><TranscriptFooter /></MemoryRouter>);
    inject(BIG, "run-big");
    await waitFor(() => expect(box().value.length).toBe(BIG.length));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitForText(/This message is 10,511 characters; the chat takes at most 10,000/);
    expect(bodies).toHaveLength(0);
    expect(box().value).toBe(BIG);
    // shorten it and send: the skill's run is still attached
    fireEvent.change(box(), { target: { value: "/gen-csat\n\nshort" } });
    await send();
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].skill_run_id).toBe("run-big");
  });

  it("Run does not silently lose an over-long prompt either", async () => {
    render(<MemoryRouter><TranscriptFooter /></MemoryRouter>);
    inject(BIG, "run-big2", true);
    await waitForText(/the chat takes at most 10,000/);
    expect(bodies).toHaveLength(0);
    expect(box().value).toBe(BIG);
  });

  it("shows a character count as the box nears the cap, red once over", async () => {
    render(<MemoryRouter><TranscriptFooter /></MemoryRouter>);
    expect(screen.queryByTestId("footer-char-count")).not.toBeInTheDocument();
    fireEvent.change(box(), { target: { value: "a".repeat(8_500) } });
    expect(screen.getByTestId("footer-char-count")).toHaveTextContent("8,500 / 10,000");
    expect(screen.getByTestId("footer-char-count").className).not.toContain("text-red-600");
    fireEvent.change(box(), { target: { value: "a".repeat(10_001) } });
    expect(screen.getByTestId("footer-char-count").className).toContain("text-red-600");
  });

  it("a server refusal is explained in words and the text comes back to the box", async () => {
    server.use(http.post(SEND, () => HttpResponse.json(
      { message: ["Ensure this field has no more than 10000 characters."] }, { status: 400 })));
    render(<MemoryRouter><TranscriptFooter /></MemoryRouter>);
    fireEvent.change(box(), { target: { value: "please summarise" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitForText(/over the chat's 10,000-character limit/);
    expect(screen.queryByText(/Ensure this field/)).not.toBeInTheDocument();
    await waitFor(() => expect(box().value).toBe("please summarise"));
  });

  it("any other refusal keeps the text too, with the server's reason", async () => {
    server.use(http.post(SEND, () => HttpResponse.json({ detail: "Nope, try later." }, { status: 503 })));
    render(<MemoryRouter><TranscriptFooter /></MemoryRouter>);
    fireEvent.change(box(), { target: { value: "hello there" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitForText(/Nope, try later\./);
    await waitFor(() => expect(box().value).toBe("hello there"));
  });
});
