import { useState, useEffect } from "react";
import { accountsApi } from "../../lib/api";
import type { CustomerContact } from "../../types";
import { ContactNoteRow } from "./ContactNoteRow";

export function CustomerContactsPanel({ accountId, accountName }: { accountId: number; accountName: string }) {
  const [contacts, setContacts] = useState<CustomerContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<number, string>>({});
  const BLANK = (): Partial<CustomerContact> => ({ name: "", role: "", description: "", email: "" });
  const [form, setForm] = useState<Partial<CustomerContact>>(BLANK());
  const [editId, setEditId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    accountsApi.listContacts(accountId)
      .then(({ data }) => setContacts(data.results))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [accountId]);

  function setField(k: keyof CustomerContact, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function handleSave() {
    if (!form.name?.trim() || saving) return;
    setSaving(true);
    try {
      if (editId) {
        const { data } = await accountsApi.updateContact(editId, form);
        setContacts((prev) => prev.map((c) => c.id === editId ? data : c));
      } else {
        const { data } = await accountsApi.createContact(accountId, form);
        setContacts((prev) => [data, ...prev]);
      }
      setForm(BLANK());
      setEditId(null);
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(c: CustomerContact) {
    setForm({ name: c.name, role: c.role, description: c.description, email: c.email });
    setEditId(c.id);
    setShowForm(true);
  }

  async function handleDelete(c: CustomerContact) {
    await accountsApi.deleteContact(c.id);
    setContacts((prev) => prev.filter((x) => x.id !== c.id));
    if (expandedId === c.id) setExpandedId(null);
  }

  async function handleAddNote(contactId: number) {
    const content = (noteDraft[contactId] ?? "").trim();
    if (!content) return;
    const { data } = await accountsApi.addContactNote(contactId, content);
    setContacts((prev) => prev.map((c) => c.id === contactId
      ? { ...c, notes: [data, ...c.notes], notes_count: c.notes_count + 1 }
      : c
    ));
    setNoteDraft((d) => ({ ...d, [contactId]: "" }));
  }

  async function handleDeleteNote(contactId: number, noteId: number) {
    await accountsApi.deleteContactNote(noteId);
    setContacts((prev) => prev.map((c) => c.id === contactId
      ? { ...c, notes: c.notes.filter((n) => n.id !== noteId), notes_count: Math.max(0, c.notes_count - 1) }
      : c
    ));
  }

  async function handleUpdateNote(contactId: number, noteId: number, content: string) {
    const { data } = await accountsApi.updateContactNote(noteId, content);
    setContacts((prev) => prev.map((c) => c.id === contactId
      ? { ...c, notes: c.notes.map((n) => (n.id === noteId ? data : n)) }
      : c
    ));
  }

  const cancelForm = () => { setShowForm(false); setForm(BLANK()); setEditId(null); };

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <p className="text-xs font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide">
          {accountName} Contacts
          {contacts.length > 0 && <span className="ml-1.5 font-normal normal-case text-[10px] opacity-70">({contacts.length})</span>}
        </p>
        <button
          onClick={() => { cancelForm(); setShowForm((v) => !v); }}
          className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
        >
          {showForm && !editId ? "Cancel" : "+ Add contact"}
        </button>
      </div>

      {showForm && (
        <div className="px-4 py-3 border-b border-gray-100 space-y-2.5" style={{ background: "#f9fafb" }}>
          <p className="text-[11px] font-semibold text-[var(--twilio-navy)] uppercase tracking-wide">
            {editId ? "Edit contact" : "New contact"}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <input
              autoFocus
              value={form.name ?? ""}
              onChange={(e) => setField("name", e.target.value)}
              placeholder="Full name *"
              className="col-span-2 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-[var(--twilio-navy)] placeholder:text-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-100"
            />
            <input
              value={form.role ?? ""}
              onChange={(e) => setField("role", e.target.value)}
              placeholder="Role / title"
              className="rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-[var(--twilio-navy)] placeholder:text-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-100"
            />
            <input
              type="email"
              value={form.email ?? ""}
              onChange={(e) => setField("email", e.target.value)}
              placeholder="Email"
              className="rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-[var(--twilio-navy)] placeholder:text-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-100"
            />
          </div>
          <textarea
            value={form.description ?? ""}
            onChange={(e) => setField("description", e.target.value)}
            rows={2}
            placeholder="Description or context…"
            className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-[var(--twilio-navy)] placeholder:text-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-100 resize-none"
          />
          <div className="flex justify-end gap-2">
            <button onClick={cancelForm} className="text-[11px] text-[var(--twilio-gray-60)] hover:text-[var(--twilio-navy)] transition-colors">Cancel</button>
            <button
              onClick={() => void handleSave()}
              disabled={saving || !form.name?.trim()}
              className="px-3 py-1 text-[11px] font-semibold rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              {saving ? "Saving…" : editId ? "Update" : "Add"}
            </button>
          </div>
        </div>
      )}

      {loading && (
        <p className="px-4 py-3 text-xs text-[var(--twilio-gray-60)] italic">Loading…</p>
      )}

      {!loading && contacts.length === 0 && !showForm && (
        <p className="px-4 py-3 text-xs text-[var(--twilio-gray-60)] italic">No contacts yet.</p>
      )}

      {contacts.map((c) => {
        const isOpen = expandedId === c.id;
        const initials = c.name.split(" ").map((p) => p[0]).join("").toUpperCase().slice(0, 2);
        return (
          <div key={c.id} className="border-b border-gray-100 last:border-0">
            <div
              className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors group"
              onClick={() => setExpandedId(isOpen ? null : c.id)}
            >
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                style={{ background: "rgba(99,102,241,0.12)", color: "#4f46e5" }}
              >
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-[var(--twilio-navy)] truncate">{c.name}</p>
                {c.role && <p className="text-[10px] text-[var(--twilio-gray-60)] truncate">{c.role}</p>}
              </div>
              {c.email && (
                <a
                  href={`mailto:${c.email}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-[10px] text-indigo-500 hover:underline shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  {c.email}
                </a>
              )}
              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => { e.stopPropagation(); startEdit(c); }}
                  className="p-1 rounded hover:bg-gray-200 text-[var(--twilio-gray-60)] hover:text-[var(--twilio-navy)] transition-colors"
                  title="Edit"
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3"><path d="M11.5 2.5l2 2-8 8H3.5v-2l8-8z" strokeLinejoin="round"/></svg>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); void handleDelete(c); }}
                  className="p-1 rounded hover:bg-red-50 text-[var(--twilio-gray-60)] hover:text-red-500 transition-colors"
                  title="Delete"
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3"><path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9h8l1-9" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              </div>
              <svg viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-3 h-3 shrink-0 text-[var(--twilio-gray-60)] transition-transform ${isOpen ? "rotate-180" : ""}`}><path d="M1 1l4 4 4-4" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>

            {isOpen && (
              <div className="px-4 pb-3 space-y-2" style={{ background: "#f9fafb" }}>
                {c.description && (
                  <p className="text-[11px] text-[var(--twilio-navy)] opacity-70 leading-relaxed">{c.description}</p>
                )}
                {c.email && (
                  <a href={`mailto:${c.email}`} className="text-[11px] text-indigo-600 hover:underline">{c.email}</a>
                )}
                <div>
                  <p className="text-[10px] font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide mb-1.5">Notes</p>
                  <div className="flex gap-2 mb-1.5">
                    <input
                      value={noteDraft[c.id] ?? ""}
                      onChange={(e) => setNoteDraft((d) => ({ ...d, [c.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleAddNote(c.id); } }}
                      placeholder="Add a note…"
                      className="flex-1 rounded border border-gray-200 bg-white px-2 py-1 text-[11px] text-[var(--twilio-navy)] placeholder:text-gray-400 focus:border-indigo-300 focus:outline-none"
                    />
                    {(noteDraft[c.id] ?? "").trim() && (
                      <button
                        onClick={() => void handleAddNote(c.id)}
                        className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800 transition-colors shrink-0"
                      >Add</button>
                    )}
                  </div>
                  {c.notes.length > 0 ? (
                    <ul className="space-y-1">
                      {c.notes.map((n) => (
                        <ContactNoteRow
                          key={n.id}
                          note={n}
                          size="xs"
                          onSave={(noteId, content) => handleUpdateNote(c.id, noteId, content)}
                          onDelete={(noteId) => void handleDeleteNote(c.id, noteId)}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[10px] text-gray-400 italic">No notes yet.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
