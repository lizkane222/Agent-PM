/**
 * AccountMeetingNotesFeed used to fetch notes and the linked Airtable meeting once per
 * calendar event — 2N requests. An account with many meetings blew the backend's
 * 200/min DRF user throttle and the page 429'd. These tests pin the request count at 2
 * regardless of event count, and check that the batched responses still land on the
 * right events.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { AccountMeetingNotesFeed } from "../AccountMeetingNotesFeed";
import type { AirtableMeeting, CalendarEvent, MeetingNote } from "../../../types";

vi.mock("../../../context/CurrentUserContext", () => ({
  useCurrentUser: () => null,
  CurrentUserProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const NOTES_PATH = "/api/v1/scheduler/meeting-notes/";
const MEETINGS_PATH = "/api/v1/airtable/meetings/";

function makeEvent(id: number, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id,
    owner: 1,
    owner_username: "alice",
    title: `Event ${id}`,
    description: "",
    location: "",
    start_datetime: `2026-07-${String(10 + id).padStart(2, "0")}T10:00:00Z`,
    end_datetime: `2026-07-${String(10 + id).padStart(2, "0")}T11:00:00Z`,
    all_day: false,
    status: "confirmed",
    account: null,
    account_name: null,
    google_event_id: "",
    meet_link: "",
    calendar_id: "",
    is_synced: false,
    agentpm_airtable_id: "",
    attendees: [],
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function makeNote(id: number, event: number, text: string): MeetingNote {
  return {
    id,
    event,
    author: 1,
    author_username: "alice",
    author_display: "Alice",
    html: `<p>${text}</p>`,
    text,
    due_date: null,
    position: 0,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
  } as MeetingNote;
}

function makeMeeting(id: number, airtableId: string, overrides: Partial<AirtableMeeting> = {}): AirtableMeeting {
  return {
    id,
    airtable_id: airtableId,
    account: 5,
    account_name: "Acme Corp",
    name: `Meeting ${id}`,
    date: "2026-07-11T10:00:00Z",
    duration: 3600,
    expected_topics: "",
    gong_notes: "",
    gong_url: "",
    customer_slack: "",
    account_team_slack: "",
    last_synced: "2026-07-01T00:00:00Z",
    ...overrides,
  } as AirtableMeeting;
}

/** Installs handlers that count calls and record the query params they were sent. */
function trackRequests(opts: {
  notes?: MeetingNote[];
  meetings?: AirtableMeeting[];
} = {}) {
  const calls = { notes: 0, meetings: 0 };
  const params = { notesEvent: [] as string[], meetingsCalEvent: [] as string[] };

  server.use(
    http.get(NOTES_PATH, ({ request }) => {
      calls.notes += 1;
      params.notesEvent.push(new URL(request.url).searchParams.get("event") ?? "");
      return HttpResponse.json({
        count: opts.notes?.length ?? 0,
        next: null,
        previous: null,
        results: opts.notes ?? [],
      });
    }),
    http.get(MEETINGS_PATH, ({ request }) => {
      calls.meetings += 1;
      params.meetingsCalEvent.push(
        new URL(request.url).searchParams.get("calendar_event_id") ?? ""
      );
      return HttpResponse.json({
        count: opts.meetings?.length ?? 0,
        next: null,
        previous: null,
        results: opts.meetings ?? [],
      });
    })
  );

  return { calls, params };
}

function renderFeed(calendarEvents: CalendarEvent[], meetings: AirtableMeeting[] = []) {
  return render(
    <AccountMeetingNotesFeed
      meetings={meetings}
      calendarEvents={calendarEvents}
      accountName="Acme Corp"
      airtableAccountId={5}
      onCreatedActionItem={vi.fn()}
    />
  );
}

