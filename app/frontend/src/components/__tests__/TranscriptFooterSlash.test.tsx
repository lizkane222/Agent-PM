import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockAgentSkill } from "../../test/handlers/skills";

vi.mock("@twilio/voice-sdk", () => ({ Device: class {}, Call: class {} }));
vi.mock("../VoiceButton", () => ({ default: () => null }));

import TranscriptFooter from "../TranscriptFooter";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  server.use(http.get("/api/v1/skills/agent-skills/", () =>
    HttpResponse.json({ count: 1, next: null, previous: null, results: [mockAgentSkill({ name: "weekly-update" })] })));
});

describe("TranscriptFooter — slash skills", () => {
  it("shows skills on '/', filters, and inserts the selection", async () => {
    let sent = 0;
    server.use(http.post("/api/v1/agents/sessions/send/", () => { sent++; return new HttpResponse("ok"); }));
    render(<MemoryRouter><TranscriptFooter /></MemoryRouter>);
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "/wee", selectionStart: 4 } });
    await screen.findByText("/weekly-update");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box.value).toBe("/weekly-update ");
    expect(sent).toBe(0);
  });
});
