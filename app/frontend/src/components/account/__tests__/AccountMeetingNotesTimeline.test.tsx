import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import AccountMeetingNotesTimeline from "../AccountMeetingNotesTimeline";
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
