import { useEffect, useMemo, useState } from "react";
import { schedulerApi } from "../../lib/api";
import { parseBullets } from "./GongSummaryPanel";
import { sanitizeHtml, plainToHtml } from "../../lib/noteHelpers";
import { endOfWeek } from "../../lib/weekBounds";
import { setNoteDragData, noteLabel, noteRefKey, summaryRefId, type NoteLinkIndex } from "../../lib/noteLinks";
import type { AirtableMeeting, CalendarEvent, MeetingNote } from "../../types";

export const MEETING_NOTES_TIMELINE_PAGE = 20;

function summaryText(m: AirtableMeeting | undefined): string {
  if (!m) return "";
  return m.gong_notes?.trim() ? m.gong_notes : (m.zoom_notes ?? "");
}

type Entry = {
  key: string;
  title: string;
  date: string; // ISO
  event?: CalendarEvent;
  meeting?: AirtableMeeting;
};

function LinkedChip({ names }: { names?: string[] }) {
  if (!names || names.length === 0) return null;
  return (
    <span data-testid="note-linked-badge" title={`Linked to ${names.join(", ")}`} style={{ marginLeft: 6, fontSize: "0.6rem", padding: "1px 6px", borderRadius: 999, background: "var(--tint-indigo-50)", color: "#6366f1" }}>
      In: {names.join(", ")}
    </span>
  );
}

function fmt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "No date";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/**
 * Vertical, newest-first timeline of every meeting on the account, each headed by its title
 * and date with the meeting's calendar notes and Gong/Zoom summary underneath. Notes for the
 * visible page of meetings are fetched in ONE batched request (never one per meeting).
 * Note visibility is the server's owner-scoped rule: a teammate's calendar notes are not
 * returned, but their meeting's Gong/Zoom summary (AirtableMeeting) is.
 */
