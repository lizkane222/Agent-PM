import { useEffect, useMemo, useRef, useState } from "react";
import { schedulerApi, airtableApi } from "../../lib/api";
import { AccountNoteRowSimple } from "./AccountNoteRowSimple";
import { parseBullets, GongBulletRow, _strHash } from "./GongSummaryPanel";
import type { GongItem } from "./GongSummaryPanel";
import type { AirtableActionItem, AirtableMeeting, CalendarEvent, MeetingNote } from "../../types";

// ── Gong summary section — renders parsed bullets with per-bullet action buttons ──

function GongSummaryRow({
  meeting,
  eventId,
  accountName,
  airtableAccountId,
  onCreatedActionItem,
}: {
  meeting: AirtableMeeting;
  eventId: number;
  accountName?: string | null;
  airtableAccountId?: number | null;
  onCreatedActionItem?: (item: AirtableActionItem) => void;
}) {
  const items: GongItem[] = parseBullets(meeting.gong_notes);
  if (items.length === 0) return null;

  return (
    <li style={{ listStyle: "none", background: "rgba(99,102,241,0.02)", paddingBottom: "4px" }}>
      <div style={{ padding: "5px 10px 3px", display: "flex", alignItems: "center", gap: "4px" }}>
        <span style={{ fontSize: "0.62rem", fontWeight: 700, color: "#6366f1", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Meeting Summary
        </span>
      </div>
      <div style={{ marginLeft: "8px", marginRight: "8px", border: "1px solid rgba(99,102,241,0.15)", borderRadius: "6px", overflow: "hidden" }}>
        {items.map((item, i) => {
          if (item.kind === "heading") {
            return (
              <div key={i} style={{ padding: "5px 10px 3px", borderBottom: "1px solid rgba(0,0,0,0.05)", background: "rgba(99,102,241,0.04)" }}>
                <p style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "capitalize", color: "var(--twilio-navy)", margin: 0, letterSpacing: "0.01em" }}>
                  {item.text}
                </p>
              </div>
            );
          }
          const isLast = i === items.length - 1 || items[i + 1]?.kind === "heading";
          return (
            <GongBulletRow
              key={i}
              text={item.text}
              eventId={eventId}
              accountName={accountName}
              airtableAccountId={airtableAccountId}
              isLast={isLast}
              onCreatedActionItem={onCreatedActionItem}
              persistKey={`gong-feed::${meeting.id}::${_strHash(item.text)}`}
            />
          );
        })}
      </div>
    </li>
  );
}

// ── AccountMeetingNotesFeed ───────────────────────────────────────────────────

// meeting is optional — calendar events without a linked Airtable meeting are still shown
type MeetingEntry = {
  meeting: AirtableMeeting | undefined;
  event: CalendarEvent | undefined;
  notes: MeetingNote[];
  entryKey: string;
  title: string;
};

type DateGroup = {
  dateKey: string;
  dateLabel: string;
  entries: MeetingEntry[];
};

