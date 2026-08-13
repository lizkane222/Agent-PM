import React, { useEffect, useRef, useState } from "react";
import type { AirtableActionItem, AirtableMeeting, CalendarEvent } from "../../types";
import { useRightClickComment } from "../comments/CommentContext";

export function fmtDuration(secs: number): string {
  if (!secs) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Account Timeline (horizontal, day-by-day) ─────────────────────────────────

const DAY_ABBR = ["Su", "M", "T", "W", "Th", "F", "Sa"];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Returns an array of Date objects for each weekday (Mon–Fri) over the window. */
function buildDayWindow(centerDate: Date, halfWeeks = 3): Date[] {
  const days: Date[] = [];
  const start = new Date(centerDate);
  // go back halfWeeks weeks to Monday
  const dow = start.getDay(); // 0=Sun
  const daysToMon = (dow === 0 ? 6 : dow - 1);
  start.setDate(start.getDate() - daysToMon - halfWeeks * 7);

  for (let i = 0; i < (halfWeeks * 2 + 1) * 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    if (d.getDay() !== 0 && d.getDay() !== 6) days.push(d); // weekdays only
  }
  return days;
}

function MeetingTimelineBtn({
  m,
  isPast,
  onSelectMeeting,
}: {
  m: AirtableMeeting;
  isPast: boolean;
  onSelectMeeting: (m: AirtableMeeting) => void;
}) {
  const { onContextMenu } = useRightClickComment("meeting", m.id, m.name);
  return (
    <button
      onClick={() => onSelectMeeting(m)}
      onContextMenu={onContextMenu}
      title={m.name || "Meeting"}
      style={{
        background: isPast ? "rgba(226,34,34,0.07)" : "rgba(226,34,34,0.12)",
        border: "1px solid rgba(226,34,34,0.2)",
        borderRadius: "4px",
        padding: "3px 5px",
        fontSize: "0.625rem",
        fontWeight: 500,
        color: "var(--twilio-red, #e22)",
        textAlign: "left",
        cursor: "pointer",
        opacity: isPast ? 0.65 : 1,
        overflow: "hidden",
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
        maxWidth: "100%",
      }}
    >
      {m.name || "Meeting"}
    </button>
  );
}

function CalEventTimelineBtn({
  ev,
  isPast,
  onSelectCalEvent,
}: {
  ev: CalendarEvent;
  isPast: boolean;
  onSelectCalEvent: (ev: CalendarEvent) => void;
}) {
  const { onContextMenu } = useRightClickComment("calendar_event", ev.id, ev.title);
  return (
    <button
      className="card-btn"
      onClick={() => onSelectCalEvent(ev)}
      onContextMenu={onContextMenu}
      title={ev.title}
      style={{
        background: isPast ? "rgba(14,165,233,0.06)" : "rgba(14,165,233,0.12)",
        border: "1px solid rgba(14,165,233,0.2)",
        borderRadius: "4px",
        padding: "3px 5px",
        fontSize: "0.625rem",
        fontWeight: 500,
        color: "#0ea5e9",
        textAlign: "left",
        cursor: "pointer",
        opacity: isPast ? 0.65 : 1,
        overflow: "hidden",
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
        maxWidth: "100%",
      }}
    >
      {ev.title}
    </button>
  );
}

export function renderInline(text: string): React.ReactNode {
  // Handle **bold** markers inline
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part
  );
}