export default function AccountMeetingNotesTimeline({
  events,
  meetings,
  onOpenEvent,
  onOpenMeeting,
  noteLinks,
}: {
  events: CalendarEvent[];
  meetings: AirtableMeeting[];
  onOpenEvent: (ev: CalendarEvent) => void;
  onOpenMeeting: (m: AirtableMeeting) => void;
  /** noteRefKey → project/goal names the note is linked under (drives the "In:" chip). */
  noteLinks?: NoteLinkIndex;
}) {
  const [visible, setVisible] = useState(MEETING_NOTES_TIMELINE_PAGE);
  const [notes, setNotes] = useState<Record<number, MeetingNote[]>>({});
  const [loading, setLoading] = useState(false);

  const entries = useMemo<Entry[]>(() => {
    const byAirtable = new Map(meetings.map((m) => [m.airtable_id, m]));
    const covered = new Set<string>();
    const out: Entry[] = [];
    for (const ev of events) {
      const meeting = ev.agentpm_airtable_id ? byAirtable.get(ev.agentpm_airtable_id) : undefined;
      if (meeting) covered.add(meeting.airtable_id);
      out.push({ key: `e-${ev.id}`, title: ev.title || meeting?.name || "Untitled Meeting", date: ev.start_datetime, event: ev, meeting });
    }
    for (const m of meetings) {
      if (covered.has(m.airtable_id) || !summaryText(m).trim()) continue;
      out.push({ key: `m-${m.id}`, title: m.name || "Untitled Meeting", date: m.date ?? "", meeting: m });
    }
    // Nothing beyond the end of the current (local, Sunday-start) week. Undated entries are
    // kept: with no date we cannot say they are in the future, and hiding them would drop notes.
    const cutoff = endOfWeek(new Date()).getTime();
    for (let i = out.length - 1; i >= 0; i--) {
      const t = out[i].date ? new Date(out[i].date).getTime() : NaN;
      if (!isNaN(t) && t > cutoff) out.splice(i, 1);
    }
    out.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    return out;
  }, [events, meetings]);

  const cutoffLabel = endOfWeek(new Date()).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const shown = entries.slice(0, visible);
  const idKey = shown.map((e) => e.event?.id ?? "").filter(Boolean).join(",");

  useEffect(() => {
    const ids = idKey ? idKey.split(",").map(Number) : [];
    if (ids.length === 0) { setNotes({}); return; }
    let cancelled = false;
    setLoading(true);
    schedulerApi.listMeetingNotesForEvents(ids)
      .then((r) => {
        if (cancelled) return;
        const map: Record<number, MeetingNote[]> = {};
        for (const n of r.data.results as MeetingNote[]) (map[n.event] ??= []).push(n);
        setNotes(map);
      })
      .catch(() => { if (!cancelled) setNotes({}); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [idKey]);

  return (
    <div
      data-testid="meeting-notes-timeline"
      className="rounded-xl mt-3"
      style={{ background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}
    >
      <div style={{ padding: "10px 16px 8px", borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
        <p className="text-xs font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide">Meeting Notes Timeline</p>
        <p data-testid="meeting-notes-cutoff" style={{ fontSize: "0.65rem", color: "var(--twilio-gray-40, #9ca3af)", margin: 0 }}>Showing meetings through {cutoffLabel}</p>
      </div>
      <div style={{ maxHeight: "480px", overflowY: "auto" }} data-testid="meeting-notes-timeline-scroll">
        {entries.length === 0 && (
          <p style={{ padding: "16px", fontSize: "0.8125rem", color: "var(--twilio-gray-40, #9ca3af)", fontStyle: "italic" }}>
            No meetings recorded yet.
          </p>
        )}
        {shown.map(({ key, title, date, event, meeting }) => {
          const evNotes = event ? notes[event.id] ?? [] : [];
          const bullets = parseBullets(summaryText(meeting));
          const empty = evNotes.length === 0 && bullets.length === 0;
          return (
            <section key={key} data-testid="meeting-notes-entry" style={{ borderBottom: "1px solid var(--border, rgba(0,0,0,0.06))" }}>
              <button
                type="button"
                onClick={() => (event ? onOpenEvent(event) : meeting && onOpenMeeting(meeting))}
                className="w-full text-left hover:bg-[#e4eaf4] transition-colors"
                style={{ padding: "6px 16px", background: "#eef2f8", display: "flex", justifyContent: "space-between", gap: "8px", position: "sticky", top: 0, zIndex: 1 }}
              >
                <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-ink)" }}>{title}</span>
                <span style={{ fontSize: "0.68rem", color: "var(--text-ink)", opacity: 0.6, whiteSpace: "nowrap" }}>{fmt(date)}</span>
              </button>
              <ul style={{ listStyle: "none", margin: 0, padding: "4px 16px 6px" }}>
                {bullets.map((b, i) =>
                  b.kind === "heading" ? (
                    <li key={`b${i}`} style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "capitalize", color: "var(--text-ink)", paddingTop: 4 }}>{b.text}</li>
                  ) : (
                    // The unit of a summary drag is ONE bullet: bullets have no ids, so a link is
                    // the meeting plus the bullet text. Editing the summary text orphans the link
                    // (the chip keeps its snapshot label).
                    <li
                      key={`b${i}`}
                      data-testid="summary-bullet-row"
                      draggable={!!meeting}
                      onDragStart={(e) => meeting && setNoteDragData(e, { kind: "summary", id: summaryRefId(meeting.airtable_id, b.text), meetingId: meeting.airtable_id, label: noteLabel(b.text) })}
                      style={{ fontSize: "0.75rem", color: "var(--twilio-gray-80, #374151)", padding: "1px 0 1px 10px" }}
                    >
                      • {b.text}
                      <LinkedChip names={meeting ? noteLinks?.[noteRefKey({ kind: "summary", id: summaryRefId(meeting.airtable_id, b.text) })] : undefined} />
                    </li>
                  ),
                )}
                {evNotes.map((n) => (
                  <li
                    key={n.id}
                    data-testid="meeting-note-row"
                    draggable
                    onDragStart={(e) => setNoteDragData(e, { kind: "meeting_note", id: String(n.id), meetingId: String(n.event), label: noteLabel(n.html || n.text) })}
                    style={{ padding: "3px 0" }}
                  >
                    <div className="rich-text" style={{ fontSize: "0.75rem" }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(plainToHtml(n.html || n.text)) }} />
                    <LinkedChip names={noteLinks?.[noteRefKey({ kind: "meeting_note", id: String(n.id) })]} />
                  </li>
                ))}
                {empty && !loading && (
                  <li style={{ fontSize: "0.75rem", fontStyle: "italic", color: "var(--twilio-gray-40, #9ca3af)" }}>No notes yet</li>
                )}
              </ul>
            </section>
          );
        })}
        {entries.length > visible && (
          <button
            type="button"
            onClick={() => setVisible((v) => v + MEETING_NOTES_TIMELINE_PAGE)}
            className="w-full text-[11px] font-medium text-indigo-500 hover:text-indigo-700 py-2"
          >
            Load more ({entries.length - visible} older)
          </button>
        )}
      </div>
    </div>
  );
}
