import { useState, useRef, useEffect } from "react";
import { schedulerApi } from "../../lib/api";
import type { MeetingNote, AirtableActionItem } from "../../types";
import { AccountNoteRowSimple } from "./AccountNoteRowSimple";

export function MeetingNotesPanel({ eventId, accountName, airtableAccountId, linkedMeetingId, onCreatedActionItem }: { eventId: number; accountName?: string | null; airtableAccountId?: number | null; linkedMeetingId?: number; onCreatedActionItem?: (item: AirtableActionItem) => void }) {
  const [notes, setNotes] = useState<MeetingNote[]>([]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const locallyCreatedIds = useRef<Set<number>>(new Set());

  useEffect(() => {
    schedulerApi.listMeetingNotes(eventId)
      .then(({ data }) => setNotes(data.results ?? []))
      .catch(() => {});
  }, [eventId]);


  async function addNote() {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      const { data } = await schedulerApi.createMeetingNote({ event: eventId, html: text, text, position: notes.length });
      locallyCreatedIds.current.add(data.id);
      setNotes((prev) => [...prev, data]);
      setDraft("");
    } catch { /* best effort */ } finally { setSaving(false); }
  }

  async function deleteNote(id: number) {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    try { await schedulerApi.deleteMeetingNote(id); } catch { /* best effort */ }
  }

  async function saveNote(updated: MeetingNote) {
    setNotes((prev) => prev.map((n) => n.id === updated.id ? updated : n));
    try { await schedulerApi.updateMeetingNote(updated.id, { text: updated.text, html: updated.text }); } catch { /* best effort */ }
  }

  return (
    <div style={{ marginTop: "12px" }}>
      <p style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--twilio-gray-60)", marginBottom: "6px" }}>Meeting Notes</p>
      <div style={{ border: "1px solid rgba(0,0,0,0.08)", borderRadius: "8px", background: "#fff", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "6px", padding: "6px 10px", borderBottom: notes.length > 0 ? "1px solid rgba(0,0,0,0.06)" : undefined }}>
          <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#d1d5db", flexShrink: 0, marginTop: "7px" }} />
          <textarea
            value={draft}
            rows={draft.split("\n").length || 1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.shiftKey) return;
              if (e.key === "Enter") { e.preventDefault(); void addNote(); }
            }}
            placeholder="Add a note… (Shift+Enter for new line)"
            disabled={saving}
            style={{ flex: 1, fontSize: "0.8125rem", color: "var(--twilio-navy)", background: "transparent", border: "none", outline: "none", resize: "none", lineHeight: 1.5, padding: "1px 0" }}
          />
          {draft.trim() && (
            <button onClick={() => void addNote()} disabled={saving} style={{ fontSize: "0.6875rem", fontWeight: 600, color: "#6366f1", background: "none", border: "none", cursor: "pointer", padding: "2px 0", flexShrink: 0, marginTop: "4px" }}>
              Add
            </button>
          )}
        </div>
        {notes.length > 0 && (
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {notes.map((note) => (
              <AccountNoteRowSimple key={note.id} note={note} onSave={saveNote} onDelete={deleteNote} accountName={accountName} airtableAccountId={airtableAccountId} eventId={eventId} linkedMeetingId={linkedMeetingId} onCreatedActionItem={onCreatedActionItem} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
