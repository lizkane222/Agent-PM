import { useState } from "react";
import { accountsApi } from "../../lib/api";
import type { CustomerContact, CustomerContactNote } from "../../types";
import { ContactNoteRow } from "./ContactNoteRow";

export function ContactSidePanelContent({
  contact,
  onUpdated,
  onDeleted,
}: {
  contact: CustomerContact;
  onUpdated: (c: CustomerContact) => void;
  onDeleted: (id: number) => void;
}) {
  const [form, setForm] = useState({ name: contact.name, role: contact.role, description: contact.description, email: contact.email });
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notes, setNotes] = useState<CustomerContactNote[]>(contact.notes ?? []);
  const [noteDraft, setNoteDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const initials = contact.name.split(" ").map((p) => p[0]).join("").toUpperCase().slice(0, 2);

  function setField(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  }

  async function handleSave() {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    try {
      const { data } = await accountsApi.updateContact(contact.id, form);
      onUpdated(data);
      setDirty(false);
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
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Avatar + name */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
          style={{ background: "rgba(99,102,241,0.12)", color: "#4f46e5" }}>
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <input
            value={form.name}
            onChange={(e) => setField("name", e.target.value)}
            className="w-full text-sm font-semibold border-b border-transparent hover:border-gray-200 focus:border-indigo-300 focus:outline-none bg-transparent"
            style={{ color: "var(--twilio-navy)" }}
          />
          <input
            value={form.role}
            onChange={(e) => setField("role", e.target.value)}
            placeholder="Role / title"
            className="w-full text-xs border-b border-transparent hover:border-gray-200 focus:border-indigo-300 focus:outline-none bg-transparent mt-0.5"
            style={{ color: "var(--twilio-gray-60)" }}
          />
        </div>
      </div>

      {/* Email */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-[var(--twilio-gray-60)] w-16 shrink-0">Email</span>
        <input
          type="email"
          value={form.email}
          onChange={(e) => setField("email", e.target.value)}
          placeholder="email@company.com"
          className="flex-1 text-xs border-b border-transparent hover:border-gray-200 focus:border-indigo-300 focus:outline-none bg-transparent"
          style={{ color: "var(--twilio-navy)" }}
        />
      </div>

      {/* Description */}
      <div>
        <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">Description</p>
        <textarea
          value={form.description}
          onChange={(e) => setField("description", e.target.value)}
          rows={3}
          placeholder="Context, background…"
          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs placeholder:text-gray-400 focus:bg-white focus:border-indigo-400 focus:outline-none resize-none"
          style={{ color: "var(--twilio-navy)" }}
        />
      </div>

      {/* Save / discard */}
      {dirty && (
        <div className="flex justify-end gap-2">
          <button
            onClick={() => { setForm({ name: contact.name, role: contact.role, description: contact.description, email: contact.email }); setDirty(false); }}
            className="text-xs text-[var(--twilio-gray-60)] hover:text-[var(--twilio-navy)] transition-colors"
          >Discard</button>
          <button
            onClick={() => void handleSave()}
            disabled={saving || !form.name.trim()}
            className="px-3 py-1 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
          >{saving ? "Saving…" : "Save"}</button>
        </div>
      )}

      {/* Notes */}
      <div style={{ borderTop: "1px solid rgba(0,0,0,0.07)", paddingTop: "12px" }}>
        <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--twilio-gray-60)" }}>Notes</p>
        <div className="flex gap-2 mb-3">
          <input
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleAddNote(); } }}
            placeholder="Add a note…"
            className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs placeholder:text-gray-400 focus:bg-white focus:border-indigo-300 focus:outline-none"
            style={{ color: "var(--twilio-navy)" }}
          />
          {noteDraft.trim() && (
            <button onClick={() => void handleAddNote()}
              className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shrink-0">Add</button>
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

      {/* Delete */}
      <div style={{ borderTop: "1px solid rgba(0,0,0,0.07)", paddingTop: "10px" }}>
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
      </div>
    </div>
  );
}