function formatDateLabel(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function AccountMeetingNotesFeed({
  meetings,
  calendarEvents,
  accountName,
  airtableAccountId,
  onCreatedActionItem,
}: {
  meetings: AirtableMeeting[];
  calendarEvents: CalendarEvent[];
  accountName?: string | null;
  airtableAccountId?: number | null;
  onCreatedActionItem?: (item: AirtableActionItem) => void;
}) {
  const [notesByEvent, setNotesByEvent] = useState<Record<number, MeetingNote[]>>({});
  // Keyed by calendar event ID — fetched via calendar_event_id param, same as the sidebar.
  // This reliably returns stub meetings that may have account=None and therefore would
  // be absent from the account-filtered meetings prop.
  const [meetingByEvent, setMeetingByEvent] = useState<Record<number, AirtableMeeting>>({});
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  const allEventIdStr = useMemo(() => {
    return calendarEvents.map((ev) => ev.id).sort((a, b) => a - b).join(",");
  }, [calendarEvents]);

  // The effect needs each event's agentpm_airtable_id to map batched meetings back to
  // events, but must keep re-firing only on the ID set (not on every new array
  // reference). Read the full objects through a ref so they stay out of the deps.
  const calendarEventsRef = useRef(calendarEvents);
  calendarEventsRef.current = calendarEvents;

  useEffect(() => {
    if (!allEventIdStr) {
      setFetched(true);
      return;
    }
    setLoading(true);
    const ids = allEventIdStr.split(",").map(Number).filter(Boolean);
    // Two requests total, regardless of event count. This used to be two per event,
    // which blew the backend's 200/min throttle on any account with many meetings.
    Promise.all([
      schedulerApi.listMeetingNotesForEvents(ids)
        .then((r) => r.data.results as MeetingNote[])
        .catch(() => [] as MeetingNote[]),
      airtableApi.listMeetings({ calendar_event_id: ids.join(",") })
        .then((r) => r.data.results as AirtableMeeting[])
        .catch(() => [] as AirtableMeeting[]),
    ]).then(([notes, batchedMeetings]) => {
      // Every requested event gets an entry — dateGroups indexes this map directly.
      const notesMap: Record<number, MeetingNote[]> = {};
      for (const id of ids) notesMap[id] = [];
      for (const note of notes) {
        (notesMap[note.event] ??= []).push(note);
      }

      // Join meetings back to events on airtable_id === event.agentpm_airtable_id,
      // the same linkage the backend used to resolve one calendar_event_id at a time.
      const meetingByAirtableId = new Map(batchedMeetings.map((m) => [m.airtable_id, m]));
      const meetingsMap: Record<number, AirtableMeeting> = {};
      for (const ev of calendarEventsRef.current) {
        if (!ev.agentpm_airtable_id) continue;
        const meeting = meetingByAirtableId.get(ev.agentpm_airtable_id);
        if (meeting) meetingsMap[ev.id] = meeting;
      }

      setNotesByEvent(notesMap);
      setMeetingByEvent(meetingsMap);
    }).finally(() => { setLoading(false); setFetched(true); });
  }, [allEventIdStr]);

  const dateGroups = useMemo((): DateGroup[] => {
    if (!fetched) return [];

    const entries: MeetingEntry[] = [];
    const coveredMeetingIds = new Set<number>();

    for (const event of calendarEvents) {
      // meetingByEvent is fetched by calendar_event_id — always correct, even for stub meetings.
      // Fall back to the prop-based lookup for Airtable-native meetings.
      const meeting =
        meetingByEvent[event.id] ??
        meetings.find((m) => m.airtable_id === event.agentpm_airtable_id);
      if (meeting) coveredMeetingIds.add(meeting.id);
      const notes = notesByEvent[event.id] ?? [];
      entries.push({
        meeting,
        event,
        notes,
        entryKey: `event-${event.id}`,
        title: event.title || meeting?.name || "Untitled Meeting",
      });
    }

    // Airtable meetings with gong_notes not yet covered by any calendar event
    for (const meeting of meetings) {
      if (!meeting.gong_notes || coveredMeetingIds.has(meeting.id)) continue;
      entries.push({
        meeting,
        event: undefined,
        notes: [],
        entryKey: `meeting-${meeting.id}`,
        title: meeting.name || "Untitled Meeting",
      });
    }

    entries.sort((a, b) => {
      const da = a.event ? a.event.start_datetime : (a.meeting?.date ?? "");
      const db = b.event ? b.event.start_datetime : (b.meeting?.date ?? "");
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return db.localeCompare(da);
    });

    const groupMap = new Map<string, MeetingEntry[]>();
    for (const entry of entries) {
      const dateKey = entry.event
        ? new Date(entry.event.start_datetime).toISOString().slice(0, 10)
        : (entry.meeting?.date?.slice(0, 10) ?? "no-date");
      if (!groupMap.has(dateKey)) groupMap.set(dateKey, []);
      groupMap.get(dateKey)!.push(entry);
    }

    return Array.from(groupMap.entries()).map(([dateKey, grpEntries]) => ({
      dateKey,
      dateLabel: dateKey !== "no-date" ? formatDateLabel(dateKey) : "No date",
      entries: grpEntries,
    }));
  }, [fetched, meetings, calendarEvents, notesByEvent, meetingByEvent]);

  function updateNote(eventId: number, updated: MeetingNote) {
    schedulerApi.updateMeetingNote(updated.id, { text: updated.text, html: updated.html }).catch(() => {});
    setNotesByEvent((prev) => ({
      ...prev,
      [eventId]: (prev[eventId] ?? []).map((n) => n.id === updated.id ? updated : n),
    }));
  }

  function deleteNote(eventId: number, noteId: number) {
    schedulerApi.deleteMeetingNote(noteId).catch(() => {});
    setNotesByEvent((prev) => ({
      ...prev,
      [eventId]: (prev[eventId] ?? []).filter((n) => n.id !== noteId),
    }));
  }

  if (!fetched || loading) return null;
  if (meetings.length === 0 && calendarEvents.length === 0) return null;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: "var(--surface, #fff)",
        border: "1px solid var(--border, rgba(0,0,0,0.08))",
        boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
      }}
    >
      <div style={{ padding: "12px 16px 8px", borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
        <p className="text-xs font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide">
          Meeting Notes History
        </p>
      </div>

      <div style={{ maxHeight: "480px", overflowY: "auto" }}>
        {dateGroups.length === 0 && (
          <p style={{ padding: "16px", fontSize: "0.8125rem", color: "var(--twilio-gray-40, #9ca3af)", fontStyle: "italic" }}>
            No meetings recorded yet.
          </p>
        )}
        {dateGroups.map(({ dateKey, dateLabel, entries }) => (
          <div key={dateKey}>
            {/* Date group header — level 1 */}
            <div
              style={{
                padding: "6px 16px 5px 14px",
                background: "#dde4ef",
                borderBottom: "1px solid rgba(18,28,45,0.12)",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                position: "sticky",
                top: 0,
                zIndex: 1,
              }}
            >
              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: "10px", height: "10px", color: "#121C2D", opacity: 0.6, flexShrink: 0 }}>
                <rect x="1" y="2" width="12" height="11" rx="1.5"/>
                <path d="M1 5.5h12M4.5 1v3M9.5 1v3" strokeLinecap="round"/>
              </svg>
              <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#121C2D", letterSpacing: "0.03em" }}>
                {dateLabel}
              </span>
            </div>

            {/* Meetings within this date */}
            {entries.map(({ meeting, event, notes, entryKey, title }) => (
              <div key={entryKey} style={{ borderBottom: "1px solid var(--border, rgba(0,0,0,0.06))" }}>
                {/* Meeting name subheader — level 2 (indented from date) */}
                <div style={{
                  padding: "5px 16px 5px 28px",
                  background: "#eef2f8",
                  borderBottom: "1px solid rgba(18,28,45,0.07)",
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                }}>
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" style={{ width: "9px", height: "9px", color: "#121C2D", opacity: 0.45, flexShrink: 0 }}>
                    <path d="M7 1.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM7 4v3.5l2.5 1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "#121C2D", opacity: 0.75 }}>
                    {title}
                  </span>
                </div>

                {/* Notes — level 3 (indented from meeting title) */}
                <ul style={{ listStyle: "none", margin: 0, padding: "0 0 2px 28px" }}>
                  {/* Gong / meeting summary */}
                  {meeting?.gong_notes && (
                    <GongSummaryRow
                      meeting={meeting}
                      eventId={event?.id ?? 0}
                      accountName={accountName}
                      airtableAccountId={airtableAccountId}
                      onCreatedActionItem={onCreatedActionItem}
                    />
                  )}

                  {/* Individual meeting notes (from calendar event) */}
                  {event && notes.map((note) => (
                    <AccountNoteRowSimple
                      key={note.id}
                      note={note}
                      onSave={(updated) => updateNote(event.id, updated)}
                      onDelete={(id) => deleteNote(event.id, id)}
                      accountName={accountName}
                      airtableAccountId={airtableAccountId}
                      eventId={event.id}
                      onCreatedActionItem={onCreatedActionItem}
                    />
                  ))}

                  {/* Empty state when no notes or gong summary */}
                  {!meeting?.gong_notes && notes.length === 0 && (
                    <li style={{ padding: "6px 10px 6px 10px" }}>
                      <span style={{ fontSize: "0.75rem", color: "var(--twilio-gray-40, #9ca3af)", fontStyle: "italic" }}>
                        No notes yet
                      </span>
                    </li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
