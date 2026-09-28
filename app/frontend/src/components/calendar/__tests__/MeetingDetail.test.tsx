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

// ── Meeting summary: Gong / Zoom parity ───────────────────────────────────────

/**
 * MeetingDetail keeps its *own* copy of the meeting-summary panel (a fourth, after the
 * shared one, AccountDetailPage's local one, and the account SidePanel). It was Gong-only
 * — a meeting whose notes came from Zoom read as empty on the calendar page even though
 * the notes were stored. These pin the toggle and the per-provider save on this copy.
 */
describe("MeetingDetail — meeting summary provider toggle", () => {
  const GONG_NOTES = "Recap\n- Gong said pricing";
  const ZOOM_NOTES = "Recap\n- Zoom said rollout";

  /** MeetingSummarySection re-reads the meeting through the match endpoint. */
  function serveMatch(overrides: { gong_notes?: string; zoom_notes?: string }) {
    server.use(
      http.post("/api/v1/airtable/match/", () =>
        HttpResponse.json({
          matched: true,
          account: { id: 1, name: "Acme Corp" },
          this_meeting: {
            id: 7, airtable_id: "recMTG007", name: "Q3 Review", date: null,
            duration: 0, expected_topics: "", gong_notes: "", gong_url: "",
            zoom_notes: "", zoom_url: "", customer_slack: "", account_team_slack: "",
            last_synced: "", account: 1, account_name: "Acme Corp",
            ...overrides,
          },
        })
      )
    );
  }

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("WebSocket", FakeSocket);
    registerHandlers();
  });

  it("shows the Gong notes and marks Gong active", async () => {
    serveMatch({ gong_notes: GONG_NOTES });
    renderDetail();

    expect(await screen.findByText("Gong said pricing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gong" })).toHaveAttribute("aria-pressed", "true");
  });

  it("opens on Zoom when only Zoom has notes", async () => {
    serveMatch({ zoom_notes: ZOOM_NOTES });
    renderDetail();

    expect(await screen.findByText("Zoom said rollout")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom" })).toHaveAttribute("aria-pressed", "true");
  });

  it("swaps the rendered bullets when the toggle is clicked", async () => {
    serveMatch({ gong_notes: GONG_NOTES, zoom_notes: ZOOM_NOTES });
    renderDetail();

    await screen.findByText("Gong said pricing");
    fireEvent.click(screen.getByRole("button", { name: "Zoom" }));

    expect(await screen.findByText("Zoom said rollout")).toBeInTheDocument();
    expect(screen.queryByText("Gong said pricing")).not.toBeInTheDocument();
  });

  it("saves a paste to the zoom-notes endpoint while Zoom is active", async () => {
    const hits: string[] = [];
    serveMatch({ gong_notes: GONG_NOTES });
    server.use(
      http.patch("/api/v1/airtable/meetings/:id/zoom-notes/", async ({ request }) => {
        const body = await request.json() as { zoom_notes: string };
        hits.push(body.zoom_notes);
        return HttpResponse.json({ id: 7, zoom_notes: body.zoom_notes });
      }),
      http.patch("/api/v1/airtable/meetings/:id/gong-notes/", () => {
        throw new Error("a Zoom paste must not overwrite gong_notes");
      })
    );

    renderDetail();
    await screen.findByText("Gong said pricing");
    fireEvent.click(screen.getByRole("button", { name: "Zoom" }));

    const box = await screen.findByPlaceholderText(/Zoom AI Companion summary/i);
    fireEvent.change(box, { target: { value: "- Pasted a Zoom recap" } });
    fireEvent.click(screen.getByRole("button", { name: /Parse & Save/i }));

    await waitFor(() => expect(hits).toEqual(["- Pasted a Zoom recap"]));
  });

  it("re-seeds the panel when the selected meeting changes", async () => {
    // Event 1 has Gong notes, event 2 has Zoom notes: the panel must follow the switch.
    server.use(
      http.post("/api/v1/airtable/match/", async ({ request }) => {
        const { event_uid } = await request.json() as { event_uid: string };
        return HttpResponse.json({
          matched: true,
          account: { id: 1, name: "Acme Corp" },
          this_meeting: {
            id: event_uid === "1" ? 7 : 8, airtable_id: `recMTG00${event_uid}`,
            name: "Meeting", date: null, duration: 0, expected_topics: "",
            gong_notes: event_uid === "1" ? GONG_NOTES : "", gong_url: "",
            zoom_notes: event_uid === "1" ? "" : ZOOM_NOTES, zoom_url: "",
            customer_slack: "", account_team_slack: "", last_synced: "",
            account: 1, account_name: "Acme Corp",
          },
        });
      })
    );

    const { rerender } = render(
      <MemoryRouter><MeetingDetail event={mockCalendarEvents[0]} /></MemoryRouter>
    );
    await screen.findByText("Gong said pricing");

    rerender(<MemoryRouter><MeetingDetail event={mockCalendarEvents[1]} /></MemoryRouter>);

    expect(await screen.findByText("Zoom said rollout")).toBeInTheDocument();
    expect(screen.queryByText("Gong said pricing")).not.toBeInTheDocument();
  });

  it("Clear only clears the active provider", async () => {
    const cleared: string[] = [];
    serveMatch({ gong_notes: GONG_NOTES, zoom_notes: ZOOM_NOTES });
    server.use(
      http.patch("/api/v1/airtable/meetings/:id/zoom-notes/", async ({ request }) => {
        const body = await request.json() as { zoom_notes: string };
        cleared.push(`zoom:${body.zoom_notes}`);
        return HttpResponse.json({ id: 7, zoom_notes: "" });
      }),
      http.patch("/api/v1/airtable/meetings/:id/gong-notes/", () => {
        throw new Error("clearing Zoom must not touch gong_notes");
      })
    );

    renderDetail();
    await screen.findByText("Gong said pricing");
    fireEvent.click(screen.getByRole("button", { name: "Zoom" }));
    await screen.findByText("Zoom said rollout");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    await waitFor(() => expect(cleared).toEqual(["zoom:"]));
  });
});

