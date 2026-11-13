/**
 * MeetingDetail — dragging an action item out of the meeting's Action Items section.
 *
 * Two destinations: the Meeting Notes (links the item to this meeting, so the account
 * page's timeline shows it under the meeting) and the calendar grid (which reads the same
 * window globals the calendar sidebar's cards set — CalendarPage owns that drop handler).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { mockCalendarEvents } from "../../../test/handlers/scheduler";
import { mockActionItem } from "../../../test/handlers/action_items";
import { CALENDAR_DRAG_KEY } from "../calendarHelpers";
import { ExportProvider } from "../../../context/ExportContext";
import MeetingDetail from "../MeetingDetail";

vi.mock("../../../assets/icons/Corporate.svg?react", () => ({ default: () => null }));

// Same stub as MeetingDetail.test.tsx: TipTap's Placeholder needs elementFromPoint.
vi.mock("../../shared/RichTextMentionEditor", () => ({
  default: React.forwardRef(({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }, ref: React.Ref<{ clear: () => void }>) => {
    React.useImperativeHandle(ref, () => ({ clear: () => onChange("") }));
    return <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
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

const item = { ...mockActionItem, airtable_id: "recDRAG1", task: "Send recap deck", status: "Open", linked_meeting: null, linked_meeting_name: null };

function serve(opts: { thisMeetingId?: number } = {}) {
  const calls = { ensure: 0, patches: [] as Array<{ id: string; body: Record<string, unknown> }> };
  server.use(
    http.get("/api/v1/scheduler/meeting-notes/", () => HttpResponse.json({ results: [] })),
    http.post("/api/v1/airtable/match/", () =>
      HttpResponse.json({
        account: null, matched: false, needs_categorization: true, action_items: [item], meetings: [],
        ...(opts.thisMeetingId ? { this_meeting: { id: opts.thisMeetingId, name: "Standup" } } : {}),
      })),
    http.post("/api/v1/airtable/categorize/", () => HttpResponse.json({ account: null, matched: false })),
    http.get("/api/v1/airtable/action-items/", () => HttpResponse.json([item])),
    http.get("/api/v1/salesforce/projects/", () => HttpResponse.json({ results: [] })),
    http.post("/api/v1/airtable/meetings/by-event/:id/ensure/", () => {
      calls.ensure += 1;
      return HttpResponse.json({ id: 901, name: "Standup" });
    }),
    http.patch("/api/v1/airtable/action-items/:id/fields/", async ({ request, params }) => {
      calls.patches.push({ id: String(params.id), body: (await request.json()) as Record<string, unknown> });
      return HttpResponse.json({ ...item, linked_meeting: 901 });
    }),
  );
  return calls;
}

function dataTransfer(initial: Record<string, string> = {}) {
  // `types` is a stable array mutated by setData: RTL copies the object's own keys onto the
  // event once, so a getter would be frozen at its first (empty) value, unlike a real DataTransfer.
  const store: Record<string, string> = { ...initial };
  const types: string[] = Object.keys(store).map((k) => k.toLowerCase());
  return {
    types,
    // Browsers lowercase the type names in `types` (but not in getData), which is why the app tests for "kanbancardid".
    setData: (k: string, v: string) => { store[k] = v; if (!types.includes(k.toLowerCase())) types.push(k.toLowerCase()); },
    getData: (k: string) => store[k] ?? "",
    effectAllowed: "all", dropEffect: "none",
  };
}

async function openAndGrabCard() {
  render(<MemoryRouter><ExportProvider><MeetingDetail event={mockCalendarEvents[0]} /></ExportProvider></MemoryRouter>);
  // The title can also appear in the "from this meeting" list, so pick the one on a card.
  const titles = await screen.findAllByText("Send recap deck");
  const card = titles.map((t) => t.closest("[draggable='true']")).find(Boolean) as HTMLElement;
  expect(card).toBeTruthy();
  return card;
}

const section = () => screen.getByTestId("meeting-action-items-section");
const notes = () => screen.getByTestId("meeting-notes-column");

describe("MeetingDetail — dragging an action item", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("WebSocket", FakeSocket);
    const w = window as unknown as Record<string, string>;
    for (const k of Object.keys(w)) if (k.startsWith(CALENDAR_DRAG_KEY)) delete w[k];
  });

  it("tells the user where an action item can be dragged", async () => {
    serve();
    await openAndGrabCard();
    expect(within(section()).getByText("Drag Action Item to Meeting Notes or Calendar")).toBeInTheDocument();
  });

  it("glows the section and the notes while a card is in the air, and stops when it lands", async () => {
    serve();
    const card = await openAndGrabCard();
    expect(section()).not.toHaveAttribute("data-drag-glow");

    const dt = dataTransfer();
    fireEvent.dragStart(card, { dataTransfer: dt });
    await waitFor(() => expect(section()).toHaveAttribute("data-drag-glow", "ready"));
    expect(notes()).toHaveAttribute("data-drag-glow", "ready");

    // Hovering the notes lights them up as the drop target.
    fireEvent.dragOver(notes(), { dataTransfer: dt });
    await waitFor(() => expect(notes()).toHaveAttribute("data-drag-glow", "over"));

    fireEvent.dragEnd(card, { dataTransfer: dt });
    await waitFor(() => expect(section()).not.toHaveAttribute("data-drag-glow"));
    expect(notes()).not.toHaveAttribute("data-drag-glow");
  });

  it("does not glow for a drag that is not an action-item card", async () => {
    serve();
    await openAndGrabCard();
    fireEvent.dragStart(document.body, { dataTransfer: dataTransfer({ "text/plain": "hello" }) });
    await new Promise((r) => setTimeout(r, 20));
    expect(section()).not.toHaveAttribute("data-drag-glow");
  });

  it("carries the calendar payload, and clears it when the drag ends", async () => {
    serve();
    const card = await openAndGrabCard();
    const dt = dataTransfer();
    fireEvent.dragStart(card, { dataTransfer: dt });
    const w = window as unknown as Record<string, string>;
    expect(w[CALENDAR_DRAG_KEY]).toBe("recDRAG1");
    expect(w[`${CALENDAR_DRAG_KEY}_task`]).toBe("Send recap deck");
    expect(dt.getData("text/plain")).toBe("recDRAG1");
    expect(dt.getData("kanbanCardId")).toBe("recDRAG1");

    fireEvent.dragEnd(card, { dataTransfer: dt });
    expect(w[CALENDAR_DRAG_KEY]).toBeUndefined();
    expect(w[`${CALENDAR_DRAG_KEY}_task`]).toBeUndefined();
  });

  it("dropping on the notes of a calendar-only event creates its meeting row and links the item", async () => {
    const calls = serve();
    const card = await openAndGrabCard();
    const dt = dataTransfer();
    fireEvent.dragStart(card, { dataTransfer: dt });
    fireEvent.drop(notes(), { dataTransfer: dt });

    await waitFor(() => expect(calls.patches).toHaveLength(1));
    expect(calls.ensure).toBe(1);
    expect(calls.patches[0]).toEqual({ id: "recDRAG1", body: { linked_meeting: 901 } });
    expect(await screen.findByRole("status")).toHaveTextContent(/Linked "Send recap deck" to this meeting/);
    const linked = screen.getByTestId("linked-action-items");
    expect(within(linked).getByText("Send recap deck")).toBeInTheDocument();
  });

  it("uses the meeting the event already has instead of creating another", async () => {
    const calls = serve({ thisMeetingId: 77 });
    const card = await openAndGrabCard();
    const dt = dataTransfer();
    fireEvent.dragStart(card, { dataTransfer: dt });
    fireEvent.drop(notes(), { dataTransfer: dt });

    await waitFor(() => expect(calls.patches).toHaveLength(1));
    expect(calls.ensure).toBe(0);
    expect(calls.patches[0].body).toEqual({ linked_meeting: 77 });
  });

  it("dropping an item that is already linked here changes nothing", async () => {
    const calls = serve({ thisMeetingId: 77 });
    server.use(http.post("/api/v1/airtable/match/", () =>
      HttpResponse.json({ account: null, matched: false, needs_categorization: true, meetings: [],
        action_items: [{ ...item, linked_meeting: 77 }], this_meeting: { id: 77, name: "Standup" } })));
    const card = await openAndGrabCard();
    const dt = dataTransfer();
    fireEvent.dragStart(card, { dataTransfer: dt });
    fireEvent.drop(notes(), { dataTransfer: dt });

    expect(await screen.findByRole("status")).toHaveTextContent(/already linked/);
    expect(calls.patches).toHaveLength(0);
  });

  it("says so, and links nothing, when the save fails", async () => {
    serve({ thisMeetingId: 77 });
    server.use(http.patch("/api/v1/airtable/action-items/:id/fields/", () => HttpResponse.json({ error: "no" }, { status: 500 })));
    const card = await openAndGrabCard();
    const dt = dataTransfer();
    fireEvent.dragStart(card, { dataTransfer: dt });
    fireEvent.drop(notes(), { dataTransfer: dt });

    expect(await screen.findByRole("status")).toHaveTextContent(/Could not link/);
    expect(screen.queryByTestId("linked-action-items")).not.toBeInTheDocument();
  });

  it("a drop that carries no card is ignored by the notes", async () => {
    const calls = serve({ thisMeetingId: 77 });
    await openAndGrabCard();
    fireEvent.drop(notes(), { dataTransfer: dataTransfer({ "text/plain": "just text" }) });
    await new Promise((r) => setTimeout(r, 30));
    expect(calls.patches).toHaveLength(0);
    expect(calls.ensure).toBe(0);
  });
});
