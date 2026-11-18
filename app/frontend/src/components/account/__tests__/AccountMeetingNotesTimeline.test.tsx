import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import AccountMeetingNotesTimeline from "../AccountMeetingNotesTimeline";
import { lineKeyFor } from "../../../lib/sensitiveMatch";
import type { AirtableMeeting, CalendarEvent, MeetingNote } from "../../../types";

const NOTES_PATH = "/api/v1/scheduler/meeting-notes/";

function ev(id: number, day: number, o: Partial<CalendarEvent> = {}): CalendarEvent {
  const d = String(day).padStart(2, "0");
  return {
    id, owner: 1, owner_username: "a", title: `Event ${id}`, description: "", location: "",
    start_datetime: `2026-07-${d}T10:00:00Z`, end_datetime: `2026-07-${d}T11:00:00Z`,
    all_day: false, status: "confirmed", account: null, account_name: null, google_event_id: "",
    meet_link: "", calendar_id: "", is_synced: false, agentpm_airtable_id: "", attendees: [],
    created_at: "", updated_at: "", ...o,
  } as CalendarEvent;
}
function note(id: number, event: number, text: string): MeetingNote {
  return { id, event, author: 1, author_username: "a", author_display: "A", html: `<p>${text}</p>`, text, due_date: null, position: 0, created_at: "", updated_at: "" } as MeetingNote;
}
function mtg(id: number, at: string, o: Partial<AirtableMeeting> = {}): AirtableMeeting {
  return { id, airtable_id: at, account: 5, account_name: "Acme", name: `M${id}`, date: "2026-07-05T10:00:00Z", duration: 0, expected_topics: "", gong_notes: "", gong_url: "", customer_slack: "", account_team_slack: "", last_synced: "", ...o } as AirtableMeeting;
}

function track(notes: MeetingNote[] = []) {
  const events: string[] = [];
  server.use(http.get(NOTES_PATH, ({ request }) => {
    events.push(new URL(request.url).searchParams.get("event") ?? "");
    return HttpResponse.json({ count: notes.length, next: null, previous: null, results: notes });
  }));
  return events;
}
const noop = vi.fn();

