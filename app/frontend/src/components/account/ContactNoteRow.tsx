import { useState } from "react";
import type { CustomerContactNote } from "../../types";

export function ContactNoteRow({
  note,
  size = "sm",
  onSave,
  onDelete,
}: {
  note: CustomerContactNote;
  size?: "sm" | "xs";
  onSave: (noteId: number, content: string) => Promise<void> | void;
  onDelete: (noteId: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.content);
  const [saving, setSaving] = useState(false);
  const isXs = size === "xs";

  async function commit() {
    const next = draft.trim();
    if (!next || next === note.content) { setEditing(false); setDraft(note.content); return; }
    setSaving(true);
    try {
      await onSave(note.id, next);
      setEditing(false);
    } catch { /* keep editor open on failure */ } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <li className={`flex items-start gap-${isXs ? "1.5" : "2"} ${isXs ? "text-[11px]" : "text-xs"}`} style={{ color: "var(--twilio-navy)" }}>
        <span className={`${isXs ? "w-1.5 h-1.5" : "w-1.5 h-1.5"} rounded-full bg-gray-300 shrink-0 mt-1.5`} />
        <div className="flex-1 flex flex-col gap-1">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void commit(); }
              if (e.key === "Escape") { e.preventDefault(); setEditing(false); setDraft(note.content); }
            }}
            rows={2}
            className={`w-full rounded border border-gray-200 bg-white px-2 py-1 ${isXs ? "text-[11px]" : "text-xs"} focus:border-indigo-300 focus:outline-none resize-y`}
            style={{ color: "var(--twilio-navy)" }}
          />
          <div className="flex gap-1.5">
            <button
              onClick={() => void commit()}
              disabled={saving || !draft.trim()}
              className={`${isXs ? "text-[10px]" : "text-[11px]"} font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-40 transition-colors`}
            >Save</button>
            <button
              onClick={() => { setEditing(false); setDraft(note.content); }}
              className={`${isXs ? "text-[10px]" : "text-[11px]"} text-gray-400 hover:text-gray-600 transition-colors`}
            >Cancel</button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className={`group/note flex items-start gap-${isXs ? "1.5" : "2"} ${isXs ? "text-[11px]" : "text-xs"}`} style={{ color: "var(--twilio-navy)" }}>
      <span className="w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0 mt-1.5" />
      <span className="flex-1 leading-relaxed">{note.content}</span>
      <button
        onClick={() => { setDraft(note.content); setEditing(true); }}
        title="Edit"
        className="opacity-0 group-hover/note:opacity-100 shrink-0 text-gray-300 hover:text-indigo-500 transition-opacity text-sm leading-none"
      >✎</button>
      <button
        onClick={() => onDelete(note.id)}
        title="Remove"
        className="opacity-0 group-hover/note:opacity-100 shrink-0 text-gray-300 hover:text-red-400 transition-opacity text-sm leading-none"
      >×</button>
    </li>
  );
}
