import { useState, useEffect, useRef } from "react";
import type { Reminder } from "../../types";
import { readScheduledReminders } from "./calendarHelpers";

export default function ReminderCard_Cal({ reminder, onDragStart, onDelete, onUpdate }: {
  reminder: Reminder;
  onDragStart: (e: React.DragEvent) => void;
  onDelete: () => void;
  onUpdate: (patch: Partial<Reminder>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editTitle, setEditTitle] = useState(reminder.title);
  const [editBody, setEditBody] = useState(reminder.body);
  const [editDueAt, setEditDueAt] = useState(reminder.due_at.slice(0, 16)); // "YYYY-MM-DDTHH:MM"
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) {
      setEditTitle(reminder.title);
      setEditBody(reminder.body);
      setEditDueAt(reminder.due_at.slice(0, 16));
    }
  }, [reminder, expanded]);

  function commitEdit() {
    if (!expanded) return;
    setExpanded(false);
    const patch: Partial<Reminder> = {};
    if (editTitle !== reminder.title) patch.title = editTitle;
    if (editBody !== reminder.body) patch.body = editBody;
    const newDueAt = editDueAt.length === 16 ? `${editDueAt}:00` : editDueAt;
    if (newDueAt !== reminder.due_at) patch.due_at = newDueAt;
    if (Object.keys(patch).length > 0) onUpdate(patch);
  }

  useEffect(() => {
    if (!expanded) return;
    function onPointerDown(e: PointerEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) commitEdit();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, editTitle, editBody, editDueAt]);

  const statusLabel = reminder.status.charAt(0).toUpperCase() + reminder.status.slice(1);
  const dueLabel = new Date(reminder.due_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  if (expanded) {
    return (
      <div
        ref={cardRef}
        className="rounded-lg select-none"
        style={{ background: "#FFFBEB", borderLeft: "3px solid #f59e0b", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6, boxShadow: "0 2px 8px rgba(0,0,0,0.10)" }}
      >
        <input
          autoFocus
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitEdit(); } if (e.key === "Escape") setExpanded(false); }}
          placeholder="Reminder title"
          className="w-full text-[13px] font-medium text-[var(--twilio-navy)] bg-white rounded px-2 py-1 border border-amber-300 focus:outline-none focus:border-amber-500"
        />
        <textarea
          value={editBody}
          onChange={(e) => setEditBody(e.target.value)}
          rows={2}
          placeholder="Notes…"
          className="w-full text-[11px] text-[var(--twilio-navy)] bg-white rounded px-2 py-1 border border-gray-200 focus:outline-none focus:border-amber-300 resize-none leading-relaxed placeholder:text-gray-400"
        />
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--twilio-gray-60)] shrink-0">Due:</span>
          <input
            type="datetime-local"
            value={editDueAt}
            onChange={(e) => setEditDueAt(e.target.value)}
            className="flex-1 text-[11px] rounded border border-amber-200 px-1.5 py-1 focus:outline-none focus:border-amber-400 bg-white"
          />
        </div>
        <div className="flex items-center justify-between pt-0.5">
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="rounded p-0.5 hover:bg-red-100 transition-colors text-gray-400 hover:text-red-500"
          >
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>
          </button>
          <button onClick={(e) => { e.stopPropagation(); commitEdit(); }} className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-amber-500 text-white hover:bg-amber-600 transition-colors">Done</button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      draggable
      onDragStart={onDragStart}
      onClick={() => setExpanded(true)}
      className="rounded-lg select-none cursor-pointer group"
      style={{ background: "#FFFBEB", borderLeft: "3px solid #f59e0b", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap bg-amber-50 text-amber-700">{statusLabel}</span>
        <span className="text-[10px] text-[var(--twilio-gray-60)]">{dueLabel}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="ml-auto rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-red-100 transition-all text-gray-400 hover:text-red-500"
        >
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>
        </button>
      </div>
      <p className="text-[13px] font-medium text-[var(--twilio-navy)] leading-snug" style={{ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>
        {reminder.title || <span className="italic opacity-40">Untitled</span>}
      </p>
      {reminder.body && (
        <p className="text-[11px] text-[var(--twilio-navy)] opacity-60 leading-snug" style={{ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>
          {reminder.body}
        </p>
      )}
      {/* Scheduled occurrences */}
      {(() => {
        const occurrences = readScheduledReminders().filter((r) => r.reminderId === reminder.id && new Date(r.start) >= new Date(new Date().setHours(0,0,0,0)));
        if (occurrences.length === 0) return null;
        return (
          <div className="mt-1 pt-1.5 border-t border-amber-200/70">
            <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide mb-0.5">On calendar</p>
            {occurrences.map((o) => (
              <span key={o.start} className="text-[10px] text-amber-700 block">
                {new Date(o.start).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </span>
            ))}
          </div>
        );
      })()}
    </div>
  );
}
