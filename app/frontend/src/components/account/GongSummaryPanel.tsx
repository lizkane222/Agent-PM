import React, { useState, useRef, useEffect } from "react";
import { airtableApi, integrationsApi } from "../../lib/api";
import type { MeetingNotesSource } from "../../lib/api";
import type { AirtableActionItem, AirtableMeeting, TeamMember, CommentReference } from "../../types";
import { NoteActionTooltip } from "./NoteActionTooltip";
import { MeetingSummarySourceToggle, preferredMeetingSource } from "./MeetingSummarySourceToggle";

// ── Gong / meeting summary paste section ─────────────────────────────────────

// Detect team members mentioned by name in a Gong bullet.
// Returns the members found and a new display string with @FirstLast substitutions.
function detectMentions(text: string, teamMembers: TeamMember[]): { members: TeamMember[]; display: string } {
  const found: TeamMember[] = [];
  let display = text;
  for (const m of teamMembers) {
    const first = m.full_name.split(" ")[0];
    // Match full name or first name (word boundary, case-insensitive), not already @-prefixed
    const patterns = [
      new RegExp(`(?<!@)\\b${m.full_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"),
      new RegExp(`(?<!@)\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"),
    ];
    for (const pat of patterns) {
      if (pat.test(display)) {
        if (!found.find((f) => f.id === m.id)) found.push(m);
        display = display.replace(pat, `@${m.full_name}`);
        break;
      }
    }
  }
  return { members: found, display };
}

export type GongItem = { kind: "heading"; text: string } | { kind: "subheading"; text: string } | { kind: "bullet"; text: string };

// Section headings from Gong ("Recap", "Key Points", "Next Steps")
// and Zoom ("Quick recap", "Next steps", "Summary", "Collaboration", named sub-sections)
const GONG_HEADINGS = /^(recap|quick\s+recap|key\s+points?|next\s+steps?|summary|collaboration):?$/i;

function isPersonSubheading(line: string, inNextSteps: boolean): boolean {
  if (!inNextSteps) return false;
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^[\s]*[-•*▪◦–—]/.test(trimmed)) return false;
  if (/^[\s]*\d+[.)]/.test(trimmed)) return false;
  if (GONG_HEADINGS.test(trimmed.replace(/:$/, ""))) return false;
  return trimmed.length <= 50 && !/[.?!]$/.test(trimmed);
}

export function parseBullets(text: string): GongItem[] {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  let inNextSteps = false;
  const result: GongItem[] = [];
  for (const l of lines) {
    const stripped = l.replace(/^[\s]*[-•*▪◦–—][\s]+/, "").replace(/^[\s]*\d+[.)]\s+/, "").trim();
    const headingText = stripped.replace(/:$/, "");
    if (GONG_HEADINGS.test(headingText)) {
      inNextSteps = /next\s+steps?/i.test(headingText);
      result.push({ kind: "heading", text: headingText });
    } else if (isPersonSubheading(l, inNextSteps)) {
      result.push({ kind: "subheading", text: stripped });
    } else {
      result.push({ kind: "bullet", text: stripped });
    }
  }
  return result;
}

type NotesBySource = Record<MeetingNotesSource, string>;

