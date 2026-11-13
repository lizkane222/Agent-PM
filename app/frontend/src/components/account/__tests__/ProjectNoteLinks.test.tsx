/**
 * Dragging notes (Account Notes rows, Meeting Notes Timeline rows / summary bullets) onto a
 * project or goal LINKS them: reference only, single parent, unlink never deletes.
 */
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { ProjectGoals } from "../ProjectGoals";
import AccountMeetingNotesTimeline from "../AccountMeetingNotesTimeline";
import { buildNoteLinkIndex, setNoteDragData, linkNoteToGoal, summaryRefId } from "../../../lib/noteLinks";
import type { AirtableMeeting, CalendarEvent, GoalSection, MeetingNote, NoteRef } from "../../../types";

vi.mock("../../../hooks/useExportTray", () => ({ useExportTray: () => ({ addToTray: vi.fn(), isSelected: vi.fn(() => false), exportMode: false }) }));
vi.mock("../ActionItemModal", () => ({ ActionItemModal: () => null }));

/** A DataTransfer stand-in that both stores (dragStart) and serves (drop). */
function dt() {
  const store: Record<string, string> = {};
  return {
    store,
    setData: (k: string, v: string) => { store[k.toLowerCase()] = v; },
    getData: (k: string) => store[k.toLowerCase()] ?? "",
    get types() { return Object.keys(store); },
    effectAllowed: "all",
  };
}

const goal = (id: string, name: string, o: Partial<GoalSection> = {}): GoalSection =>
  ({ id, name, kind: "project", url: "", actionIds: [], meetingIds: [], goalIds: [], resources: [], noteRefs: [], ...o });

const ev = (id: number): CalendarEvent => ({
  id, owner: 1, owner_username: "a", title: `Event ${id}`, description: "", location: "",
  start_datetime: new Date(Date.now() - 86400000).toISOString(), end_datetime: new Date().toISOString(),
  all_day: false, status: "confirmed", account: null, account_name: null, google_event_id: "", meet_link: "",
  calendar_id: "", is_synced: false, agentpm_airtable_id: "", attendees: [], created_at: "", updated_at: "",
} as CalendarEvent);
const mtg: AirtableMeeting = {
  id: 1, airtable_id: "recM", account: 1, account_name: "Acme", name: "Sync", date: new Date(Date.now() - 86400000).toISOString(),
  duration: 0, expected_topics: "", gong_notes: "Key Points:\n- pricing agreed", gong_url: "", customer_slack: "", account_team_slack: "", last_synced: "",
} as AirtableMeeting;
const mnote = { id: 5, event: 1, author: 1, author_username: "a", author_display: "A", html: "<p>call them back</p>", text: "call them back", due_date: null, position: 0, created_at: "", updated_at: "" } as MeetingNote;

function Harness({ initial, onSelectNote }: { initial: GoalSection[]; onSelectNote?: (r: NoteRef) => void }) {
  const [goals, setGoals] = useState(initial);
  return (
    <>
      <AccountMeetingNotesTimeline
        events={[{ ...ev(1), agentpm_airtable_id: "recM" }]} meetings={[mtg]}
        onOpenEvent={vi.fn()} onOpenMeeting={vi.fn()} noteLinks={buildNoteLinkIndex(goals)}
      />
      <ProjectGoals goals={goals} actionItems={[]} meetings={[]} onChange={setGoals} onSelectNote={onSelectNote} />
      <output data-testid="state">{JSON.stringify(goals.map((g) => ({ id: g.id, refs: g.noteRefs })))}</output>
    </>
  );
}
const state = () => JSON.parse(screen.getByTestId("state").textContent!) as { id: string; refs: NoteRef[] }[];

function serveNotes() {
  server.use(http.get("/api/v1/scheduler/meeting-notes/", () => HttpResponse.json({ count: 1, next: null, previous: null, results: [mnote] })));
}

function dragTo(source: HTMLElement, target: HTMLElement) {
  const d = dt();
  fireEvent.dragStart(source, { dataTransfer: d });
  fireEvent.dragOver(target, { dataTransfer: d });
  fireEvent.drop(target, { dataTransfer: d });
}