describe("AccountMeetingNotesFeed — batched fetching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("issues exactly two requests for a single event", async () => {
    const { calls } = trackRequests();
    renderFeed([makeEvent(1)]);

    await waitFor(() => expect(calls.notes).toBe(1));
    expect(calls.meetings).toBe(1);
  });

  it("still issues exactly two requests for many events", async () => {
    // The regression this change exists to prevent: 12 events used to mean 24 requests.
    const { calls } = trackRequests();
    const events = Array.from({ length: 12 }, (_, i) => makeEvent(i + 1));

    renderFeed(events);

    // Wait for the feed to finish loading (it renders nothing until then), rather than
    // waiting on the counter itself — a count-based waitFor would pass the instant it
    // saw 1 even if eleven more requests were still on their way.
    await waitFor(() => {
      expect(screen.getByText("Event 1")).toBeInTheDocument();
    });
    // Then let any stragglers land before pinning the totals.
    await new Promise((r) => setTimeout(r, 50));

    expect(calls.notes).toBe(1);
    expect(calls.meetings).toBe(1);
  });

  it("sends every event ID as one comma-separated batch", async () => {
    const { calls, params } = trackRequests();
    renderFeed([makeEvent(1), makeEvent(2), makeEvent(3)]);

    await waitFor(() => expect(calls.notes).toBe(1));
    expect(params.notesEvent[0]).toBe("1,2,3");
    expect(params.meetingsCalEvent[0]).toBe("1,2,3");
  });

  it("makes no request at all when there are no events", async () => {
    const { calls } = trackRequests();
    renderFeed([]);

    // Nothing to ask about — the effect short-circuits.
    await waitFor(() => expect(calls.notes).toBe(0));
    expect(calls.meetings).toBe(0);
  });

  it("groups batched notes onto the correct events", async () => {
    const { calls } = trackRequests({
      notes: [
        makeNote(101, 1, "note for event one"),
        makeNote(102, 2, "note for event two"),
        makeNote(103, 2, "second note for event two"),
      ],
    });

    renderFeed([makeEvent(1), makeEvent(2)]);

    await waitFor(() => expect(calls.notes).toBe(1));
    // All three notes render, each under its own event's entry.
    await waitFor(() => {
      expect(screen.getByText("note for event one")).toBeInTheDocument();
    });
    expect(screen.getByText("note for event two")).toBeInTheDocument();
    expect(screen.getByText("second note for event two")).toBeInTheDocument();
  });

  it("joins batched meetings to events via agentpm_airtable_id", async () => {
    // Only event 2 is linked to an Airtable meeting; its Gong summary must render
    // under that event, proving the local join replaced the per-event server lookup.
    const { calls } = trackRequests({
      meetings: [
        makeMeeting(900, "recLINKED", { gong_notes: "- Discussed renewal terms" }),
      ],
    });

    renderFeed([
      makeEvent(1),
      makeEvent(2, { agentpm_airtable_id: "recLINKED" }),
    ]);

    await waitFor(() => expect(calls.meetings).toBe(1));
    await waitFor(() => {
      expect(screen.getByText(/Discussed renewal terms/)).toBeInTheDocument();
    });
    // Exactly one Meeting Summary block — the unlinked event must not pick it up.
    expect(screen.getAllByText("Meeting Summary")).toHaveLength(1);
  });

  it("does not attribute a meeting to an event with no airtable link", async () => {
    const { calls } = trackRequests({
      meetings: [makeMeeting(900, "recOTHER", { gong_notes: "- Unrelated summary" })],
    });

    renderFeed([makeEvent(1), makeEvent(2)]);

    await waitFor(() => expect(calls.meetings).toBe(1));
    expect(screen.queryByText("Meeting Summary")).not.toBeInTheDocument();
  });

  it("renders events even when both batched requests fail", async () => {
    server.use(
      http.get(NOTES_PATH, () => new HttpResponse(null, { status: 500 })),
      http.get(MEETINGS_PATH, () => new HttpResponse(null, { status: 500 }))
    );

    renderFeed([makeEvent(1, { title: "Resilient Event" })]);

    // Failures are swallowed per-request; the feed still renders its events.
    await waitFor(() => {
      expect(screen.getByText("Resilient Event")).toBeInTheDocument();
    });
  });

  it("re-fetches once when the event ID set changes, not once per event", async () => {
    const { calls } = trackRequests();
    const { rerender } = renderFeed([makeEvent(1)]);

    await waitFor(() => expect(calls.notes).toBe(1));

    rerender(
      <AccountMeetingNotesFeed
        meetings={[]}
        calendarEvents={[makeEvent(1), makeEvent(2), makeEvent(3)]}
        accountName="Acme Corp"
        airtableAccountId={5}
        onCreatedActionItem={vi.fn()}
      />
    );

    await waitFor(() => expect(calls.notes).toBe(2));
    expect(calls.meetings).toBe(2);
  });

  it("does not re-fetch when the events array is a new reference with the same IDs", async () => {
    const { calls } = trackRequests();
    const { rerender } = renderFeed([makeEvent(1), makeEvent(2)]);

    await waitFor(() => expect(calls.notes).toBe(1));

    // Fresh objects, identical IDs — the ID-string dep must keep this from re-firing.
    rerender(
      <AccountMeetingNotesFeed
        meetings={[]}
        calendarEvents={[makeEvent(1), makeEvent(2)]}
        accountName="Acme Corp"
        airtableAccountId={5}
        onCreatedActionItem={vi.fn()}
      />
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(calls.notes).toBe(1);
    expect(calls.meetings).toBe(1);
  });
});