// ── Switching meetings must not leave the previous one's summary behind ────────

/**
 * The reported bug: paste a summary onto one meeting, click another, and the bottom
 * section still showed the first meeting's notes. Both meetings here are *unlinked* —
 * no AirtableMeeting row, which the 2026-08-18 "GET Meeting Notes" session measured as
 * the common case — so `existingNotes`/`existingZoomNotes` are undefined for both and a
 * notes-text-only re-seed guard never fires. The second test is the sharper half: the
 * panel cached the first meeting's PK, so the next save went to the wrong Airtable row.
 */
describe("MeetingDetail — the summary follows the selected meeting", () => {
  const PASTE_PATH = "/api/v1/airtable/meetings/by-event/:eventId/gong-notes/";

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("WebSocket", FakeSocket);
    registerHandlers();
    // No `this_meeting`: neither event has a meeting row until a paste creates one.
    server.use(
      http.post("/api/v1/airtable/match/", () =>
        HttpResponse.json({ matched: true, account: { id: 1, name: "Acme Corp" } })
      )
    );
  });

  function renderEvent(index: number) {
    return render(
      <MemoryRouter><MeetingDetail event={mockCalendarEvents[index]} /></MemoryRouter>
    );
  }

  async function pasteSummary(text: string) {
    const box = await screen.findByPlaceholderText(/Gong AI summary/i);
    fireEvent.change(box, { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: /Parse & Save/i }));
  }

  it("drops the pasted summary when another meeting is selected", async () => {
    const saved: string[] = [];
    server.use(
      http.patch(PASTE_PATH, async ({ request }) => {
        const body = await request.json() as { gong_notes: string };
        saved.push(body.gong_notes);
        return HttpResponse.json({ id: 7, gong_notes: body.gong_notes });
      })
    );

    const { rerender } = renderEvent(0);
    await pasteSummary("- Pricing agreed");
    await waitFor(() => expect(saved).toEqual(["- Pricing agreed"]));
    expect(await screen.findByText("Pricing agreed")).toBeInTheDocument();

    rerender(<MemoryRouter><MeetingDetail event={mockCalendarEvents[1]} /></MemoryRouter>);

    await waitFor(() =>
      expect(screen.queryByText("Pricing agreed")).not.toBeInTheDocument()
    );
    // Back to an empty paste box, not the previous meeting's bullets.
    expect(await screen.findByPlaceholderText(/Gong AI summary/i)).toHaveValue("");
  });

  it("saves a paste against the newly selected meeting, not the previous one", async () => {
    const urls: string[] = [];
    server.use(
      http.patch(PASTE_PATH, async ({ request }) => {
        urls.push(new URL(request.url).pathname);
        return HttpResponse.json({ id: 7, gong_notes: "" });
      }),
      // The by-PK route is what a stale cached meeting id would reach for.
      http.patch("/api/v1/airtable/meetings/:id/gong-notes/", ({ params }) => {
        urls.push(`STALE-PK-${params.id}`);
        return HttpResponse.json({ id: Number(params.id), gong_notes: "" });
      })
    );

    const { rerender } = renderEvent(0);
    await pasteSummary("- First meeting recap");
    await waitFor(() =>
      expect(urls).toEqual(["/api/v1/airtable/meetings/by-event/1/gong-notes/"])
    );

    rerender(<MemoryRouter><MeetingDetail event={mockCalendarEvents[1]} /></MemoryRouter>);
    await pasteSummary("- Second meeting recap");

    await waitFor(() => expect(urls).toHaveLength(2));
    expect(urls[1]).toBe("/api/v1/airtable/meetings/by-event/2/gong-notes/");
  });

  it("clears an unsent note draft so it cannot post to the next meeting", async () => {
    let posted = 0;
    server.use(http.post(NOTES_PATH, () => { posted += 1; return HttpResponse.json(noteResponse); }));

    const { rerender } = renderEvent(0);
    const composer = await screen.findByPlaceholderText(/Add a note/i);
    fireEvent.change(composer, { target: { value: "Typed against the first meeting" } });

    rerender(<MemoryRouter><MeetingDetail event={mockCalendarEvents[1]} /></MemoryRouter>);

    const next = await screen.findByPlaceholderText(/Add a note/i);
    await waitFor(() => expect(next).toHaveValue(""));
    fireEvent.keyDown(next, { key: "Enter" });
    await new Promise((r) => setTimeout(r, 30));
    expect(posted).toBe(0);
  });
});