export function AccountTimeline({
  meetings,
  actionItems,
  calendarEvents,
  onSelectMeeting,
  onSelectAction,
  onSelectCalEvent,
  onDropActionOnDay,
  scrollToDate,
}: {
  meetings: AirtableMeeting[];
  actionItems: AirtableActionItem[];
  calendarEvents: CalendarEvent[];
  onSelectMeeting: (m: AirtableMeeting) => void;
  onSelectAction: (i: AirtableActionItem) => void;
  onSelectCalEvent: (ev: CalendarEvent) => void;
  onDropActionOnDay?: (airtableId: string, dateStr: string) => void;
  scrollToDate?: string;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = isoDate(today);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);

  const days = buildDayWindow(today, 3);

  // Build lookup maps by date string
  const meetingsByDate: Record<string, AirtableMeeting[]> = {};
  for (const m of meetings) {
    if (!m.date) continue;
    const d = isoDate(new Date(m.date));
    (meetingsByDate[d] ??= []).push(m);
  }

  // Done items pinned to a specific meeting (by meeting Django PK)
  const pinnedByMeeting: Record<number, AirtableActionItem[]> = {};
  for (const item of actionItems) {
    if (item.linked_meeting != null) {
      (pinnedByMeeting[item.linked_meeting] ??= []).push(item);
    }
  }

  const actionsByDate: Record<string, AirtableActionItem[]> = {};
  for (const item of actionItems) {
    if (!item.due_date) continue;
    const d = isoDate(new Date(item.due_date));
    (actionsByDate[d] ??= []).push(item);
  }

  const calByDate: Record<string, CalendarEvent[]> = {};
  for (const ev of calendarEvents) {
    const d = isoDate(new Date(ev.start_datetime));
    (calByDate[d] ??= []).push(ev);
  }

  const hasAny = meetings.length > 0 || actionItems.length > 0 || calendarEvents.length > 0;

  // Auto-scroll to scrollToDate (or today) when the prop changes or on first render
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const target = scrollToDate
      ? container.querySelector<HTMLElement>(`[data-date="${scrollToDate}"]`)
      : null;
    const el = target ?? container.querySelector<HTMLElement>("[data-today='true']");
    if (el) {
      const containerW = container.offsetWidth;
      container.scrollLeft = el.offsetLeft - containerW / 2 + el.offsetWidth / 2;
    }
  }, [scrollToDate]);

  if (!hasAny) {
    return <p className="text-xs text-[var(--twilio-gray-60)] italic py-1">No meetings, action items, or calendar events yet.</p>;
  }

  return (
    <div
      ref={scrollRef}
      className="overflow-x-auto pb-2"
      style={{ scrollbarWidth: "thin" }}
    >
      <div style={{ display: "flex", gap: "6px", minWidth: "max-content" }}>
        {days.map((day) => {
          const ds = isoDate(day);
          const isToday = ds === todayStr;
          const isPast = day < today;
          const dayMeetings = meetingsByDate[ds] ?? [];
          const dayActions = actionsByDate[ds] ?? [];
          const dayCalEvs = calByDate[ds] ?? [];
          const hasItems = dayMeetings.length > 0 || dayActions.length > 0 || dayCalEvs.length > 0;

          return (
            <div
              key={ds}
              data-date={ds}
              data-today={isToday ? "true" : undefined}
              onDragOver={(e) => { e.preventDefault(); setDragOverDay(ds); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverDay(null); }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverDay(null);
                const aid = e.dataTransfer.getData("timelineActionId");
                if (aid && onDropActionOnDay) onDropActionOnDay(aid, ds);
              }}
              style={{
                width: "120px",
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              {/* ── Day card (header + meetings + cal events only) ── */}
              <div
                style={{
                  borderRadius: "8px",
                  border: dragOverDay === ds
                    ? "1.5px solid var(--twilio-blue, #0263E0)"
                    : isToday
                    ? "1.5px solid var(--twilio-red, #e22)"
                    : hasItems
                    ? "1px solid rgba(0,0,0,0.1)"
                    : "1px solid rgba(0,0,0,0.05)",
                  background: dragOverDay === ds
                    ? "rgba(2,99,224,0.06)"
                    : isToday
                    ? "rgba(226,34,34,0.04)"
                    : isPast
                    ? "rgba(0,0,0,0.02)"
                    : "var(--surface, #fff)",
                  padding: "6px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  minHeight: "52px",
                }}
              >
                {/* Day header */}
                <div style={{ textAlign: "center", paddingBottom: "4px", borderBottom: isToday ? "1px solid rgba(226,34,34,0.2)" : "1px solid rgba(0,0,0,0.06)" }}>
                  <div style={{
                    fontSize: "0.625rem",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: isToday ? "var(--twilio-red, #e22)" : isPast ? "var(--twilio-gray-40, #aaa)" : "var(--twilio-gray-60, #606b85)",
                  }}>
                    {DAY_ABBR[day.getDay()]}
                  </div>
                  <div style={{
                    fontSize: "0.8125rem",
                    fontWeight: isToday ? 700 : 500,
                    color: isToday ? "var(--twilio-red, #e22)" : isPast ? "var(--twilio-gray-40, #aaa)" : "var(--twilio-navy, #121c2d)",
                    lineHeight: 1.2,
                  }}>
                    {(day.getMonth() + 1)}/{day.getDate()}
                  </div>
                </div>

                {/* Meetings + calendar events */}
                <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                  {dayMeetings.map((m) => (
                    <div key={m.airtable_id} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                      <MeetingTimelineBtn
                        m={m}
                        isPast={isPast}
                        onSelectMeeting={onSelectMeeting}
                      />
                      {/* Pinned Done action items linked to this meeting */}
                      {(pinnedByMeeting[m.id] ?? []).map((pinned) => (
                        <button
                          key={pinned.airtable_id}
                          onClick={() => onSelectAction(pinned)}
                          title={pinned.task}
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: "4px",
                            width: "100%",
                            textAlign: "left",
                            background: "rgba(21,128,61,0.08)",
                            border: "1px solid rgba(21,128,61,0.22)",
                            borderRadius: "3px",
                            padding: "2px 5px",
                            marginLeft: "6px",
                            cursor: "pointer",
                          }}
                        >
                          <span style={{ flexShrink: 0, fontSize: "0.6rem", color: "#15803d", marginTop: "2px" }}>✓</span>
                          <span style={{
                            fontSize: "0.6rem",
                            fontWeight: 500,
                            lineHeight: 1.3,
                            color: "#15803d",
                            textDecoration: "line-through",
                            overflow: "hidden",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            wordBreak: "break-word",
                          }}>
                            {pinned.task}
                          </span>
                        </button>
                      ))}
                    </div>
                  ))}
                  {dayCalEvs.map((ev) => (
                    <CalEventTimelineBtn
                      key={ev.google_event_id || ev.id}
                      ev={ev}
                      isPast={isPast}
                      onSelectCalEvent={onSelectCalEvent}
                    />
                  ))}
                </div>
              </div>

              {/* ── Action items — below the card, outside the border ── */}
              {dayActions.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                  {dayActions.map((item) => {
                    const isDone = item.status === "Done";
                    const isOverdue = isPast && !isDone;
                    return (
                      <button
                        key={item.airtable_id}
                        className="card-btn"
                        onClick={() => onSelectAction(item)}
                        title={item.task || "Action item"}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: "5px",
                          width: "100%",
                          textAlign: "left",
                          background: isDone ? "rgba(21,128,61,0.09)" : isOverdue ? "rgba(220,38,38,0.1)" : "rgba(124,58,237,0.1)",
                          border: isDone ? "1px solid rgba(21,128,61,0.25)" : isOverdue ? "1px solid rgba(220,38,38,0.25)" : "1px solid rgba(124,58,237,0.25)",
                          borderRadius: "4px",
                          padding: "3px 5px",
                          cursor: "pointer",
                          opacity: isDone ? 0.7 : 1,
                        }}
                      >
                        <span style={{
                          flexShrink: 0,
                          marginTop: "3px",
                          width: "6px",
                          height: "6px",
                          borderRadius: "50%",
                          background: isDone ? "#15803d" : isOverdue ? "#dc2626" : "#7c3aed",
                          display: "inline-block",
                        }} />
                        <span style={{
                          fontSize: "0.625rem",
                          fontWeight: 500,
                          lineHeight: 1.35,
                          color: isDone ? "#15803d" : isOverdue ? "#dc2626" : "#6d28d9",
                          textDecoration: isDone ? "line-through" : "none",
                          overflow: "hidden",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          wordBreak: "break-word",
                        }}>
                          {item.task || "Action item"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: "12px", marginTop: "8px", paddingLeft: "2px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <div style={{ width: "10px", height: "10px", borderRadius: "2px", background: "rgba(226,34,34,0.12)", border: "1px solid rgba(226,34,34,0.2)" }} />
          <span style={{ fontSize: "0.625rem", color: "var(--twilio-gray-60)" }}>Meetings</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <div style={{ width: "10px", height: "10px", borderRadius: "2px", background: "rgba(2,99,224,0.1)", border: "1px solid rgba(2,99,224,0.2)" }} />
          <span style={{ fontSize: "0.625rem", color: "var(--twilio-gray-60)" }}>Calendar events</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: "var(--twilio-gray-40)" }} />
          <span style={{ fontSize: "0.625rem", color: "var(--twilio-gray-60)" }}>Action items due</span>
        </div>
      </div>
    </div>
  );
}