export function GongSummaryPanel({ eventId, meetingId: meetingIdProp, existingNotes, existingZoomNotes, accountName, airtableAccountId, onCreatedActionItem, onSaved, teamMembers = [] }: { eventId: number; meetingId?: number; existingNotes?: string; existingZoomNotes?: string; accountName?: string | null; airtableAccountId?: number | null; onCreatedActionItem?: (item: AirtableActionItem) => void; onSaved?: (updated: AirtableMeeting) => void; teamMembers?: TeamMember[] }) {
  // Both providers' summaries are held at once so switching the toggle doesn't need a
  // round-trip; `raw` / `items` / `showPaste` are the view of whichever is active.
  const [notesBySource, setNotesBySource] = useState<NotesBySource>(() => ({
    gong: existingNotes ?? "",
    zoom: existingZoomNotes ?? "",
  }));
  const [source, setSource] = useState<MeetingNotesSource>(() =>
    preferredMeetingSource(existingNotes, existingZoomNotes)
  );
  const initialText = notesBySource[source];
  const [raw, setRaw] = useState(initialText);
  const [items, setItems] = useState<(GongItem & { mentionedMembers?: TeamMember[] })[]>(() =>
    initialText.trim() ? parseBullets(initialText).map((item) => item) : []
  );
  const [showPaste, setShowPaste] = useState(!initialText.trim());
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [noteReferences] = useState<CommentReference[]>([]);
  // Once the backend creates a stub meeting via by-event, cache its PK for future saves
  const resolvedMeetingId = useRef<number | undefined>(meetingIdProp);

  // Point raw/items/showPaste at `next`'s text. Unsaved textarea edits are dropped on
  // switch — the same thing that already happens when the panel's meeting changes.
  function showSource(next: MeetingNotesSource, store: NotesBySource) {
    setSource(next);
    const text = store[next] ?? "";
    setRaw(text);
    setItems(text.trim() ? parseBullets(text).map((i) => i) : []);
    setShowPaste(!text.trim());
  }

  // Re-initialize when the target meeting changes (covers same-notes-text case too)
  const prevMeetingRef = useRef<number | undefined>(meetingIdProp);
  const prevEventRef = useRef<number>(eventId);
  useEffect(() => {
    const meetingChanged = meetingIdProp !== prevMeetingRef.current;
    const eventChanged = eventId !== prevEventRef.current;
    if (meetingChanged || eventChanged) {
      prevMeetingRef.current = meetingIdProp;
      prevEventRef.current = eventId;
      resolvedMeetingId.current = meetingIdProp;
      const store: NotesBySource = { gong: existingNotes ?? "", zoom: existingZoomNotes ?? "" };
      setNotesBySource(store);
      showSource(preferredMeetingSource(store.gong, store.zoom), store);
    }
  }, [meetingIdProp, eventId, existingNotes, existingZoomNotes]);

  // Always fetch the latest notes from the server when the panel mounts or the
  // event/meeting changes — this ensures notes saved on the Calendar page, or imported
  // from a recap email by "GET Meeting Notes", are reflected here without a reload.
  useEffect(() => {
    const fetchMeeting = meetingIdProp
      ? airtableApi.getMeeting(meetingIdProp).then(({ data }) => data)
      : eventId
        ? airtableApi.listMeetings({ calendar_event_id: String(eventId) })
            .then(({ data }) => (data.results ?? [])[0] as AirtableMeeting | undefined)
        : Promise.resolve(undefined);

    fetchMeeting
      .then((m) => {
        if (!m) return;
        resolvedMeetingId.current = m.id;
        // Whitespace-only counts as empty: Airtable's richText columns report "\n"
        // forever once written and cleared, so a truthiness test would render an empty
        // recap as content and hide the paste box.
        const store: NotesBySource = {
          gong: (m.gong_notes ?? "").trim() ? m.gong_notes : "",
          zoom: (m.zoom_notes ?? "").trim() ? m.zoom_notes : "",
        };
        if (!store.gong && !store.zoom) return;
        setNotesBySource(store);
        if (store[source] && store[source] !== raw) {
          showSource(source, store);
        } else if (!store[source]) {
          // The active source came back empty but the other one has content — land on
          // whichever the server actually filled in rather than showing a paste box.
          showSource(preferredMeetingSource(store.gong, store.zoom), store);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, meetingIdProp]);

  async function persistAndNotify(text: string, parsed: GongItem[]) {
    const notified = new Set<number>();
    const enriched = parsed.map((item) => {
      if (item.kind !== "bullet") return item;
      const { members, display } = detectMentions(item.text, teamMembers);
      return { ...item, text: display, mentionedMembers: members };
    });
    setItems(enriched);
    setShowPaste(false);

    // Whichever provider the toggle is on is the one this text belongs to, so the save
    // targets that column. The other provider's notes are untouched.
    setNotesBySource((prev) => ({ ...prev, [source]: text }));

    const canSave = resolvedMeetingId.current || eventId;
    if (!canSave) return;
    setSaveState("saving");
    try {
      let savedMeeting;
      if (resolvedMeetingId.current) {
        const save = source === "zoom"
          ? airtableApi.updateMeetingZoomNotesByPk
          : airtableApi.updateMeetingGongNotesByPk;
        const { data } = await save(resolvedMeetingId.current, text.trim(), noteReferences.length > 0 ? noteReferences : undefined);
        savedMeeting = data;
      } else {
        // by-event will create a stub meeting if none exists; cache its PK
        const save = source === "zoom"
          ? airtableApi.updateMeetingZoomNotes
          : airtableApi.updateMeetingGongNotes;
        const { data } = await save(eventId, text.trim(), noteReferences.length > 0 ? noteReferences : undefined);
        savedMeeting = data;
        resolvedMeetingId.current = savedMeeting.id;
      }
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2500);
      onSaved?.(savedMeeting);
    } catch {
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 3000);
    }

    // Slack DMs to mentioned members (once per member)
    const summaryText = enriched.filter((i) => i.kind === "bullet").map((i) => `• ${i.text}`).join("\n");
    for (const item of enriched) {
      if (item.kind !== "bullet" || !item.mentionedMembers?.length) continue;
      for (const member of item.mentionedMembers) {
        if (notified.has(member.id) || !member.slack_handle) continue;
        notified.add(member.id);
        const msg = `👋 You were mentioned in meeting notes${accountName ? ` for *${accountName}*` : ""}:\n\n${summaryText}`;
        integrationsApi.notifySlackMention(member.slack_handle, msg).catch(() => {});
      }
    }
  }

  async function handleParse() {
    const parsed = parseBullets(raw);
    if (parsed.length === 0) return;
    await persistAndNotify(raw, parsed);
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = e.clipboardData.getData("text");
    if (!pasted.trim()) return;
    // Compute what the textarea will contain after the paste
    const ta = e.target as HTMLTextAreaElement;
    const before = ta.value.slice(0, ta.selectionStart ?? 0);
    const after = ta.value.slice(ta.selectionEnd ?? ta.value.length);
    const fullText = before + pasted + after;
    // Update controlled state immediately so textarea reflects the paste
    setRaw(fullText);
    const parsed = parseBullets(fullText);
    if (parsed.length === 0) return;
    void persistAndNotify(fullText, parsed);
  }

  return (
    <div style={{ marginTop: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
        <p style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--twilio-gray-60)", margin: 0 }}>Meeting Summary</p>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {saveState === "saving" && <span style={{ fontSize: "0.6875rem", color: "#9ca3af" }}>Saving…</span>}
          {saveState === "saved" && <span style={{ fontSize: "0.6875rem", color: "#16a34a" }}>✓ Saved</span>}
          {saveState === "error" && <span style={{ fontSize: "0.6875rem", color: "#dc2626" }}>Save failed</span>}
          <MeetingSummarySourceToggle
            value={source}
            onChange={(next) => showSource(next, notesBySource)}
            hasGong={!!notesBySource.gong.trim()}
            hasZoom={!!notesBySource.zoom.trim()}
          />
          <button onClick={() => setShowPaste((v) => !v)} style={{ fontSize: "0.6875rem", fontWeight: 600, color: "#6366f1", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            {showPaste ? "Hide" : items.length > 0 ? "Edit paste" : "+ Paste summary"}
          </button>
        </div>
      </div>

      {showPaste && (
        <div style={{ marginBottom: "8px" }}>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onPaste={handlePaste}
            rows={8}
            placeholder={source === "zoom"
              ? "Paste your Zoom AI Companion summary or any bulleted text here…"
              : "Paste your Gong notes, meeting summary, or any bulleted text here…"}
            style={{ width: "100%", fontSize: "0.8125rem", border: "1px solid #e5e7eb", borderRadius: "7px", padding: "8px 10px", outline: "none", resize: "vertical", lineHeight: 1.5, boxSizing: "border-box", color: "var(--twilio-navy)" }}
          />
          <button onClick={() => void handleParse()} disabled={!raw.trim()} style={{ marginTop: "5px", width: "100%", padding: "5px 0", fontSize: "0.75rem", fontWeight: 700, background: "#6366f1", color: "#fff", border: "none", borderRadius: "6px", cursor: raw.trim() ? "pointer" : "not-allowed", opacity: raw.trim() ? 1 : 0.4 }}>
            Parse & Save
          </button>
        </div>
      )}

      {items.length > 0 && (
        <div style={{ border: "1px solid rgba(0,0,0,0.08)", borderRadius: "8px", background: "#fff", overflow: "hidden" }}>
          {items.map((item, i) => {
            if (item.kind === "heading") {
              return (
                <div key={i} style={{ padding: "6px 10px 3px", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                  <p style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "capitalize", color: "var(--twilio-navy)", margin: 0, letterSpacing: "0.01em" }}>{item.text}</p>
                </div>
              );
            }
            if (item.kind === "subheading") {
              return (
                <div key={i} style={{ padding: "4px 10px 2px 20px", background: "rgba(99,102,241,0.04)" }}>
                  <p style={{ fontSize: "0.6875rem", fontWeight: 600, color: "#6366f1", margin: 0, letterSpacing: "0.01em" }}>{item.text}</p>
                </div>
              );
            }
            const isLast = i === items.length - 1 || items[i + 1]?.kind === "heading" || items[i + 1]?.kind === "subheading";
            return (
              <GongBulletRow key={i} persistKey={`gong-actions::${meetingIdProp ?? eventId}::${_strHash(item.text)}`} text={item.text} eventId={eventId} accountName={accountName} airtableAccountId={airtableAccountId} linkedMeetingId={resolvedMeetingId.current} isLast={isLast} onCreatedActionItem={onCreatedActionItem} mentionedMembers={item.mentionedMembers} />
            );
          })}
        </div>
      )}
    </div>
  );
}

function renderWithMentions(text: string): React.ReactNode {
  const parts = text.split(/(@\S+)/g);
  return parts.map((p, i) =>
    p.startsWith("@") ? <span key={i} style={{ color: "#2563eb", fontWeight: 600 }}>{p}</span> : p
  );
}

export function _strHash(s: string): number {
  let h = 0;
  for (let i = 0; i < Math.min(s.length, 120); i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function GongBulletRow({ text, eventId, accountName, airtableAccountId, linkedMeetingId, isLast, onCreatedActionItem, mentionedMembers, persistKey }: { text: string; eventId: number; accountName?: string | null; airtableAccountId?: number | null; linkedMeetingId?: number; isLast: boolean; onCreatedActionItem?: (item: AirtableActionItem) => void; mentionedMembers?: TeamMember[]; persistKey?: string }) {
  const [openAction, setOpenAction] = useState<"action" | "reminder" | "calendar" | null>(null);
  const [hovered, setHovered] = useState(false);
  const [tooltipAnchorY, setTooltipAnchorY] = useState<number | undefined>(undefined);
  const [doneActions, setDoneActions] = useState<Set<"action" | "calendar" | "reminder">>(() => {
    if (!persistKey) return new Set();
    try { const v = localStorage.getItem(persistKey); return v ? new Set(JSON.parse(v) as ("action" | "calendar" | "reminder")[]) : new Set(); } catch { return new Set(); }
  });
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openAction) return;
    function handler(e: MouseEvent) {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) setOpenAction(null);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openAction]);

  return (
    <div
      className="group"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "flex-start", gap: "6px", padding: "6px 10px", position: "relative",
        borderTop: `1px solid ${hovered ? "rgba(0,0,0,0.07)" : "transparent"}`,
        borderBottom: isLast
          ? `1px solid ${hovered ? "rgba(0,0,0,0.07)" : "transparent"}`
          : "1px solid rgba(0,0,0,0.05)",
        transition: "border-color 0.1s",
      }}
    >
      <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#9ca3af", flexShrink: 0, marginTop: "7px" }} />
      <p style={{ flex: 1, fontSize: "0.8125rem", color: "var(--twilio-navy)", lineHeight: 1.5, margin: 0 }}>{renderWithMentions(text)}</p>
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
        {openAction && (
          <NoteActionTooltip
            kind={openAction}
            noteText={text}
            eventId={eventId}
            accountName={accountName}
            airtableAccountId={airtableAccountId}
            linkedMeetingId={linkedMeetingId}
            mentionedMembers={mentionedMembers}
            anchorY={tooltipAnchorY}
            onDone={(kind) => setDoneActions((prev) => { const n = new Set([...prev, kind]); if (persistKey) { try { localStorage.setItem(persistKey, JSON.stringify([...n])); } catch {} } return n; })}
            onCreated={onCreatedActionItem}
            onClose={() => setOpenAction(null)}
          />
        )}
      </div>
    </div>
  );
}