describe("MeetingDetail — no WebSocket for synthetic overlay events", () => {
  // Airtable meetings / scheduled action items / reminders rendered as calendar
  // overlays (CalendarPage.tsx's synthesis effects) get a non-positive `id` — there is
  // no backing CalendarEvent row, and the backend's ws route only matches a positive
  // integer, so attempting the connection just fails loudly in the console.
  let sockets: string[] = [];

  class TrackingSocket {
    static CONNECTING = 0;
    readyState = 1;
    onopen: (() => void) | null = null;
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    constructor(url: string) {
      sockets.push(url);
    }
    send() {}
    close() {}
  }

  beforeEach(() => {
    localStorage.clear();
    sockets = [];
    vi.stubGlobal("WebSocket", TrackingSocket);
    registerHandlers();
  });

  it("opens the notes-collaboration socket for a real, positive-id event", async () => {
    render(
      <MemoryRouter>
        <MeetingDetail event={mockCalendarEvents[0]} />
      </MemoryRouter>
    );
    await screen.findByPlaceholderText(/Add a note/i);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]).toContain("/ws/meeting-notes/1/");
  });

  it("skips the socket entirely for a synthetic overlay event with a negative id", async () => {
    const syntheticEvent = { ...mockCalendarEvents[0], id: -3298 };
    render(
      <MemoryRouter>
        <MeetingDetail event={syntheticEvent} />
      </MemoryRouter>
    );
    await screen.findByPlaceholderText(/Add a note/i);
    expect(sockets).toHaveLength(0);
  });
});
