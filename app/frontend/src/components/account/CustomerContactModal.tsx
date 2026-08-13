import { useState } from "react";
import { accountsApi } from "../../lib/api";
import type { CustomerContact, CustomerContactNote } from "../../types";
import { ContactNoteRow } from "./ContactNoteRow";

export function CustomerContactModal({
  contact,
  onClose,
  onUpdated,
  onDeleted,
  initialEditMode = false,
}: {
  contact: CustomerContact;
  onClose: () => void;
  onUpdated: (c: CustomerContact) => void;
  onDeleted: (id: number) => void;
  initialEditMode?: boolean;
}) {
  const [form, setForm] = useState({ name: contact.name, role: contact.role, description: contact.description, email: contact.email });
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState<CustomerContactNote[]>(contact.notes ?? []);
  const [noteDraft, setNoteDraft] = useState("");
  const [editMode, setEditMode] = useState(initialEditMode);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const initials = contact.name.split(" ").map((p) => p[0]).join("").toUpperCase().slice(0, 2);

  async function handleSave() {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    try {
      const { data } = await accountsApi.updateContact(contact.id, form);
      onUpdated(data);
      setEditMode(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddNote() {
    const content = noteDraft.trim();
    if (!content) return;
    const { data } = await accountsApi.addContactNote(contact.id, content);
    setNotes((prev) => [data, ...prev]);
    setNoteDraft("");
  }

  async function handleUpdateNote(noteId: number, content: string) {
    const { data } = await accountsApi.updateContactNote(noteId, content);
    setNotes((prev) => prev.map((n) => (n.id === noteId ? data : n)));
  }

  async function handleDeleteNote(noteId: number) {
    await accountsApi.deleteContactNote(noteId);
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
  }

  async function handleDelete() {
    await accountsApi.deleteContact(contact.id);
    onDeleted(contact.id);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ background: "#fff", width: "440px", maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 48px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: "1px solid rgba(0,0,0,0.07)" }}>
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
            style={{ background: "rgba(99,102,241,0.12)", color: "#4f46e5" }}>
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            {editMode
              ? <input autoFocus value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full text-sm font-semibold text-[var(--twilio-navy)] border-b border-indigo-300 focus:outline-none bg-transparent" />
              : <p className="text-sm font-semibold text-[var(--twilio-navy)] truncate">{contact.name}</p>
            }
            {editMode
              ? <input value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                  placeholder="Role / title"
                  className="w-full text-xs text-[var(--twilio-gray-60)] border-b border-gray-200 focus:border-indigo-300 focus:outline-none bg-transparent mt-0.5" />
              : contact.role && <p className="text-xs text-[var(--twilio-gray-60)] truncate">{contact.role}</p>
            }
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!editMode && (
              <button onClick={() => setEditMode(true)}
                className="p-1.5 rounded-lg text-[var(--twilio-gray-60)] hover:text-[var(--twilio-navy)] hover:bg-gray-100 transition-colors" title="Edit">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5"><path d="M11.5 2.5l2 2-8 8H3.5v-2l8-8z" strokeLinejoin="round"/></svg>
              </button>
            )}
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 text-xl leading-none transition-colors">×</button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Email */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--twilio-gray-60)] w-16 shrink-0">Email</span>
            {editMode
              ? <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="email@company.com"
                  className="flex-1 text-xs border-b border-gray-200 focus:border-indigo-300 focus:outline-none bg-transparent text-[var(--twilio-navy)]" />
              : form.email
                ? <a href={`mailto:${form.email}`} className="text-xs text-indigo-600 hover:underline">{form.email}</a>
                : <span className="text-xs text-gray-400 italic">—</span>
            }
          </div>

          {/* Description */}
          <div>
            <p className="text-xs text-[var(--twilio-gray-60)] mb-1">Description</p>
            {editMode
              ? <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3} placeholder="Context, background…"
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-[var(--twilio-navy)] placeholder:text-gray-400 focus:bg-white focus:border-indigo-400 focus:outline-none resize-none" />
              : form.description
                ? <p className="text-xs text-[var(--twilio-navy)] opacity-80 leading-relaxed">{form.description}</p>
                : <p className="text-xs text-gray-400 italic">No description.</p>
            }
          </div>

          {editMode && (
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => { setEditMode(false); setForm({ name: contact.name, role: contact.role, description: contact.description, email: contact.email }); }}
                className="text-xs text-[var(--twilio-gray-60)] hover:text-[var(--twilio-navy)] transition-colors">Cancel</button>
              <button onClick={() => void handleSave()} disabled={saving || !form.name.trim()}
                className="px-3 py-1 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          )}

          {/* Notes */}
          <div style={{ borderTop: "1px solid rgba(0,0,0,0.07)", paddingTop: "12px" }}>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)] mb-2">Notes</p>
            <div className="flex gap-2 mb-3">
              <input
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleAddNote(); } }}
                placeholder="Add a note…"
                className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-[var(--twilio-navy)] placeholder:text-gray-400 focus:bg-white focus:border-indigo-300 focus:outline-none"
              />
              {noteDraft.trim() && (
                <button onClick={() => void handleAddNote()}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shrink-0">Add</button>
              )}
            </div>
            {notes.length === 0
              ? <p className="text-xs text-gray-400 italic">No notes yet.</p>
              : (
                <ul className="space-y-1.5">
                  {notes.map((n) => (
                    <ContactNoteRow
                      key={n.id}
                      note={n}
                      onSave={handleUpdateNote}
                      onDelete={handleDeleteNote}
                    />
                  ))}
                </ul>
              )
            }
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderTop: "1px solid rgba(0,0,0,0.07)" }}>
          {confirmDelete
            ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-600">Remove this contact?</span>
                <button onClick={() => void handleDelete()} className="text-xs font-semibold text-red-600 hover:text-red-800 transition-colors">Yes, delete</button>
                <button onClick={() => setConfirmDelete(false)} className="text-xs text-[var(--twilio-gray-60)] hover:text-[var(--twilio-navy)] transition-colors">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)}
                className="text-xs text-[var(--twilio-gray-60)] hover:text-red-500 transition-colors">Delete contact</button>
            )
          }
          <button onClick={onClose} className="text-sm font-medium text-[var(--twilio-gray-60)] hover:text-[var(--twilio-navy)] transition-colors ml-auto">Close</button>
        </div>
      </div>
    </div>
  );
}
