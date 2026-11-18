import { useEffect, useRef, useState } from "react";
import type { AirtableActionItem, CommentReference, TeamMember } from "../../types";
import { NoteActionTooltip, type NoteSource } from "./NoteActionTooltip";

type ActionKind = "action" | "reminder" | "calendar";

/** Plain text of a bullet: markup removed, @mentions kept as text. */
export function bulletPlainText(text: string): string {
  if (!/[<&]/.test(text)) return text.trim();
  const doc = new DOMParser().parseFromString(text, "text/html");
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

const ICON = { width: "12px", height: "12px" } as const;
const keepSelection = (e: React.MouseEvent) => e.preventDefault();

/**
 * The per-bullet action buttons (create action item / set reminder / create meeting, and an
 * optional Copy) shared by the meeting-summary sidebar and the meeting-notes timeline. The
 * nearest ancestor with the `group` class drives the show-on-hover behaviour. Buttons prevent
 * default on mousedown so clicking one never clears a text selection.
 */
export function NoteBulletActions({
  text, eventId, source, onLinked, accountName, airtableAccountId, linkedMeetingId, mentionedMembers, persistKey, onCreatedActionItem, copyable,
}: {
  text: string;
  /** The meeting the text belongs to. Omit it when `source` says where the text came from instead. */
  eventId?: number;
  source?: NoteSource;
  onLinked?: (ref: CommentReference) => void; accountName?: string | null; airtableAccountId?: number | null; linkedMeetingId?: number;
  mentionedMembers?: TeamMember[]; persistKey?: string; onCreatedActionItem?: (item: AirtableActionItem) => void; copyable?: boolean;
}) {
  const [openAction, setOpenAction] = useState<ActionKind | null>(null);
  const [anchorY, setAnchorY] = useState<number | undefined>(undefined);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [doneActions, setDoneActions] = useState<Set<ActionKind>>(() => {
    if (!persistKey) return new Set();
    try { const v = localStorage.getItem(persistKey); return v ? new Set(JSON.parse(v) as ActionKind[]) : new Set(); } catch { return new Set(); }
  });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openAction) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenAction(null);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openAction]);

  function btn(kind: ActionKind, title: string, icon: React.ReactNode) {
    const done = doneActions.has(kind);
    return (
      <button
        title={title}
        onMouseDown={keepSelection}
        onClick={(e) => { setAnchorY(e.currentTarget.getBoundingClientRect().bottom); setOpenAction(openAction === kind ? null : kind); }}
        style={{ padding: "2px", borderRadius: "3px", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", color: done ? "#2563eb" : "var(--text-gray-400)" }}
        className={done ? "transition-opacity" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"}
      >
        {icon}
      </button>
    );
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(bulletPlainText(text));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    setTimeout(() => setCopyState("idle"), 1500);
  }

  return (
    <div ref={ref} style={{ display: "flex", alignItems: "center", gap: "2px", flexShrink: 0, position: "relative" }}>
      {btn("action", "Create action item", <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" style={ICON}><path d="M8 5h9M8 10h9M8 15h9" strokeLinecap="round"/><path d="M3 5l1.5 1.5L7 3M3 10l1.5 1.5L7 8M3 15l1.5 1.5L7 13" strokeLinecap="round" strokeLinejoin="round"/></svg>)}
      {btn("reminder", "Set reminder", <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" style={ICON}><circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2" strokeLinecap="round" strokeLinejoin="round"/></svg>)}
      {btn("calendar", "Create meeting", <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" style={ICON}><rect x="2" y="4" width="16" height="14" rx="2"/><path d="M2 8h16M6 2v4M14 2v4" strokeLinecap="round"/></svg>)}
      {copyable && (
        <button
          title={copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy text"}
          aria-label="Copy text"
          onMouseDown={keepSelection}
          onClick={() => void copy()}
          style={{ padding: "2px", borderRadius: "3px", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", fontSize: "0.625rem", fontWeight: 600, color: copyState === "copied" ? "#16a34a" : copyState === "failed" ? "#dc2626" : "var(--text-gray-400)" }}
          className={copyState === "idle" ? "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity" : "transition-opacity"}
        >
          {copyState === "copied" ? "Copied" : copyState === "failed" ? "Failed" : (
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" style={ICON}><rect x="7" y="7" width="10" height="10" rx="2"/><path d="M13 7V5a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2" strokeLinecap="round"/></svg>
          )}
        </button>
      )}
      {openAction && (
        <NoteActionTooltip
          kind={openAction}
          noteText={text}
          eventId={eventId}
          source={source}
          onLinked={onLinked}
          accountName={accountName}
          airtableAccountId={airtableAccountId}
          linkedMeetingId={linkedMeetingId}
          mentionedMembers={mentionedMembers}
          anchorY={anchorY}
          onDone={(kind) => setDoneActions((prev) => { const n = new Set([...prev, kind]); if (persistKey) { try { localStorage.setItem(persistKey, JSON.stringify([...n])); } catch {} } return n; })}
          onCreated={onCreatedActionItem}
          onClose={() => setOpenAction(null)}
        />
      )}
    </div>
  );
}
