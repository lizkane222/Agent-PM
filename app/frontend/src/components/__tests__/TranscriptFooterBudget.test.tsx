/**
 * The footer chat posts to /agents/sessions/send/ with a raw fetch. A daily-token-limit refusal
 * comes back as JSON with HTTP 403; it must read as a sentence, not as raw JSON streamed in as
 * if it were the assistant's answer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";

vi.mock("@twilio/voice-sdk", () => ({ Device: class {}, Call: class {} }));
vi.mock("../VoiceButton", () => ({ default: () => null }));

import TranscriptFooter from "../TranscriptFooter";

const SEND = "/api/v1/agents/sessions/send/";

async function sendMessage(text: string) {
  render(<MemoryRouter><TranscriptFooter /></MemoryRouter>);
  const box = screen.getByRole("textbox");
  fireEvent.change(box, { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  // The footer starts collapsed; a user opens the transcript to read the reply.
  fireEvent.click(await screen.findByRole("button", { name: /Show \(/ }));
}

describe("TranscriptFooter — daily token budget", () => {
  beforeEach(() => {
    localStorage.setItem("agentpm_access", "jwt-abc");
    // jsdom doesn't implement scrollIntoView; the transcript calls it when it expands.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("shows the refusal as a sentence and never as raw JSON", async () => {
    server.use(http.post(SEND, () => HttpResponse.json(
      { detail: "You've reached your daily token limit, so the agent is paused until tomorrow.", code: "token_budget_blocked", budget: { state: "blocked" } },
      { status: 403 })));
    await sendMessage("hello");
    expect(await screen.findByText(/Error: You've reached your daily token limit/)).toBeInTheDocument();
    expect(screen.queryByText(/token_budget_blocked/)).not.toBeInTheDocument();
  });

  it("a normal reply still streams as before", async () => {
    server.use(http.post(SEND, () => new HttpResponse("Hello there", { headers: { "X-Session-Id": "5" } })));
    await sendMessage("hi");
    expect(await screen.findByText("Hello there")).toBeInTheDocument();
  });

  it("a different 403 keeps its old handling (not rewritten as a budget message)", async () => {
    server.use(http.post(SEND, () => HttpResponse.json({ detail: "Forbidden." }, { status: 403 })));
    await sendMessage("hi");
    await waitFor(() => expect(screen.queryByText(/daily token limit/)).not.toBeInTheDocument());
    expect(await screen.findByText(/Forbidden\./)).toBeInTheDocument();
  });
});
