import { useEffect, useRef, useState } from "react";
import type { AirtableActionItem } from "../../types";
import type { ScheduledItem, ScheduledReminder } from "../../types/calendar";
import UrlPillInput from "../shared/UrlPillInput";

// ── Drag-and-drop storage keys ────────────────────────────────────────────────
export const CALENDAR_DRAG_KEY = "calendarDragActionItemId";
export const CALENDAR_DRAG_REMINDER_KEY = "calendarDragReminderId";
export const CALENDAR_DRAG_ACCOUNT_KEY = "calendarDragAccountId";
export const CALENDAR_DRAG_EVENT_KEY = "calendarDragEventUid";
export const ACTION_ITEM_ZONES_KEY = "actionItemZones";
export const SCHEDULED_ITEMS_KEY = "scheduledActionItems";
export const SCHEDULED_REMINDERS_KEY = "scheduledReminders";

// ── Color maps ────────────────────────────────────────────────────────────────
export const WORK_TRACKING_COLOR = "#a78bfa";

// Event-type colors moved to lib/eventColors.ts, where they are user-selectable
// (DEFAULT_CATEGORY_COLORS + PALETTES). WORK_TRACKING_COLOR above is still the
// action-item accent used by chips outside the calendar grid.


export const PRIORITY_ACCENT_CAL: Record<string, string> = {
  Critical: "#ef4444",
  High: "#f97316",
  Medium: "#0ea5e9",
  Low: "#9ca3af",
};
export const PRIORITY_COLORS_CAL: Record<string, string> = {
  Critical: "bg-red-50 text-red-700",
  High: "bg-orange-50 text-orange-700",
  Medium: "bg-sky-50 text-sky-700",
  Low: "bg-gray-100 text-gray-600",
};
export const STATUS_COLORS_CAL: Record<string, string> = {
  Open: "bg-gray-100 text-gray-700",
  "In Progress": "bg-indigo-50 text-indigo-700",
  Complete: "bg-emerald-50 text-emerald-700",
  Blocked: "bg-red-50 text-red-700",
  Backlogged: "bg-slate-100 text-slate-600",
};
export const PRIORITY_DOT: Record<string, string> = {
  Critical: "bg-red-500",
  High: "bg-orange-400",
  Medium: "bg-sky-400",
  Low: "bg-gray-300",
};

// ── CalCreateForm type + blank ────────────────────────────────────────────────
export type CalCreateForm = {
  task: string;
  task_details: string;
  priority: AirtableActionItem["priority"];
  status: AirtableActionItem["status"];
  due_date: string;
  account_name: string;
  estimated_time: number;
  time_spent: number;
  prep_time: number;
  slack_thread_url: string;
  assignee_name: string;
};

export const BLANK_FORM: CalCreateForm = {
  task: "", task_details: "",
  priority: "Medium", status: "Open",
  due_date: "", account_name: "",
  estimated_time: 0, time_spent: 0, prep_time: 0,
  slack_thread_url: "", assignee_name: "",
};

// ── localStorage utilities ────────────────────────────────────────────────────
export function readScheduledItems(): ScheduledItem[] {
  try { return JSON.parse(localStorage.getItem(SCHEDULED_ITEMS_KEY) ?? "[]"); } catch { return []; }
}

export function readScheduledReminders(): ScheduledReminder[] {
  try { return JSON.parse(localStorage.getItem(SCHEDULED_REMINDERS_KEY) ?? "[]"); } catch { return []; }
}

// ── CalPill helpers ───────────────────────────────────────────────────────────

export function CalPillSelect<T extends string>({ value, options, colorMap, placeholder, onChange }: {
  value: T | undefined; options: readonly T[]; colorMap: Record<string, string>; placeholder: string;
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSelectElement>(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  const cls = value ? colorMap[value] ?? "bg-gray-100 text-[var(--twilio-navy)]" : "bg-gray-100 text-[var(--twilio-gray-60)]";
  if (open) return (
    <select ref={ref} value={value ?? ""} onChange={(e) => { onChange(e.target.value as T); setOpen(false); }}
      onBlur={() => setOpen(false)} onClick={(e) => e.stopPropagation()}
      className="rounded-full border border-indigo-400 bg-white px-2.5 py-0.5 text-[12px] font-semibold focus:outline-none cursor-pointer"
    >{options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
  );
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold cursor-pointer hover:opacity-75 transition-opacity ${cls}`}
    >{value ?? placeholder}<svg viewBox="0 0 8 5" fill="currentColor" className="w-1.5 h-1.5 opacity-50"><path d="M0 0l4 5 4-5z"/></svg></button>
  );
}

export function CalPillNumber({ value, label, onChange }: { value: number; label: string; onChange: (v: number) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { ref.current?.focus(); ref.current?.select(); } }, [open]);
  const mins = value > 0 ? Math.round(value / 60) : null;
  if (open) return (
    <input ref={ref} type="number" min={0} defaultValue={mins ?? ""}
      onBlur={(e) => { onChange(e.target.value !== "" ? Number(e.target.value) * 60 : 0); setOpen(false); }}
      onClick={(e) => e.stopPropagation()}
      className="w-16 rounded-full border border-indigo-400 bg-white px-2.5 py-0.5 text-[12px] font-semibold focus:outline-none" placeholder="0"
    />
  );
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold bg-gray-100 text-[var(--twilio-navy)] hover:opacity-75 transition-opacity cursor-pointer"
    >{mins != null ? `${mins}m` : label}</button>
  );
}

export function CalPillDate({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  const label = value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Due date";
  if (open) return (
    <input ref={ref} type="date" defaultValue={value || ""}
      onBlur={(e) => { onChange(e.target.value); setOpen(false); }}
      onClick={(e) => e.stopPropagation()}
      className="rounded-full border border-indigo-400 bg-white px-2.5 py-0.5 text-[12px] font-semibold focus:outline-none"
    />
  );
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold hover:opacity-75 transition-opacity cursor-pointer ${value ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200" : "bg-gray-100 text-[var(--twilio-gray-60)]"}`}
    >
      {value && <svg viewBox="0 0 12 12" fill="currentColor" className="w-2.5 h-2.5 opacity-70"><path d="M4 0a1 1 0 011 1h2a1 1 0 112 0h1a2 2 0 012 2v7a2 2 0 01-2 2H2a2 2 0 01-2-2V3a2 2 0 012-2h1a1 1 0 011-1zM2 5v5h8V5H2z"/></svg>}
      {label}
    </button>
  );
}

export function CalPillUrl({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  if (open) {
    return <UrlPillInput value={value} onCommit={(v) => { onChange(v); setOpen(false); }} onCancel={() => setOpen(false)} />;
  }
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold hover:opacity-75 transition-opacity cursor-pointer ${value ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200" : "bg-gray-100 text-[var(--twilio-gray-60)]"}`}
    >
      <svg viewBox="0 0 16 16" fill="currentColor" className="w-2.5 h-2.5"><path d="M6 2a2 2 0 00-2 2v5a2 2 0 002 2h1v2l2.5-2.5A1 1 0 0110 10h2a2 2 0 002-2V4a2 2 0 00-2-2H6z"/></svg>
      {value ? "Slack ↗" : "Slack"}
    </button>
  );
}
