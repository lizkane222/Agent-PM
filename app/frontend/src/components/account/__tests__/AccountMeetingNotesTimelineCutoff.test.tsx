import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import AccountMeetingNotesTimeline, { MEETING_NOTES_TIMELINE_PAGE } from "../AccountMeetingNotesTimeline";
import { endOfWeek } from "../../../lib/weekBounds";
import type { AirtableMeeting, CalendarEvent } from "../../../types";

const NOTES_PATH = "/api/v1/scheduler/meeting-notes/";
const DAY = 24 * 3600 * 1000;

function ev(id: number, start: Date, title = `Event ${id}`): CalendarEvent {
  return {
    id, owner: 1, owner_username: "a", title, description: "", location: "",
    start_datetime: start.toISOString(), end_datetime: start.toISOString(),
    all_day: false, status: "confirmed", account: null, account_name: null, google_event_id: "",
    meet_link: "", calendar_id: "", is_synced: false, agentpm_airtable_id: "", attendees: [],
    created_at: "", updated_at: "",
  } as CalendarEvent;
}
function mtg(id: number, date: string | null): AirtableMeeting {
  return { id, airtable_id: `rec${id}`, account: 5, account_name: "Acme", name: `M${id}`, date, duration: 0, expected_topics: "", gong_notes: "Recap:\n- did stuff", gong_url: "", customer_slack: "", account_team_slack: "", last_synced: "" } as unknown as AirtableMeeting;
}
function track() {
  const calls: string[] = [];
  server.use(http.get(NOTES_PATH, ({ request }) => {
    calls.push(new URL(request.url).searchParams.get("event") ?? "");
    return HttpResponse.json({ count: 0, next: null, previous: null, results: [] });
  }));
  return calls;
}
const noop = vi.fn();
const eow = () => endOfWeek(new Date());

describe("AccountMeetingNotesTimeline week cutoff", () => {
  it("hides next week's meeting, shows later this week and past ones; skips fetching excluded", async () => {
    const calls = track();
    const nextWeek = new Date(eow().getTime() + 2 * 3600 * 1000);
    const thisWeek = new Date(Math.max(Date.now(), eow().getTime() - 3 * 3600 * 1000)); // inside the week
    const past = new Date(Date.now() - 20 * DAY);
    render(<AccountMeetingNotesTimeline events={[ev(1, nextWeek), ev(2, thisWeek), ev(3, past)]} meetings={[]} onOpenEvent={noop} onOpenMeeting={noop} />);
    expect(screen.queryByText("Event 1")).toBeNull();
    expect(screen.getByText("Event 2")).toBeTruthy();
    expect(screen.getByText("Event 3")).toBeTruthy();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].split(",").sort()).toEqual(["2", "3"]);
  });

  it("excludes future-week meetings from the Load more count", () => {
    track();
    const past = (i: number) => new Date(Date.now() - (i + 1) * DAY);
    const events = Array.from({ length: MEETING_NOTES_TIMELINE_PAGE + 3 }, (_, i) => ev(100 + i, past(i)));
    events.push(ev(1, new Date(eow().getTime() + DAY)), ev(2, new Date(eow().getTime() + 5 * DAY)));
    render(<AccountMeetingNotesTimeline events={events} meetings={[]} onOpenEvent={noop} onOpenMeeting={noop} />);
    fireEvent.click(screen.getByText("Load more (3 older)", { exact: false }));
    expect(screen.queryByText("Event 1")).toBeNull();
    expect(screen.queryByText(/Load more/)).toBeNull();
  });

  it("applies the cutoff to summary-only meetings; keeps undated ones", () => {
    track();
    const future = new Date(eow().getTime() + DAY).toISOString();
    render(<AccountMeetingNotesTimeline events={[]} meetings={[mtg(7, future), mtg(8, null), mtg(9, new Date(Date.now() - DAY).toISOString())]} onOpenEvent={noop} onOpenMeeting={noop} />);
    expect(screen.queryByText("M7")).toBeNull();
    expect(screen.getByText("M8")).toBeTruthy();
    expect(screen.getByText("M9")).toBeTruthy();
  });

  it("shows a muted caption naming the cutoff date", () => {
    track();
    render(<AccountMeetingNotesTimeline events={[]} meetings={[]} onOpenEvent={noop} onOpenMeeting={noop} />);
    const label = eow().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    expect(screen.getByTestId("meeting-notes-cutoff").textContent).toBe(`Showing meetings through ${label}`);
  });
});
