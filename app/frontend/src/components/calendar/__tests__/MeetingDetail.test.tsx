/**
 * MeetingDetail — Enter adds a meeting note.
 *
 * Scoped deliberately to the notes composer. The rest of MeetingDetail
 * (real-time collaboration, Google/Salesforce wiring) is out of scope per
 * CLAUDE.md, so this stubs the socket rather than exercising it.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { mockCalendarEvents } from "../../../test/handlers/scheduler";
import MeetingDetail from "../MeetingDetail";

const NOTES_PATH = "/api/v1/scheduler/meeting-notes/";

// The real editor's Enter contract is covered against real TipTap in
// components/shared/__tests__/RichTextMentionEditor.test.tsx. Here it is
// stubbed (TipTap's Placeholder needs elementFromPoint) but the stub honours
// the same onSubmit-on-Enter contract.
vi.mock("../../shared/RichTextMentionEditor", () => ({
  default: React.forwardRef(({ value, onChange, placeholder, onSubmit, onKeyDownCapture }: { value: string; onChange: (v: string) => void; placeholder?: string; onSubmit?: () => void; onKeyDownCapture?: (e: React.KeyboardEvent) => void }, ref: React.Ref<{ clear: () => void }>) => {
    React.useImperativeHandle(ref, () => ({ clear: () => onChange("") }));
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onKeyDown={(e) => {
          onKeyDownCapture?.(e);
          if (e.key === "Enter" && !e.shiftKey && onSubmit) { e.preventDefault(); onSubmit(); }
        }}
      />
    );
  }),
  plainToHtml: (text: string) => text,
}));

class FakeSocket {
  static CONNECTING = 0;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send() {}
  close() {}
}

const noteResponse = {
  id: 42,
  event: 1,
  author: 1,
  author_display: "Alice",
  text: "Renewal risk flagged",
  html: "Renewal risk flagged",
  position: 0,
  due_date: null,
  created_at: "2026-07-28T12:00:00Z",
  updated_at: "2026-07-28T12:00:00Z",
};

function registerHandlers() {
  server.use(
    http.get(NOTES_PATH, () => HttpResponse.json({ results: [] })),
    http.post("/api/v1/airtable/match/", () => HttpResponse.json({ account: null, matched: false })),
    http.post("/api/v1/airtable/categorize/", () => HttpResponse.json({ account: null, matched: false })),
    http.get("/api/v1/airtable/action-items/", () => HttpResponse.json([])),
    http.get("/api/v1/salesforce/projects/", () => HttpResponse.json({ results: [] })),
  );
}

function renderDetail() {
  render(
    <MemoryRouter>
      <MeetingDetail event={mockCalendarEvents[0]} />
    </MemoryRouter>
  );
}

async function getComposer() {
  return await screen.findByPlaceholderText(/Add a note/i);
}

describe("MeetingDetail — Enter adds a meeting note", () => {
  beforeEach(() => {
    localStorage.clear();
    // jsdom's WebSocket is a read-only global — stubGlobal is the only way in.
    vi.stubGlobal("WebSocket", FakeSocket);
    registerHandlers();
  });

  it("renders the note composer", async () => {
    renderDetail();
    expect(await getComposer()).toBeInTheDocument();
  });

  it("POSTs the note on a bare Enter — no Add click needed", async () => {
    let body: unknown = "not called";
    server.use(
      http.post(NOTES_PATH, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(noteResponse);
      })
    );

    renderDetail();
    const composer = await getComposer();
    fireEvent.change(composer, { target: { value: "Renewal risk flagged" } });
    fireEvent.keyDown(composer, { key: "Enter" });

    await waitFor(() => expect(body).not.toBe("not called"));
    expect(body).toMatchObject({ event: 1, html: "Renewal risk flagged" });
  });

  it("does NOT post on Shift+Enter — that inserts a newline", async () => {
    let calls = 0;
    server.use(http.post(NOTES_PATH, () => { calls += 1; return HttpResponse.json(noteResponse); }));

    renderDetail();
    const composer = await getComposer();
    fireEvent.change(composer, { target: { value: "Line one" } });
    fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });

    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toBe(0);
  });

  it("does not post an empty note on Enter", async () => {
    let calls = 0;
    server.use(http.post(NOTES_PATH, () => { calls += 1; return HttpResponse.json(noteResponse); }));

    renderDetail();
    fireEvent.keyDown(await getComposer(), { key: "Enter" });

    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toBe(0);
  });

  it("posts exactly once per Enter press", async () => {
    let calls = 0;
    server.use(http.post(NOTES_PATH, () => { calls += 1; return HttpResponse.json(noteResponse); }));

    renderDetail();
    const composer = await getComposer();
    fireEvent.change(composer, { target: { value: "Renewal risk flagged" } });
    fireEvent.keyDown(composer, { key: "Enter" });

    await waitFor(() => expect(calls).toBe(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toBe(1);
  });

  it("still adds the note when the Add button is clicked", async () => {
    let calls = 0;
    server.use(http.post(NOTES_PATH, () => { calls += 1; return HttpResponse.json(noteResponse); }));

    renderDetail();
    const composer = await getComposer();
    fireEvent.change(composer, { target: { value: "Clicked instead" } });
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));

    await waitFor(() => expect(calls).toBe(1));
  });
});
