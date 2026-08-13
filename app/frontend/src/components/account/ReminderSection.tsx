import React, { useState } from "react";
import type { Reminder } from "../../types";
import { ReminderBell } from "./ReminderBell";

const REMINDER_STATUS_COLORS: Record<string, string> = {
  pending: "#f97316",
  sent: "#9ca3af",
  dismissed: "#9ca3af",
  snoozed: "#6366f1",
};

export function ReminderSection({
  reminders,
  onAdd,
  onDismiss,
  compact = false,
}: {
  reminders: Reminder[];
  onAdd: (due_at: string, title: string, body?: string) => Promise<void>;
  onDismiss: (id: number) => Promise<void>;
  compact?: boolean;
}) {
  const [showForm, setShowForm] = useState(false);
  const [remDate, setRemDate] = useState("");
  const [remTime, setRemTime] = useState("09:00");
  const [remTitle, setRemTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const active = reminders.filter((r) => r.status === "pending" || r.status === "snoozed");

  async function handleSave() {
    if (!remDate || !remTitle.trim()) return;
    setSaving(true);
    try {
      const due = new Date(`${remDate}T${remTime}:00`).toISOString();
      await onAdd(due, remTitle.trim());
      setSaved(true);
      setTimeout(() => { setSaved(false); setShowForm(false); setRemTitle(""); }, 1200);
    } finally {
      setSaving(false);
    }
  }

  function quickDate(offsetDays: number, hour = 9) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    d.setHours(hour, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    setRemDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    setRemTime(`${pad(d.getHours())}:00`);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        {!compact && (
          <p className="text-[11px] font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide">
            Reminders {active.length > 0 && <span className="text-[10px] font-medium normal-case" style={{ color: "#f97316" }}>({active.length} active)</span>}
          </p>
        )}
        <button
          onClick={() => setShowForm((s) => !s)}
          className="ml-auto text-[11px] flex items-center gap-1 px-2 py-0.5 rounded transition-colors hover:opacity-80"
          style={{ background: showForm ? "rgba(249,115,22,0.12)" : "rgba(249,115,22,0.08)", color: "#f97316", border: "1px solid rgba(249,115,22,0.2)" }}
        >
          <ReminderBell className="w-3 h-3" />
          {showForm ? "Cancel" : "+ Reminder"}
        </button>
      </div>

      {showForm && (
        <div className="rounded-lg border border-orange-100 bg-orange-50/50 p-2.5 mb-2 space-y-2">
          <input
            autoFocus
            placeholder="Reminder title…"
            value={remTitle}
            onChange={(e) => setRemTitle(e.target.value)}
            className="w-full text-xs rounded px-2 py-1 border border-gray-200 outline-none focus:border-orange-300 bg-white"
          />
          <div className="flex gap-1 flex-wrap">
            {[{ label: "In 1h", d: 0, h: new Date().getHours() + 1 }, { label: "Tomorrow 9am", d: 1, h: 9 }, { label: "In 2 days", d: 2, h: 9 }].map(({ label, d, h }) => (
              <button key={label} onClick={() => quickDate(d, h)}
                className="text-[11px] px-2 py-0.5 rounded-full border border-orange-200 hover:bg-orange-100 text-orange-700 transition-colors">
                {label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input type="date" value={remDate} onChange={(e) => setRemDate(e.target.value)}
              className="flex-1 text-xs rounded px-2 py-1 border border-gray-200 outline-none focus:border-orange-300 bg-white" />
            <input type="time" value={remTime} onChange={(e) => setRemTime(e.target.value)}
              className="w-20 text-xs rounded px-2 py-1 border border-gray-200 outline-none focus:border-orange-300 bg-white" />
          </div>
          <button
            onClick={() => void handleSave()}
            disabled={!remDate || !remTitle.trim() || saving}
            className={`w-full text-xs font-semibold py-1.5 rounded-lg transition-colors ${saved ? "bg-emerald-500 text-white" : "text-white"}`}
            style={!saved ? { background: "#f97316" } : {}}
          >
            {saved ? "✓ Saved" : saving ? "Saving…" : "Set Reminder"}
          </button>
        </div>
      )}

      {active.length > 0 && (
        <div className="space-y-1.5">
          {active.map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
              style={{ background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.15)" }}>
              <ReminderBell className="w-3 h-3 shrink-0" style={{ color: REMINDER_STATUS_COLORS[r.status] ?? "#f97316" } as React.CSSProperties} />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-[var(--twilio-navy)] truncate">{r.title}</p>
                <p className="text-[10px] text-[var(--twilio-gray-60)]">
                  {new Date(r.due_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </p>
              </div>
              <button onClick={() => void onDismiss(r.id)} title="Dismiss"
                className="text-gray-300 hover:text-red-400 text-sm transition-colors shrink-0">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