describe("linking notes to projects/goals", () => {
  it("dropping a calendar meeting note links it and shows the In: chip; the note stays", async () => {
    serveNotes();
    render(<Harness initial={[goal("1", "Alpha"), goal("2", "Beta")]} />);
    const row = await screen.findByTestId("meeting-note-row");
    dragTo(row, screen.getByTestId("project-row-1"));
    expect(state()[0].refs).toEqual([{ kind: "meeting_note", id: "5", meetingId: "1", label: "call them back" }]);
    expect(within(screen.getByTestId("goal-notes")).getByText("call them back")).toBeTruthy();
    expect(within(screen.getByTestId("meeting-note-row")).getByTestId("note-linked-badge")).toHaveTextContent("In: Alpha");
    expect(screen.getByTestId("meeting-note-row")).toHaveTextContent("call them back");
  });

  it("dropping a summary bullet links that one bullet", async () => {
    serveNotes();
    render(<Harness initial={[goal("1", "Alpha")]} />);
    const bullet = await screen.findByTestId("summary-bullet-row");
    dragTo(bullet, screen.getByTestId("project-row-1"));
    expect(state()[0].refs).toEqual([{ kind: "summary", id: summaryRefId("recM", "pricing agreed"), meetingId: "recM", label: "pricing agreed" }]);
    expect(within(screen.getByTestId("summary-bullet-row")).getByTestId("note-linked-badge")).toBeTruthy();
  });

  it("dropping on another project MOVES the link (single parent) and updates the badge", async () => {
    serveNotes();
    render(<Harness initial={[goal("1", "Alpha"), goal("2", "Beta")]} />);
    const row = await screen.findByTestId("meeting-note-row");
    dragTo(row, screen.getByTestId("project-row-1"));
    dragTo(screen.getByTestId("meeting-note-row"), screen.getByTestId("project-row-2"));
    const s = state();
    expect(s[0].refs).toEqual([]);
    expect(s[1].refs).toHaveLength(1);
    expect(screen.getByTestId("meeting-note-row")).toHaveTextContent("In: Beta");
    expect(screen.getByTestId("meeting-note-row")).not.toHaveTextContent("In: Alpha");
  });

  it("dropping the same note twice on one project does not duplicate it", async () => {
    serveNotes();
    render(<Harness initial={[goal("1", "Alpha")]} />);
    const row = await screen.findByTestId("meeting-note-row");
    dragTo(row, screen.getByTestId("project-row-1"));
    dragTo(screen.getByTestId("meeting-note-row"), screen.getByTestId("project-row-1"));
    expect(state()[0].refs).toHaveLength(1);
  });

  it("remove only unlinks: the note remains in the timeline and the badge disappears", async () => {
    serveNotes();
    const ref: NoteRef = { kind: "meeting_note", id: "5", meetingId: "1", label: "call them back" };
    render(<Harness initial={[goal("1", "Alpha", { noteRefs: [ref] })]} />);
    await screen.findByTestId("meeting-note-row");
    expect(screen.getByTestId("note-linked-badge")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Unlink note" }));
    expect(state()[0].refs).toEqual([]);
    expect(screen.queryByTestId("goal-notes")).toBeNull();
    expect(screen.getByTestId("meeting-note-row")).toHaveTextContent("call them back");
    expect(screen.queryByTestId("note-linked-badge")).toBeNull();
  });

  it("clicking a linked note reports it to the host", async () => {
    serveNotes();
    const ref: NoteRef = { kind: "account_note", id: "9", label: "an account note" };
    const onSelect = vi.fn();
    render(<Harness initial={[goal("1", "Alpha", { noteRefs: [ref] })]} onSelectNote={onSelect} />);
    fireEvent.click(await screen.findByTestId("goal-note-row"));
    expect(onSelect).toHaveBeenCalledWith(ref);
  });

  it("an account-note payload (as AccountNoteRow produces) links too, alongside existing noteText", async () => {
    serveNotes();
    render(<Harness initial={[goal("1", "Alpha")]} />);
    await screen.findByTestId("project-row-1");
    const d = dt();
    d.setData("noteText", "plain");
    setNoteDragData({ dataTransfer: d } as never, { kind: "account_note", id: "9", label: "plain" });
    fireEvent.dragOver(screen.getByTestId("project-row-1"), { dataTransfer: d });
    fireEvent.drop(screen.getByTestId("project-row-1"), { dataTransfer: d });
    await waitFor(() => expect(state()[0].refs).toEqual([{ kind: "account_note", id: "9", label: "plain" }]));
  });

  it("linkNoteToGoal moves a link between goals without touching others", () => {
    const r: NoteRef = { kind: "summary", id: "x", label: "l" };
    const out = linkNoteToGoal([goal("1", "A", { noteRefs: [r] }), goal("2", "B")], "2", r);
    expect(out[0].noteRefs).toEqual([]);
    expect(out[1].noteRefs).toEqual([r]);
  });
});
