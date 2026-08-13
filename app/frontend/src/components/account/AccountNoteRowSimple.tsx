import { useState, useRef, useEffect } from "react";
import { renderNoteInline, handleLinkPaste } from "../../lib/noteHelpers";
import { NoteActionButton } from "./NoteActionButton";
import { NoteActionTooltip } from "./NoteActionTooltip";
import type { MeetingNote, AirtableActionItem } from "../../types";

// Inline editable note row for the account panel (no @mention, minimal UI)
export function AccountNoteRowSimple({
  note, onSave, onDelete, accountName, airtableAccountId, eventId, linkedMeetingId, onCreatedActionItem,
}: {
  note: MeetingNote;
  onSave: (n: MeetingNote) => void;
  onDelete: (id: number) => void;
  accountName?: string | null;
  airtableAccountId?: number | null;
  eventId: number;
  linkedMeetingId?: number;
  onCreatedActionItem?: (item: AirtableActionItem) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.text);
  const [openAction, setOpenAction] = useState<"action" | "calendar" | "reminder" | null>(null);
  const [tooltipAnchorY, setTooltipAnchorY] = useState<number | undefined>(undefined);
  const _nlsKey = `note-actions::${note.id}`;
  const [doneActions, setDoneActions] = useState<Set<"action" | "calendar" | "reminder">>(() => {
    try { const v = localStorage.getItem(_nlsKey); return v ? new Set(JSON.parse(v) as ("action" | "calendar" | "reminder")[]) : new Set(); } catch { return new Set(); }
  });
  function markSimpleDone(kind: "action" | "calendar" | "reminder") {
    setDoneActions((p) => { const n = new Set([...p, kind]); try { localStorage.setItem(_nlsKey, JSON.stringify([...n])); } catch {} return n; });
  }
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Close tooltip on outside click
  useEffect(() => {
    if (!openAction) return;
    function handler(e: MouseEvent) {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) setOpenAction(null);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openAction]);

  function commit() {
    setEditing(false);
    const trimmed = text.trim();
    if (!trimmed || trimmed === note.text) return;
    onSave({ ...note, text: trimmed, html: trimmed });
  }

  const [hovered, setHovered] = useState(false);

  return (
    <li
      className="group"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "flex-start", gap: "6px", padding: "5px 10px", position: "relative",
        borderTop: `1px solid ${hovered ? "rgba(0,0,0,0.06)" : "transparent"}`,
        borderBottom: `1px solid ${hovered ? "rgba(0,0,0,0.06)" : "transparent"}`,
        transition: "border-color 0.1s",
      }}
    >
      <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--twilio-navy)", opacity: 0.35, flexShrink: 0, marginTop: "7px" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <textarea
            autoFocus
            value={text}
            rows={text.split("\n").length || 1}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => handleLinkPaste(e, text, setText)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter" && e.shiftKey) return; if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") { setEditing(false); setText(note.text); } }}
            style={{ width: "100%", fontSize: "0.8125rem", color: "var(--twilio-navy)", background: "#eef2ff", border: "1px solid #a5b4fc", borderRadius: "4px", padding: "2px 6px", outline: "none", resize: "none", lineHeight: 1.5 }}
          />
        ) : (
          <div onClick={() => { setEditing(true); setText(note.text); }} style={{ fontSize: "0.8125rem", color: "var(--twilio-navy)", lineHeight: 1.5, cursor: "text" }}>
            {note.text.split("\n").map((line, li) => {
              const isSub = line.startsWith("- ");
              const content = isSub ? line.slice(2) : line;
              return (
                <div key={li} style={isSub ? { display: "flex", alignItems: "flex-start", gap: "5px", marginLeft: "12px", marginTop: li > 0 ? "1px" : undefined } : { marginTop: li > 0 ? "1px" : undefined }}>
                  {isSub && <span style={{ width: "4px", height: "4px", borderRadius: "50%", background: "#9ca3af", flexShrink: 0, marginTop: "7px" }} />}
                  <span>{renderNoteInline(content)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {/* Hover actions */}
      {!editing && (
        <div ref={tooltipRef} style={{ display: "flex", alignItems: "center", gap: "2px", flexShrink: 0, position: "relative" }}>
          <button
            title="Create action item"
            onClick={(e) => { setTooltipAnchorY(e.currentTarget.getBoundingClientRect().bottom); setOpenAction(openAction === "action" ? null : "action"); }}
            style={{ padding: "2px", borderRadius: "3px", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", color: doneActions.has("action") ? "#2563eb" : "#9ca3af" }}
            className={doneActions.has("action") ? "transition-opacity" : "opacity-0 group-hover:opacity-100 transition-opacity"}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: "12px", height: "12px" }}><path d="M8 5h9M8 10h9M8 15h9" strokeLinecap="round"/><path d="M3 5l1.5 1.5L7 3M3 10l1.5 1.5L7 8M3 15l1.5 1.5L7 13" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button
            title="Set reminder"
            onClick={(e) => { setTooltipAnchorY(e.currentTarget.getBoundingClientRect().bottom); setOpenAction(openAction === "reminder" ? null : "reminder"); }}
            style={{ padding: "2px", borderRadius: "3px", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", color: doneActions.has("reminder") ? "#2563eb" : "#9ca3af" }}
            className={doneActions.has("reminder") ? "transition-opacity" : "opacity-0 group-hover:opacity-100 transition-opacity"}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: "12px", height: "12px" }}><circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button
            title="Create meeting"
            onClick={(e) => { setTooltipAnchorY(e.currentTarget.getBoundingClientRect().bottom); setOpenAction(openAction === "calendar" ? null : "calendar"); }}
            style={{ padding: "2px", borderRadius: "3px", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", color: doneActions.has("calendar") ? "#2563eb" : "#9ca3af" }}
            className={doneActions.has("calendar") ? "transition-opacity" : "opacity-0 group-hover:opacity-100 transition-opacity"}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: "12px", height: "12px" }}><rect x="2" y="4" width="16" height="14" rx="2"/><path d="M2 8h16M6 2v4M14 2v4" strokeLinecap="round"/></svg>
          </button>
          <button
            title="Send to agent chat"
            onClick={() => window.dispatchEvent(new CustomEvent("chat-inject", { detail: { text: note.text } }))}
            style={{ padding: "2px", borderRadius: "3px", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", color: "#9ca3af" }}
            className="opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: "12px", height: "12px" }}><path d="M3 5a2 2 0 012-2h10a2 2 0 012 2v7a2 2 0 01-2 2H7l-4 3V5z" strokeLinejoin="round"/><path d="M7 9h6M7 12h4" strokeLinecap="round"/></svg>
          </button>
          <span style={{ width: "1px", height: "10px", background: "#e5e7eb", margin: "0 2px" }} className="opacity-0 group-hover:opacity-100 transition-opacity" />
          <NoteActionButton title="Delete" onClick={() => onDelete(note.id)} danger>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: "12px", height: "12px" }}><path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9h8l1-9" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </NoteActionButton>
          {openAction && (
            <NoteActionTooltip
              kind={openAction}
              noteText={note.text}
              eventId={eventId}
              accountName={accountName}
              airtableAccountId={airtableAccountId}
              linkedMeetingId={linkedMeetingId}
              anchorY={tooltipAnchorY}
              onDone={markSimpleDone}
              onCreated={onCreatedActionItem}
              onClose={() => setOpenAction(null)}
            />
          )}
        </div>
      )}
    </li>
  );
}
