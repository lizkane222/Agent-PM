import { useState, useEffect } from "react";
import { schedulerApi } from "../../lib/api";
import type { Reminder } from "../../types";
import {
  CALENDAR_DRAG_REMINDER_KEY,
  SCHEDULED_REMINDERS_KEY,
  readScheduledReminders,
} from "./calendarHelpers";
import ReminderCard_Cal from "./ReminderCard_Cal";

export default function RemindersTabContent(_props: { onDropToast: (msg: string, type: "success" | "warn") => void }) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newDueAt, setNewDueAt] = useState(() => {
    const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1);
    return d.toISOString().slice(0, 16);
  });
  const [saving, setSaving] = useState(false);
  const [filterTerm, setFilterTerm] = useState("");

  const load = () =>
    schedulerApi.listReminders({ status: "pending", page_size: "200" })
      .then(({ data }) => setReminders(data.results ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === "remindersUpdated") void load();
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function handleReminderDragStart(e: React.DragEvent, reminder: Reminder) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(reminder.id));
    const w = window as unknown as Record<string, string>;
    w[CALENDAR_DRAG_REMINDER_KEY] = String(reminder.id);
    w[`${CALENDAR_DRAG_REMINDER_KEY}_title`] = reminder.title;
  }

  async function handleDelete(reminder: Reminder) {
    setReminders((prev) => prev.filter((r) => r.id !== reminder.id));
    // Remove all calendar occurrences for this reminder from localStorage
    const pruned = readScheduledReminders().filter((s) => s.reminderId !== reminder.id);
    localStorage.setItem(SCHEDULED_REMINDERS_KEY, JSON.stringify(pruned));
    window.dispatchEvent(new StorageEvent("storage", { key: SCHEDULED_REMINDERS_KEY, newValue: JSON.stringify(pruned) }));
    try {
      await schedulerApi.deleteReminder(reminder.id);
    } catch {
      setReminders((prev) => [...prev, reminder]);
    }
  }

  async function handleUpdate(reminder: Reminder, patch: Partial<Reminder>) {
    setReminders((prev) => prev.map((r) => r.id === reminder.id ? { ...r, ...patch } : r));
    try {
      await schedulerApi.updateReminder(reminder.id, patch);
    } catch {
      setReminders((prev) => prev.map((r) => r.id === reminder.id ? reminder : r));
    }
  }

  async function handleCreate() {
    if (!newTitle.trim()) return;
    setSaving(true);
    try {
      const due_at = newDueAt.length === 16 ? `${newDueAt}:00` : newDueAt;
      const { data } = await schedulerApi.createReminder({
        title: newTitle.trim(),
        body: newBody.trim(),
        due_at,
        resource_type: "general",
        notify_in_app: true,
      });
      setReminders((prev) => [data, ...prev]);
      setNewTitle(""); setNewBody("");
      const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1);
      setNewDueAt(d.toISOString().slice(0, 16));
      setCreating(false);
      window.dispatchEvent(new StorageEvent("storage", { key: "remindersUpdated", newValue: "1" }));
    } finally {
      setSaving(false);
    }
  }

  const filtered = filterTerm.trim()
    ? reminders.filter((r) => r.title.toLowerCase().includes(filterTerm.toLowerCase()) || r.body?.toLowerCase().includes(filterTerm.toLowerCase()))
    : reminders;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Filter */}
      <div className="px-3 pt-2 pb-1 shrink-0">
        <div className="relative">
          <svg viewBox="0 0 16 16" className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="6.5" cy="6.5" r="4"/><line x1="10" y1="10" x2="13.5" y2="13.5"/>
          </svg>
          <input
            type="text" value={filterTerm} onChange={(e) => setFilterTerm(e.target.value)} placeholder="Filter…"
            className="w-full pl-6 pr-6 py-1.5 text-[11px] rounded-md border border-gray-200 bg-gray-50 text-[var(--twilio-navy)] placeholder-gray-400 focus:outline-none focus:border-amber-400 focus:bg-white transition-colors"
          />
          {filterTerm && (
            <button onClick={() => setFilterTerm("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 leading-none">✕</button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {loading ? (
          <p className="text-sm text-[var(--twilio-gray-60)] py-2">Loading…</p>
        ) : filtered.length === 0 && !creating ? (
          <p className="text-sm text-[var(--twilio-gray-60)] py-2">{filterTerm ? "No matches." : "No pending reminders."}</p>
        ) : (
          filtered.map((r) => (
            <ReminderCard_Cal
              key={r.id}
              reminder={r}
              onDragStart={(e) => handleReminderDragStart(e, r)}
              onDelete={() => void handleDelete(r)}
              onUpdate={(patch) => void handleUpdate(r, patch)}
            />
          ))
        )}
      </div>

      {/* Create form */}
      {creating && (
        <div className="shrink-0 border-t border-gray-100">
          <div className="rounded-xl flex flex-col overflow-hidden m-3" style={{ background: "#FFFBEB", border: "1px solid #fde68a" }}>
            <div className="px-4 pt-3 pb-2 flex flex-col gap-2">
              <input
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void handleCreate(); if (e.key === "Escape") setCreating(false); }}
                placeholder="Reminder title"
                className="w-full text-xs font-semibold text-[var(--twilio-navy)] bg-white border-b border-amber-200 focus:border-amber-400 focus:outline-none pb-1 placeholder:text-[var(--twilio-gray-60)] placeholder:font-normal"
              />
              <textarea
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
                rows={2}
                placeholder="Notes (optional)"
                className="w-full rounded-md border border-amber-100 bg-white px-2.5 py-1.5 text-xs text-[var(--twilio-navy)] placeholder:text-[var(--twilio-gray-60)] focus:bg-white focus:border-amber-300 focus:outline-none resize-none leading-relaxed"
              />
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[var(--twilio-gray-60)] shrink-0">Due:</span>
                <input
                  type="datetime-local"
                  value={newDueAt}
                  onChange={(e) => setNewDueAt(e.target.value)}
                  className="flex-1 text-[11px] rounded border border-amber-200 px-1.5 py-1 focus:outline-none focus:border-amber-400 bg-white"
                />
              </div>
            </div>
            <div className="px-4 py-3 flex items-center justify-between rounded-b-xl">
              <button onClick={() => setCreating(false)} className="text-[11px] text-[var(--twilio-gray-60)] hover:text-[var(--twilio-navy)] transition-colors">Cancel</button>
              <button
                onClick={() => void handleCreate()}
                disabled={saving || !newTitle.trim()}
                className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide rounded-md bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 transition-colors"
              >{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}

      {/* New button — shown at bottom when not creating */}
      {!creating && (
        <div className="shrink-0 px-3 pb-3 pt-1 border-t border-gray-100">
          <button
            onClick={() => setCreating(true)}
            className="w-full text-[11px] font-semibold py-1.5 rounded-lg transition-colors"
            style={{ background: "#f59e0b", color: "#fff" }}
          >+ New Reminder</button>
        </div>
      )}
    </div>
  );
}