describe("AccountMeetingNotesTimeline", () => {
  it("shows an empty state and sends no request without meetings", async () => {
    const calls = track();
    render(<AccountMeetingNotesTimeline events={[]} meetings={[]} onOpenEvent={noop} onOpenMeeting={noop} />);
    expect(screen.getByText("No meetings recorded yet.")).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("orders newest first, groups notes under their meeting, includes summary, one request", async () => {
    const calls = track([note(1, 1, "old note"), note(2, 2, "new note"), note(3, 2, "second new")]);
    const e1 = ev(1, 10), e2 = ev(2, 20, { agentpm_airtable_id: "recA" });
    render(
      <AccountMeetingNotesTimeline
        events={[e1, e2]}
        meetings={[mtg(1, "recA", { gong_notes: "Key Points:\n- pricing agreed" })]}
        onOpenEvent={noop} onOpenMeeting={noop}
      />,
    );
    await waitFor(() => expect(screen.getByText("new note")).toBeTruthy());
    const entries = screen.getAllByTestId("meeting-notes-entry");
    expect(within(entries[0]).getByText("Event 2")).toBeTruthy();
    expect(within(entries[0]).getByText("new note")).toBeTruthy();
    expect(within(entries[0]).getByText("second new")).toBeTruthy();
    expect(within(entries[0]).getByText(/pricing agreed/)).toBeTruthy();
    expect(within(entries[1]).getByText("Event 1")).toBeTruthy();
    expect(within(entries[1]).getByText("old note")).toBeTruthy();
    expect(calls).toEqual(["2,1"]);
  });

  it("lists a summary-only meeting with no calendar event", async () => {
    track();
    render(<AccountMeetingNotesTimeline events={[]} meetings={[mtg(9, "recZ", { zoom_notes: "Recap:\n- shipped" })]} onOpenEvent={noop} onOpenMeeting={noop} />);
    expect(screen.getByText("M9")).toBeTruthy();
    expect(screen.getByText(/shipped/)).toBeTruthy();
  });

  it("pages by 20 and batches one request per page", async () => {
    const calls = track();
    const events = Array.from({ length: 25 }, (_, i) => ev(i + 1, (i % 28) + 1));
    render(<AccountMeetingNotesTimeline events={events} meetings={[]} onOpenEvent={noop} onOpenMeeting={noop} />);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.getAllByTestId("meeting-notes-entry")).toHaveLength(20);
    fireEvent.click(screen.getByText(/Load more/));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(screen.getAllByTestId("meeting-notes-entry")).toHaveLength(25);
  });

  it("opens the meeting when its heading is clicked", async () => {
    track();
    const onOpenEvent = vi.fn();
    const e = ev(3, 12);
    render(<AccountMeetingNotesTimeline events={[e]} meetings={[]} onOpenEvent={onOpenEvent} onOpenMeeting={noop} />);
    fireEvent.click(screen.getByText("Event 3"));
    expect(onOpenEvent).toHaveBeenCalledWith(e);
  });
});

describe("AccountMeetingNotesTimeline bullet actions", () => {
  const setup = (gong = "Key Points:\n- pricing agreed with <b>Acme</b> @Jane") => {
    track();
    const e = ev(4, 12, { agentpm_airtable_id: "recQ" });
    return render(
      <AccountMeetingNotesTimeline events={[e]} meetings={[mtg(77, "recQ", { gong_notes: gong })]} onOpenEvent={noop} onOpenMeeting={noop} />,
    );
  };

  it("gives each bullet the action buttons and a Copy button", () => {
    setup();
    const row = screen.getByTestId("summary-bullet-row");
    for (const t of ["Create action item", "Set reminder", "Create meeting", "Copy text"]) {
      expect(within(row).getByTitle(t)).toBeTruthy();
    }
    expect(row.querySelector("[data-note-text]")).toBeTruthy();
  });

  it("Copy writes the bullet's plain text and confirms", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    setup();
    fireEvent.click(screen.getByTitle("Copy text"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("pricing agreed with Acme @Jane"));
    await waitFor(() => expect(screen.getByText("Copied")).toBeTruthy());
  });

  it("Copy failure shows a failure state instead of throwing", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("no")) }, configurable: true });
    setup();
    fireEvent.click(screen.getByTitle("Copy text"));
    await waitFor(() => expect(screen.getByText("Failed")).toBeTruthy());
  });

  it("creating an action item links it to the meeting", async () => {
    let body: Record<string, unknown> | null = null;
    server.use(http.post("*/api/v1/airtable/action-items/", async ({ request }) => {
      body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ id: 1, airtable_id: "recN", task: "x", status: "Open" }, { status: 201 });
    }));
    setup();
    fireEvent.click(screen.getByTitle("Create action item"));
    fireEvent.click(await screen.findByRole("button", { name: "Create Action Item" }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.linked_meeting).toBe(77);
  });

  it("masks a bullet hidden as sensitive (same meeting/field/line key as the sidebar), and not the others", async () => {
    server.use(http.get("*/api/v1/sensitive/marks/", () => HttpResponse.json({
      results: { "77": [{ id: 1, field: "summary", text: "", line_key: lineKeyFor("pricing agreed with <b>Acme</b> @Jane") }] },
    })));
    setup();
    const row = screen.getByTestId("summary-bullet-row");
    await waitFor(() => expect((row.querySelector("[data-note-text]") as HTMLElement).textContent).not.toContain("pricing"));
    expect(row.textContent).not.toContain("Acme");
  });

  it("a bullet row gets a slightly darker background on hover only, so its far-away actions are easy to match", () => {
    setup();
    const row = screen.getByTestId("summary-bullet-row");
    expect(row.className).toContain("hover:bg-[var(--row-hover)]");
    // Not tinted at rest.
    expect(row.style.background).toBe("");
    expect(row.style.backgroundColor).toBe("");
    // The variable exists for both themes: a dark tint on light, a light tint on dark.
    const css = readFileSync(join(__dirname, "../../../index.css"), "utf8");
    expect(css).toMatch(/:root \{[\s\S]*?--row-hover:\s*rgba\(15, 23, 42/);
    expect(css).toMatch(/\[data-theme="dark"\] \{[\s\S]*?--row-hover:\s*rgba\(255, 255, 255/);
  });

  it("action buttons don't steal the selection (mousedown is default-prevented)", () => {
    setup();
    const btn = screen.getByTitle("Copy text");
    expect(fireEvent.mouseDown(btn)).toBe(false);
  });

  it("text is selectable: not user-select none, and pressing it disarms row drag", () => {
    setup();
    const row = screen.getByTestId("summary-bullet-row");
    const text = row.querySelector("[data-note-text]") as HTMLElement;
    expect(getComputedStyle(text).userSelect).not.toBe("none");
    expect(row.getAttribute("draggable")).toBe("true");
    fireEvent.mouseDown(text);
    expect(row.getAttribute("draggable")).toBe("false");
    fireEvent.mouseUp(document);
    expect(row.getAttribute("draggable")).toBe("true");
  });
});
