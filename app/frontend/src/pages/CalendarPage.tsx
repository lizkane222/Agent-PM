/**
 * CalendarPage — interactive FullCalendar view connected to the backend events API.
 */

import FullCalendar from "@fullcalendar/react";
import CorporateIcon from "../assets/icons/Corporate.svg?react";
import CalendarIcon from "../assets/icons/Calendar.svg?react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventClickArg, DateSelectArg, EventInput, DropArg } from "@fullcalendar/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useScheduledOccurrences } from "../hooks/useScheduledOccurrences";
import { useActionItemFieldOptions } from "../hooks/useActionItemFieldOptions";
import DOMPurify from "dompurify";
import { schedulerApi, integrationsApi, teamApi, airtableApi, accountsApi, salesforceApi } from "../lib/api";
import { addLog } from "../lib/appLog";
import { useLogGlow } from "../lib/useLogGlow";
import { useCurrentUser } from "../context/CurrentUserContext";
import { useCommentContext } from "../components/comments/CommentContext";
import DayBar from "../components/calendar/DayBar";
import MeetingDetail from "../components/calendar/MeetingDetail";
import type { AirtableActionItem, AirtableAccount, CalendarEvent, LogTimeDayAssignment, Reminder, SalesforceProject } from "../types";
import { getRsvp, dateToLocalISO, toLocalISO, addMsToLocalISO } from "twilio-agent-pm-shared";
import type { RsvpStatus } from "twilio-agent-pm-shared";

const PRIORITY_ACCENT_CAL: Record<string, string> = {
  Critical: "#ef4444",
  High: "#f97316",
  Medium: "#0ea5e9",
  Low: "#9ca3af",
};
const PRIORITY_COLORS_CAL: Record<string, string> = {
  Critical: "bg-red-50 text-red-700",
  High: "bg-orange-50 text-orange-700",
  Medium: "bg-sky-50 text-sky-700",
  Low: "bg-gray-100 text-gray-600",
};
const STATUS_COLORS_CAL: Record<string, string> = {
  Open: "bg-gray-100 text-gray-700",
  "In Progress": "bg-indigo-50 text-indigo-700",
  Complete: "bg-emerald-50 text-emerald-700",
  Blocked: "bg-red-50 text-red-700",
  Backlogged: "bg-slate-100 text-slate-600",
};


function RsvpDot({ rsvp }: { rsvp: RsvpStatus }) {
  if (rsvp === "accepted") {
    return <span className="h-2 w-2 rounded-full bg-green-400 shrink-0 mt-0.5" />;
  }
  if (rsvp === "tentative") {
    return <span className="h-2 w-2 rounded-full bg-yellow-400 shrink-0 mt-0.5" />;
  }
  if (rsvp === "needsAction") {
    return <span className="h-2 w-2 rounded-full bg-sky-400 shrink-0 mt-0.5 animate-pulse" />;
  }
  if (rsvp === "unknown") {
    return <span className="h-2 w-2 rounded-full bg-gray-400 shrink-0 mt-0.5" />;
  }
  // declined — no dot
  return null;
}

function statusColor(status: CalendarEvent["status"]): string {
  return status === "cancelled"
    ? "#d1d5db"
    : status === "tentative"
    ? "#60a5fa"
    : "#3b82f6"; // blue-500 — meetings
}

const WORK_TRACKING_COLOR = "#a78bfa"; // violet-400 — action items (light purple)

function fadeColor(hex: string, amount = 0.45): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

function toFullCalendarEvent(e: CalendarEvent): EventInput {
  const isWorkSession = e.calendar_id === "work_tracking";
  const isScheduled = e.google_event_id?.startsWith("scheduled-");
  const isScheduledReminder = e.google_event_id?.startsWith("scheduled-reminder-");
  const isDbWorkTracking = isWorkSession && !!e.agentpm_airtable_id && e.is_synced;
  const backgroundColor = isScheduledReminder ? "#FFFBEB" : isWorkSession ? WORK_TRACKING_COLOR : statusColor(e.status);
  const borderColor = isScheduledReminder ? "#f59e0b" : isWorkSession ? WORK_TRACKING_COLOR : statusColor(e.status);
  const textColor = isScheduledReminder ? "#92400e" : "#ffffff";
  return {
    id: String(e.id),
    title: isScheduled ? e.title : isWorkSession ? `⏱ ${e.title}` : e.title,
    start: e.start_datetime,
    end: e.end_datetime,
    allDay: e.all_day,
    backgroundColor,
    borderColor,
    textColor,
    editable: isScheduled || isDbWorkTracking || (!isWorkSession && !isScheduledReminder),
    extendedProps: { ...e },
  };
}

interface EventDetailPanelProps {
  event: CalendarEvent;
  onClose: () => void;
  onCollapse: () => void;
  linkedAccount?: { accountName: string; accountId: number } | null;
  onDropAccount?: (accountId: number, accountName: string) => void;
  onUnlink?: () => void;
  onRemove?: () => void;
  onDelete?: () => void;
  onUpdateReminder?: (reminderId: number, patch: { title?: string; body?: string; due_at?: string }) => void;
  actionItem?: AirtableActionItem | null;
  onUpdateActionItem?: (patch: Partial<AirtableActionItem>) => void;
  onUpdateScheduleTime?: (newStart: string, newEnd: string) => void;
}

function EventDetailPanel({ event, onClose, onCollapse, linkedAccount, onDropAccount, onUnlink, onRemove, onDelete, onUpdateReminder, actionItem, onUpdateActionItem, onUpdateScheduleTime }: EventDetailPanelProps) {
  const { status: statusOptions } = useActionItemFieldOptions();
  const [dropOver, setDropOver] = useState(false);
  const isWorkSession = event.calendar_id === "work_tracking";
  const isScheduledReminder = !!event.google_event_id?.startsWith("scheduled-reminder-");
  // Local synthetic: google_event_id starts with "scheduled-"
  // DB-backed (synced back from Google): calendar_id is "work_tracking" + has agentpm_airtable_id
  const isScheduledActionItem = !isScheduledReminder && (
    !!event.google_event_id?.startsWith("scheduled-") ||
    (isWorkSession && !!event.agentpm_airtable_id && event.is_synced)
  );

  // Reminder edit state
  const reminderIdFromUid = isScheduledReminder ? (() => {
    const body = event.google_event_id!.slice("scheduled-reminder-".length);
    const sep = body.lastIndexOf("__");
    return parseInt(sep === -1 ? body : body.slice(0, sep), 10);
  })() : null;
  const [editTitle, setEditTitle] = useState(event.title.replace(/^🔔\s*/, ""));
  const [editBody, setEditBody] = useState("");
  const [editDueAt, setEditDueAt] = useState(event.start_datetime.slice(0, 16));
  const [saving, setSaving] = useState(false);

  // "Set reminder for this event" inline form (only shown for regular events)
  const [newRemOpen, setNewRemOpen] = useState(false);
  const [newRemTitle, setNewRemTitle] = useState(`Reminder: ${event.title}`);
  const [newRemDueAt, setNewRemDueAt] = useState(() => {
    try {
      const t = new Date(event.start_datetime);
      t.setMinutes(t.getMinutes() - 15);
      return t.toISOString().slice(0, 16);
    } catch { return event.start_datetime.slice(0, 16); }
  });
  const [newRemSaving, setNewRemSaving] = useState(false);
  const [newRemDone, setNewRemDone] = useState(false);

  async function createReminderForEvent() {
    if (!newRemTitle.trim() || !newRemDueAt) return;
    setNewRemSaving(true);
    try {
      const due_at = newRemDueAt.length === 16 ? `${newRemDueAt}:00` : newRemDueAt;
      await schedulerApi.createReminder({
        title: newRemTitle.trim().slice(0, 200),
        resource_type: "calendar_event",
        resource_id: String(event.id),
        due_at: new Date(due_at).toISOString(),
        notify_in_app: true,
      } as Parameters<typeof schedulerApi.createReminder>[0]);
      setNewRemDone(true);
      setTimeout(() => { setNewRemOpen(false); setNewRemDone(false); }, 1500);
    } catch {
      // best-effort; failure feedback would be nice but non-blocking
    } finally {
      setNewRemSaving(false);
    }
  }

  // Action item inline edit state
  const [aiEditing, setAiEditing] = useState(false);
  const [aiForm, setAiForm] = useState<CalCreateForm | null>(null);
  const [aiSaving, setAiSaving] = useState(false);
  // Store as local "HH:MM" for the time inputs — derive from the Date so the
  // browser's timezone is applied rather than reading the raw UTC string.
  const [aiStart, setAiStart] = useState(() => {
    const d = new Date(event.start_datetime);
    return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  });
  const [aiEnd, setAiEnd] = useState(() => {
    const d = new Date(event.end_datetime);
    return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  });

  // Reset action item form when the selected item changes
  useEffect(() => {
    if (actionItem) {
      setAiForm({
        task: actionItem.task,
        task_details: actionItem.task_details,
        priority: actionItem.priority,
        status: actionItem.status,
        due_date: actionItem.due_date ?? "",
        account_name: actionItem.account_name ?? "",
        estimated_time: actionItem.estimated_time,
        time_spent: actionItem.time_spent,
        prep_time: actionItem.prep_time,
        slack_thread_url: actionItem.slack_thread_url,
        assignee_name: actionItem.assignee_name,
      });
      const ds = new Date(event.start_datetime);
      const de = new Date(event.end_datetime);
      setAiStart(`${String(ds.getHours()).padStart(2,"0")}:${String(ds.getMinutes()).padStart(2,"0")}`);
      setAiEnd(`${String(de.getHours()).padStart(2,"0")}:${String(de.getMinutes()).padStart(2,"0")}`);
      setAiEditing(false);
    }
  }, [actionItem?.airtable_id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function commitAiEdit() {
    if (!aiForm || !actionItem || !onUpdateActionItem) return;
    setAiSaving(true);
    const patch: Partial<AirtableActionItem> = {};
    if (aiForm.task !== actionItem.task) patch.task = aiForm.task;
    if (aiForm.task_details !== actionItem.task_details) patch.task_details = aiForm.task_details;
    if (aiForm.priority !== actionItem.priority) patch.priority = aiForm.priority;
    if (aiForm.status !== actionItem.status) patch.status = aiForm.status;
    if ((aiForm.due_date || null) !== actionItem.due_date) patch.due_date = aiForm.due_date || null;
    if ((aiForm.account_name || null) !== actionItem.account_name) patch.account_name = aiForm.account_name || null;
    if (aiForm.estimated_time !== actionItem.estimated_time) patch.estimated_time = aiForm.estimated_time;
    if (aiForm.time_spent !== actionItem.time_spent) patch.time_spent = aiForm.time_spent;
    if (aiForm.prep_time !== actionItem.prep_time) patch.prep_time = aiForm.prep_time;
    if (aiForm.slack_thread_url !== actionItem.slack_thread_url) patch.slack_thread_url = aiForm.slack_thread_url;
    if (aiForm.assignee_name !== actionItem.assignee_name) patch.assignee_name = aiForm.assignee_name;
    if (Object.keys(patch).length > 0) onUpdateActionItem(patch);

    // If the scheduled time changed, notify the parent to update localStorage + calendar state
    // Rebuild full local datetime strings using the event's local date + edited HH:MM
    const eventDate = new Date(event.start_datetime);
    const localDate = `${eventDate.getFullYear()}-${String(eventDate.getMonth()+1).padStart(2,"0")}-${String(eventDate.getDate()).padStart(2,"0")}`;
    const origStartHM = `${String(eventDate.getHours()).padStart(2,"0")}:${String(eventDate.getMinutes()).padStart(2,"0")}`;
    const origEndD = new Date(event.end_datetime);
    const origEndHM = `${String(origEndD.getHours()).padStart(2,"0")}:${String(origEndD.getMinutes()).padStart(2,"0")}`;
    if ((aiStart !== origStartHM || aiEnd !== origEndHM) && onUpdateScheduleTime) {
      onUpdateScheduleTime(toLocalISO(`${localDate}T${aiStart}:00`), toLocalISO(`${localDate}T${aiEnd}:00`));
    }

    setAiEditing(false);
    setAiSaving(false);
  }

  // Keep edit fields in sync when the event prop changes (e.g. after drag)
  useEffect(() => {
    setEditTitle(event.title.replace(/^🔔\s*/, ""));
    setEditDueAt(event.start_datetime.slice(0, 16));
  }, [event.google_event_id, event.start_datetime, event.title]);
  const cleanDescription = event.description
    ? DOMPurify.sanitize(event.description, {
        ADD_ATTR: ["target"],
        FORCE_BODY: true,
      })
    : "";

  // Force all links in the sanitized HTML to open in a new tab safely.
  const descriptionWithLinks = cleanDescription.replace(
    /<a\s/gi,
    '<a target="_blank" rel="noopener noreferrer" '
  );

  const headerColor = isWorkSession ? WORK_TRACKING_COLOR : statusColor(event.status);

  return (
    <div
      className={[
        "w-full h-full bg-white border shadow-xl rounded-2xl transition-colors flex flex-col",
        dropOver ? "border-indigo-400 border-2" : "border-gray-200",
      ].join(" ")}
      draggable={!!event.google_event_id}
      onDragStart={(e) => {
        if (!event.google_event_id) return;
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData("calendarEventUid", event.google_event_id);
        (window as unknown as Record<string, string>)[CALENDAR_DRAG_EVENT_KEY] = event.google_event_id;
      }}
      onDragOver={(e) => { e.preventDefault(); setDropOver(true); }}
      onDragLeave={() => setDropOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropOver(false);
        const accountId = Number(e.dataTransfer.getData("calendarAccountId") || (window as unknown as Record<string, string>)[CALENDAR_DRAG_ACCOUNT_KEY]);
        const accountName = e.dataTransfer.getData("calendarAccountName") || (window as unknown as Record<string, string>)[`${CALENDAR_DRAG_ACCOUNT_KEY}_name`] || "";
        if (accountId) {
          delete (window as unknown as Record<string, string>)[CALENDAR_DRAG_ACCOUNT_KEY];
          if (isScheduledActionItem && onUpdateActionItem) {
            onUpdateActionItem({ account: accountId, account_name: accountName });
          } else if (onDropAccount) {
            onDropAccount(accountId, accountName);
          }
        }
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4 rounded-t-2xl cursor-grab active:cursor-grabbing shrink-0"
        style={{ backgroundColor: headerColor }}
      >
        <div className="flex flex-col gap-0.5 pr-2 flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-white break-words">{event.title}</h3>
          {isWorkSession && (
            <span className="text-[10px] font-medium text-white/80 uppercase tracking-wide">Work Session · Local only</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onCollapse}
            className="text-white/70 hover:text-white"
            aria-label="Collapse panel"
          >
            <svg viewBox="0 0 10 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-4">
              <path d="M2 2l6 6-6 6"/>
            </svg>
          </button>
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      {isScheduledReminder ? (
        /* ── Editable reminder form ── */
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
          <div>
            <p className="text-[11px] text-amber-700 uppercase tracking-wide font-semibold mb-1">Title</p>
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="w-full text-sm text-[var(--twilio-navy)] rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 focus:outline-none focus:border-amber-400 focus:bg-white transition-colors"
            />
          </div>
          <div>
            <p className="text-[11px] text-amber-700 uppercase tracking-wide font-semibold mb-1">Notes</p>
            <textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              rows={3}
              placeholder="Optional notes…"
              className="w-full text-sm text-[var(--twilio-navy)] rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 focus:outline-none focus:border-amber-400 focus:bg-white transition-colors resize-none"
            />
          </div>
          <div>
            <p className="text-[11px] text-amber-700 uppercase tracking-wide font-semibold mb-1">Due</p>
            <input
              type="datetime-local"
              value={editDueAt}
              onChange={(e) => setEditDueAt(e.target.value)}
              className="w-full text-sm rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 focus:outline-none focus:border-amber-400 focus:bg-white transition-colors"
            />
          </div>
        </div>
      ) : isScheduledActionItem && actionItem && aiForm ? (
        /* ── Inline action item view / edit ── */
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3 text-sm">
          {/* Scheduled time — same single-line style in both read and edit mode */}
          <div className="flex items-center gap-1 text-[11px] text-[var(--twilio-gray-60)] uppercase tracking-wide flex-wrap" onDoubleClick={() => { if (!aiEditing) setAiEditing(true); }}>
            <span>
              {new Date(event.start_datetime).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
              {","}
            </span>
            {aiEditing ? (
              <>
                <input
                  type="time"
                  value={aiStart}
                  onChange={(e) => {
                    setAiStart(e.target.value);
                    // Shift end if start overtakes it, preserving original duration
                    const [sh, sm] = e.target.value.split(":").map(Number);
                    const [eh, em] = aiEnd.split(":").map(Number);
                    const startMins = sh * 60 + sm;
                    const endMins = eh * 60 + em;
                    if (startMins >= endMins) {
                      const [oh, om] = aiStart.split(":").map(Number);
                      const origDur = (eh * 60 + em) - (oh * 60 + om);
                      const dur = origDur > 0 ? origDur : 60;
                      const newEnd = (startMins + dur) % (24 * 60);
                      setAiEnd(`${String(Math.floor(newEnd/60)).padStart(2,"0")}:${String(newEnd%60).padStart(2,"0")}`);
                    }
                  }}
                  className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)] border-0 border-b border-indigo-300 bg-transparent focus:outline-none focus:border-indigo-500 p-0 w-[5.5rem] [color-scheme:light]"
                />
                <span>–</span>
                <input
                  type="time"
                  value={aiEnd}
                  onChange={(e) => setAiEnd(e.target.value)}
                  className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)] border-0 border-b border-indigo-300 bg-transparent focus:outline-none focus:border-indigo-500 p-0 w-[5.5rem] [color-scheme:light]"
                />
              </>
            ) : (
              <>
                <span>{new Date(event.start_datetime).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
                <span>–</span>
                <span>{new Date(event.end_datetime).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
              </>
            )}
          </div>

          {aiEditing ? (
            /* Edit mode */
            <>
              <input
                autoFocus
                value={aiForm.task}
                onChange={(e) => setAiForm((f) => f && ({ ...f, task: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") void commitAiEdit(); if (e.key === "Escape") setAiEditing(false); }}
                placeholder="Task name"
                className="w-full text-sm font-medium text-[var(--twilio-navy)] rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 focus:outline-none focus:border-indigo-500 focus:bg-white transition-colors"
              />
              <textarea
                value={aiForm.task_details}
                onChange={(e) => setAiForm((f) => f && ({ ...f, task_details: e.target.value }))}
                rows={3}
                placeholder="Details…"
                className="w-full text-sm text-[var(--twilio-navy)] rounded-md border border-gray-200 px-3 py-1.5 focus:outline-none focus:border-indigo-300 resize-none leading-relaxed placeholder:text-gray-400"
              />
              <div className="flex flex-wrap gap-1.5">
                <CalPillSelect value={aiForm.status} options={statusOptions as AirtableActionItem["status"][]} colorMap={STATUS_COLORS_CAL} placeholder="Status" onChange={(v) => setAiForm((f) => f && ({ ...f, status: v }))} />
                <CalPillSelect value={aiForm.priority} options={["Critical","High","Medium","Low"] as const} colorMap={PRIORITY_COLORS_CAL} placeholder="Priority" onChange={(v) => setAiForm((f) => f && ({ ...f, priority: v }))} />
                <CalPillDate value={aiForm.due_date} onChange={(v) => setAiForm((f) => f && ({ ...f, due_date: v }))} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <CalPillNumber value={aiForm.estimated_time} label="Est." onChange={(v) => setAiForm((f) => f && ({ ...f, estimated_time: v }))} />
                <CalPillNumber value={aiForm.time_spent} label="Spent" onChange={(v) => setAiForm((f) => f && ({ ...f, time_spent: v }))} />
                <CalPillNumber value={aiForm.prep_time} label="Prep" onChange={(v) => setAiForm((f) => f && ({ ...f, prep_time: v }))} />
              </div>
              <input
                value={aiForm.account_name ?? ""}
                onChange={(e) => setAiForm((f) => f && ({ ...f, account_name: e.target.value }))}
                placeholder="Account name…"
                className="w-full text-xs rounded-md border border-gray-200 px-3 py-1.5 focus:outline-none focus:border-indigo-300 placeholder:text-gray-400"
              />
            </>
          ) : (
            /* Read mode — double-click anywhere to start editing */
            <div className="flex flex-col gap-3 cursor-default select-none" onDoubleClick={() => setAiEditing(true)}>
              <p className="text-[var(--twilio-navy)] font-medium leading-snug">{actionItem.task}</p>
              {actionItem.task_details && (
                <p className="text-[var(--twilio-gray-80)] text-[13px] leading-relaxed">{actionItem.task_details}</p>
              )}
              <div className="flex flex-wrap gap-1.5">
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS_CAL[actionItem.status] ?? "bg-gray-100 text-gray-700"}`}>{actionItem.status}</span>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${PRIORITY_COLORS_CAL[actionItem.priority] ?? "bg-gray-100 text-gray-600"}`}>{actionItem.priority}</span>
                {actionItem.due_date && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                    Due {new Date(actionItem.due_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--twilio-gray-60)]">
                {actionItem.assignee_name && <span>→ {actionItem.assignee_name}</span>}
                {actionItem.estimated_time > 0 && <span>{Math.round(actionItem.estimated_time / 60)}m est.</span>}
                {actionItem.time_spent > 0 && <span>{Math.round(actionItem.time_spent / 60)}m spent</span>}
              </div>
              {/* Linked account — drag to link or shows current */}
              <div className={["rounded-lg px-3 py-2 border-2 border-dashed transition-colors text-sm", dropOver ? "border-indigo-400 bg-indigo-50" : "border-gray-200"].join(" ")}>
                {linkedAccount ? (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <CorporateIcon className="w-4 h-4 shrink-0 text-indigo-500" />
                      <span className="font-medium text-[var(--twilio-navy)] truncate">{linkedAccount.accountName}</span>
                    </div>
                    {onUnlink && <button onClick={onUnlink} className="text-[var(--twilio-gray-60)] hover:text-red-500 text-xs shrink-0 transition-colors">✕</button>}
                  </div>
                ) : actionItem.account_name ? (
                  <span className="text-[var(--twilio-navy)] text-[13px]">{actionItem.account_name}</span>
                ) : (
                  <p className="text-[var(--twilio-gray-60)] text-center text-xs">Drop an account here to link</p>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 text-sm">
          <div>
            <p className="text-sm text-[var(--twilio-gray-60)] uppercase tracking-wide mb-1">When</p>
            <p className="text-[var(--twilio-navy)]">
              {new Date(event.start_datetime).toLocaleString()} –{" "}
              {new Date(event.end_datetime).toLocaleString()}
            </p>
          </div>
          {event.location && (
            <div>
              <p className="text-sm text-[var(--twilio-gray-60)] uppercase tracking-wide mb-1">Location</p>
              <p className="text-[var(--twilio-navy)] break-all">
                {/^https?:\/\//i.test(event.location.trim()) ? (
                  <a href={event.location.trim()} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline hover:text-indigo-800">
                    {event.location}
                  </a>
                ) : event.location}
              </p>
            </div>
          )}
          {descriptionWithLinks && (
            <div>
              <p className="text-sm text-[var(--twilio-gray-60)] uppercase tracking-wide mb-1">Description</p>
              <div className="text-[var(--twilio-gray-80)] text-sm [&_a]:text-indigo-600 [&_a]:underline [&_a]:break-all hover:[&_a]:text-indigo-800" dangerouslySetInnerHTML={{ __html: descriptionWithLinks }} />
            </div>
          )}
          {!isWorkSession && event.attendees.length > 0 && (
            <div>
              <p className="text-sm text-[var(--twilio-gray-60)] uppercase tracking-wide mb-1">Attendees ({event.attendees.length})</p>
              <ul className="space-y-1">
                {event.attendees.map((a) => (
                  <li key={a.email} className="flex items-center gap-2">
                    <span className={["h-2 w-2 rounded-full shrink-0", a.responseStatus === "accepted" ? "bg-green-500" : a.responseStatus === "declined" ? "bg-red-500" : "bg-gray-300"].join(" ")} />
                    <span className="text-[var(--twilio-gray-80)] truncate">{a.displayName ?? a.email}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!isWorkSession && event.meet_link && (
            <a href={event.meet_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-600 hover:underline text-sm">
              Join meeting →
            </a>
          )}
          {/* Linked account */}
          <div className={["rounded-lg px-3 py-2 border-2 border-dashed transition-colors text-sm", dropOver ? "border-indigo-400 bg-indigo-50" : "border-gray-200"].join(" ")}>
            {linkedAccount ? (
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <CorporateIcon className="w-4 h-4 shrink-0 text-indigo-500" />
                  <span className="font-medium text-[var(--twilio-navy)] truncate">{linkedAccount.accountName}</span>
                </div>
                {onUnlink && <button onClick={onUnlink} className="text-[var(--twilio-gray-60)] hover:text-red-500 text-xs shrink-0 transition-colors">✕</button>}
              </div>
            ) : (
              <p className="text-[var(--twilio-gray-60)] text-center">Drop an account here to link</p>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="shrink-0 px-5 pb-4 pt-2 border-t border-gray-100 flex flex-col gap-2">
        {isScheduledReminder && onUpdateReminder && reminderIdFromUid !== null && (
          <button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              const due_at = editDueAt.length === 16 ? `${editDueAt}:00` : editDueAt;
              await onUpdateReminder(reminderIdFromUid, { title: editTitle, body: editBody || undefined, due_at });
              setSaving(false);
            }}
            className="w-full text-[12px] font-semibold py-2 rounded-lg transition-colors text-white disabled:opacity-50"
            style={{ background: "#f59e0b" }}
          >{saving ? "Saving…" : "Save changes"}</button>
        )}
        {isScheduledActionItem && actionItem && (
          aiEditing ? (
            <div className="flex gap-2">
              <button
                onClick={() => setAiEditing(false)}
                className="flex-1 text-[12px] font-medium py-2 rounded-lg border border-gray-200 text-[var(--twilio-gray-60)] hover:bg-gray-50 transition-colors"
              >Cancel</button>
              <button
                onClick={() => void commitAiEdit()}
                disabled={aiSaving}
                className="flex-1 text-[12px] font-semibold py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >{aiSaving ? "Saving…" : "Save"}</button>
            </div>
          ) : (
            <button
              onClick={() => setAiEditing(true)}
              className="w-full text-[12px] font-semibold py-2 rounded-lg border border-indigo-200 text-indigo-600 hover:bg-indigo-50 transition-colors"
            >Edit action item</button>
          )
        )}
        {!isScheduledReminder && !isScheduledActionItem && (
          newRemOpen ? (
            <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
              <input
                autoFocus
                type="text"
                value={newRemTitle}
                onChange={(e) => setNewRemTitle(e.target.value)}
                placeholder="Reminder title"
                className="w-full rounded border border-amber-200 bg-white px-2 py-1 text-[12px] focus:outline-none focus:ring-2 focus:ring-amber-300"
              />
              <input
                type="datetime-local"
                value={newRemDueAt}
                onChange={(e) => setNewRemDueAt(e.target.value)}
                className="w-full rounded border border-amber-200 bg-white px-2 py-1 text-[12px] focus:outline-none focus:ring-2 focus:ring-amber-300"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => void createReminderForEvent()}
                  disabled={newRemSaving || !newRemTitle.trim() || !newRemDueAt}
                  className="flex-1 text-[12px] font-semibold py-1.5 rounded-md text-white disabled:opacity-50 transition-colors"
                  style={{ background: "#f59e0b" }}
                >{newRemDone ? "Saved!" : newRemSaving ? "Saving…" : "Save reminder"}</button>
                <button
                  onClick={() => { setNewRemOpen(false); setNewRemDone(false); }}
                  className="text-[12px] font-medium py-1.5 px-3 rounded-md border border-gray-200 text-[var(--twilio-gray-60)] hover:bg-white transition-colors"
                >Cancel</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setNewRemOpen(true)}
              className="w-full text-[12px] font-medium py-2 rounded-lg border border-amber-200 text-amber-700 hover:bg-amber-50 transition-colors"
            >Set reminder for this event</button>
          )
        )}
        {(onRemove || onDelete) && (
          <button
            onClick={onRemove ?? onDelete}
            className="w-full text-[12px] font-medium py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
          >{onRemove ? "Remove from calendar" : "Delete event"}</button>
        )}
      </div>
    </div>
  );
}

const PRIORITY_DOT: Record<string, string> = {
  Critical: "bg-red-500",
  High: "bg-orange-400",
  Medium: "bg-sky-400",
  Low: "bg-gray-300",
};


const CALENDAR_DRAG_KEY = "calendarDragActionItemId";
const CALENDAR_DRAG_REMINDER_KEY = "calendarDragReminderId";
const CALENDAR_DRAG_ACCOUNT_KEY = "calendarDragAccountId";
const CALENDAR_DRAG_EVENT_KEY = "calendarDragEventUid";
const ACTION_ITEM_ZONES_KEY = "actionItemZones";
const SCHEDULED_ITEMS_KEY = "scheduledActionItems";
const SCHEDULED_REMINDERS_KEY = "scheduledReminders";
const LOGGED_DATES_EVENT = "loggedDatesUpdated";

// ── Event cache (sessionStorage) ──────────────────────────────────────────────
// Avoids redundant API calls when navigating away and back, or paging through
// weeks that were already fetched this session. TTL = 5 minutes.
const EVENT_CACHE_TTL_MS = 5 * 60 * 1000;

function eventCacheKey(start: string, end: string): string {
  return `calEvents::${start.slice(0, 10)}::${end.slice(0, 10)}`;
}

function readEventCache(start: string, end: string): CalendarEvent[] | null {
  try {
    const raw = sessionStorage.getItem(eventCacheKey(start, end));
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw) as { ts: number; data: CalendarEvent[] };
    if (Date.now() - ts > EVENT_CACHE_TTL_MS) return null;
    return data;
  } catch { return null; }
}

function writeEventCache(start: string, end: string, data: CalendarEvent[]): void {
  try {
    sessionStorage.setItem(eventCacheKey(start, end), JSON.stringify({ ts: Date.now(), data }));
  } catch { /* storage full — best effort */ }
}

function bustEventCache(): void {
  try {
    const toDelete: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith("calEvents::")) toDelete.push(k);
    }
    toDelete.forEach((k) => sessionStorage.removeItem(k));
  } catch { /* best effort */ }
}

// Returns a Set of "date||accountName" composite keys so only events for that
// specific account on that date are faded, not every event on the calendar.
function readLoggedDates(): Set<string> {
  const keys = new Set<string>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const lsKey = localStorage.key(i);
      if (!lsKey?.startsWith("logtime::") || !lsKey.endsWith("::manuallyLoggedDays")) continue;
      // Extract accountName from "logtime::{accountName}::manuallyLoggedDays"
      const accountName = lsKey.slice("logtime::".length, lsKey.length - "::manuallyLoggedDays".length);
      const raw = localStorage.getItem(lsKey);
      if (!raw) continue;
      const dates: string[] = JSON.parse(raw);
      dates.forEach((d) => keys.add(`${d}||${accountName}`));
    }
  } catch { /* best effort */ }
  return keys;
}

function stageItemActive(airtableId: string) {
  try {
    const zones: Record<string, string> = JSON.parse(localStorage.getItem(ACTION_ITEM_ZONES_KEY) ?? "{}");
    zones[airtableId] = "active";
    localStorage.setItem(ACTION_ITEM_ZONES_KEY, JSON.stringify(zones));
    window.dispatchEvent(new StorageEvent("storage", { key: ACTION_ITEM_ZONES_KEY, newValue: JSON.stringify(zones) }));
    // Signal ActionItemsPage to start the timer for this item
    window.dispatchEvent(new StorageEvent("storage", { key: "actionItemStartTimer", newValue: airtableId }));
  } catch { /* best effort */ }
}

interface ScheduledItem { airtableId: string; task: string; accountName: string | null; start: string; end: string; googleEventId?: string; uid?: string }

function readScheduledItems(): ScheduledItem[] {
  try {
    return JSON.parse(localStorage.getItem(SCHEDULED_ITEMS_KEY) ?? "[]");
  } catch { return []; }
}

/** Returns false if a duplicate (same airtableId, overlapping time slot) already exists. */
function saveScheduledItem(item: ScheduledItem): ScheduledItem | null {
  try {
    const existing = readScheduledItems();
    // Block duplicate: same item already scheduled at the same start minute
    const startMin = item.start.slice(0, 16); // "YYYY-MM-DDTHH:MM"
    const duplicate = existing.find(
      (i) => i.airtableId === item.airtableId && i.start.slice(0, 16) === startMin
    );
    if (duplicate) return null;
    // Assign a stable uid so the FC event id doesn't change when start is updated
    const uid = item.uid ?? `sched-${item.airtableId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const saved = { ...item, uid };
    // Allow same item on different times — just append (don't filter out prior entries)
    existing.push(saved);
    localStorage.setItem(SCHEDULED_ITEMS_KEY, JSON.stringify(existing));
    window.dispatchEvent(new StorageEvent("storage", { key: SCHEDULED_ITEMS_KEY, newValue: JSON.stringify(existing) }));
    return saved;
  } catch {
    return null;
  }
}

interface ScheduledReminder { reminderId: number; title: string; start: string; end: string }

function readScheduledReminders(): ScheduledReminder[] {
  try { return JSON.parse(localStorage.getItem(SCHEDULED_REMINDERS_KEY) ?? "[]"); } catch { return []; }
}

function saveScheduledReminder(item: ScheduledReminder): boolean {
  try {
    const existing = readScheduledReminders();
    const startMin = item.start.slice(0, 16);
    if (existing.find((i) => i.reminderId === item.reminderId && i.start.slice(0, 16) === startMin)) return false;
    existing.push(item);
    localStorage.setItem(SCHEDULED_REMINDERS_KEY, JSON.stringify(existing));
    window.dispatchEvent(new StorageEvent("storage", { key: SCHEDULED_REMINDERS_KEY, newValue: JSON.stringify(existing) }));
    return true;
  } catch { return false; }
}

// ── Accounts sidebar ──────────────────────────────────────────────────────────

function AccountsSidebar({
  open,
  onToggle,
  eventAccountLinks,
  onLink,
  selectedAccountName,
  onSelectAccount,
  logTimeModeAccount,
  onLogTimeMode,
}: {
  open: boolean;
  onToggle: () => void;
  eventAccountLinks: Map<string, { accountName: string; accountId: number }>;
  onLink: (accountId: number, accountName: string, eventUid?: string) => void;
  selectedAccountName: string | null;
  onSelectAccount: (name: string | null) => void;
  logTimeModeAccount: string | null;
  onLogTimeMode: (accountName: string | null) => void;
}) {
  const [accounts, setAccounts] = useState<AirtableAccount[]>([]);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      airtableApi.listAccounts(),
      accountsApi.listAccounts(),
      accountsApi.getAdminAccount(),
    ]).then(([atRes, appRes, adminRes]) => {
      const atAccounts = atRes.data.results as AirtableAccount[];
      const atNames = new Set(atAccounts.map((a) => a.name?.toLowerCase()));
      const appOnly = (appRes.data.results as { id: number; company_name: string; is_admin_account?: boolean }[])
        .filter((a) => !a.is_admin_account && !atNames.has(a.company_name?.toLowerCase()))
        .map((a) => ({ id: a.id, name: a.company_name } as AirtableAccount));
      const adminAcct = adminRes.data as { id: number; company_name: string };
      const adminPill: AirtableAccount = { id: adminAcct.id, name: adminAcct.company_name };
      const merged = [adminPill, ...atAccounts, ...appOnly].sort((a, b) =>
        a.name === adminAcct.company_name ? -1 : b.name === adminAcct.company_name ? 1 : a.name.localeCompare(b.name)
      );
      setAccounts(merged);
    }).catch(() => {
      // Fallback without admin account
      Promise.all([airtableApi.listAccounts(), accountsApi.listAccounts()]).then(([atRes, appRes]) => {
        const atAccounts = atRes.data.results as AirtableAccount[];
        const atNames = new Set(atAccounts.map((a) => a.name?.toLowerCase()));
        const appOnly = (appRes.data.results as { id: number; company_name: string }[])
          .filter((a) => !atNames.has(a.company_name?.toLowerCase()))
          .map((a) => ({ id: a.id, name: a.company_name } as AirtableAccount));
        setAccounts([...atAccounts, ...appOnly].sort((a, b) => a.name.localeCompare(b.name)));
      }).catch(() => {});
    });
  }, []);

  function handleAccountDragStart(e: React.DragEvent, account: AirtableAccount) {
    e.dataTransfer.setData("calendarAccountId", String(account.id));
    e.dataTransfer.setData("calendarAccountName", account.name);
    e.dataTransfer.effectAllowed = "copy";
    (window as unknown as Record<string, string>)[CALENDAR_DRAG_ACCOUNT_KEY] = String(account.id);
    (window as unknown as Record<string, string>)[`${CALENDAR_DRAG_ACCOUNT_KEY}_name`] = account.name;

    // Build a pill as the drag image. Must be in the DOM when setDragImage is called,
    // then removed immediately after so it never flashes on screen.
    const pill = document.createElement("div");
    pill.style.cssText = "position:fixed;top:-200px;left:-200px;background:#4f46e5;color:#fff;padding:5px 14px;border-radius:9999px;font-size:12px;font-weight:600;white-space:nowrap;box-shadow:0 4px 14px rgba(79,70,229,0.45);pointer-events:none";
    pill.textContent = account.name;
    document.body.appendChild(pill);
    e.dataTransfer.setDragImage(pill, 60, 14);
    // Defer state + DOM cleanup — changing state during dragstart breaks the drag
    setTimeout(() => { document.body.removeChild(pill); setDraggingId(account.id); }, 0);
  }

  function handleDropOnAccount(e: React.DragEvent, account: AirtableAccount) {
    e.preventDefault();
    setDropTargetId(null);
    const w = window as unknown as Record<string, string>;
    // Calendar event dragged onto account chip
    const eventUid = w[CALENDAR_DRAG_EVENT_KEY];
    if (eventUid) {
      delete w[CALENDAR_DRAG_EVENT_KEY];
      onLink(account.id, account.name, eventUid);
      return;
    }
    // Action item dragged onto account chip — update its account association
    const airtableId = w[CALENDAR_DRAG_KEY];
    if (airtableId) {
      delete w[CALENDAR_DRAG_KEY];
      delete w[`${CALENDAR_DRAG_KEY}_task`];
      delete w[`${CALENDAR_DRAG_KEY}_account`];
      delete w[`${CALENDAR_DRAG_KEY}_est`];
      airtableApi.updateActionItemFields(airtableId, { account: account.id, account_name: account.name }).catch(() => {});
      window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated", newValue: "1" }));
    }
  }

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={onToggle}
        className={[
          "absolute top-4 left-4 z-30 flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border shadow-sm transition-colors",
          open
            ? "bg-indigo-600 border-indigo-600 text-white shadow-md"
            : "bg-white border-gray-300 text-[var(--twilio-navy)] hover:bg-gray-50 hover:border-indigo-300",
        ].join(" ")}
      >
        <CorporateIcon className="w-3.5 h-3.5 shrink-0" />
        Accounts
      </button>

      {/* Overlay panel */}
      <div
        className={[
          "absolute top-0 left-0 h-full z-20 flex flex-col bg-white border-r border-gray-200 shadow-2xl transition-transform duration-300",
          "w-[276px]",
          open ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <div className="h-16 shrink-0" />
        <p className="px-4 pb-2 text-[11px] text-[var(--twilio-gray-60)]">
          Drag an account onto a calendar event · or drag an event onto an account
        </p>
        <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2">
          {accounts.filter((acct) => !!acct.name).map((acct) => {
            const isSelected = selectedAccountName === acct.name;
            return (
              <div
                key={acct.id ?? acct.name}
                draggable
                onClick={() => onSelectAccount(selectedAccountName === acct.name ? null : acct.name)}
                onDragStart={(e) => handleAccountDragStart(e, acct)}
                onDragEnd={() => setDraggingId(null)}
                onDragOver={(e) => { e.preventDefault(); setDropTargetId(acct.id); }}
                onDragLeave={() => setDropTargetId(null)}
                onDrop={(e) => handleDropOnAccount(e, acct)}
                className={[
                  "rounded-lg p-4 cursor-pointer transition-all select-none border",
                  draggingId === acct.id
                    ? "opacity-40 scale-95 bg-indigo-50 border-indigo-300"
                    : dropTargetId === acct.id
                    ? "bg-indigo-50 border-indigo-400 border-2 shadow-md"
                    : isSelected
                    ? "bg-indigo-600 border-indigo-600 shadow-md"
                    : "bg-white border-gray-200 shadow-sm hover:shadow-md hover:border-indigo-300",
                ].join(" ")}
              >
                <div className="flex items-center gap-3">
                  <div className={["h-9 w-9 rounded-full flex items-center justify-center shrink-0", isSelected ? "bg-indigo-500 text-white" : "bg-indigo-50 text-indigo-600"].join(" ")}>
                    <CorporateIcon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={["text-sm font-semibold truncate", isSelected ? "text-white" : "text-[var(--twilio-navy)]"].join(" ")}>{acct.name}</p>
                  </div>
                </div>
              </div>
            );
          })}
          {accounts.length === 0 && <p className="text-sm text-[var(--twilio-gray-60)] px-1">No accounts found.</p>}
        </div>

        {/* Log Time footer — always visible at the bottom of the sidebar */}
        <div className="shrink-0 px-3 py-3 border-t border-gray-100">
          {!selectedAccountName ? (
            <p className="text-[11px] text-center text-[var(--twilio-gray-60)] px-1">Select an account above to log time</p>
          ) : null}
          <button
            disabled={!selectedAccountName && !logTimeModeAccount}
            onClick={() => onLogTimeMode(logTimeModeAccount ? null : selectedAccountName)}
            className={[
              "mt-1 w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-colors border",
              logTimeModeAccount
                ? "bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700"
                : selectedAccountName
                ? "bg-[var(--twilio-navy)] border-[var(--twilio-navy)] text-white hover:opacity-90"
                : "bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed",
            ].join(" ")}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 shrink-0">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/>
            </svg>
            {logTimeModeAccount ? `Exit Log Time` : "Log Time to Salesforce"}
          </button>
          {logTimeModeAccount && (
            <p className="mt-1.5 text-[10px] text-center text-emerald-700 font-medium">{logTimeModeAccount}</p>
          )}
        </div>
      </div>
    </>
  );
}

type CalCreateForm = {
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

const BLANK_FORM: CalCreateForm = {
  task: "", task_details: "",
  priority: "Medium", status: "Open",
  due_date: "", account_name: "",
  estimated_time: 0, time_spent: 0, prep_time: 0,
  slack_thread_url: "", assignee_name: "",
};

// ── Pill helpers (self-contained, matching ActionItemsPage style) ─────────────

function CalPillSelect<T extends string>({ value, options, colorMap, placeholder, onChange }: {
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

function CalPillNumber({ value, label, onChange }: { value: number; label: string; onChange: (v: number) => void }) {
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

function CalPillDate({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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

function CalPillUrl({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  if (open) return (
    <input ref={ref} type="url" defaultValue={value}
      onBlur={(e) => { onChange(e.target.value); setOpen(false); }}
      onClick={(e) => e.stopPropagation()} placeholder="https://…"
      className="w-40 rounded-full border border-indigo-400 bg-white px-2.5 py-0.5 text-[12px] font-semibold focus:outline-none"
    />
  );
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold hover:opacity-75 transition-opacity cursor-pointer ${value ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200" : "bg-gray-100 text-[var(--twilio-gray-60)]"}`}
    >
      <svg viewBox="0 0 16 16" fill="currentColor" className="w-2.5 h-2.5"><path d="M6 2a2 2 0 00-2 2v5a2 2 0 002 2h1v2l2.5-2.5A1 1 0 0110 10h2a2 2 0 002-2V4a2 2 0 00-2-2H6z"/></svg>
      {value ? "Slack ↗" : "Slack"}
    </button>
  );
}

function OccurrencesList({ airtableId }: { airtableId: string }) {
  const occurrences = useScheduledOccurrences(airtableId);
  if (occurrences.length === 0) return null;
  return (
    <div className="mt-1 pt-1.5 border-t border-gray-200/70">
      <p className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wide mb-0.5">On calendar</p>
      <div className="flex flex-col gap-0.5">
        {occurrences.map((o) => (
          <span key={o.start} className="text-[10px] text-indigo-600">
            {new Date(o.start).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </span>
        ))}
      </div>
    </div>
  );
}

function ActionItemCard_Cal({ item, onDragStart, onDelete, onReminderToggle, onUpdate, onAccountDrop, accounts, teamMembers, forceExpand }: {
  item: AirtableActionItem;
  onDragStart: (e: React.DragEvent) => void;
  onDelete: () => void;
  onReminderToggle: () => void;
  onUpdate: (patch: Partial<AirtableActionItem>) => void;
  onAccountDrop: (accountId: number, accountName: string) => void;
  accounts: AirtableAccount[];
  teamMembers: { id: number; full_name: string }[];
  forceExpand?: boolean;
}) {
  const { status: statusOptions } = useActionItemFieldOptions();
  const [expanded, setExpanded] = useState(forceExpand ?? false);

  useEffect(() => {
    if (forceExpand) setExpanded(true);
  }, [forceExpand]);
  const [editForm, setEditForm] = useState<CalCreateForm>({
    task: item.task,
    task_details: item.task_details,
    priority: item.priority,
    status: item.status,
    due_date: item.due_date ?? "",
    account_name: item.account_name ?? "",
    estimated_time: item.estimated_time,
    time_spent: item.time_spent,
    prep_time: item.prep_time,
    slack_thread_url: item.slack_thread_url,
    assignee_name: item.assignee_name,
  });
  const cardRef = useRef<HTMLDivElement>(null);
  const accent = PRIORITY_ACCENT_CAL[editForm.priority] ?? "#9ca3af";
  const hasReminder = !!item.reminder_due_at;
  const [isAccountDropTarget, setIsAccountDropTarget] = useState(false);

  // Sync editForm when item prop changes (e.g. after save)
  useEffect(() => {
    if (!expanded) {
      setEditForm({
        task: item.task,
        task_details: item.task_details,
        priority: item.priority,
        status: item.status,
        due_date: item.due_date ?? "",
        account_name: item.account_name ?? "",
        estimated_time: item.estimated_time,
        time_spent: item.time_spent,
        prep_time: item.prep_time,
        slack_thread_url: item.slack_thread_url,
        assignee_name: item.assignee_name,
      });
    }
  }, [item, expanded]);

  function commitEdit() {
    if (!expanded) return;
    setExpanded(false);
    // Build patch of only changed fields
    const patch: Partial<AirtableActionItem> = {};
    if (editForm.task !== item.task) patch.task = editForm.task;
    if (editForm.task_details !== item.task_details) patch.task_details = editForm.task_details;
    if (editForm.priority !== item.priority) patch.priority = editForm.priority;
    if (editForm.status !== item.status) patch.status = editForm.status;
    if ((editForm.due_date || null) !== item.due_date) patch.due_date = editForm.due_date || null;
    if ((editForm.account_name || null) !== item.account_name) patch.account_name = editForm.account_name || null;
    if (editForm.estimated_time !== item.estimated_time) patch.estimated_time = editForm.estimated_time;
    if (editForm.time_spent !== item.time_spent) patch.time_spent = editForm.time_spent;
    if (editForm.prep_time !== item.prep_time) patch.prep_time = editForm.prep_time;
    if (editForm.slack_thread_url !== item.slack_thread_url) patch.slack_thread_url = editForm.slack_thread_url;
    if (editForm.assignee_name !== item.assignee_name) patch.assignee_name = editForm.assignee_name;
    if (Object.keys(patch).length > 0) onUpdate(patch);
  }

  // Click-outside → commit
  useEffect(() => {
    if (!expanded) return;
    function onPointerDown(e: PointerEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        commitEdit();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, editForm]);

  if (expanded) {
    return (
      <div
        ref={cardRef}
        className="rounded-lg select-none"
        style={{
          background: "#F5F3FF",
          borderLeft: "3px solid #a78bfa",
          padding: "8px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
        }}
      >
        {/* Task title */}
        <input
          autoFocus
          value={editForm.task}
          onChange={(e) => setEditForm((f) => ({ ...f, task: e.target.value }))}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitEdit(); } if (e.key === "Escape") { setExpanded(false); } }}
          placeholder="Task name"
          className="w-full text-[13px] font-medium text-[var(--twilio-navy)] bg-white rounded px-2 py-1 border border-indigo-300 focus:outline-none focus:border-indigo-500"
        />

        {/* Task details */}
        <textarea
          value={editForm.task_details}
          onChange={(e) => setEditForm((f) => ({ ...f, task_details: e.target.value }))}
          rows={2}
          placeholder="Details…"
          className="w-full text-[11px] text-[var(--twilio-navy)] bg-white rounded px-2 py-1 border border-gray-200 focus:outline-none focus:border-indigo-300 resize-none leading-relaxed placeholder:text-gray-400"
        />

        {/* Status + Priority */}
        <div className="flex flex-wrap gap-1.5">
          <CalPillSelect
            value={editForm.status}
            options={statusOptions as AirtableActionItem["status"][]}
            colorMap={STATUS_COLORS_CAL}
            placeholder="Status"
            onChange={(v) => setEditForm((f) => ({ ...f, status: v }))}
          />
          <CalPillSelect
            value={editForm.priority}
            options={["Critical", "High", "Medium", "Low"] as const}
            colorMap={PRIORITY_COLORS_CAL}
            placeholder="Priority"
            onChange={(v) => setEditForm((f) => ({ ...f, priority: v }))}
          />
          <CalPillDate value={editForm.due_date} onChange={(v) => setEditForm((f) => ({ ...f, due_date: v }))} />
        </div>

        {/* Time fields + Slack */}
        <div className="flex flex-wrap gap-1.5">
          <CalPillNumber value={editForm.estimated_time} label="Est." onChange={(v) => setEditForm((f) => ({ ...f, estimated_time: v }))} />
          <CalPillNumber value={editForm.time_spent} label="Spent" onChange={(v) => setEditForm((f) => ({ ...f, time_spent: v }))} />
          <CalPillNumber value={editForm.prep_time} label="Prep" onChange={(v) => setEditForm((f) => ({ ...f, prep_time: v }))} />
          <CalPillUrl value={editForm.slack_thread_url} onChange={(v) => setEditForm((f) => ({ ...f, slack_thread_url: v }))} />
        </div>

        {/* Account + Assignee */}
        <div className="flex flex-wrap gap-1.5">
          <CalPillSelect
            value={(editForm.account_name || "No account") as string}
            options={["No account", ...accounts.map((a) => a.name)] as string[]}
            colorMap={{}}
            placeholder="Account"
            onChange={(v) => setEditForm((f) => ({ ...f, account_name: v === "No account" ? "" : v }))}
          />
          {teamMembers.length > 0 && (
            <CalPillSelect
              value={(editForm.assignee_name || "Unassigned") as string}
              options={["Unassigned", ...teamMembers.map((m) => m.full_name)] as string[]}
              colorMap={{}}
              placeholder="Assignee"
              onChange={(v) => setEditForm((f) => ({ ...f, assignee_name: v === "Unassigned" ? "" : v }))}
            />
          )}
        </div>

        {/* Footer: reminder + delete + done */}
        <div className="flex items-center justify-between pt-0.5">
          <div className="flex items-center gap-1.5">
            <button
              onClick={(e) => { e.stopPropagation(); onReminderToggle(); }}
              title={hasReminder ? `Reminder: ${new Date(item.reminder_due_at!).toLocaleString()}` : "Set reminder"}
              className="rounded p-0.5 hover:bg-gray-200 transition-colors"
              style={{ color: hasReminder ? "#f59e0b" : "#9ca3af" }}
            >
              <svg viewBox="0 0 16 16" width="12" height="12" fill={hasReminder ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" d="M8 1a5 5 0 00-5 5v2.5L1.5 10h13L13 8.5V6a5 5 0 00-5-5z"/>
                <path strokeLinecap="round" d="M6.5 13a1.5 1.5 0 003 0"/>
              </svg>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              title="Delete"
              className="rounded p-0.5 hover:bg-red-100 transition-colors text-gray-400 hover:text-red-500"
            >
              <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M3 3l10 10M13 3L3 13"/>
              </svg>
            </button>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); commitEdit(); }}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            Done
          </button>
        </div>

        <OccurrencesList airtableId={item.airtable_id} />
      </div>
    );
  }

  // ── Collapsed view ────────────────────────────────────────────────────────────
  return (
    <div
      ref={cardRef}
      draggable
      onDragStart={onDragStart}
      onClick={() => setExpanded(true)}
      onDragOver={(e) => {
        const w = window as unknown as Record<string, string>;
        if (w[CALENDAR_DRAG_ACCOUNT_KEY]) { e.preventDefault(); setIsAccountDropTarget(true); }
      }}
      onDragLeave={() => setIsAccountDropTarget(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsAccountDropTarget(false);
        const w = window as unknown as Record<string, string>;
        const accountId = Number(w[CALENDAR_DRAG_ACCOUNT_KEY]);
        const accountName = w[`${CALENDAR_DRAG_ACCOUNT_KEY}_name`] || "";
        if (accountId) {
          delete w[CALENDAR_DRAG_ACCOUNT_KEY];
          delete w[`${CALENDAR_DRAG_ACCOUNT_KEY}_name`];
          onAccountDrop(accountId, accountName);
        }
      }}
      className="rounded-lg select-none cursor-pointer group"
      style={{
        background: "#F5F3FF",
        borderLeft: "3px solid #a78bfa",
        padding: "8px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 5,
        boxShadow: isAccountDropTarget ? "0 0 0 2px #6366f1" : "0 1px 3px rgba(0,0,0,0.08)",
        outline: isAccountDropTarget ? "2px solid #6366f1" : "none",
        borderRadius: 8,
      }}
    >
      {/* Row 1: badges + actions */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ${PRIORITY_COLORS_CAL[editForm.priority] ?? "bg-gray-100 text-gray-600"}`}>{editForm.priority}</span>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ${STATUS_COLORS_CAL[editForm.status] ?? "bg-gray-100 text-gray-700"}`}>{editForm.status}</span>
        {editForm.due_date && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap bg-amber-50 text-amber-700">
            {new Date(editForm.due_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onReminderToggle(); }}
            title={hasReminder ? `Reminder: ${new Date(item.reminder_due_at!).toLocaleString()}` : "Set reminder"}
            className="rounded p-0.5 hover:bg-gray-200 transition-colors"
            style={{ color: hasReminder ? "#f59e0b" : "#9ca3af" }}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" fill={hasReminder ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" d="M8 1a5 5 0 00-5 5v2.5L1.5 10h13L13 8.5V6a5 5 0 00-5-5z"/>
              <path strokeLinecap="round" d="M6.5 13a1.5 1.5 0 003 0"/>
            </svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="Remove"
            className="rounded p-0.5 hover:bg-red-100 transition-colors text-gray-400 hover:text-red-500"
          >
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M3 3l10 10M13 3L3 13"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Row 2: task title */}
      <p className="text-[13px] font-medium text-[var(--twilio-navy)] leading-snug" style={{ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>
        {editForm.task || <span className="italic opacity-40">Untitled</span>}
      </p>

      {/* Row 3: details + meta */}
      {(editForm.task_details || editForm.assignee_name || editForm.account_name || editForm.estimated_time) ? (
        <div className="flex flex-col gap-0.5">
          {editForm.task_details && (
            <p className="text-[11px] text-[var(--twilio-navy)] opacity-60 leading-snug" style={{ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>
              {editForm.task_details}
            </p>
          )}
          <div className="flex gap-2 flex-wrap">
            {editForm.account_name && <span className="text-[10px] text-[var(--twilio-gray-60)]">{editForm.account_name}</span>}
            {editForm.assignee_name && <span className="text-[10px] text-[var(--twilio-gray-60)]">{editForm.assignee_name}</span>}
            {editForm.estimated_time ? <span className="text-[10px] text-[var(--twilio-gray-60)]">{editForm.estimated_time}m est.</span> : null}
          </div>
        </div>
      ) : null}

      <OccurrencesList airtableId={item.airtable_id} />
    </div>
  );
}

function ActionItemsSidebar({ onDropToast, expandItemId }: { onDropToast?: (msg: string, type: "success" | "warn") => void; expandItemId?: string | null }) {
  const currentUser = useCurrentUser();
  const { status: statusOptions } = useActionItemFieldOptions();
  const [items, setItems] = useState<AirtableActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [forcedExpandId, setForcedExpandId] = useState<string | null>(expandItemId ?? null);

  // When a new expandItemId is pushed in, adopt it
  useEffect(() => {
    if (expandItemId) setForcedExpandId(expandItemId);
  }, [expandItemId]);
  const [stagedIds, setStagedIds] = useState<Set<string>>(() => {
    try {
      const zones: Record<string, string> = JSON.parse(localStorage.getItem(ACTION_ITEM_ZONES_KEY) ?? "{}");
      return new Set(Object.entries(zones).filter(([, v]) => v === "today").map(([k]) => k));
    } catch { return new Set(); }
  });

  // Create form state
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [saving, setSaving] = useState(false);

  // Reminder popover state
  const [reminderItemId, setReminderItemId] = useState<string | null>(null);
  const [reminderDate, setReminderDate] = useState("");
  const [reminderTime, setReminderTime] = useState("09:00");
  const [reminderSaving, setReminderSaving] = useState(false);

  // Airtable accounts and team members for the create form
  const [accounts, setAccounts] = useState<AirtableAccount[]>([]);
  const [teamMembers, setTeamMembers] = useState<{ id: number; full_name: string }[]>([]);

  const fetchItems = () =>
    airtableApi
      .listActionItems({ status: "Open,In Progress,Blocked,Backlogged,Complete" })
      .then(({ data }) => {
        // Only show open/in-progress in the sidebar
        const all = data ?? [];
        const liveIds = new Set(all.map((i: AirtableActionItem) => i.airtable_id));
        setItems(all.filter((i: AirtableActionItem) => i.status === "Open" || i.status === "In Progress"));
        // Prune stale activeTimers
        try {
          const timers: Record<string, unknown> = JSON.parse(localStorage.getItem("activeTimers") ?? "{}");
          const pruned = Object.fromEntries(Object.entries(timers).filter(([id]) => liveIds.has(id)));
          if (Object.keys(pruned).length !== Object.keys(timers).length) {
            localStorage.setItem("activeTimers", JSON.stringify(pruned));
            window.dispatchEvent(new StorageEvent("storage", { key: "activeTimers", newValue: JSON.stringify(pruned) }));
          }
        } catch { /* best effort */ }
        // Prune scheduledActionItems — remove any entry whose backing record no longer exists
        try {
          const scheduled = readScheduledItems();
          const pruned = scheduled.filter((s) => liveIds.has(s.airtableId));
          if (pruned.length !== scheduled.length) {
            localStorage.setItem(SCHEDULED_ITEMS_KEY, JSON.stringify(pruned));
            window.dispatchEvent(new StorageEvent("storage", { key: SCHEDULED_ITEMS_KEY, newValue: JSON.stringify(pruned) }));
          }
        } catch { /* best effort */ }
      })
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => {
    void fetchItems();
    airtableApi.listAccounts().then(({ data }) => setAccounts(data.results)).catch(() => {});
    teamApi.listMembers().then(({ data }) => setTeamMembers(data.results)).catch(() => {});
  }, []);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === "actionItemsUpdated") { void fetchItems(); return; }
      if (e.key !== ACTION_ITEM_ZONES_KEY) return;
      try {
        const zones: Record<string, string> = JSON.parse(e.newValue ?? "{}");
        setStagedIds(new Set(Object.entries(zones).filter(([, v]) => v === "today").map(([k]) => k)));
      } catch { /* ignore */ }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function handleDragStart(e: React.DragEvent, item: AirtableActionItem) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", item.airtable_id);
    const w = window as unknown as Record<string, string>;
    w[CALENDAR_DRAG_KEY] = item.airtable_id;
    w[`${CALENDAR_DRAG_KEY}_task`] = item.task;
    w[`${CALENDAR_DRAG_KEY}_account`] = item.account_name ?? "";
    w[`${CALENDAR_DRAG_KEY}_est`] = String(item.estimated_time ?? 0);
    (e.currentTarget as HTMLElement).setAttribute(
      "data-event",
      JSON.stringify({
        title: item.task,
        duration: "00:15",
        backgroundColor: WORK_TRACKING_COLOR,
        borderColor: WORK_TRACKING_COLOR,
        extendedProps: { airtableId: item.airtable_id, accountName: item.account_name ?? "" },
      })
    );
  }

  async function handleDelete(item: AirtableActionItem) {
    setItems((prev) => prev.filter((i) => i.airtable_id !== item.airtable_id));
    // Remove all calendar occurrences for this item from localStorage
    const pruned = readScheduledItems().filter((s) => s.airtableId !== item.airtable_id);
    localStorage.setItem(SCHEDULED_ITEMS_KEY, JSON.stringify(pruned));
    window.dispatchEvent(new StorageEvent("storage", { key: SCHEDULED_ITEMS_KEY, newValue: JSON.stringify(pruned) }));
    try {
      await airtableApi.deleteActionItem(item.id);
      window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated", newValue: "1" }));
    } catch {
      setItems((prev) => [...prev, item]);
    }
  }

  async function handleSetReminder(item: AirtableActionItem) {
    if (!reminderDate) return;
    setReminderSaving(true);
    try {
      const due_at = `${reminderDate}T${reminderTime}:00`;
      const { data } = await airtableApi.setActionItemReminder(item.id, { due_at, notify_in_app: true });
      setItems((prev) => prev.map((i) => i.airtable_id === item.airtable_id ? data : i));
      setReminderItemId(null);
      const reminderLabel = new Date(due_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      addLog({
        category: "action_item",
        message: `Reminder linked to "${item.task || "Untitled"}" — ${reminderLabel}`,
        links: [{ label: "View calendar", path: "/calendar" }],
        resource: { type: "action_item", id: item.airtable_id },
      });
    } finally {
      setReminderSaving(false);
    }
  }

  async function handleClearReminder(item: AirtableActionItem) {
    try {
      const { data } = await airtableApi.clearActionItemReminder(item.id);
      setItems((prev) => prev.map((i) => i.airtable_id === item.airtable_id ? data : i));
      window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated", newValue: "1" }));
      addLog({
        category: "action_item",
        message: `Reminder cleared from "${item.task || "Untitled"}"`,
        links: [{ label: "View calendar", path: "/calendar" }],
        resource: { type: "action_item", id: item.airtable_id },
      });
    } catch { /* best effort */ }
    setReminderItemId(null);
  }

  async function handleUpdate(item: AirtableActionItem, patch: Partial<AirtableActionItem>) {
    // Optimistic update
    setItems((prev) => prev.map((i) => i.airtable_id === item.airtable_id ? { ...i, ...patch } : i));
    try {
      await airtableApi.updateActionItemFields(item.airtable_id, patch);
      window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated", newValue: "1" }));
    } catch {
      // Revert on failure
      setItems((prev) => prev.map((i) => i.airtable_id === item.airtable_id ? item : i));
    }
  }

  async function handleCreate() {
    if (!form.task.trim()) return;
    setSaving(true);
    try {
      const acct = accounts.find((a) => a.name === form.account_name);
      const member = teamMembers.find((m) => m.full_name === form.assignee_name);
      const resolvedAssigneeName = member?.full_name ?? (form.assignee_name || currentUser?.display_name || "");
      const resolvedAssigneeId = member ? String(member.id) : (form.assignee_name ? "" : currentUser?.airtable_collaborator_id || "");
      const { data } = await airtableApi.createActionItem({
        task: form.task.trim(),
        task_details: form.task_details.trim(),
        priority: form.priority,
        status: form.status,
        due_date: form.due_date || null,
        account: acct?.id ?? null,
        account_name: form.account_name || null,
        estimated_time: form.estimated_time || 0,
        time_spent: form.time_spent || 0,
        prep_time: form.prep_time || 0,
        slack_thread_url: form.slack_thread_url || "",
        assignee_name: resolvedAssigneeName,
        assignee_airtable_id: resolvedAssigneeId,
      });
      setItems((prev) => [data, ...prev]);
      setForm({ ...BLANK_FORM });
      setCreating(false);
      window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated", newValue: "1" }));
    } finally {
      setSaving(false);
    }
  }

  const reminderItem = reminderItemId ? items.find((i) => i.airtable_id === reminderItemId) ?? null : null;

  const [filterTerm, setFilterTerm] = useState("");
  const filteredItems = filterTerm.trim()
    ? items.filter((i) => {
        const q = filterTerm.toLowerCase();
        return (
          i.task?.toLowerCase().includes(q) ||
          i.task_details?.toLowerCase().includes(q) ||
          i.account_name?.toLowerCase().includes(q) ||
          i.assignee_name?.toLowerCase().includes(q)
        );
      })
    : items;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Filter input */}
      <div className="px-3 pt-2 pb-1 shrink-0">
        <div className="relative">
          <svg viewBox="0 0 16 16" className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="6.5" cy="6.5" r="4"/>
            <line x1="10" y1="10" x2="13.5" y2="13.5"/>
          </svg>
          <input
            type="text"
            value={filterTerm}
            onChange={(e) => setFilterTerm(e.target.value)}
            placeholder="Filter…"
            className="w-full pl-6 pr-6 py-1.5 text-[11px] rounded-md border border-gray-200 bg-gray-50 text-[var(--twilio-navy)] placeholder-gray-400 focus:outline-none focus:border-indigo-400 focus:bg-white transition-colors"
          />
          {filterTerm && (
            <button
              onClick={() => setFilterTerm("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors leading-none"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {loading ? (
          <p className="text-sm text-[var(--twilio-gray-60)] py-2">Loading…</p>
        ) : filteredItems.length === 0 && !creating ? (
          <p className="text-sm text-[var(--twilio-gray-60)] py-2">
            {filterTerm ? "No matches." : "No open action items."}
          </p>
        ) : (
          filteredItems.map((item) => {
            const isStaged = stagedIds.has(item.airtable_id);
            return (
              <div key={item.airtable_id} className="relative">
                {isStaged && (
                  <span className="absolute -top-1 -right-1 z-10 text-[9px] font-bold bg-blue-500 text-white px-1.5 py-0.5 rounded-full">Staged</span>
                )}
                <ActionItemCard_Cal
                  item={item}
                  forceExpand={forcedExpandId === item.airtable_id}
                  onDragStart={(e) => handleDragStart(e, item)}
                  onDelete={() => handleDelete(item)}
                  onUpdate={(patch) => void handleUpdate(item, patch)}
                  onAccountDrop={(accountId, accountName) => {
                    setItems((prev) => prev.map((i) => i.airtable_id === item.airtable_id ? { ...i, account: accountId, account_name: accountName } : i));
                    airtableApi.updateActionItemFields(item.airtable_id, { account: accountId, account_name: accountName }).catch(() => {
                      setItems((prev) => prev.map((i) => i.airtable_id === item.airtable_id ? item : i));
                    });
                    window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated", newValue: "1" }));
                  }}
                  accounts={accounts}
                  teamMembers={teamMembers}
                  onReminderToggle={() => {
                    if (reminderItemId === item.airtable_id) {
                      setReminderItemId(null);
                    } else {
                      setReminderItemId(item.airtable_id);
                      setReminderDate(item.reminder_due_at ? item.reminder_due_at.slice(0, 10) : new Date().toISOString().slice(0, 10));
                      setReminderTime(item.reminder_due_at ? item.reminder_due_at.slice(11, 16) : "09:00");
                    }
                  }}
                />
                {/* Reminder popover */}
                {reminderItemId === item.airtable_id && (
                  <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 p-2.5 flex flex-col gap-2">
                    <p className="text-[11px] font-semibold text-amber-800">{item.reminder_due_at ? "Edit Reminder" : "Set Reminder"}</p>
                    <div className="flex gap-1.5">
                      <input type="date" value={reminderDate} onChange={(e) => setReminderDate(e.target.value)}
                        className="flex-1 text-[11px] rounded border border-amber-200 px-1.5 py-1 focus:outline-none focus:border-amber-400"
                        style={{ background: "#fff" }}
                      />
                      <input type="time" value={reminderTime} onChange={(e) => setReminderTime(e.target.value)}
                        className="w-20 text-[11px] rounded border border-amber-200 px-1.5 py-1 focus:outline-none focus:border-amber-400"
                        style={{ background: "#fff" }}
                      />
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => void handleSetReminder(item)}
                        disabled={reminderSaving || !reminderDate}
                        className="flex-1 text-[11px] font-semibold py-1 rounded-md transition-colors disabled:opacity-40"
                        style={{ background: "#f59e0b", color: "#fff" }}
                      >{reminderSaving ? "…" : "Set"}</button>
                      <button
                        onClick={() => void handleClearReminder(item)}
                        className="text-[11px] font-semibold px-2 py-1 rounded-md border border-amber-200 text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-30"
                        disabled={!item.reminder_due_at}
                      >Clear</button>
                      <button onClick={() => setReminderItemId(null)} className="text-[11px] px-2 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors">✕</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Create card — pinned at bottom */}
      {creating && (
        <div className="shrink-0 border-t border-gray-100">
          <div className="rounded-xl flex flex-col overflow-hidden m-3" style={{ background: "#F5F3FF", border: "1px solid #ddd6fe" }}>
            {/* Task title */}
            <div className="px-4 pt-3 pb-2">
              <input
                autoFocus
                value={form.task}
                onChange={(e) => setForm((f) => ({ ...f, task: e.target.value }))}
                placeholder="Name or short description"
                className="w-full text-xs font-semibold text-[var(--twilio-navy)] bg-transparent border-b border-violet-200 focus:border-violet-400 focus:outline-none pb-1 placeholder:text-[var(--twilio-gray-60)] placeholder:font-normal"
              />
            </div>

            {/* Badge row */}
            <div className="px-4 pb-2 flex items-center gap-1.5 flex-wrap">
              <CalPillSelect
                value={form.priority}
                options={["Critical", "High", "Medium", "Low"] as const}
                colorMap={PRIORITY_COLORS_CAL}
                placeholder="Priority"
                onChange={(v) => setForm((f) => ({ ...f, priority: v }))}
              />
              <CalPillSelect
                value={form.status}
                options={statusOptions as AirtableActionItem["status"][]}
                colorMap={STATUS_COLORS_CAL}
                placeholder="Status"
                onChange={(v) => setForm((f) => ({ ...f, status: v }))}
              />
              {form.account_name && (
                <span className="text-[11px] text-[var(--twilio-navy)] font-medium truncate">{form.account_name}</span>
              )}
            </div>

            {/* Body fields */}
            <div className="px-4 py-2 flex flex-col gap-2.5">
              <textarea
                value={form.task_details}
                onChange={(e) => setForm((f) => ({ ...f, task_details: e.target.value }))}
                rows={2}
                placeholder="Additional context, steps, or notes…"
                className="w-full rounded-md border border-violet-100 bg-white px-2.5 py-1.5 text-xs text-[var(--twilio-navy)] placeholder:text-[var(--twilio-gray-60)] focus:bg-white focus:border-violet-300 focus:outline-none resize-none leading-relaxed"
              />

              {/* Status · Priority · Due date */}
              <div className="flex flex-wrap gap-1.5 items-center">
                <CalPillSelect
                  value={form.status}
                  options={statusOptions as AirtableActionItem["status"][]}
                  colorMap={STATUS_COLORS_CAL}
                  placeholder="Status"
                  onChange={(v) => setForm((f) => ({ ...f, status: v }))}
                />
                <CalPillSelect
                  value={form.priority}
                  options={["Critical", "High", "Medium", "Low"] as const}
                  colorMap={PRIORITY_COLORS_CAL}
                  placeholder="Priority"
                  onChange={(v) => setForm((f) => ({ ...f, priority: v }))}
                />
                <CalPillDate value={form.due_date} onChange={(v) => setForm((f) => ({ ...f, due_date: v }))} />
              </div>

              {/* Est · Spent · Prep · Slack */}
              <div className="flex flex-wrap gap-1.5 items-center">
                <CalPillNumber value={form.estimated_time} label="Est." onChange={(v) => setForm((f) => ({ ...f, estimated_time: v }))} />
                <CalPillNumber value={form.time_spent} label="Spent" onChange={(v) => setForm((f) => ({ ...f, time_spent: v }))} />
                <CalPillNumber value={form.prep_time} label="Prep" onChange={(v) => setForm((f) => ({ ...f, prep_time: v }))} />
                <CalPillUrl value={form.slack_thread_url} onChange={(v) => setForm((f) => ({ ...f, slack_thread_url: v }))} />
              </div>

              {/* Account · Assignee */}
              <div className="flex flex-wrap gap-1.5 items-center">
                <CalPillSelect
                  value={(form.account_name || "No account") as string}
                  options={["No account", ...accounts.map((a) => a.name)] as string[]}
                  colorMap={{}}
                  placeholder="Account"
                  onChange={(v) => setForm((f) => ({ ...f, account_name: v === "No account" ? "" : v }))}
                />
                {teamMembers.length > 0 && (
                  <CalPillSelect
                    value={(form.assignee_name || "Unassigned") as string}
                    options={["Unassigned", ...teamMembers.map((m) => m.full_name)] as string[]}
                    colorMap={{}}
                    placeholder="Unassigned"
                    onChange={(v) => setForm((f) => ({ ...f, assignee_name: v === "Unassigned" ? "" : v }))}
                  />
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-4 py-3 flex items-center justify-between rounded-b-xl">
              <button
                onClick={() => { setCreating(false); setForm({ ...BLANK_FORM }); }}
                className="text-[11px] text-[var(--twilio-gray-60)] hover:text-[var(--twilio-navy)] transition-colors"
              >Cancel</button>
              <button
                onClick={() => void handleCreate()}
                disabled={saving || !form.task.trim()}
                className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide rounded-md text-white disabled:opacity-40 transition-colors"
                style={{ background: "#a78bfa" }}
              >{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}

      {/* New button — pinned at bottom when not creating */}
      {!creating && (
        <div className="shrink-0 px-3 pb-3 pt-1 border-t border-gray-100">
          <button
            onClick={() => { setCreating(true); setForm({ ...BLANK_FORM }); }}
            className="w-full text-[11px] font-semibold py-1.5 rounded-lg transition-colors text-white"
            style={{ background: "#a78bfa" }}
          >+ New Action Item</button>
        </div>
      )}
    </div>
  );
}

// ── Reminder card ─────────────────────────────────────────────────────────────

function ReminderCard_Cal({ reminder, onDragStart, onDelete, onUpdate }: {
  reminder: Reminder;
  onDragStart: (e: React.DragEvent) => void;
  onDelete: () => void;
  onUpdate: (patch: Partial<Reminder>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editTitle, setEditTitle] = useState(reminder.title);
  const [editBody, setEditBody] = useState(reminder.body);
  const [editDueAt, setEditDueAt] = useState(reminder.due_at.slice(0, 16)); // "YYYY-MM-DDTHH:MM"
  const cardRef = useRef<HTMLDivElement>(null);
  const isPending = reminder.status === "pending";

  useEffect(() => {
    if (!expanded) {
      setEditTitle(reminder.title);
      setEditBody(reminder.body);
      setEditDueAt(reminder.due_at.slice(0, 16));
    }
  }, [reminder, expanded]);

  function commitEdit() {
    if (!expanded) return;
    setExpanded(false);
    const patch: Partial<Reminder> = {};
    if (editTitle !== reminder.title) patch.title = editTitle;
    if (editBody !== reminder.body) patch.body = editBody;
    const newDueAt = editDueAt.length === 16 ? `${editDueAt}:00` : editDueAt;
    if (newDueAt !== reminder.due_at) patch.due_at = newDueAt;
    if (Object.keys(patch).length > 0) onUpdate(patch);
  }

  useEffect(() => {
    if (!expanded) return;
    function onPointerDown(e: PointerEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) commitEdit();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, editTitle, editBody, editDueAt]);

  const statusColor = isPending ? "#f59e0b" : "#9ca3af";
  const statusLabel = reminder.status.charAt(0).toUpperCase() + reminder.status.slice(1);
  const dueLabel = new Date(reminder.due_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  if (expanded) {
    return (
      <div
        ref={cardRef}
        className="rounded-lg select-none"
        style={{ background: "#FFFBEB", borderLeft: "3px solid #f59e0b", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6, boxShadow: "0 2px 8px rgba(0,0,0,0.10)" }}
      >
        <input
          autoFocus
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitEdit(); } if (e.key === "Escape") setExpanded(false); }}
          placeholder="Reminder title"
          className="w-full text-[13px] font-medium text-[var(--twilio-navy)] bg-white rounded px-2 py-1 border border-amber-300 focus:outline-none focus:border-amber-500"
        />
        <textarea
          value={editBody}
          onChange={(e) => setEditBody(e.target.value)}
          rows={2}
          placeholder="Notes…"
          className="w-full text-[11px] text-[var(--twilio-navy)] bg-white rounded px-2 py-1 border border-gray-200 focus:outline-none focus:border-amber-300 resize-none leading-relaxed placeholder:text-gray-400"
        />
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--twilio-gray-60)] shrink-0">Due:</span>
          <input
            type="datetime-local"
            value={editDueAt}
            onChange={(e) => setEditDueAt(e.target.value)}
            className="flex-1 text-[11px] rounded border border-amber-200 px-1.5 py-1 focus:outline-none focus:border-amber-400 bg-white"
          />
        </div>
        <div className="flex items-center justify-between pt-0.5">
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="rounded p-0.5 hover:bg-red-100 transition-colors text-gray-400 hover:text-red-500"
          >
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>
          </button>
          <button onClick={(e) => { e.stopPropagation(); commitEdit(); }} className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-amber-500 text-white hover:bg-amber-600 transition-colors">Done</button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      draggable
      onDragStart={onDragStart}
      onClick={() => setExpanded(true)}
      className="rounded-lg select-none cursor-pointer group"
      style={{ background: "#FFFBEB", borderLeft: "3px solid #f59e0b", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap bg-amber-50 text-amber-700">{statusLabel}</span>
        <span className="text-[10px] text-[var(--twilio-gray-60)]">{dueLabel}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="ml-auto rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-red-100 transition-all text-gray-400 hover:text-red-500"
        >
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>
        </button>
      </div>
      <p className="text-[13px] font-medium text-[var(--twilio-navy)] leading-snug" style={{ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>
        {reminder.title || <span className="italic opacity-40">Untitled</span>}
      </p>
      {reminder.body && (
        <p className="text-[11px] text-[var(--twilio-navy)] opacity-60 leading-snug" style={{ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>
          {reminder.body}
        </p>
      )}
      {/* Scheduled occurrences */}
      {(() => {
        const occurrences = readScheduledReminders().filter((r) => r.reminderId === reminder.id && new Date(r.start) >= new Date(new Date().setHours(0,0,0,0)));
        if (occurrences.length === 0) return null;
        return (
          <div className="mt-1 pt-1.5 border-t border-amber-200/70">
            <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide mb-0.5">On calendar</p>
            {occurrences.map((o) => (
              <span key={o.start} className="text-[10px] text-amber-700 block">
                {new Date(o.start).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </span>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

// ── Reminders tab content ─────────────────────────────────────────────────────

function RemindersTabContent({ onDropToast }: { onDropToast: (msg: string, type: "success" | "warn") => void }) {
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

// ── Combined Items Sidebar (Action Items + Reminders tabs) ────────────────────

function ItemsSidebar({ onDropToast, forceTab, expandItemId }: { onDropToast: (msg: string, type: "success" | "warn") => void; forceTab?: "action-items" | "reminders"; expandItemId?: string | null }) {
  const [tab, setTab] = useState<"action-items" | "reminders">(forceTab ?? "action-items");

  useEffect(() => {
    if (forceTab) setTab(forceTab);
  }, [forceTab]);
  return (
    <div className="flex flex-col h-full overflow-hidden bg-white border-l border-gray-200 shadow-2xl">
      {/* Spacer so the button row (absolute top-4 right-4) overlaps cleanly */}
      <div className="h-16 shrink-0" />

      {/* Tab body — each mounts/unmounts so state resets on switch */}
      {tab === "action-items" ? (
        <ActionItemsSidebar onDropToast={onDropToast} expandItemId={expandItemId} />
      ) : (
        <RemindersTabContent onDropToast={onDropToast} />
      )}
    </div>
  );
}

// ── Log Time Panel ────────────────────────────────────────────────────────────

function fmtDuration(secs: number): string {
  if (secs <= 0) return "0m";
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function fmtDecimalHours(secs: number): string {
  return (secs / 3600).toFixed(2);
}

/** Round minutes up to the nearest 15-minute increment. */
function roundUpToQuarterHour(mins: number): number {
  return Math.ceil(mins / 15) * 15;
}

interface LogTimeDayColumnProps {
  date: string;
  dayCalEvents: CalendarEvent[];   // pre-filtered to this date, non-work-tracking
  dayItems: AirtableActionItem[];  // pre-filtered: scheduled on calendar for this date + pinned
  scheduledItems: ScheduledItem[]; // all scheduled items (for slot-duration lookup)
  syncedItemDurations: Map<string, number>; // "${date}::${airtableId}" → seconds from DB-backed work_tracking events
  projects: SalesforceProject[];
  assignments: LogTimeDayAssignment[];
  timeOverrides: Record<string, number>; // key "${date}::e::{id}" or "${date}::i::{airtableId}" → seconds
  itemAssignments: Record<string, number>; // item key → assignment.id (which project the item belongs to)
  onOverrideChange: (key: string, secs: number) => void;
  onAddProject: (date: string, project: SalesforceProject) => void;
  onRemoveProject: (date: string, assignment: LogTimeDayAssignment) => void;
  onPinItem: (date: string, airtableId: string) => void;
  onAssignItem: (itemKey: string, assignmentId: number | null) => void;
  onLogDay: (date: string, projectSfId: string, minutes: number, description: string) => Promise<void>;
  loggedDays: Set<string>;
  manuallyLogged: boolean;
  onMarkManuallyLogged: (date: string) => void;
}

function CopyButton({ buildText }: { buildText: () => string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(buildText()).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }).catch(() => {});
      }}
      className={[
        "shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold border transition-colors",
        copied ? "bg-emerald-50 border-emerald-300 text-emerald-700" : "bg-white border-gray-200 text-gray-400 hover:border-indigo-300 hover:text-indigo-600",
      ].join(" ")}
    >
      {copied ? "✓" : "Copy"}
    </button>
  );
}

function LogTimeDayColumn({
  date, dayCalEvents: allDayCalEvents, dayItems: allDayItems, scheduledItems, syncedItemDurations, projects, assignments,
  timeOverrides, itemAssignments, onOverrideChange, onAddProject, onRemoveProject, onPinItem, onAssignItem, onLogDay, loggedDays,
  manuallyLogged, onMarkManuallyLogged,
}: LogTimeDayColumnProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isDragOverProject, setIsDragOverProject] = useState<number | null>(null);
  const [loggingKey, setLoggingKey] = useState<string | null>(null);
  const [removedEventIds, setRemovedEventIds] = useState<Set<number>>(new Set());
  const [removedItemIds, setRemovedItemIds] = useState<Set<string>>(new Set());

  const dayCalEvents = allDayCalEvents.filter((e) => !removedEventIds.has(e.id));
  const dayItems = allDayItems.filter((i) => !removedItemIds.has(i.airtable_id));

  function secsForEvent(e: CalendarEvent) {
    const key = `${date}::e::${e.id}`;
    if (timeOverrides[key] !== undefined) return timeOverrides[key];
    return Math.max(0, (new Date(e.end_datetime).getTime() - new Date(e.start_datetime).getTime()) / 1000);
  }

  function secsForItem(item: AirtableActionItem) {
    const key = `${date}::i::${item.airtable_id}`;
    if (timeOverrides[key] !== undefined) return timeOverrides[key];
    // Prefer the calendar slot duration for locally-scheduled items (localStorage)
    const slot = scheduledItems.find((s) => s.airtableId === item.airtable_id && s.start.slice(0, 10) === date);
    if (slot) {
      const slotSecs = (new Date(slot.end).getTime() - new Date(slot.start).getTime()) / 1000;
      if (slotSecs > 0) return slotSecs;
    }
    // For items already synced to Google (DB-backed work_tracking events), use the actual event duration
    const syncedSecs = syncedItemDurations.get(`${date}::${item.airtable_id}`);
    if (syncedSecs !== undefined && syncedSecs > 0) return syncedSecs;
    const actual = (item.time_spent ?? 0) + (item.prep_time ?? 0);
    return actual > 0 ? actual : (item.estimated_time ?? 0);
  }

  const multiProject = assignments.length > 1;

  function eventItemKey(e: CalendarEvent) { return `${date}::e::${e.id}`; }
  function actionItemKey(i: AirtableActionItem) { return `${date}::i::${i.airtable_id}`; }

  // When multiple projects: only count items not yet assigned to any project in the header total
  // (each project footer shows its own total). With single project, count everything.
  const totalSecs = multiProject
    ? 0
    : dayCalEvents.reduce((s, e) => s + secsForEvent(e), 0)
      + dayItems.reduce((s, i) => s + secsForItem(i), 0);

  const [d, mo, dy] = date.split("-").map(Number) as [number, number, number];
  const dayLabel = new Date(d, mo - 1, dy).toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    // Ignore assigned-project pills being dragged off — they handle removal via dragend
    if (e.dataTransfer.getData("logTimeRemoveAssignmentId")) return;
    // Project pill dropped from the header source list
    const projectId = e.dataTransfer.getData("logTimeProjectId");
    if (projectId) {
      const project = projects.find((p) => String(p.id) === projectId);
      if (project) onAddProject(date, project);
      return;
    }
    // Action item dragged from sidebar
    const airtableId = e.dataTransfer.getData("text/plain") || (window as unknown as Record<string, string>)[CALENDAR_DRAG_KEY];
    if (airtableId) onPinItem(date, airtableId);
  }

  function handleProjectDrop(e: React.DragEvent, assignmentId: number) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOverProject(null);
    const itemKey = e.dataTransfer.getData("logTimeItemKey");
    if (itemKey) {
      onAssignItem(itemKey, assignmentId);
    }
  }

  function TimeInput({ valueKey, defaultSecs }: { valueKey: string; defaultSecs: number }) {
    const currentSecs = timeOverrides[valueKey] !== undefined ? timeOverrides[valueKey] : defaultSecs;
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");

    if (!editing) {
      return (
        <button
          onClick={() => { setDraft(String((currentSecs / 3600).toFixed(2))); setEditing(true); }}
          className="text-xs text-gray-400 hover:text-indigo-600 transition-colors shrink-0 tabular-nums"
          title="Click to edit"
        >
          {fmtDuration(currentSecs)}
        </button>
      );
    }
    return (
      <input
        autoFocus
        type="number"
        min="0"
        step="0.25"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const hrs = parseFloat(draft);
          if (!isNaN(hrs) && hrs >= 0) onOverrideChange(valueKey, Math.round(hrs * 3600));
          setEditing(false);
        }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
        className="w-14 text-xs border border-indigo-400 rounded px-1 py-0.5 text-right focus:outline-none"
        title="Hours (e.g. 0.5)"
      />
    );
  }

  const hasProjects = assignments.length > 0;
  const hasActivity = dayCalEvents.length > 0 || dayItems.length > 0;
  const noProjectsConfigured = projects.length === 0;

  // Blank auto-project used when the account has no projects at all
  const BLANK_SF_ID = "admin-pseudo-general";
  const blankKey = `${date}::${BLANK_SF_ID}`;
  const blankLogged = loggedDays.has(blankKey);
  const blankSecs = (noProjectsConfigured && !hasProjects)
    ? dayCalEvents.reduce((s, e) => s + secsForEvent(e), 0) + dayItems.reduce((s, i) => s + secsForItem(i), 0)
    : 0;
  const blankMinsRaw = Math.round(blankSecs / 60);
  const blankMins = roundUpToQuarterHour(blankMinsRaw);
  function buildBlankDescription() {
    const lines: string[] = [];
    for (const e of dayCalEvents) lines.push(`${e.title} (${fmtDuration(secsForEvent(e))})`);
    for (const i of dayItems) lines.push(`${i.task}${i.task_details ? `: ${i.task_details}` : ""} (${fmtDuration(secsForItem(i))})`);
    lines.push(`Total: ${fmtDecimalHours(blankSecs)} hrs`);
    return lines.join("\n");
  }

  // Set of currently-valid assignment IDs — stale IDs (from removed projects) are treated as unassigned
  const validAssignmentIds = new Set(assignments.map((a) => a.id));

  function isAssigned(key: string): boolean {
    const id = itemAssignments[key];
    return id !== undefined && validAssignmentIds.has(id);
  }

  // Items not yet assigned to any *current* project (only relevant when multiProject)
  const unassignedEvents = multiProject
    ? dayCalEvents.filter((e) => !isAssigned(eventItemKey(e)))
    : dayCalEvents;
  const unassignedItems = multiProject
    ? dayItems.filter((i) => !isAssigned(actionItemKey(i)))
    : dayItems;

  function renderEventRow(e: CalendarEvent, compact: boolean, draggable?: boolean) {
    const key = eventItemKey(e);
    const defaultSecs = Math.max(0, (new Date(e.end_datetime).getTime() - new Date(e.start_datetime).getTime()) / 1000);
    return (
      <div
        key={e.id}
        draggable={draggable}
        onDragStart={draggable ? (ev) => { ev.dataTransfer.setData("logTimeItemKey", key); ev.dataTransfer.effectAllowed = "move"; } : undefined}
        className={[
          "flex items-center gap-2 rounded px-2 py-1 group",
          compact ? "mx-2 mb-1" : "mb-1",
          manuallyLogged ? (compact ? "bg-white/60 opacity-60" : "bg-emerald-50 opacity-60") : (compact ? "bg-white/80" : "bg-blue-50"),
          draggable ? "cursor-grab active:cursor-grabbing" : "",
        ].join(" ")}
      >
        <div className={["rounded-full bg-blue-400 shrink-0", compact ? "h-1.5 w-1.5" : "h-2 w-2"].join(" ")} />
        <p className={[compact ? "text-[11px]" : "text-xs", "text-[var(--twilio-navy)] truncate flex-1", manuallyLogged ? "line-through text-gray-400" : ""].join(" ")}>{e.title}</p>
        <TimeInput valueKey={key} defaultSecs={defaultSecs} />
        <button onClick={() => setRemovedEventIds((prev) => new Set([...prev, e.id]))} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 text-xs leading-none shrink-0 transition-opacity ml-1" title="Remove from log">×</button>
      </div>
    );
  }

  function renderItemRow(item: AirtableActionItem, compact: boolean, draggable?: boolean) {
    const key = actionItemKey(item);
    const defaultSecs = (item.time_spent ?? 0) + (item.prep_time ?? 0) > 0
      ? (item.time_spent ?? 0) + (item.prep_time ?? 0)
      : (item.estimated_time ?? 0);
    return (
      <div
        key={item.airtable_id}
        draggable={draggable}
        onDragStart={draggable ? (ev) => { ev.dataTransfer.setData("logTimeItemKey", key); ev.dataTransfer.effectAllowed = "move"; } : undefined}
        className={[
          "flex items-start gap-2 rounded px-2 py-1 group",
          compact ? "mx-2 mb-1" : "mb-1",
          manuallyLogged ? (compact ? "bg-white/60 opacity-60" : "bg-emerald-50 opacity-60") : (compact ? "bg-white/80" : "bg-violet-50"),
          draggable ? "cursor-grab active:cursor-grabbing" : "",
        ].join(" ")}
      >
        <div className={["rounded-full bg-violet-400 shrink-0 mt-1", compact ? "h-1.5 w-1.5" : "h-2 w-2"].join(" ")} />
        <div className="flex-1 min-w-0">
          <p className={[compact ? "text-[11px] font-medium" : "text-xs font-medium", "truncate", manuallyLogged ? "line-through text-gray-400" : "text-[var(--twilio-navy)]"].join(" ")}>{item.task}</p>
          {!compact && item.task_details && <p className="text-[10px] text-gray-400 truncate">{item.task_details}</p>}
        </div>
        <TimeInput valueKey={key} defaultSecs={defaultSecs} />
        <button onClick={() => setRemovedItemIds((prev) => new Set([...prev, item.airtable_id]))} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 text-xs leading-none shrink-0 transition-opacity ml-1" title="Remove from log">×</button>
      </div>
    );
  }

  return (
    <div
      className={[
        "flex flex-col rounded-xl border transition-colors min-w-0",
        isDragOver ? "border-indigo-400 bg-indigo-50 shadow-md" : "border-gray-200 bg-white",
      ].join(" ")}
      style={{ flex: "1 1 0", minWidth: 0 }}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className={["px-3 pt-3 pb-2 border-b flex items-start justify-between gap-1", manuallyLogged ? "border-emerald-200 bg-emerald-50/60" : "border-gray-100"].join(" ")}>
        <div>
          <p className="text-xs font-semibold text-[var(--twilio-navy)]">{dayLabel}</p>
          <p className={["text-lg font-bold leading-tight", manuallyLogged ? "text-emerald-700" : "text-[var(--twilio-navy)]"].join(" ")}>
            {fmtDecimalHours(totalSecs)}<span className="text-sm font-normal text-gray-400 ml-1">/ {fmtDuration(totalSecs)}</span>
          </p>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-2 px-3 py-2 flex-1">
        {/* No projects configured: auto-group all items in a General block with Copy/Mark/Log */}
        {!hasProjects && noProjectsConfigured && (
          <div className={["rounded-lg border transition-colors", manuallyLogged ? "border-emerald-200 bg-emerald-50/40" : "border-emerald-200 bg-emerald-50/60"].join(" ")}>
            {!hasActivity && (
              <p className="mx-2 mt-2 mb-1 text-[11px] text-gray-400 italic">{isDragOver ? "Drop here to add" : "No calendar activity for this day"}</p>
            )}
            {dayCalEvents.map((e) => renderEventRow(e, true))}
            {dayItems.map((item) => renderItemRow(item, true))}
            <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2 pt-1 border-t border-emerald-100 mt-1 min-w-0">
              <span className="text-[10px] font-semibold text-emerald-800 mr-auto tabular-nums whitespace-nowrap">
                {fmtDecimalHours(blankSecs)} / {fmtDuration(blankSecs)}
                {blankMins !== blankMinsRaw && <span className="text-emerald-600 ml-1">(→ {blankMins}m)</span>}
              </span>
              <CopyButton buildText={buildBlankDescription} />
              <button
                onClick={() => onMarkManuallyLogged(date)}
                className={["shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold border transition-colors", manuallyLogged ? "bg-emerald-600 border-emerald-600 text-white" : "bg-white border-gray-200 text-gray-400 hover:border-emerald-400 hover:text-emerald-700"].join(" ")}
              >
                {manuallyLogged ? "✓" : "Mark"}
              </button>
              <button
                onClick={async () => { setLoggingKey(blankKey); try { await onLogDay(date, BLANK_SF_ID, blankMins, buildBlankDescription()); } finally { setLoggingKey(null); } }}
                disabled={loggingKey === blankKey || blankMins === 0}
                className={["shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold transition-colors border", blankLogged ? "bg-emerald-600 border-emerald-600 text-white" : "bg-white border-emerald-400 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed"].join(" ")}
              >
                {loggingKey === blankKey ? "…" : blankLogged ? "✓ Logged" : "Log"}
              </button>
            </div>
          </div>
        )}

        {/* Projects exist but none dragged to this day: flat list */}
        {!hasProjects && !noProjectsConfigured && (
          <>
            {dayCalEvents.map((e) => renderEventRow(e, false))}
            {dayItems.map((item) => renderItemRow(item, false))}
            {!hasActivity && (
              <p className="text-xs text-gray-400 italic">{isDragOver ? "Drop here to add" : "No activity"}</p>
            )}
          </>
        )}

        {/* When multiple projects: unassigned pool at top (draggable into a project) */}
        {hasProjects && multiProject && (unassignedEvents.length > 0 || unassignedItems.length > 0) && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-1 pt-1 pb-0.5 mb-1">
            <p className="text-[10px] text-gray-400 px-1 pb-0.5">Unassigned — drag into a project</p>
            {unassignedEvents.map((e) => renderEventRow(e, true, true))}
            {unassignedItems.map((item) => renderItemRow(item, true, true))}
          </div>
        )}

        {/* One block per project — meetings + items inside, Copy + Log at the bottom of each */}
        {assignments.map((a) => {
          const key = `${date}::${a.project_sf_id}`;
          const logged = loggedDays.has(key);

          // Which events/items belong to this project
          const projEvents = multiProject
            ? dayCalEvents.filter((e) => itemAssignments[eventItemKey(e)] === a.id && validAssignmentIds.has(a.id))
            : dayCalEvents;
          const projItems = multiProject
            ? dayItems.filter((i) => itemAssignments[actionItemKey(i)] === a.id && validAssignmentIds.has(a.id))
            : dayItems;

          const projSecs = projEvents.reduce((s, e) => s + secsForEvent(e), 0)
            + projItems.reduce((s, i) => s + secsForItem(i), 0);
          const projMinsRaw = Math.round(projSecs / 60);
          const projMins = roundUpToQuarterHour(projMinsRaw);
          const projHasContent = projEvents.length > 0 || projItems.length > 0;

          function buildProjectDescription() {
            const lines: string[] = [];
            for (const e of projEvents) lines.push(`${e.title} (${fmtDuration(secsForEvent(e))})`);
            for (const i of projItems) lines.push(`${i.task}${i.task_details ? `: ${i.task_details}` : ""} (${fmtDuration(secsForItem(i))})`);
            lines.push(`Total: ${fmtDecimalHours(projSecs)} hrs`);
            return lines.join("\n");
          }

          const isDropTarget = isDragOverProject === a.id;

          return (
            <div
              key={a.id}
              className={[
                "rounded-lg border transition-colors",
                isDropTarget ? "border-indigo-400 bg-indigo-50/60" : (manuallyLogged ? "border-emerald-200 bg-emerald-50/40" : "border-emerald-200 bg-emerald-50/60"),
              ].join(" ")}
              onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer.types.includes("logtimeitemkey")) setIsDragOverProject(a.id); }}
              onDragLeave={() => setIsDragOverProject(null)}
              onDrop={(e) => handleProjectDrop(e, a.id)}
            >
              {/* Project header — draggable to remove */}
              <div className="flex items-center gap-1.5 px-2 pt-2 pb-1">
                <div
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("logTimeRemoveAssignmentId", String(a.id));
                    e.dataTransfer.setData("logTimeRemoveDate", date);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={(e) => {
                    if (e.dataTransfer.dropEffect === "none") onRemoveProject(date, a);
                  }}
                  className="flex-1 flex items-center gap-1.5 min-w-0 cursor-grab active:cursor-grabbing active:opacity-50"
                  title="Drag off to remove"
                >
                  <div className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                  <p className="text-[11px] font-semibold text-emerald-900 break-words min-w-0">{a.project_name}</p>
                </div>
                <button onClick={() => onRemoveProject(date, a)} className="shrink-0 text-gray-300 hover:text-red-400 transition-colors text-sm leading-none" title="Remove">×</button>
              </div>

              {/* Meetings inside project */}
              {projEvents.map((e) => {
                const ikey = eventItemKey(e);
                return (
                  <div key={e.id} className={["flex items-center gap-2 mx-2 mb-1 rounded px-2 py-1 group", manuallyLogged ? "bg-white/60 opacity-60" : "bg-white/80"].join(" ")}>
                    <div className="h-1.5 w-1.5 rounded-full bg-blue-400 shrink-0" />
                    <p className={["text-[11px] text-[var(--twilio-navy)] truncate flex-1", manuallyLogged ? "line-through text-gray-400" : ""].join(" ")}>{e.title}</p>
                    <TimeInput valueKey={ikey} defaultSecs={Math.max(0, (new Date(e.end_datetime).getTime() - new Date(e.start_datetime).getTime()) / 1000)} />
                    {multiProject && <button onClick={() => onAssignItem(ikey, null)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-indigo-400 text-xs leading-none shrink-0 transition-opacity" title="Unassign from project">↩</button>}
                    <button onClick={() => setRemovedEventIds((prev) => new Set([...prev, e.id]))} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 text-xs leading-none shrink-0 transition-opacity" title="Remove from log">×</button>
                  </div>
                );
              })}

              {/* Action items inside project */}
              {projItems.map((item) => {
                const ikey = actionItemKey(item);
                return (
                  <div key={item.airtable_id} className={["flex items-start gap-2 mx-2 mb-1 rounded px-2 py-1 group", manuallyLogged ? "bg-white/60 opacity-60" : "bg-white/80"].join(" ")}>
                    <div className="h-1.5 w-1.5 rounded-full bg-violet-400 shrink-0 mt-1" />
                    <div className="flex-1 min-w-0">
                      <p className={["text-[11px] font-medium truncate", manuallyLogged ? "line-through text-gray-400" : "text-[var(--twilio-navy)]"].join(" ")}>{item.task}</p>
                    </div>
                    <TimeInput valueKey={ikey} defaultSecs={(item.time_spent ?? 0) + (item.prep_time ?? 0) > 0 ? (item.time_spent ?? 0) + (item.prep_time ?? 0) : (item.estimated_time ?? 0)} />
                    {multiProject && <button onClick={() => onAssignItem(ikey, null)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-indigo-400 text-xs leading-none shrink-0 transition-opacity" title="Unassign from project">↩</button>}
                    <button onClick={() => setRemovedItemIds((prev) => new Set([...prev, item.airtable_id]))} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 text-xs leading-none shrink-0 transition-opacity" title="Remove from log">×</button>
                  </div>
                );
              })}

              {multiProject && !projHasContent && (
                <p className="mx-2 mb-1 text-[11px] text-gray-400 italic">{isDropTarget ? "Drop here" : "Drag items here"}</p>
              )}
              {!multiProject && !hasActivity && (
                <p className="mx-2 mb-1 text-[11px] text-gray-400 italic">No calendar activity for this day</p>
              )}

              {/* Per-project Copy + Log + Mark Logged */}
              <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2 pt-1 border-t border-emerald-100 mt-1 min-w-0">
                <span className="text-[10px] font-semibold text-emerald-800 mr-auto tabular-nums whitespace-nowrap">
                  {fmtDecimalHours(projSecs)} / {fmtDuration(projSecs)}
                  {projMins !== projMinsRaw && (
                    <span className="text-emerald-600 ml-1">(→ {projMins}m)</span>
                  )}
                </span>
                <CopyButton buildText={buildProjectDescription} />
                <button
                  onClick={() => onMarkManuallyLogged(date)}
                  className={[
                    "shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold border transition-colors",
                    manuallyLogged ? "bg-emerald-600 border-emerald-600 text-white" : "bg-white border-gray-200 text-gray-400 hover:border-emerald-400 hover:text-emerald-700",
                  ].join(" ")}
                >
                  {manuallyLogged ? "✓" : "Mark"}
                </button>
                <button
                  onClick={async () => { setLoggingKey(key); try { await onLogDay(date, a.project_sf_id, projMins, buildProjectDescription()); } finally { setLoggingKey(null); } }}
                  disabled={loggingKey === key || projMins === 0}
                  className={[
                    "shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold transition-colors border",
                    logged ? "bg-emerald-600 border-emerald-600 text-white"
                    : "bg-white border-emerald-400 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed",
                  ].join(" ")}
                >
                  {loggingKey === key ? "…" : logged ? "✓ Logged" : "Log"}
                </button>
              </div>
            </div>
          );
        })}

        {isDragOver && (
          <div className="rounded-lg border-2 border-dashed border-indigo-400 bg-indigo-50 py-1.5 text-center text-xs text-indigo-600 font-medium">
            Drop project or action item
          </div>
        )}
        {!hasProjects && !noProjectsConfigured && !isDragOver && (
          <p className="text-[10px] text-gray-400 text-center pb-1">Drop a project to log time</p>
        )}
      </div>
    </div>
  );
}

function LogTimePanel({
  accountName,
  visibleDays,
  events,
  eventAccountLinks,
  scheduledItems,
  weekStart,
  onExit,
}: {
  accountName: string;
  visibleDays: string[];
  events: CalendarEvent[];
  eventAccountLinks: Map<string, { accountName: string; accountId: number }>;
  scheduledItems: ScheduledItem[];
  weekStart: string;
  onExit: () => void;
}) {
  const lsKey = (suffix: string) => `logtime::${accountName}::${suffix}`;
  function lsGet<T>(suffix: string, fallback: T): T {
    try { const v = localStorage.getItem(lsKey(suffix)); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; }
  }
  function lsSet(suffix: string, value: unknown) {
    try { localStorage.setItem(lsKey(suffix), JSON.stringify(value)); } catch { /* quota */ }
  }

  const [projects, setProjects] = useState<SalesforceProject[]>([]);
  const [assignments, setAssignments] = useState<LogTimeDayAssignment[]>(() => lsGet<LogTimeDayAssignment[]>("pseudoAssignments", []));
  const [allActionItems, setAllActionItems] = useState<AirtableActionItem[]>([]);
  // Own fetch of calendar events for this week so we always have work_tracking records
  // regardless of what week the main calendar is currently displaying.
  const [weekEvents, setWeekEvents] = useState<CalendarEvent[]>(events);

  // Map "${date}::${airtableId}" → seconds for items already synced to Google (DB-backed work_tracking).
  // These don't have a localStorage ScheduledItem, so secsForItem/secsForDay can't get their duration
  // from scheduledItems — they use this map instead, matching what the calendar tile shows.
  const syncedItemDurations = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of weekEvents) {
      if (e.calendar_id === "work_tracking" && e.agentpm_airtable_id) {
        const secs = Math.max(0, (new Date(e.end_datetime).getTime() - new Date(e.start_datetime).getTime()) / 1000);
        if (secs > 0) m.set(`${e.start_datetime.slice(0, 10)}::${e.agentpm_airtable_id}`, secs);
      }
    }
    return m;
  }, [weekEvents]);
  const [loggedDays, setLoggedDays] = useState<Set<string>>(() => new Set(lsGet<string[]>("loggedDays", [])));
  const [dragProjectId, setDragProjectId] = useState<string | null>(null);
  const [weekLogState, setWeekLogState] = useState<"idle" | "logging" | "done">("idle");
  const [manuallyLoggedDays, setManuallyLoggedDays] = useState<Set<string>>(() => new Set(lsGet<string[]>("manuallyLoggedDays", [])));
  const [timeOverrides, setTimeOverrides] = useState<Record<string, number>>(() => lsGet("timeOverrides", {}));
  const [pinnedItems, setPinnedItems] = useState<Record<string, string[]>>(() => lsGet("pinnedItems", {}));
  const [itemAssignments, setItemAssignments] = useState<Record<string, number>>(() => lsGet("itemAssignments", {}));

  const ADMIN_PROJECT_DESCRIPTIONS: Record<string, string> = {
    "Manager Tasks": "Managers / Team Leads Only: Resource/capacity planning, development planning and tracking, 1:1's, HR issues, employee coaching, customer project support and review, etc",
    "General Business Tasks": "General business overhead tasks such as non customer related emails, Workday peer reviews, writing GCS Newsletter stories, travel to customer visits. (Please add a \"Comment\").\n\nLogging your time to Cloud Coach should be logged as a General Business Task, however the time that you're entering into the timesheet (like customer work) should be categorized accordingly.",
    "Presales Support": "Participating in a pre-sales call, work on customer SoW, effort estimates, technical presales discussions",
    "Industry Thought Leadership": "Subject Matter Expert initiatives such as preparing for and attending Signal, attending job related conferences, taking an online learning course, writing a whitepaper or blog post, serving as Product Liaison",
    "Training": "Preparing, giving and/or receiving Twilio specific training. e.g. new hire training, Shadowing, QEP's, etc.",
    "Internal Meetings": "All Hands, 1:1 with your manager or other Twilion and team status meetings, PS offsites and meetings",
    "OOO/Vacation/PTO": "PTO, corporate holidays, bereavement leave or out sick",
    "ERG/Volunteer": "Time spent focused on volunteer efforts and/or ERG events and initiatives",
    "Partner Enablement/Assist": "Non project related work to enable or help our partners",
    "Practice Development": "Internal Projects, COE, developing and enhancing services offerings, developing marketing content, creating reusable assets, writing/assembling customer stories",
    "Recruiting / Hiring": "Recruiting, prepping, conducting or submitting notes for interviews",
  };

  const ADMIN_DEFAULT_PROJECTS: SalesforceProject[] = [
    "ERG/Volunteer",
    "General Business Tasks",
    "Industry Thought Leadership",
    "Internal Meetings",
    "Manager Tasks",
    "OOO/Vacation/PTO",
    "Partner Enablement/Assist",
    "Practice Development",
    "Presales Support",
    "Recruiting / Hiring",
    "Training",
  ].map((name, i) => ({
    id: -(i + 1),
    sf_id: `admin-pseudo-${i}`,
    name,
    description: ADMIN_PROJECT_DESCRIPTIONS[name] ?? "",
    status: "",
    account_name: "Admin",
    owner_sf_id: "",
    members: [],
    tasks: [],
  } as unknown as SalesforceProject));

  useEffect(() => {
    if (accountName.toLowerCase() === "admin") {
      setProjects(ADMIN_DEFAULT_PROJECTS);
      airtableApi.listActionItems()
        .then(({ data }) => setAllActionItems(data))
        .catch(() => {});
      return;
    }
    // Fetch SF projects and local account projects in parallel; merge results
    const sfPromise = salesforceApi.listProjects({ account_name: accountName })
      .then(({ data }) => data.results)
      .catch((): SalesforceProject[] => []);
    const localPromise = accountsApi.listProjectsByAccount(accountName)
      .then(({ data }) => data.results.map((p, i) => ({
        id: -(p.id + 10000),
        sf_id: `local-${p.id}`,
        name: p.name,
        description: p.description,
        status: "active",
        account: null,
        account_name: accountName,
        owner_name: "",
        start_date: null,
        end_date: null,
        owner_sf_id: "",
        members: [],
        tasks: [],
      } as SalesforceProject)))
      .catch((): SalesforceProject[] => []);
    Promise.all([sfPromise, localPromise]).then(([sfProjects, localProjects]) => {
      setProjects([...sfProjects, ...localProjects]);
    });
    airtableApi.listActionItems()
      .then(({ data }) => setAllActionItems(data))
      .catch(() => {});
  }, [accountName]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!weekStart) return;
    const pseudo = lsGet<LogTimeDayAssignment[]>("pseudoAssignments", []);
    salesforceApi.listDayAssignments(weekStart)
      .then(({ data }) => setAssignments([...data, ...pseudo.filter((p) => p.id < 0)]))
      .catch(() => { setAssignments(pseudo.filter((p) => p.id < 0)); });
  }, [weekStart, accountName]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch the full week's calendar events independently so work_tracking items from
  // last week are present even when the main calendar view is on a different week.
  useEffect(() => {
    if (!weekStart) return;
    const weekEnd = (() => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + 7);
      return d.toISOString();
    })();
    schedulerApi.listEvents({ start: weekStart, end: weekEnd })
      .then(({ data }) => setWeekEvents(data))
      .catch(() => {});
  }, [weekStart]);

  const days = visibleDays.slice(0, 5);

  const isAdmin = accountName.toLowerCase() === "admin";

  // Build per-day item lists: calendar events + scheduled (dragged) action items + pinned items
  function dayCalEvents(date: string): CalendarEvent[] {
    return weekEvents.filter((e) => {
      if (e.start_datetime.slice(0, 10) !== date) return false;
      if (e.calendar_id === "work_tracking") return false;
      // eventAccountLinks covers in-session links not yet saved to DB
      const link = (e.google_event_id ? eventAccountLinks.get(e.google_event_id) : undefined)
        ?? eventAccountLinks.get(String(e.id));
      if (link) return link.accountName === accountName;
      // Fall back to the DB-stored account_name on the event itself
      return e.account_name === accountName;
    });
  }

  function dayActionItems(date: string): AirtableActionItem[] {
    // 1. Items dragged from the sidebar onto the calendar (localStorage), scoped to this account
    const scheduledIds = new Set(
      scheduledItems
        .filter((s) => s.start.slice(0, 10) === date && (isAdmin || s.accountName === accountName))
        .map((s) => s.airtableId)
    );
    // 2. Items manually dragged into the log time day column (already account-scoped via lsKey)
    const pinned = new Set(pinnedItems[date] ?? []);
    // 3. Synced work_tracking calendar events for this day — these are action items
    //    that were pushed to Google and have an agentpm_airtable_id.
    //    Uses weekEvents (own fetch) so last week's items are present even when
    //    the main calendar is displaying a different week.
    const syncedIds = new Set(
      weekEvents
        .filter((e) =>
          e.calendar_id === "work_tracking" &&
          !!e.agentpm_airtable_id &&
          e.start_datetime.slice(0, 10) === date
        )
        .map((e) => e.agentpm_airtable_id as string)
    );
    const allIds = new Set([...scheduledIds, ...pinned, ...syncedIds]);
    // Filter by ID match AND account — admin sees all, others see only their account's items
    return allActionItems.filter((i) =>
      allIds.has(i.airtable_id) && (isAdmin || i.account_name === accountName)
    );
  }

  function itemSecs(date: string, i: AirtableActionItem): number {
    const key = `${date}::i::${i.airtable_id}`;
    if (timeOverrides[key] !== undefined) return timeOverrides[key];
    const slot = scheduledItems.find((s) => s.airtableId === i.airtable_id && s.start.slice(0, 10) === date);
    if (slot) {
      const slotSecs = (new Date(slot.end).getTime() - new Date(slot.start).getTime()) / 1000;
      if (slotSecs > 0) return slotSecs;
    }
    const synced = syncedItemDurations.get(`${date}::${i.airtable_id}`);
    if (synced !== undefined && synced > 0) return synced;
    const actual = (i.time_spent ?? 0) + (i.prep_time ?? 0);
    return actual > 0 ? actual : (i.estimated_time ?? 0);
  }

  function secsForDay(date: string): number {
    const evSecs = dayCalEvents(date).reduce((s, e) => {
      const key = `${date}::e::${e.id}`;
      return s + (timeOverrides[key] !== undefined ? timeOverrides[key] : Math.max(0, (new Date(e.end_datetime).getTime() - new Date(e.start_datetime).getTime()) / 1000));
    }, 0);
    return evSecs + dayActionItems(date).reduce((s, i) => s + itemSecs(date, i), 0);
  }

  function secsForProject(date: string, assignmentId: number): number {
    const dayAssignments = assignmentsForDay(date);
    const multiProject = dayAssignments.length > 1;
    const evts = multiProject
      ? dayCalEvents(date).filter((e) => itemAssignments[`${date}::e::${e.id}`] === assignmentId)
      : dayCalEvents(date);
    const items = multiProject
      ? dayActionItems(date).filter((i) => itemAssignments[`${date}::i::${i.airtable_id}`] === assignmentId)
      : dayActionItems(date);
    const evSecs = evts.reduce((s, e) => {
      const key = `${date}::e::${e.id}`;
      return s + (timeOverrides[key] !== undefined ? timeOverrides[key] : Math.max(0, (new Date(e.end_datetime).getTime() - new Date(e.start_datetime).getTime()) / 1000));
    }, 0);
    return evSecs + items.reduce((s, i) => s + itemSecs(date, i), 0);
  }

  function assignmentsForDay(date: string) {
    const projectIds = new Set(projects.map((p) => p.id));
    return assignments.filter((a) => a.date === date && projectIds.has(a.project));
  }

  function handleOverrideChange(key: string, secs: number) {
    setTimeOverrides((prev) => { const next = { ...prev, [key]: secs }; lsSet("timeOverrides", next); return next; });
  }

  function handlePinItem(date: string, airtableId: string) {
    setPinnedItems((prev) => {
      const existing = prev[date] ?? [];
      if (existing.includes(airtableId)) return prev;
      const next = { ...prev, [date]: [...existing, airtableId] };
      lsSet("pinnedItems", next);
      return next;
    });
  }

  function handleAssignItem(itemKey: string, assignmentId: number | null) {
    setItemAssignments((prev) => {
      const next = { ...prev };
      if (assignmentId === null) { delete next[itemKey]; } else { next[itemKey] = assignmentId; }
      lsSet("itemAssignments", next);
      return next;
    });
  }

  // Negative project IDs are pseudo-projects (Admin account) — no backend record exists
  const pseudoAssignmentIdRef = useRef(
    // Seed below the lowest already-persisted pseudo ID so we never reuse one
    Math.min(-1, ...lsGet<LogTimeDayAssignment[]>("pseudoAssignments", []).map((a) => a.id)) - 1
  );

  function savePseudoAssignments(next: LogTimeDayAssignment[]) {
    lsSet("pseudoAssignments", next.filter((a) => a.id < 0));
  }

  async function handleAddProject(date: string, project: SalesforceProject) {
    if (project.id < 0) {
      setAssignments((prev) => {
        if (prev.some((a) => a.date === date && a.project === project.id)) return prev;
        const synth: LogTimeDayAssignment = {
          id: pseudoAssignmentIdRef.current--,
          date,
          project: project.id,
          project_sf_id: project.sf_id,
          project_name: project.name,
          position: prev.length,
        };
        const next = [...prev, synth];
        savePseudoAssignments(next);
        return next;
      });
      return;
    }
    try {
      const { data } = await salesforceApi.addDayAssignment(date, project.id);
      setAssignments((prev) => prev.some((a) => a.date === date && a.project === project.id) ? prev : [...prev, data]);
    } catch { /* best effort */ }
  }

  async function handleRemoveProject(date: string, assignment: LogTimeDayAssignment) {
    if (assignment.id < 0) {
      setAssignments((prev) => {
        const next = prev.filter((a) => a.id !== assignment.id);
        savePseudoAssignments(next);
        return next;
      });
      return;
    }
    try {
      await salesforceApi.removeDayAssignment(date, assignment.project);
      setAssignments((prev) => prev.filter((a) => a.id !== assignment.id));
    } catch { /* best effort */ }
  }

  async function handleLogDay(date: string, projectSfId: string, minutes: number, description: string) {
    if (minutes <= 0) return;
    if (!projectSfId.startsWith("local-") && !projectSfId.startsWith("admin-pseudo-")) {
      await salesforceApi.logTime({ project_sf_id: projectSfId, date, duration_minutes: minutes, description });
    }
    setLoggedDays((prev) => { const next = new Set([...prev, `${date}::${projectSfId}`]); lsSet("loggedDays", [...next]); return next; });
  }

  async function handleLogWeek() {
    setWeekLogState("logging");
    try {
      const promises: Promise<void>[] = [];
      for (const date of days) {
        const dayAssignments = assignmentsForDay(date);
        const multi = dayAssignments.length > 1;
        for (const a of dayAssignments) {
          const key = `${date}::${a.project_sf_id}`;
          if (loggedDays.has(key)) continue;
          const projSecs = secsForProject(date, a.id);
          const totalMins = roundUpToQuarterHour(Math.round(projSecs / 60));
          if (totalMins <= 0) continue;
          const projEvents = multi
            ? dayCalEvents(date).filter((e) => itemAssignments[`${date}::e::${e.id}`] === a.id)
            : dayCalEvents(date);
          const projItems = multi
            ? dayActionItems(date).filter((i) => itemAssignments[`${date}::i::${i.airtable_id}`] === a.id)
            : dayActionItems(date);
          const lines: string[] = [
            ...projEvents.map((e) => e.title),
            ...projItems.map((i) => i.task),
            `Total: ${fmtDecimalHours(projSecs)} hrs`,
          ];
          promises.push(handleLogDay(date, a.project_sf_id, totalMins, lines.join("\n")));
        }
      }
      await Promise.all(promises);
      setWeekLogState("done");
      setTimeout(() => setWeekLogState("idle"), 3000);
    } catch {
      setWeekLogState("idle");
    }
  }

  // Week summary totals per project (using overrides)
  const projectTotals: Record<string, { name: string; secs: number }> = {};
  for (const date of days) {
    for (const a of assignmentsForDay(date)) {
      if (!projectTotals[a.project_sf_id]) projectTotals[a.project_sf_id] = { name: a.project_name, secs: 0 };
      projectTotals[a.project_sf_id].secs += secsForProject(date, a.id);
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 shadow-sm overflow-hidden">
      {/* Panel header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-white gap-4">
        <div className="min-w-0">
          <p className="text-sm font-bold text-[var(--twilio-navy)]">Log Time to Salesforce — {accountName}</p>
          <p className="text-xs text-gray-500">Drag a project onto a day, then log time</p>
          {accountName.toLowerCase() === "admin" && (
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <a
                href="https://docs.google.com/document/d/1875fhJatKUfZqcxkR91ao-D5bCmhHkoVOkLDWuCM2GE/edit?tab=t.0#heading=h.ootjszwuii3h"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:underline font-medium"
              >
                <img src="https://www.google.com/s2/favicons?sz=16&domain=docs.google.com" alt="" className="w-3 h-3" />
                Reference Guide: Project vs. Admin Time
              </a>
              <a
                href="https://docs.google.com/document/d/1X8P7KY_7DwJBvgk-JWgoa_KhwSKQzAdp5hc_O5UCbxI/edit?tab=t.0#heading=h.hyzdaoxe2nui"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:underline font-medium"
              >
                <img src="https://www.google.com/s2/favicons?sz=16&domain=docs.google.com" alt="" className="w-3 h-3" />
                Logging Project Time (Customer time, billable and non-billable)
              </a>
            </div>
          )}
        </div>
        <button
          onClick={onExit}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors shrink-0"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-3 h-3">
            <path d="M3 3l10 10M13 3L3 13"/>
          </svg>
          Exit Log Time
        </button>
      </div>

      {/* Available projects — grid that wraps at 2 or 3 per row */}
      <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
        {projects.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No projects linked to this account — items are grouped automatically in each day column</p>
        ) : (
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
            {projects.map((p) => {
              const desc = ADMIN_PROJECT_DESCRIPTIONS[p.name];
              return (
                <div
                  key={p.id}
                  draggable
                  title={desc}
                  onDragStart={(e) => { e.dataTransfer.setData("logTimeProjectId", String(p.id)); setDragProjectId(String(p.id)); }}
                  onDragEnd={() => setDragProjectId(null)}
                  className={[
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold border cursor-grab select-none transition-all",
                    dragProjectId === String(p.id)
                      ? "opacity-40 scale-95 bg-emerald-100 border-emerald-400 text-emerald-800"
                      : "bg-white border-emerald-300 text-emerald-800 hover:bg-emerald-50 shadow-sm",
                  ].join(" ")}
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 text-emerald-500 shrink-0">
                    <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM14 11a1 1 0 011 1v1h1a1 1 0 110 2h-1v1a1 1 0 11-2 0v-1h-1a1 1 0 110-2h1v-1a1 1 0 011-1z"/>
                  </svg>
                  <span className="break-words min-w-0">{p.name}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 5 day columns */}
      <div className="flex gap-3 p-4">
        {days.map((date) => (
          <LogTimeDayColumn
            key={date}
            date={date}
            dayCalEvents={dayCalEvents(date)}
            dayItems={dayActionItems(date)}
            scheduledItems={scheduledItems}
            syncedItemDurations={syncedItemDurations}
            projects={projects}
            assignments={assignmentsForDay(date)}
            timeOverrides={timeOverrides}
            itemAssignments={itemAssignments}
            onOverrideChange={handleOverrideChange}
            onAddProject={handleAddProject}
            onRemoveProject={handleRemoveProject}
            onPinItem={handlePinItem}
            onAssignItem={handleAssignItem}
            onLogDay={handleLogDay}
            loggedDays={loggedDays}
            manuallyLogged={manuallyLoggedDays.has(date)}
            onMarkManuallyLogged={(d) => setManuallyLoggedDays((prev) => {
              const next = new Set(prev);
              if (next.has(d)) next.delete(d); else next.add(d);
              lsSet("manuallyLoggedDays", [...next]);
              window.dispatchEvent(new StorageEvent("storage", { key: LOGGED_DATES_EVENT }));
              return next;
            })}
          />
        ))}
        {days.length === 0 && (
          <p className="text-sm text-gray-400 px-2 py-6">Navigate the calendar to a week to see days here.</p>
        )}
      </div>

      {/* Week summary footer */}
      <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200 bg-white gap-4 flex-wrap">
        <div className="flex items-center gap-4 flex-wrap">
          {Object.entries(projectTotals).map(([sfId, { name, secs }]) => (
            <span key={sfId} className="text-xs text-gray-600">
              <span className="font-semibold text-[var(--twilio-navy)]">{name}</span>
              {" "}Total: {fmtDecimalHours(secs)} / {fmtDuration(secs)}
            </span>
          ))}
          {Object.keys(projectTotals).length === 0 && (
            <span className="text-xs text-gray-400">Assign projects to days to see totals</span>
          )}
        </div>
        <button
          onClick={() => void handleLogWeek()}
          disabled={weekLogState === "logging" || Object.keys(projectTotals).length === 0}
          className={[
            "shrink-0 rounded-xl px-5 py-2 text-sm font-semibold transition-colors",
            weekLogState === "done"
              ? "bg-emerald-600 text-white"
              : "bg-[var(--twilio-navy)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed",
          ].join(" ")}
        >
          {weekLogState === "logging" ? "Logging…" : weekLogState === "done" ? "✓ Week Logged" : "Log Week"}
        </button>
      </div>
    </div>
  );
}

type ContentView = "all" | "meetings" | "action-items" | "reminders" | "accounts";

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [meetingPanelCollapsed, setMeetingPanelCollapsed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showWeekends, setShowWeekends] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [itemsPanelOpen, setItemsPanelOpen] = useState(() => sessionStorage.getItem("calItemsPanelOpen") === "true");
  const [itemsTab, setItemsTab] = useState<"action-items" | "reminders">("action-items");

  const [expandActionItemId, setExpandActionItemId] = useState<string | null>(null);
  const [selectedActionItem, setSelectedActionItem] = useState<AirtableActionItem | null>(null);

  function openItemsPanel(tab: "action-items" | "reminders", expandId?: string) {
    setItemsTab(tab);
    setItemsPanelOpen(true);
    sessionStorage.setItem("calItemsPanelOpen", "true");
    if (expandId) setExpandActionItemId(expandId);
  }
  const [contentView, setContentView] = useState<ContentView>("all");
  // Right-click context menu for work-tracking events
  const [ctxMenu, setCtxMenu] = useState<{
    x: number; y: number;
    airtableId: string;
    type: "scheduled" | "timer" | "db-work" | "meeting";
    event: CalendarEvent;
  } | null>(null);
  // Drag-to-create modal
  const [newEventDraft, setNewEventDraft] = useState<{
    start: string; end: string; title: string; type: "meeting" | "action-item";
    accountQuery: string;
    selectedAccount: { id: number; name: string } | null;
    accountResults: { id: number; name: string }[];
  } | null>(null);
  const [newEventSaving, setNewEventSaving] = useState(false);
  // Pending reschedule that needs attendee confirmation before committing
  const [pendingReschedule, setPendingReschedule] = useState<{
    ev: CalendarEvent;
    newStart: string;
    newEnd: string;
    revert: () => void;
  } | null>(null);
  const allAccountsRef = useRef<{ id: number; name: string }[]>([]);
  const [selectedAccountName, setSelectedAccountName] = useState<string | null>(null);
  const [logTimeModeAccount, setLogTimeModeAccount] = useState<string | null>(null);
  // Set of google_event_ids the user has marked as "did not attend"
  const [absentEventIds, setAbsentEventIds] = useState<Set<string>>(new Set());
  // Visible date range (ISO strings) tracked for daily totals footer
  const [visibleRange, setVisibleRange] = useState<{ start: string; end: string } | null>(null);
  // Extra events synthesized for the accounts view (Airtable meetings)
  const [accountMeetingEvents, setAccountMeetingEvents] = useState<CalendarEvent[]>([]);

  // Map from google_event_id → linked account info
  const [eventAccountLinks, setEventAccountLinks] = useState<Map<string, { accountName: string; accountId: number }>>(new Map());
  const [lastLinkedEventName, setLastLinkedEventName] = useState<string | null>(null);
  // Incremented after a successful account link so MeetingDetail re-fetches
  const [meetingDetailReloadTrigger, setMeetingDetailReloadTrigger] = useState(0);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  // Stable ref so eventDidMount closures never go stale
  const linkEventToAccountRef = useRef<(accountId: number, accountName: string, eventUid: string) => void>(() => {});
  const pageRef = useRef<HTMLDivElement>(null);
  const eventsRef = useRef<CalendarEvent[]>([]);
  // Set to true during optimistic drag/resize updates so fetchEvents doesn't clobber them
  const localMutationRef = useRef(false);
  const { openComments } = useCommentContext();
  useLogGlow(pageRef);

  // Scheduled action items dragged onto the calendar (persisted in localStorage)
  const [scheduledItems, setScheduledItems] = useState<ScheduledItem[]>(() => readScheduledItems());
  // Scheduled reminders dragged onto the calendar
  const [scheduledReminders, setScheduledReminders] = useState<ScheduledReminder[]>(() => readScheduledReminders());
  // Live running timers broadcast from ActionItemsPage
  const [activeTimers, setActiveTimers] = useState<Record<string, { startedAt: number; elapsed: number; task: string; accountName: string | null }>>(() => {
    try { return JSON.parse(localStorage.getItem("activeTimers") ?? "{}"); } catch { return {}; }
  });

  useEffect(() => {
    teamApi.getMyProfile().then(({ data }) => {
      setUserEmail(data.google_account_email || data.email || null);
    }).catch(() => {});
  }, []);

  // Eagerly load all accounts on mount so auto-linking works on the first drop
  useEffect(() => {
    if (allAccountsRef.current.length > 0) return;
    Promise.all([airtableApi.listAccounts(), accountsApi.listAccounts()])
      .then(([atRes, appRes]) => {
        const atAccounts = (atRes.data.results as AirtableAccount[]).map((a) => ({ id: a.id, name: a.name }));
        const atNames = new Set(atAccounts.map((a) => a.name?.toLowerCase()));
        const appOnly = (appRes.data.results as { id: number; company_name: string }[])
          .filter((a) => !atNames.has(a.company_name?.toLowerCase()))
          .map((a) => ({ id: a.id, name: a.company_name }));
        allAccountsRef.current = [...atAccounts, ...appOnly].sort((a, b) => a.name.localeCompare(b.name));
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // On mount: prune stale activeTimers whose backing action item no longer exists in any status
  useEffect(() => {
    airtableApi.listActionItems({ status: "Open,In Progress,Blocked,Backlogged,Complete" }).then(({ data }) => {
      const liveIds = new Set((data as AirtableActionItem[]).map((i) => i.airtable_id));
      // Prune activeTimers
      try {
        const timers: Record<string, unknown> = JSON.parse(localStorage.getItem("activeTimers") ?? "{}");
        const pruned = Object.fromEntries(Object.entries(timers).filter(([id]) => liveIds.has(id)));
        if (Object.keys(pruned).length !== Object.keys(timers).length) {
          localStorage.setItem("activeTimers", JSON.stringify(pruned));
          setActiveTimers(pruned as Record<string, { startedAt: number; elapsed: number; task: string; accountName: string | null }>);
          window.dispatchEvent(new StorageEvent("storage", { key: "activeTimers", newValue: JSON.stringify(pruned) }));
        }
      } catch { /* best effort */ }
      // Prune scheduledActionItems — remove entries whose airtableId no longer exists
      try {
        const scheduled = readScheduledItems();
        const pruned = scheduled.filter((s) => liveIds.has(s.airtableId));
        if (pruned.length !== scheduled.length) {
          localStorage.setItem(SCHEDULED_ITEMS_KEY, JSON.stringify(pruned));
          setScheduledItems(pruned);
          window.dispatchEvent(new StorageEvent("storage", { key: SCHEDULED_ITEMS_KEY, newValue: JSON.stringify(pruned) }));
        }
      } catch { /* best effort */ }
    }).catch(() => {});
    // Prune scheduledReminders against live reminder IDs from the API
    schedulerApi.listReminders({ page_size: "500" }).then(({ data }) => {
      const liveIds = new Set((data.results ?? []).map((r) => r.id));
      try {
        const scheduled = readScheduledReminders();
        const pruned = scheduled.filter((s) => liveIds.has(s.reminderId));
        if (pruned.length !== scheduled.length) {
          localStorage.setItem(SCHEDULED_REMINDERS_KEY, JSON.stringify(pruned));
          setScheduledReminders(pruned);
          window.dispatchEvent(new StorageEvent("storage", { key: SCHEDULED_REMINDERS_KEY, newValue: JSON.stringify(pruned) }));
        }
      } catch { /* best effort */ }
    }).catch(() => {});
  }, []);

  const [loggedDates, setLoggedDates] = useState<Set<string>>(() => readLoggedDates());

  // Sync scheduled items + active timers from localStorage (updated by ActionItemsPage)
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === SCHEDULED_ITEMS_KEY) setScheduledItems(readScheduledItems());
      if (e.key === SCHEDULED_REMINDERS_KEY) setScheduledReminders(readScheduledReminders());
      if (e.key === "activeTimers") {
        try { setActiveTimers(JSON.parse(e.newValue ?? "{}")); } catch { /* ignore */ }
      }
      if (e.key === LOGGED_DATES_EVENT) setLoggedDates(readLoggedDates());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Proactively load event-account links for the past 3 weeks so faded backgrounds
  // appear correctly on marked days even before the user navigates to that week.
  useEffect(() => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 21);
    schedulerApi.listEvents({ start: start.toISOString(), end: end.toISOString() })
      .then(({ data }) => {
        const uids = (data as CalendarEvent[]).map((e) => e.google_event_id).filter(Boolean) as string[];
        if (!uids.length) return;
        airtableApi.batchEventLinks(uids)
          .then(({ data: byUid }) => {
            setEventAccountLinks((prev) => {
              const next = new Map(prev);
              for (const [uid, d] of Object.entries(byUid)) {
                if (d.linked && d.account_name) next.set(uid, { accountId: d.airtable_account_id!, accountName: d.account_name! });
              }
              return next;
            });
          })
          .catch(() => {});
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Tick activeTimers every second so live events update their end time
  useEffect(() => {
    const hasRunning = Object.keys(activeTimers).length > 0;
    if (!hasRunning) return;
    const id = setInterval(() => setActiveTimers((prev) => ({ ...prev })), 1000);
    return () => clearInterval(id);
  }, [activeTimers]);

  // Close context menu on Escape
  useEffect(() => {
    if (!ctxMenu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setCtxMenu(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ctxMenu]);

  const fetchEvents = useCallback(
    async (start: string, end: string, { bustCache = false }: { bustCache?: boolean } = {}) => {
      try {
        // Serve from session cache when available (avoids Google API calls on
        // week-navigation and page returns). Cache is busted after a manual sync.
        const cached = bustCache ? null : readEventCache(start, end);
        let data: CalendarEvent[];
        if (cached) {
          data = cached;
        } else {
          const resp = await schedulerApi.listEvents({ start, end });
          data = resp.data;
          writeEventCache(start, end, data);
        }
        // Skip overwriting events when a local drag/resize mutation is in-flight
        if (!localMutationRef.current) {
          setEvents(data);
          eventsRef.current = data;
        }
        // Bulk-load account links for all events in this range (always — cached events
        // still need their account names loaded since eventAccountLinks is not persisted).
        // Include numeric DB IDs as fallback UIDs for events without a google_event_id,
        // since links may have been saved under the numeric ID before Google sync assigned one.
        const uids = [
          ...new Set(
            (data as CalendarEvent[]).flatMap((e) =>
              [e.google_event_id, e.id ? String(e.id) : ""].filter(Boolean)
            )
          )
        ] as string[];
        if (uids.length > 0) {
          airtableApi.batchEventLinks(uids)
            .then(({ data: byUid }) => {
              setEventAccountLinks((prev) => {
                const next = new Map(prev);
                for (const [uid, d] of Object.entries(byUid)) {
                  if (d.linked && d.airtable_account_id && d.account_name) {
                    next.set(uid, { accountId: d.airtable_account_id!, accountName: d.account_name! });
                    // Also index under the other key (google_event_id ↔ numeric id) so
                    // lookups work regardless of which key was used when the link was saved.
                    const ev = (data as CalendarEvent[]).find(
                      (e) => e.google_event_id === uid || String(e.id) === uid
                    );
                    if (ev) {
                      if (ev.google_event_id && ev.google_event_id !== uid)
                        next.set(ev.google_event_id, { accountId: d.airtable_account_id!, accountName: d.account_name! });
                      if (String(ev.id) !== uid)
                        next.set(String(ev.id), { accountId: d.airtable_account_id!, accountName: d.account_name! });
                    }
                  }
                }
                return next;
              });
            })
            .catch(() => {});
        }
      } catch {
        // Silently degrade — calendar shows empty.
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const [currentView, setCurrentView] = useState<string>("timeGridWeek");

  const handleDatesSet = useCallback(
    (info: { startStr: string; endStr: string; view: { type: string } }) => {
      void fetchEvents(info.startStr, info.endStr);
      setVisibleRange({ start: info.startStr, end: info.endStr });
      setCurrentView(info.view.type);
    },
    [fetchEvents]
  );

  // Keep the event cache in sync with any local mutations (resize, drop, delete).
  // This ensures that navigating away and back shows the latest state rather than
  // re-fetching from the server for data the user already has.
  useEffect(() => {
    if (visibleRange && events.length > 0) {
      writeEventCache(visibleRange.start, visibleRange.end, events);
    }
  }, [events, visibleRange]);

  const handleEventClick = useCallback(
    (info: EventClickArg) => {
      const extProps = info.event.extendedProps as CalendarEvent;
      const isToggleOff = (prev: CalendarEvent | null) => prev?.google_event_id === extProps.google_event_id && prev?.id === extProps.id;
      setSelectedEvent((prev) => {
        const next = isToggleOff(prev) ? null : extProps;
        if (next && (!prev || prev.id !== extProps.id)) setMeetingPanelCollapsed(false);
        return next;
      });

      const uid = extProps.google_event_id ?? "";

      // Scheduled action item — fetch the backing Airtable record for inline edit
      const isLocalScheduledAI = uid.startsWith("scheduled-") && !uid.startsWith("scheduled-reminder-");
      const isDbBackedWorkAI = extProps.calendar_id === "work_tracking" && !!extProps.agentpm_airtable_id && extProps.is_synced;
      const isScheduledAI = isLocalScheduledAI || isDbBackedWorkAI;
      if (isScheduledAI) {
        let airtableId: string;
        if (isDbBackedWorkAI) {
          airtableId = extProps.agentpm_airtable_id;
        } else {
          const body = uid.slice("scheduled-".length);
          const sep = body.lastIndexOf("__");
          airtableId = sep === -1 ? body : body.slice(0, sep);
        }
        airtableApi.listActionItems({ status: "Open,In Progress,Blocked,Backlogged,Complete" })
          .then(({ data }) => {
            const found = (data as AirtableActionItem[]).find((i) => i.airtable_id === airtableId) ?? null;
            setSelectedActionItem(found);
          })
          .catch(() => setSelectedActionItem(null));
      } else {
        setSelectedActionItem(null);
      }

      // Look up account link. For meetings without a google_event_id yet, also try numeric id.
      const lookupUid = extProps.google_event_id || String(extProps.id);
      if (lookupUid && extProps.calendar_id !== "work_tracking") {
        airtableApi.getEventLink(lookupUid).then(({ data }) => {
          if (data.linked && data.airtable_account_id && data.account_name) {
            setEventAccountLinks((prev) => {
              const next = new Map(prev);
              next.set(lookupUid, { accountId: data.airtable_account_id!, accountName: data.account_name! });
              // Also index by the other key so whichever arrives first wins
              if (extProps.google_event_id && lookupUid !== extProps.google_event_id)
                next.set(extProps.google_event_id, { accountId: data.airtable_account_id!, accountName: data.account_name! });
              return next;
            });
          }
        }).catch(() => {});
      }
    },
    []
  );

  const linkEventToAccount = useCallback(async (accountId: number, accountName: string, eventUid?: string) => {
    const uid = eventUid
      ?? (selectedEvent?.google_event_id || (selectedEvent?.id ? String(selectedEvent.id) : undefined));
    if (!uid) return;
    // Find the event so we can store the link under both google_event_id and numeric id
    const linkedEvent = events.find((e) => e.google_event_id === uid || String(e.id) === uid);
    // Optimistic update — store under all known keys for this event
    setEventAccountLinks((prev) => {
      const next = new Map(prev);
      next.set(uid, { accountId, accountName });
      if (linkedEvent?.google_event_id && linkedEvent.google_event_id !== uid) {
        next.set(linkedEvent.google_event_id, { accountId, accountName });
      }
      if (linkedEvent && String(linkedEvent.id) !== uid) {
        next.set(String(linkedEvent.id), { accountId, accountName });
      }
      return next;
    });
    // Find event title for toast — match by google_event_id or by numeric DB id
    const evTitle = linkedEvent?.title ?? accountName;
    setLastLinkedEventName(evTitle);
    setTimeout(() => setLastLinkedEventName(null), 2500);
    try {
      await airtableApi.categorizeEvent({ event_uid: uid, account_id: accountId });
      // Increment trigger so MeetingDetail re-fetches now that the DB is updated
      setMeetingDetailReloadTrigger((n) => n + 1);
      addLog({
        category: "calendar",
        message: `Account "${accountName}" linked to event "${evTitle}"`,
        links: [{ label: "View calendar", path: "/calendar?glow=1" }],
        ...(linkedEvent ? { resource: { type: "calendar_event" as const, id: linkedEvent.id } } : {}),
      });
    } catch {
      setEventAccountLinks((prev) => {
        const next = new Map(prev);
        next.delete(uid);
        return next;
      });
      setLastLinkedEventName(null);
    }
  }, [selectedEvent, events]);

  // Keep ref in sync so eventDidMount closures never stale
  useEffect(() => {
    linkEventToAccountRef.current = (accountId, accountName, eventUid) =>
      void linkEventToAccount(accountId, accountName, eventUid);
  }, [linkEventToAccount]);

  const unlinkEvent = useCallback(async (eventUid: string) => {
    setEventAccountLinks((prev) => {
      const next = new Map(prev);
      next.delete(eventUid);
      return next;
    });
    try {
      await airtableApi.categorizeEvent({ event_uid: eventUid, account_id: null });
    } catch { /* best effort */ }
  }, []);

  const handleDateSelect = useCallback((info: DateSelectArg) => {
    const start = info.startStr.includes("T") ? info.startStr.slice(0, 19) : `${info.startStr}T09:00:00`;
    const end = info.endStr.includes("T") ? info.endStr.slice(0, 19) : `${info.endStr}T10:00:00`;
    setNewEventDraft({ start: toLocalISO(start), end: toLocalISO(end), title: "", type: "meeting", accountQuery: "", selectedAccount: null, accountResults: [] });
    // Eagerly load accounts the first time the modal opens
    if (allAccountsRef.current.length === 0) {
      Promise.all([airtableApi.listAccounts(), accountsApi.listAccounts()])
        .then(([atRes, appRes]) => {
          const atAccounts = (atRes.data.results as AirtableAccount[]).map((a) => ({ id: a.id, name: a.name }));
          const atNames = new Set(atAccounts.map((a) => a.name?.toLowerCase()));
          const appOnly = (appRes.data.results as { id: number; company_name: string }[])
            .filter((a) => !atNames.has(a.company_name?.toLowerCase()))
            .map((a) => ({ id: a.id, name: a.company_name }));
          allAccountsRef.current = [...atAccounts, ...appOnly].sort((a, b) => a.name.localeCompare(b.name));
        })
        .catch(() => {});
    }
  }, []);

  const [dropToast, setDropToast] = useState<{ msg: string; type: "success" | "warn" } | null>(null);

  const handleCalendarDrop = useCallback((info: DropArg) => {
    const w = window as unknown as Record<string, string>;
    // Try window globals first, fall back to data-event on the dragged element
    let airtableId = w[CALENDAR_DRAG_KEY];
    let task = w[`${CALENDAR_DRAG_KEY}_task`] || airtableId;
    let accountName: string | null = w[`${CALENDAR_DRAG_KEY}_account`] || null;

    if (!airtableId) {
      // FC may have consumed the drop via data-event; read from the element
      try {
        const dataEvent = JSON.parse(info.draggedEl.getAttribute("data-event") ?? "{}");
        airtableId = dataEvent?.extendedProps?.airtableId;
        task = dataEvent?.title || airtableId;
        accountName = dataEvent?.extendedProps?.accountName || null;
      } catch { /* ignore */ }
    }
    if (!airtableId) return;

    delete w[CALENDAR_DRAG_KEY];
    delete w[`${CALENDAR_DRAG_KEY}_task`];
    delete w[`${CALENDAR_DRAG_KEY}_account`];

    const today = new Date().toISOString().slice(0, 10);
    const droppedDate = info.dateStr.slice(0, 10);
    if (droppedDate === today) {
      stageItemActive(airtableId);
    } else {
      try {
        const zones: Record<string, string> = JSON.parse(localStorage.getItem(ACTION_ITEM_ZONES_KEY) ?? "{}");
        zones[airtableId] = "today";
        localStorage.setItem(ACTION_ITEM_ZONES_KEY, JSON.stringify(zones));
        window.dispatchEvent(new StorageEvent("storage", { key: ACTION_ITEM_ZONES_KEY, newValue: JSON.stringify(zones) }));
      } catch { /* best effort */ }
    }

    // dateStr in timeGridWeek includes time; in dayGrid it's date-only — default to 9am
    const localStr = info.dateStr.includes("T") ? info.dateStr.slice(0, 19) : `${info.dateStr}T09:00:00`;
    const start = toLocalISO(localStr);
    const end = addMsToLocalISO(localStr, 15 * 60 * 1000);
    const saved = saveScheduledItem({ airtableId, task, accountName, start, end });

    if (saved) {
      const label = new Date(start).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      setDropToast({ msg: `Scheduled for ${label}`, type: "success" });
      addLog({
        category: "calendar",
        message: `"${task}" added to calendar for ${label}${accountName ? ` (${accountName})` : ""}`,
        links: [{ label: "View calendar", path: "/calendar" }],
        resource: { type: "action_item", id: airtableId },
      });
      // Auto-link the account so SF projects appear without a manual drag
      if (accountName && saved.uid) {
        const eventUid = `scheduled-${airtableId}__${start.slice(0, 16)}`;
        const match = allAccountsRef.current.find(
          (a) => a.name.toLowerCase() === accountName.toLowerCase()
        );
        if (match) {
          linkEventToAccountRef.current(match.id, match.name, eventUid);
        }
      }
    } else {
      setDropToast({ msg: "Already scheduled at that time", type: "warn" });
    }
    setTimeout(() => setDropToast(null), 3000);

    // Tell FC not to create its own event (we manage them via scheduledItems state)
    info.revert?.();
  }, []);

  // Parse "scheduled-{airtableId}__{startMin}" → { airtableId, startMin }
  function parseScheduledUid(uid: string): { airtableId: string; startMin: string } | null {
    if (!uid.startsWith("scheduled-")) return null;
    const body = uid.slice("scheduled-".length);
    const sep = body.lastIndexOf("__");
    if (sep === -1) return { airtableId: body, startMin: "" };
    return { airtableId: body.slice(0, sep), startMin: body.slice(sep + 2) };
  }

  // When a scheduled action item event is resized on the calendar, persist the new end time
  function updateScheduledReminderTime(uid: string, startStr: string, endStr: string): boolean {
    const body = uid.slice("scheduled-reminder-".length);
    const sep = body.lastIndexOf("__");
    const reminderId = parseInt(sep === -1 ? body : body.slice(0, sep), 10);
    const startMin = sep === -1 ? "" : body.slice(sep + 2);
    if (isNaN(reminderId)) return false;
    const items = readScheduledReminders();
    const idx = items.findIndex((r) =>
      r.reminderId === reminderId && (startMin === "" || r.start.slice(0, 16) === startMin)
    );
    if (idx === -1) return false;
    items[idx] = { ...items[idx], start: startStr, end: endStr };
    localStorage.setItem(SCHEDULED_REMINDERS_KEY, JSON.stringify(items));
    setScheduledReminders([...items]);
    window.dispatchEvent(new StorageEvent("storage", { key: SCHEDULED_REMINDERS_KEY, newValue: JSON.stringify(items) }));
    // Update the reminder's due_at in the backend
    const newDueAt = startStr.length === 16 ? `${startStr}:00` : startStr;
    schedulerApi.updateReminder(reminderId, { due_at: newDueAt }).catch(() => {});
    // Keep selectedEvent in sync if it's this reminder
    setSelectedEvent((prev) => {
      if (!prev || prev.google_event_id !== uid) return prev;
      return { ...prev, start_datetime: startStr, end_datetime: endStr };
    });
    return true;
  }

  // Apply a meeting reschedule directly to state + DB (used by both the immediate path
  // and the attendee-confirmation confirm button).
  const applyMeetingReschedule = useCallback((ev: CalendarEvent, newStart: string, newEnd: string, onFail?: () => void) => {
    const uid = ev.google_event_id ?? "";
    localMutationRef.current = true;
    setEvents((prev) => prev.map((e) => e.id === ev.id ? { ...e, start_datetime: newStart, end_datetime: newEnd } : e));
    setSelectedEvent((prev) => prev?.id === ev.id ? { ...prev, start_datetime: newStart, end_datetime: newEnd } : prev);
    schedulerApi.updateEvent(ev.id, { start_datetime: newStart, end_datetime: newEnd })
      .catch(() => {
        // Roll back optimistic update
        setEvents((prev) => prev.map((e) => e.id === ev.id ? { ...e, start_datetime: ev.start_datetime, end_datetime: ev.end_datetime } : e));
        setSelectedEvent((prev) => prev?.id === ev.id ? { ...prev, start_datetime: ev.start_datetime, end_datetime: ev.end_datetime } : prev);
        onFail?.();
      })
      .finally(() => { localMutationRef.current = false; });
    // Bust cache so next navigation reflects the updated time
    if (uid) bustEventCache();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEventResize = useCallback((info: { event: { extendedProps: CalendarEvent; startStr: string; endStr: string; start: Date | null; end: Date | null }; revert: () => void }) => {
    const ev = info.event.extendedProps as CalendarEvent;
    const uid = ev.google_event_id ?? "";
    // Normalise to proper RFC3339 with local offset
    const newStart = info.event.start ? dateToLocalISO(info.event.start) : info.event.startStr;
    const newEnd = info.event.end ? dateToLocalISO(info.event.end) : info.event.endStr;
    if (uid.startsWith("scheduled-reminder-")) {
      if (!updateScheduledReminderTime(uid, newStart, newEnd)) info.revert();
      return;
    }
    // DB-backed synced action item — persist updated times to the DB + Airtable due_date
    if (ev.calendar_id === "work_tracking" && ev.agentpm_airtable_id && ev.is_synced) {
      localMutationRef.current = true;
      setEvents((prev) => prev.map((e) => e.google_event_id === uid ? { ...e, start_datetime: newStart, end_datetime: newEnd } : e));
      setSelectedEvent((prev) => prev?.google_event_id === uid ? { ...prev, start_datetime: newStart, end_datetime: newEnd } : prev);
      schedulerApi.updateEvent(ev.id, { start_datetime: newStart, end_datetime: newEnd })
        .catch(() => { info.revert(); })
        .finally(() => { localMutationRef.current = false; });
      airtableApi.updateActionItemFields(ev.agentpm_airtable_id, { due_date: newStart.slice(0, 10) }).catch(() => {});
      bustEventCache();
      return;
    }
    // Regular calendar event (meeting)
    if (ev.id && ev.calendar_id !== "work_tracking" && !uid.startsWith("scheduled-")) {
      const otherAttendees = (ev.attendees ?? []).filter((a) => a.email && a.email !== userEmail);
      if (otherAttendees.length > 0) {
        // Revert the visual change and ask for confirmation first
        info.revert();
        setPendingReschedule({ ev, newStart, newEnd });
        return;
      }
      applyMeetingReschedule(ev, newStart, newEnd, info.revert);
      return;
    }
    // Locally-scheduled action item (localStorage-only, not yet synced to Google)
    const parsed = parseScheduledUid(uid);
    if (!parsed) { info.revert(); return; }
    const { airtableId, startMin } = parsed;
    const items = readScheduledItems();
    // Match by airtableId + startMin; fall back to airtableId-only if start format differs
    let idx = items.findIndex((i) =>
      i.airtableId === airtableId && startMin !== "" && i.start.slice(0, 16) === startMin
    );
    if (idx === -1) {
      const matches = items.reduce<number[]>((acc, item, i) => item.airtableId === airtableId ? [...acc, i] : acc, []);
      if (matches.length === 1) idx = matches[0];
    }
    if (idx === -1) { info.revert(); return; }
    items[idx] = { ...items[idx], start: newStart, end: newEnd };
    localStorage.setItem(SCHEDULED_ITEMS_KEY, JSON.stringify(items));
    setScheduledItems([...items]);
    // Keep the action item's due_date in sync with the new start date
    airtableApi.updateActionItemFields(airtableId, { due_date: newStart.slice(0, 10) }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyMeetingReschedule, userEmail]);

  const handleEventDrop = useCallback((info: { event: { extendedProps: CalendarEvent; startStr: string; endStr: string; start: Date | null; end: Date | null }; revert: () => void }) => {
    const ev = info.event.extendedProps as CalendarEvent;
    const uid = ev.google_event_id ?? "";
    const newStart = info.event.start ? dateToLocalISO(info.event.start) : info.event.startStr;
    const newEnd = info.event.end ? dateToLocalISO(info.event.end) : info.event.endStr;
    if (uid.startsWith("scheduled-reminder-")) {
      if (!updateScheduledReminderTime(uid, newStart, newEnd)) info.revert();
      return;
    }
    // DB-backed synced action item — persist updated times to the DB + Airtable due_date
    if (ev.calendar_id === "work_tracking" && ev.agentpm_airtable_id && ev.is_synced) {
      localMutationRef.current = true;
      setEvents((prev) => prev.map((e) => e.google_event_id === uid ? { ...e, start_datetime: newStart, end_datetime: newEnd } : e));
      setSelectedEvent((prev) => prev?.google_event_id === uid ? { ...prev, start_datetime: newStart, end_datetime: newEnd } : prev);
      schedulerApi.updateEvent(ev.id, { start_datetime: newStart, end_datetime: newEnd })
        .catch(() => { info.revert(); })
        .finally(() => { localMutationRef.current = false; });
      airtableApi.updateActionItemFields(ev.agentpm_airtable_id, { due_date: newStart.slice(0, 10) }).catch(() => {});
      bustEventCache();
      return;
    }
    // Regular calendar event (meeting)
    if (ev.id && ev.calendar_id !== "work_tracking" && !uid.startsWith("scheduled-")) {
      const otherAttendees = (ev.attendees ?? []).filter((a) => a.email && a.email !== userEmail);
      if (otherAttendees.length > 0) {
        // Revert the visual change and ask for confirmation first
        info.revert();
        setPendingReschedule({ ev, newStart, newEnd });
        return;
      }
      applyMeetingReschedule(ev, newStart, newEnd, info.revert);
      return;
    }
    // Locally-scheduled action item (localStorage-only, not yet synced to Google)
    const parsed = parseScheduledUid(uid);
    if (!parsed) { info.revert(); return; }
    const { airtableId, startMin } = parsed;
    const items = readScheduledItems();
    // Match by airtableId + startMin; fall back to airtableId-only if start format differs
    let idx = items.findIndex((i) =>
      i.airtableId === airtableId && startMin !== "" && i.start.slice(0, 16) === startMin
    );
    if (idx === -1) {
      // Fallback: only one entry for this airtableId — safe to update it
      const matches = items.reduce<number[]>((acc, item, i) => item.airtableId === airtableId ? [...acc, i] : acc, []);
      if (matches.length === 1) idx = matches[0];
    }
    if (idx === -1) { info.revert(); return; }
    items[idx] = { ...items[idx], start: newStart, end: newEnd };
    localStorage.setItem(SCHEDULED_ITEMS_KEY, JSON.stringify(items));
    setScheduledItems([...items]);
    // Keep the action item's due_date in sync with the new start date
    airtableApi.updateActionItemFields(airtableId, { due_date: newStart.slice(0, 10) }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyMeetingReschedule, userEmail]);

  // Remove a work-tracking event from the calendar without deleting from Airtable
  const handleRemoveFromCalendar = useCallback((uid: string) => {
    if (uid.startsWith("scheduled-reminder-")) {
      // Format: scheduled-reminder-{reminderId}__{startMin}
      const body = uid.slice("scheduled-reminder-".length);
      const sep = body.lastIndexOf("__");
      const reminderId = parseInt(sep === -1 ? body : body.slice(0, sep), 10);
      const startMin = sep === -1 ? "" : body.slice(sep + 2);
      const remaining = readScheduledReminders().filter((r) =>
        r.reminderId !== reminderId || (startMin ? r.start.slice(0, 16) !== startMin : false)
      );
      localStorage.setItem(SCHEDULED_REMINDERS_KEY, JSON.stringify(remaining));
      setScheduledReminders([...remaining]);
      window.dispatchEvent(new StorageEvent("storage", { key: SCHEDULED_REMINDERS_KEY, newValue: JSON.stringify(remaining) }));
    } else if (uid.startsWith("scheduled-")) {
      const parsed = parseScheduledUid(uid);
      // Require both airtableId and startMin — if either is missing, bail out
      // rather than risk wiping all scheduled items.
      if (!parsed || !parsed.startMin) return;
      const allScheduled = readScheduledItems();
      // Collect items being removed so we can also delete any synced DB records
      const removed = allScheduled.filter((i) =>
        i.airtableId === parsed.airtableId && i.start.slice(0, 16) === parsed.startMin
      );
      const items = allScheduled.filter((i) =>
        i.airtableId !== parsed.airtableId || i.start.slice(0, 16) !== parsed.startMin
      );
      localStorage.setItem(SCHEDULED_ITEMS_KEY, JSON.stringify(items));
      setScheduledItems([...items]);
      window.dispatchEvent(new StorageEvent("storage", { key: SCHEDULED_ITEMS_KEY, newValue: JSON.stringify(items) }));
      // If the item was already pushed to Google (has a googleEventId), also delete the
      // corresponding DB-backed work_tracking CalendarEvent so it doesn't re-appear on sync.
      for (const s of removed) {
        if (s.googleEventId) {
          // Match by Google event ID first (most precise), then fall back to airtableId+start
          // scoped to the exact start minute so we don't remove a different time slot.
          const dbEv = eventsRef.current.find(
            (e) => e.google_event_id === s.googleEventId ||
                   (e.agentpm_airtable_id === s.airtableId && e.is_synced &&
                    e.start_datetime.slice(0, 16) === s.start.slice(0, 16))
          );
          if (dbEv) {
            setEvents((prev) => prev.filter((e) => e.id !== dbEv.id));
            schedulerApi.deleteEvent(dbEv.id).catch(() => {});
          }
        }
      }
    } else if (uid.startsWith("active-timer-") || uid.includes("active-timer")) {
      const airtableId = uid.replace(/^active-timer-/, "");
      try {
        const raw: Record<string, { startedAt: number; elapsed: number; task: string; accountName: string | null }> =
          JSON.parse(localStorage.getItem("activeTimers") ?? "{}");
        // Calculate how many seconds were accumulated in this active session
        const timerEntry = Object.entries(raw).find(([key]) =>
          key === airtableId || key.includes(airtableId) || airtableId.includes(key)
        )?.[1];
        const accumulatedSecs = timerEntry
          ? timerEntry.elapsed + (timerEntry.startedAt ? Math.floor((Date.now() - timerEntry.startedAt) / 1000) : 0)
          : 0;
        // Delete the exact key and any key that is a substring match (handles legacy/malformed entries)
        const pruned = Object.fromEntries(
          Object.entries(raw).filter(([key]) =>
            key !== airtableId && !key.includes(airtableId) && !airtableId.includes(key)
          )
        );
        localStorage.setItem("activeTimers", JSON.stringify(pruned));
        setActiveTimers({ ...pruned } as Record<string, { startedAt: number; elapsed: number; task: string; accountName: string | null }>);
        window.dispatchEvent(new StorageEvent("storage", { key: "activeTimers", newValue: JSON.stringify(pruned) }));
        // Tell ActionItemsPage to stop + zero the timer without committing the time
        const cancelPayload = JSON.stringify({ airtableId, seconds: accumulatedSecs });
        localStorage.setItem("actionItemCancelTimer", cancelPayload);
        window.dispatchEvent(new StorageEvent("storage", { key: "actionItemCancelTimer", newValue: cancelPayload }));
        // Also delete the live DB CalendarEvent if one was created
        const liveDbEv = eventsRef.current.find(
          (e) => e.calendar_id === "work_tracking" && e.agentpm_airtable_id === airtableId && !e.is_synced
        );
        if (liveDbEv) {
          setEvents((prev) => prev.filter((e) => e.id !== liveDbEv.id));
          schedulerApi.deleteEvent(liveDbEv.id).catch(() => {});
        }
      } catch { /* best effort */ }
    } else {
      // DB-backed work-tracking event (real Google event ID) — delete from DB
      const ev = eventsRef.current.find((e) => e.google_event_id === uid);
      if (ev) {
        const durationSecs = ev.agentpm_airtable_id
          ? Math.round((new Date(ev.end_datetime).getTime() - new Date(ev.start_datetime).getTime()) / 1000)
          : 0;
        setEvents((prev) => prev.filter((e) => e.google_event_id !== uid));
        schedulerApi.deleteEvent(ev.id).catch(() => {});
        // Tell ActionItemsPage to subtract this session's duration from the timer display
        if (ev.agentpm_airtable_id && durationSecs > 0) {
          const cancelPayload = JSON.stringify({ airtableId: ev.agentpm_airtable_id, seconds: durationSecs });
          localStorage.setItem("actionItemCancelTimer", cancelPayload);
          window.dispatchEvent(new StorageEvent("storage", { key: "actionItemCancelTimer", newValue: cancelPayload }));
        }
      }
    }
    setSelectedEvent(null);
    setCtxMenu(null);
  }, []);

  const calendarRef = useRef<FullCalendar>(null);
  const calendarWrapRef = useRef<HTMLDivElement>(null);
  const [gutterWidth, setGutterWidth] = useState(48);

  // ── Hover time tooltip ───────────────────────────────────────────────────────
  const [hoverTooltip, setHoverTooltip] = useState<{
    x: number; y: number;
    label: string;
  } | null>(null);
  const dragInfoRef = useRef<{ startMs: number } | null>(null);

  function msToTimeLabel(ms: number): string {
    const totalMins = Math.round(ms / 60000 / 15) * 15;
    const h = Math.floor(totalMins / 60) % 24;
    const m = totalMins % 60;
    const suffix = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
  }

  function fmtDurationMins(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  }

  function getMsFromY(wrap: HTMLDivElement, clientY: number): number | null {
    const body = wrap.querySelector<HTMLElement>(".fc-timegrid-body");
    const slots = wrap.querySelectorAll<HTMLElement>(".fc-timegrid-slot[data-time]");
    if (!body || !slots.length) return null;
    const bodyRect = body.getBoundingClientRect();
    const relY = clientY - bodyRect.top;
    const totalHeight = bodyRect.height;
    // 24 hours = totalHeight pixels
    const msInDay = 24 * 60 * 60 * 1000;
    const rawMs = (relY / totalHeight) * msInDay;
    return Math.max(0, Math.min(rawMs, msInDay - 1));
  }

  useEffect(() => {
    const wrap = calendarWrapRef.current;
    if (!wrap) return;

    function onMouseMove(e: MouseEvent) {
      const w = calendarWrapRef.current;
      if (!w) return;
      const ms = getMsFromY(w, e.clientY);
      if (ms === null) { setHoverTooltip(null); return; }
      // Only show when over the time grid body
      const body = w.querySelector<HTMLElement>(".fc-timegrid-body");
      if (!body) { setHoverTooltip(null); return; }
      const bodyRect = body.getBoundingClientRect();
      if (e.clientY < bodyRect.top || e.clientY > bodyRect.bottom) { setHoverTooltip(null); return; }

      const snappedMs = Math.round(ms / (15 * 60000)) * 15 * 60000;
      let label: string;
      if (dragInfoRef.current) {
        const startMs = dragInfoRef.current.startMs;
        const endMs = snappedMs;
        const durationMins = Math.abs(Math.round((endMs - startMs) / 60000));
        const earlierMs = Math.min(startMs, endMs);
        const laterMs = Math.max(startMs, endMs);
        label = `${msToTimeLabel(earlierMs)} – ${msToTimeLabel(laterMs)}  ·  ${fmtDurationMins(durationMins)}`;
      } else {
        label = msToTimeLabel(snappedMs);
      }
      setHoverTooltip({ x: e.clientX, y: e.clientY, label });
    }

    function onMouseLeave() {
      if (!dragInfoRef.current) setHoverTooltip(null);
    }

    wrap.addEventListener("mousemove", onMouseMove);
    wrap.addEventListener("mouseleave", onMouseLeave);
    return () => {
      wrap.removeEventListener("mousemove", onMouseMove);
      wrap.removeEventListener("mouseleave", onMouseLeave);
    };
  }, []);
  // ─────────────────────────────────────────────────────────────────────────────
  // Map from ISO date string → {left, width} relative to calendarWrapRef
  const [colPositions, setColPositions] = useState<Record<string, { left: number; width: number }>>({});
  const [monthWeekRows, setMonthWeekRows] = useState<{ top: number; height: number; weekDates: string[] }[]>([]);

  const measureMonthRows = useCallback(() => {
    const wrap = calendarWrapRef.current;
    if (!wrap) return;
    const wrapRect = wrap.getBoundingClientRect();
    // Each week row in month view is a <tr> inside .fc-daygrid-body
    const rows = Array.from(wrap.querySelectorAll<HTMLElement>(".fc-daygrid-body .fc-daygrid-week"));
    if (!rows.length) { setMonthWeekRows([]); return; }
    const result = rows.map((row) => {
      const r = row.getBoundingClientRect();
      const cells = Array.from(row.querySelectorAll<HTMLElement>(".fc-daygrid-day[data-date]"));
      const weekDates = cells.map((c) => c.getAttribute("data-date")!).filter(Boolean);
      return { top: r.top - wrapRect.top, height: r.height, weekDates };
    });
    setMonthWeekRows(result);
  }, []);

  const measureColumns = useCallback(() => {
    const wrap = calendarWrapRef.current;
    if (!wrap) return;
    const wrapRect = wrap.getBoundingClientRect();
    const cells = Array.from(wrap.querySelectorAll<HTMLElement>(".fc-col-header-cell[data-date]"));
    if (cells.length === 0) return;
    const positions: Record<string, { left: number; width: number }> = {};
    cells.forEach((cell) => {
      const date = cell.getAttribute("data-date");
      if (!date) return;
      const r = cell.getBoundingClientRect();
      positions[date] = { left: r.left - wrapRect.left, width: r.width };
    });
    setColPositions(positions);
  }, []);

  // Imperatively highlight the active content-view button since FullCalendar
  // repaints its DOM independently of React, making CSS attribute selectors unreliable.
  useEffect(() => {
    const wrap = calendarWrapRef.current;
    if (!wrap) return;
    const map: Record<string, string> = {
      all: ".fc-viewAll-button",
      meetings: ".fc-viewMeetings-button",
      "action-items": ".fc-viewActionItems-button",
      reminders: ".fc-viewReminders-button",
      accounts: ".fc-viewAccounts-button",
    };
    const ACTIVE = "#1f2937";
    const DEFAULT = "#606B85";
    Object.entries(map).forEach(([view, sel]) => {
      const btn = wrap.querySelector<HTMLElement>(sel);
      if (!btn) return;
      const color = view === contentView ? ACTIVE : DEFAULT;
      btn.style.setProperty("background-color", color, "important");
      btn.style.setProperty("border-color", color, "important");
    });
  }, [contentView]);

  // Measure the actual FC time-axis width and column positions so the totals footer aligns precisely
  useEffect(() => {
    function measure() {
      const axis = calendarWrapRef.current?.querySelector<HTMLElement>(".fc-timegrid-axis");
      if (axis) setGutterWidth(axis.offsetWidth);
      measureColumns();
      measureMonthRows();
    }
    measure();
    const ro = new ResizeObserver(measure);
    if (calendarWrapRef.current) ro.observe(calendarWrapRef.current);
    return () => ro.disconnect();
  }, [measureColumns, measureMonthRows]);

  // Re-measure whenever the visible date range or view type changes
  useEffect(() => {
    // FC updates the DOM asynchronously after datesSet fires; wait one frame
    const id = requestAnimationFrame(() => { measureColumns(); measureMonthRows(); });
    return () => cancelAnimationFrame(id);
  }, [visibleRange, currentView, measureColumns, measureMonthRows]);

  // Native HTML5 drag-and-drop onto the FullCalendar time grid.
  // FC's own `drop` callback only fires for elements registered via its Draggable API;
  // our sidebar cards use plain <div draggable>, so we wire up native listeners instead.
  useEffect(() => {
    const wrap = calendarWrapRef.current;
    if (!wrap) return;

    // Highlight drop targets while an action item or reminder card is being dragged over
    function onDragOver(e: DragEvent) {
      const w = window as unknown as Record<string, string>;
      if (!w[CALENDAR_DRAG_KEY] && !w[CALENDAR_DRAG_REMINDER_KEY]) return;
      e.preventDefault();
      const bg = w[CALENDAR_DRAG_REMINDER_KEY] ? "rgba(245,158,11,0.08)" : "rgba(99,102,241,0.06)";
      (e.currentTarget as HTMLElement).style.setProperty("background", bg);
    }
    function onDragLeave(e: DragEvent) {
      (e.currentTarget as HTMLElement).style.removeProperty("background");
    }

    function onDrop(e: DragEvent) {
      const w = window as unknown as Record<string, string>;
      (e.currentTarget as HTMLElement).style.removeProperty("background");

      // ── Reminder drop ────────────────────────────────────────────────────
      const reminderIdStr = w[CALENDAR_DRAG_REMINDER_KEY];
      if (reminderIdStr) {
        e.preventDefault();
        const reminderId = parseInt(reminderIdStr, 10);
        const title = w[`${CALENDAR_DRAG_REMINDER_KEY}_title`] || "Reminder";
        delete w[CALENDAR_DRAG_REMINDER_KEY];
        delete w[`${CALENDAR_DRAG_REMINDER_KEY}_title`];

        const fcApi = calendarRef.current?.getApi();
        const view = fcApi?.view;
        if (!view) return;

        const colHeaders = Array.from(wrap.querySelectorAll<HTMLElement>(".fc-col-header-cell[data-date]"));
        let dropDate: string | null = null;
        for (const cell of colHeaders) {
          const r = cell.getBoundingClientRect();
          if (e.clientX >= r.left && e.clientX <= r.right) { dropDate = cell.getAttribute("data-date"); break; }
        }
        if (!dropDate) dropDate = view.activeStart.toISOString().slice(0, 10);

        // Hit-test each slot row by its viewport rect — immune to scroll position
        let dropHour = 9, dropMinute = 0;
        const slots = Array.from(wrap.querySelectorAll<HTMLElement>(".fc-timegrid-slot[data-time]"));
        let best: HTMLElement | null = null;
        for (const slot of slots) {
          const r = slot.getBoundingClientRect();
          if (e.clientY >= r.top && e.clientY < r.bottom) { best = slot; break; }
        }
        if (best) {
          const t = best.getAttribute("data-time")!; // "HH:MM:SS"
          dropHour = parseInt(t.slice(0, 2), 10);
          dropMinute = parseInt(t.slice(3, 5), 10);
        }

        const start = `${dropDate}T${String(dropHour).padStart(2, "0")}:${String(dropMinute).padStart(2, "0")}:00`;
        const saved = saveScheduledReminder({ reminderId, title, start, end: start });
        if (saved) {
          const label = new Date(start).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
          setDropToast({ msg: `Reminder scheduled for ${label}`, type: "success" });
        } else {
          setDropToast({ msg: "Already scheduled at that time", type: "warn" });
        }
        setTimeout(() => setDropToast(null), 3000);
        return;
      }

      // ── Action item drop ─────────────────────────────────────────────────
      const airtableId = (e.dataTransfer?.getData("text/plain") || w[CALENDAR_DRAG_KEY] || "").trim();
      if (!airtableId) return;

      e.preventDefault();

      const task = w[`${CALENDAR_DRAG_KEY}_task`] || airtableId;
      const accountName: string | null = w[`${CALENDAR_DRAG_KEY}_account`] || null;

      delete w[CALENDAR_DRAG_KEY];
      delete w[`${CALENDAR_DRAG_KEY}_task`];
      delete w[`${CALENDAR_DRAG_KEY}_account`];
      delete w[`${CALENDAR_DRAG_KEY}_est`];

      // ── Compute drop time from mouse position ────────────────────────────
      const fcApi = calendarRef.current?.getApi();
      const view = fcApi?.view;
      if (!view) return;

      // Determine which date column the drop landed in
      const colHeaders = Array.from(wrap.querySelectorAll<HTMLElement>(".fc-col-header-cell[data-date]"));
      let dropDate: string | null = null;
      for (const cell of colHeaders) {
        const r = cell.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right) {
          dropDate = cell.getAttribute("data-date");
          break;
        }
      }
      // Fallback: use the first visible date
      if (!dropDate) dropDate = view.activeStart.toISOString().slice(0, 10);

      // Hit-test each slot row by its viewport rect — immune to scroll position
      let dropHour = 9;
      let dropMinute = 0;
      const slots = Array.from(wrap.querySelectorAll<HTMLElement>(".fc-timegrid-slot[data-time]"));
      let best: HTMLElement | null = null;
      for (const slot of slots) {
        const r = slot.getBoundingClientRect();
        if (e.clientY >= r.top && e.clientY < r.bottom) { best = slot; break; }
      }
      if (best) {
        const t = best.getAttribute("data-time")!; // "HH:MM:SS"
        dropHour = parseInt(t.slice(0, 2), 10);
        dropMinute = parseInt(t.slice(3, 5), 10);
      }

      const localStr = `${dropDate}T${String(dropHour).padStart(2, "0")}:${String(dropMinute).padStart(2, "0")}:00`;
      const durationMs = 15 * 60 * 1000;
      const start = toLocalISO(localStr);
      const end = addMsToLocalISO(localStr, durationMs);

      const saved = saveScheduledItem({ airtableId, task, accountName, start, end });
      if (saved) {
        const label = new Date(start).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
        setDropToast({ msg: `Scheduled for ${label}`, type: "success" });
        addLog({
          category: "calendar",
          message: `"${task}" added to calendar for ${label}${accountName ? ` (${accountName})` : ""}`,
          links: [{ label: "View calendar", path: "/calendar" }],
          resource: { type: "action_item", id: airtableId },
        });
        // Auto-link the account so SF projects appear without a manual drag
        if (accountName && saved.uid) {
          const eventUid = `scheduled-${airtableId}__${start.slice(0, 16)}`;
          const match = allAccountsRef.current.find(
            (a) => a.name.toLowerCase() === accountName.toLowerCase()
          );
          if (match) {
            linkEventToAccountRef.current(match.id, match.name, eventUid);
          }
        }
      } else {
        setDropToast({ msg: "Already scheduled at that time", type: "warn" });
      }
      setTimeout(() => setDropToast(null), 3000);
    }

    // Attach to the timegrid body so drops anywhere on the grid are captured
    function attach() {
      const body = wrap!.querySelector<HTMLElement>(".fc-timegrid-body");
      if (!body) return false;
      body.addEventListener("dragover", onDragOver);
      body.addEventListener("dragleave", onDragLeave);
      body.addEventListener("drop", onDrop);
      return true;
    }

    // FC renders the grid async; retry until it's in the DOM
    if (!attach()) {
      const raf = requestAnimationFrame(() => attach());
      return () => cancelAnimationFrame(raf);
    }
    return () => {
      const body = wrap.querySelector<HTMLElement>(".fc-timegrid-body");
      if (!body) return;
      body.removeEventListener("dragover", onDragOver);
      body.removeEventListener("dragleave", onDragLeave);
      body.removeEventListener("drop", onDrop);
    };
  // Re-attach when the view changes (month ↔ week ↔ day switches rebuild the DOM)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRange]);

  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    const showToast = (msg: string, type: "success" | "warn") => {
      setDropToast({ msg, type });
      setTimeout(() => setDropToast(null), 4000);
    };
    try {
      // ── Step 1: Push scheduled action items to Google FIRST so that the
      // pull in step 2 can bring them back as proper DB records in this same
      // sync cycle (avoids duplicates on subsequent syncs).
      //
      // Skip items that are already represented as synced DB records in the
      // current eventsRef — they don't need to be pushed again.
      const alreadySyncedAirtableIds = new Set(
        eventsRef.current
          .filter((e) => e.is_synced && e.agentpm_airtable_id)
          .map((e) => e.agentpm_airtable_id)
      );
      const currentItems = readScheduledItems().filter(
        // Skip if already pushed to Google (has a googleEventId) OR already
        // visible as a synced DB record in the current view range. This prevents
        // double-pushing when the original push happened outside the visible week.
        (s) => !s.googleEventId && !alreadySyncedAirtableIds.has(s.airtableId)
      );

      if (currentItems.length > 0) {
        let pushData: { results: Array<{ airtableId: string; start: string; googleEventId: string }> } | null = null;
        try {
          const resp = await integrationsApi.pushActionItemsToGoogle(
            currentItems.map((s) => ({
              airtableId: s.airtableId,
              start: s.start,
              end: s.end,
              task: s.task,
              accountName: s.accountName ?? undefined,
              googleEventId: s.googleEventId,
            }))
          );
          pushData = resp.data;
        } catch (pushErr) {
          console.error("[Sync] Push API call failed:", pushErr);
          showToast("Push to Google Calendar failed — check console", "warn");
        }

        if (pushData?.results?.length) {
          const newlySynced = pushData.results.filter((r) => r.googleEventId);
          const failed = pushData.results.filter((r) => !r.googleEventId).length;
          if (failed > 0) console.warn("[Sync] Push failed for", failed, "item(s)");
          if (newlySynced.length > 0) showToast(`Synced ${newlySynced.length} action item${newlySynced.length > 1 ? "s" : ""} to Google Calendar`, "success");
          if (failed > 0 && newlySynced.length === 0) showToast(`Failed to push ${failed} action item${failed > 1 ? "s" : ""} to Google Calendar`, "warn");

          // Persist returned Google event IDs, then immediately prune items that
          // now have a googleEventId (they're synced regardless of visible range).
          const idMap = new Map(pushData.results.map((r) => [`${r.airtableId}__${r.start.slice(0, 16)}`, r.googleEventId]));
          const syncedGoogleIds = new Set(newlySynced.map((r) => r.googleEventId));
          const afterPush = readScheduledItems()
            .map((s) => {
              const key = `${s.airtableId}__${s.start.slice(0, 16)}`;
              const gid = idMap.get(key);
              if (gid === undefined) return s;
              if (gid === "") return { ...s, googleEventId: undefined };
              return { ...s, googleEventId: gid };
            })
            // Remove items whose google event was just confirmed — they'll come
            // back as proper DB records after the pull in Step 2.
            .filter((s) => !s.googleEventId || !syncedGoogleIds.has(s.googleEventId));
          localStorage.setItem(SCHEDULED_ITEMS_KEY, JSON.stringify(afterPush));
          setScheduledItems(afterPush);
          window.dispatchEvent(new StorageEvent("storage", { key: SCHEDULED_ITEMS_KEY, newValue: JSON.stringify(afterPush) }));
        }
      }

      // ── Step 2: Pull Google Calendar → Django DB. Because we pushed first,
      // action items we just created in Google are now included in this pull
      // and will land as is_synced=true DB records.
      await integrationsApi.syncGoogleCalendar();

      // ── Step 3: Bust cache and refetch the visible range from the DB so that
      // freshly-synced Google events are shown immediately.
      bustEventCache();
      const api = calendarRef.current?.getApi();
      if (api) {
        const { activeStart, activeEnd } = api.view;
        await fetchEvents(activeStart.toISOString(), activeEnd.toISOString(), { bustCache: true });
      }

      // ── Step 4: Prune any remaining localStorage entries that are now
      // represented as proper DB records (is_synced=true + matching airtable id).
      const dbSyncedAirtableIds = new Set(
        eventsRef.current
          .filter((e) => e.is_synced && e.agentpm_airtable_id)
          .map((e) => e.agentpm_airtable_id)
      );
      const dbSyncedGoogleIds = new Set(
        eventsRef.current
          .filter((e) => e.is_synced && e.google_event_id)
          .map((e) => e.google_event_id)
      );
      const afterPrune = readScheduledItems().filter(
        (s) => !dbSyncedAirtableIds.has(s.airtableId) &&
               (!s.googleEventId || !dbSyncedGoogleIds.has(s.googleEventId))
      );
      const currentStored = readScheduledItems();
      if (afterPrune.length < currentStored.length) {
        localStorage.setItem(SCHEDULED_ITEMS_KEY, JSON.stringify(afterPrune));
        setScheduledItems(afterPrune);
        window.dispatchEvent(new StorageEvent("storage", { key: SCHEDULED_ITEMS_KEY, newValue: JSON.stringify(afterPrune) }));
      }
      window.dispatchEvent(new StorageEvent("storage", { key: "calendarUpdated", newValue: "1" }));
    } catch (err) {
      console.error("[Sync] Sync failed:", err);
      const is429 = (err as { response?: { status?: number } })?.response?.status === 429;
      showToast(is429 ? "Google Calendar rate limit hit — wait a moment and try again" : "Google Calendar sync failed — check console", "warn");
    } finally {
      setIsSyncing(false);
    }
  }, [fetchEvents]);

  // When accounts view is active, fetch Airtable meetings for all linked accounts.
  // Derive a stable string key from the actual account IDs so the effect only
  // re-fires when the set of linked accounts changes, not on every Map reference change.
  const linkedAccountIdsKey = [...new Set([...eventAccountLinks.values()].map((l) => l.accountId))].sort().join(",");
  useEffect(() => {
    if (contentView !== "accounts") { setAccountMeetingEvents([]); return; }
    const accountIds = linkedAccountIdsKey ? linkedAccountIdsKey.split(",").map(Number) : [];
    if (accountIds.length === 0) { setAccountMeetingEvents([]); return; }
    let cancelled = false;
    Promise.all(
      accountIds.map((id) => airtableApi.listMeetings({ account: String(id) }))
    ).then((results) => {
      if (cancelled) return;
      const synth: CalendarEvent[] = results.flatMap((r, i) => {
        const accountId = accountIds[i]!;
        const accountName = [...eventAccountLinks.values()].find((l) => l.accountId === accountId)?.accountName ?? "";
        return r.data.results
          .filter((m) => m.date)
          .map((m): CalendarEvent => ({
            id: -m.id,
            owner: 0,
            owner_username: accountName,
            google_event_id: `airtable-meeting-${m.airtable_id}`,
            title: m.name || "Meeting",
            description: m.expected_topics || "",
            location: "",
            start_datetime: m.date!,
            end_datetime: new Date(new Date(m.date!).getTime() + (m.duration || 3600) * 1000).toISOString(),
            all_day: false,
            status: "confirmed",
            attendees: [],
            meet_link: m.gong_url || "",
            calendar_id: `account-${accountId}`,
            is_synced: false,
            created_at: "",
            updated_at: "",
          }));
      });
      setAccountMeetingEvents(synth);
    }).catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentView, linkedAccountIdsKey]);

  // Synthesize scheduled action items as calendar events
  const scheduledCalEvents: CalendarEvent[] = scheduledItems.map((s) => ({
    id: -(Math.abs((s.uid ?? (s.airtableId + s.start)).split("").reduce((a, c) => a + c.charCodeAt(0), 0))),
    owner: 0,
    owner_username: s.accountName ?? "",
    google_event_id: `scheduled-${s.airtableId}__${s.start.slice(0, 16)}`,
    title: s.task,
    description: "",
    location: "",
    start_datetime: s.start,
    end_datetime: s.end,
    all_day: false,
    status: "confirmed" as const,
    attendees: [],
    meet_link: "",
    calendar_id: "work_tracking",
    is_synced: false,
    created_at: "",
    updated_at: "",
  }));

  // Synthesize live running timers as calendar events
  const now = Date.now();
  const activeTimerCalEvents: CalendarEvent[] = Object.entries(activeTimers).map(([id, t]) => ({
    id: -(Math.abs(id.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) + 1),
    owner: 0,
    owner_username: t.accountName ?? "",
    google_event_id: `active-timer-${id}`,
    title: `⏱ ${t.task}`,
    description: "",
    location: "",
    start_datetime: new Date(t.startedAt).toISOString(),
    end_datetime: new Date(now).toISOString(),
    all_day: false,
    status: "confirmed" as const,
    attendees: [],
    meet_link: "",
    calendar_id: "work_tracking",
    is_synced: false,
    created_at: "",
    updated_at: "",
  }));

  // Synthesize scheduled reminders as calendar events (amber)
  const REMINDER_COLOR = "#f97316";
  const scheduledReminderCalEvents: CalendarEvent[] = scheduledReminders.map((r) => ({
    id: -(Math.abs((String(r.reminderId) + r.start).split("").reduce((a, c) => a + c.charCodeAt(0), 0)) + 2),
    owner: 0,
    owner_username: "",
    google_event_id: `scheduled-reminder-${r.reminderId}__${r.start.slice(0, 16)}`,
    title: `🔔 ${r.title}`,
    description: "",
    location: "",
    start_datetime: r.start,
    end_datetime: new Date(new Date(r.start).getTime() + 15 * 60 * 1000).toISOString(),
    all_day: false,
    status: "confirmed" as const,
    attendees: [],
    meet_link: "",
    calendar_id: "work_tracking",
    is_synced: false,
    created_at: "",
    updated_at: "",
  }));

  // Filter events by content view — in accounts view, further filter to selected account
  const filteredEvents = (() => {
    const base = events.filter((e) => {
      if (e.calendar_id === "reminders") return false; // never show reminders as standalone events
      if (contentView === "all") return true;
      if (contentView === "meetings") return e.calendar_id !== "work_tracking";
      if (contentView === "action-items") return e.calendar_id === "work_tracking";
      if (contentView === "reminders") return false; // only show scheduled reminders (amber events)
      if (contentView === "accounts") {
        const link = (e.google_event_id ? eventAccountLinks.get(e.google_event_id) : undefined)
          ?? eventAccountLinks.get(String(e.id));
        if (!link) return false;
        return selectedAccountName === null || link.accountName === selectedAccountName;
      }
      return true;
    });
    // Always include scheduled + active-timer + reminder events depending on view
    const workEvents = contentView === "all" || contentView === "action-items"
      ? [...scheduledCalEvents, ...activeTimerCalEvents, ...scheduledReminderCalEvents]
      : contentView === "reminders"
        ? [...scheduledReminderCalEvents]
        : [];
    if (contentView !== "accounts") return [...base, ...workEvents];
    const extraFiltered = accountMeetingEvents.filter((e) =>
      selectedAccountName === null || e.owner_username === selectedAccountName
    );
    return [...base, ...extraFiltered, ...workEvents];
  })();

  // Compute daily time totals (seconds) across all filtered events for the footer
  function fmtMins(secs: number): string {
    if (secs <= 0) return "";
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return h > 0 ? `${h}h ${m > 0 ? `${m}m` : ""}`.trim() : `${m}m`;
  }

  const visibleDays: string[] = (() => {
    if (!visibleRange) return [];
    const days: string[] = [];
    const cur = new Date(visibleRange.start);
    const end = new Date(visibleRange.end);
    while (cur < end) {
      days.push(cur.toISOString().slice(0, 10));
      cur.setDate(cur.getDate() + 1);
    }
    return days.filter((d) => {
      if (showWeekends) return true;
      // Parse date parts directly to avoid UTC→local timezone shift
      const [y, mo, dy] = d.split("-").map(Number) as [number, number, number];
      const dow = new Date(y, mo - 1, dy).getDay();
      return dow !== 0 && dow !== 6;
    });
  })();

  const dailyTotals: Record<string, number> = {};
  for (const day of visibleDays) {
    let secs = 0;
    for (const e of filteredEvents) {
      if (e.google_event_id && absentEventIds.has(e.google_event_id)) continue;
      const eDay = e.start_datetime.slice(0, 10);
      if (eDay !== day) continue;
      const dur = (new Date(e.end_datetime).getTime() - new Date(e.start_datetime).getTime()) / 1000;
      if (dur > 0) secs += dur;
    }
    dailyTotals[day] = secs;
  }
  const weekTotal = Object.values(dailyTotals).reduce((a, b) => a + b, 0);

  // Right panels: always-visible action items sidebar + conditional meeting detail
  const MEETING_W = 264;
  const ACTION_W = 300;
  const GAP = 12;
  // Left: only reserve full accounts-panel width when it's open; otherwise just clear the toggle button
  const ACCOUNTS_W = 276;
  const paddingLeft = accountPanelOpen ? ACCOUNTS_W + GAP : 72;

  return (
    <div ref={pageRef} className="relative h-full overflow-hidden flex flex-col">
      {/* ── Accounts overlay (left) ───────────────────────────────────────── */}
      <AccountsSidebar
        open={accountPanelOpen}
        onToggle={() => setAccountPanelOpen((v) => !v)}
        eventAccountLinks={eventAccountLinks}
        onLink={linkEventToAccount}
        selectedAccountName={selectedAccountName}
        onSelectAccount={(name) => {
          setSelectedAccountName(name);
          setContentView(name ? "accounts" : "all");
          // When Log Time is active, switching accounts immediately updates the panel
          if (logTimeModeAccount && name && name !== logTimeModeAccount) setLogTimeModeAccount(name);
        }}
        logTimeModeAccount={logTimeModeAccount}
        onLogTimeMode={(name) => { setLogTimeModeAccount(name ?? null); if (name) { setSelectedAccountName(name); setContentView("accounts"); } }}
      />

      {/* ── Right button row — mirrors Accounts button on the left ─────────── */}
      <div className="absolute top-4 right-4 z-30 flex items-center gap-2">
        <button
          onClick={() => void handleSync()}
          disabled={isSyncing}
          className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border shadow-sm transition-colors bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {isSyncing ? "Syncing…" : "Sync Google Calendar"}
        </button>
        {/* Divider */}
        <div className="w-px h-5 bg-gray-300 mx-2 shrink-0" />
        <button
          onClick={() => itemsPanelOpen && itemsTab === "action-items" ? (setItemsPanelOpen(false), sessionStorage.setItem("calItemsPanelOpen", "false")) : openItemsPanel("action-items")}
          className={["flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border shadow-sm transition-colors", itemsPanelOpen && itemsTab === "action-items" ? "bg-indigo-600 border-indigo-600 text-white shadow-md" : "bg-white border-gray-300 text-[var(--twilio-navy)] hover:bg-gray-50 hover:border-indigo-300"].join(" ")}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-3.5 h-3.5 shrink-0">
            <path d="M8 5h9M8 10h9M8 15h9" strokeLinecap="round"/>
            <path d="M3 5l1.5 1.5L7 3M3 10l1.5 1.5L7 8M3 15l1.5 1.5L7 13" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Action Items
        </button>
        <button
          onClick={() => itemsPanelOpen && itemsTab === "reminders" ? (setItemsPanelOpen(false), sessionStorage.setItem("calItemsPanelOpen", "false")) : openItemsPanel("reminders")}
          className={["flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border shadow-sm transition-colors", itemsPanelOpen && itemsTab === "reminders" ? "bg-indigo-600 border-indigo-600 text-white shadow-md" : "bg-white border-gray-300 text-[var(--twilio-navy)] hover:bg-gray-50 hover:border-indigo-300"].join(" ")}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-3.5 h-3.5 shrink-0">
            <path d="M10 2a6 6 0 00-6 6c0 5-2.5 6.5-2.5 6.5h17S16 13 16 8a6 6 0 00-6-6z" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M11.73 17a2 2 0 01-3.46 0" strokeLinecap="round"/>
          </svg>
          Reminders
        </button>
      </div>

      {/* ── Right overlays: items sidebar (collapsible) ──────────────────── */}

      {/* Sliding panel — starts at top-0 so the button row overlaps it, matching Accounts sidebar */}
      <div
        className={[
          "absolute right-0 top-0 bottom-0 z-20 flex flex-col transition-transform duration-300",
          itemsPanelOpen ? "translate-x-0" : "translate-x-full",
        ].join(" ")}
        style={{ width: ACTION_W }}
      >
        <ItemsSidebar
          onDropToast={(msg, type) => { setDropToast({ msg, type }); setTimeout(() => setDropToast(null), 3000); }}
          forceTab={
            contentView === "reminders" ? "reminders"
            : contentView === "action-items" ? "action-items"
            : itemsTab
          }
          expandItemId={expandActionItemId}
        />
      </div>

      {/* Meeting detail — only rendered when an event is selected */}
      <div
        className="absolute bottom-6 z-20 flex"
        style={{ top: 68, width: selectedEvent ? (meetingPanelCollapsed ? 20 : MEETING_W) : 0, right: itemsPanelOpen ? ACTION_W + GAP : GAP, transition: "width 0.2s" }}
      >
        {/* Collapse/expand tab — visible whenever an event is selected */}
        {selectedEvent && (
          <button
            onClick={() => setMeetingPanelCollapsed((v) => !v)}
            title={meetingPanelCollapsed ? "Expand meeting details" : "Collapse meeting details"}
            className="absolute -left-3 top-1/2 -translate-y-1/2 z-30 flex items-center justify-center w-6 h-10 rounded-full bg-white border border-gray-200 shadow-sm text-[var(--twilio-gray-60)] hover:text-[var(--twilio-navy)] hover:border-gray-300 transition-colors"
          >
            <svg viewBox="0 0 10 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-4">
              {meetingPanelCollapsed
                ? <path d="M2 2l6 6-6 6"/>
                : <path d="M8 2L2 8l6 6"/>}
            </svg>
          </button>
        )}
        {selectedEvent && !meetingPanelCollapsed && (
          <EventDetailPanel
            event={selectedEvent}
            onClose={() => { setSelectedEvent(null); setSelectedActionItem(null); }}
            onCollapse={() => setMeetingPanelCollapsed(true)}
            linkedAccount={
              (selectedEvent.google_event_id ? eventAccountLinks.get(selectedEvent.google_event_id) : undefined)
              ?? eventAccountLinks.get(String(selectedEvent.id))
              ?? null
            }
            onDropAccount={(accountId, accountName) => void linkEventToAccount(accountId, accountName)}
            onUnlink={() => selectedEvent.google_event_id && void unlinkEvent(selectedEvent.google_event_id)}
            onRemove={
              selectedEvent.google_event_id?.startsWith("scheduled-") ||
              selectedEvent.google_event_id?.startsWith("active-timer-") ||
              (selectedEvent.calendar_id === "work_tracking" && !!selectedEvent.google_event_id)
                ? () => handleRemoveFromCalendar(selectedEvent.google_event_id!)
                : undefined
            }
            onDelete={
              selectedEvent.calendar_id !== "work_tracking"
                ? () => {
                    const evId = selectedEvent.id;
                    setEvents((prev) => prev.filter((e) => e.id !== evId));
                    setSelectedEvent(null);
                    schedulerApi.deleteEvent(evId).catch(() => {});
                  }
                : undefined
            }
            actionItem={selectedActionItem}
            onUpdateActionItem={selectedActionItem ? async (patch) => {
              setSelectedActionItem((prev) => prev ? { ...prev, ...patch } : prev);
              try {
                await airtableApi.updateActionItemFields(selectedActionItem.airtable_id, patch);
                window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated", newValue: "1" }));
                // Update event title in calendar if task name changed
                if (patch.task && selectedEvent) {
                  setEvents((prev) => prev.map((e) =>
                    e.google_event_id === selectedEvent.google_event_id ? { ...e, title: patch.task! } : e
                  ));
                }
              } catch {
                setSelectedActionItem((prev) => prev ? { ...prev, ...Object.fromEntries(Object.keys(patch).map((k) => [k, (selectedActionItem as Record<string,unknown>)[k]])) } : prev);
              }
            } : undefined}
            onUpdateReminder={async (reminderId, patch) => {
              await schedulerApi.updateReminder(reminderId, patch as Partial<import("../types").Reminder>);
              // Update the title in localStorage so the calendar event label refreshes
              if (patch.title !== undefined || patch.due_at !== undefined) {
                const newStart = patch.due_at ? patch.due_at.slice(0, 19) : selectedEvent.start_datetime;
                const newEnd = patch.due_at
                  ? new Date(new Date(patch.due_at).getTime() + (new Date(selectedEvent.end_datetime).getTime() - new Date(selectedEvent.start_datetime).getTime())).toISOString()
                  : selectedEvent.end_datetime;
                const items = readScheduledReminders();
                const uid = selectedEvent.google_event_id ?? "";
                const body = uid.slice("scheduled-reminder-".length);
                const sep = body.lastIndexOf("__");
                const startMin = sep === -1 ? "" : body.slice(sep + 2);
                const idx = items.findIndex((r) =>
                  r.reminderId === reminderId && (startMin === "" || r.start.slice(0, 16) === startMin)
                );
                if (idx !== -1) {
                  if (patch.title !== undefined) items[idx] = { ...items[idx], title: patch.title };
                  if (patch.due_at !== undefined) items[idx] = { ...items[idx], start: newStart, end: newEnd };
                  localStorage.setItem(SCHEDULED_REMINDERS_KEY, JSON.stringify(items));
                  setScheduledReminders([...items]);
                  window.dispatchEvent(new StorageEvent("storage", { key: SCHEDULED_REMINDERS_KEY, newValue: JSON.stringify(items) }));
                }
                setSelectedEvent((prev) => prev ? { ...prev, title: `🔔 ${patch.title ?? prev.title.replace(/^🔔\s*/, "")}`, start_datetime: newStart, end_datetime: newEnd } : prev);
              }
            }}
            onUpdateScheduleTime={(newStart, newEnd) => {
              if (!selectedEvent) return;
              const uid = selectedEvent.google_event_id ?? "";
              // Update localStorage entry
              const parsed = parseScheduledUid(uid);
              if (parsed) {
                const items = readScheduledItems();
                const idx = items.findIndex((i) =>
                  i.airtableId === parsed.airtableId &&
                  (parsed.startMin === "" || i.start.slice(0, 16) === parsed.startMin)
                );
                if (idx !== -1) {
                  items[idx] = { ...items[idx], start: newStart, end: newEnd };
                  localStorage.setItem(SCHEDULED_ITEMS_KEY, JSON.stringify(items));
                  setScheduledItems([...items]);
                  window.dispatchEvent(new StorageEvent("storage", { key: SCHEDULED_ITEMS_KEY, newValue: JSON.stringify(items) }));
                }
              }
              // Update the selected event and events list so the calendar redraws immediately
              setSelectedEvent((prev) => prev ? { ...prev, start_datetime: newStart, end_datetime: newEnd } : prev);
              setEvents((prev) => prev.map((e) =>
                e.google_event_id === uid ? { ...e, start_datetime: newStart, end_datetime: newEnd } : e
              ));
            }}
          />
        )}
      </div>

      {/* Right-click context menu for work-tracking events */}
      {newEventDraft && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/30" onClick={() => setNewEventDraft(null)}>
          <div
            className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-gray-900 mb-1">New event</h2>
            <p className="text-xs text-gray-500 mb-4">
              {new Date(newEventDraft.start).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              {" – "}
              {new Date(newEventDraft.end).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </p>
            <input
              autoFocus
              type="text"
              placeholder="Event title"
              value={newEventDraft.title}
              onChange={(e) => setNewEventDraft((d) => d ? { ...d, title: e.target.value } : d)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setNewEventDraft(null); }
                if (e.key === "Enter" && newEventDraft.title.trim()) {
                  e.preventDefault();
                  (document.getElementById("new-event-save-btn") as HTMLButtonElement | null)?.click();
                }
              }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-3"
            />
            <div className="flex gap-2 mb-3">
              {(["meeting", "action-item"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setNewEventDraft((d) => d ? { ...d, type: t } : d)}
                  className={[
                    "flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                    newEventDraft.type === t
                      ? t === "meeting"
                        ? "bg-blue-500 border-blue-500 text-white"
                        : "bg-violet-500 border-violet-500 text-white"
                      : "bg-white border-gray-200 text-gray-600 hover:border-gray-300",
                  ].join(" ")}
                >
                  {t === "meeting" ? "Meeting" : "Action Item"}
                </button>
              ))}
            </div>
            {/* Account picker */}
            <div className="relative mb-5">
              {newEventDraft.selectedAccount ? (
                <div className="flex items-center gap-2 border border-indigo-300 bg-indigo-50 rounded-lg px-3 py-2">
                  <span className="text-sm text-indigo-800 flex-1 truncate">{newEventDraft.selectedAccount.name}</span>
                  <button
                    type="button"
                    onClick={() => setNewEventDraft((d) => d ? { ...d, selectedAccount: null, accountQuery: "" } : d)}
                    className="text-indigo-400 hover:text-indigo-700 shrink-0"
                    aria-label="Remove account"
                  >
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M4.28 3.22a.75.75 0 0 0-1.06 1.06L6.94 8l-3.72 3.72a.75.75 0 1 0 1.06 1.06L8 9.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L9.06 8l3.72-3.72a.75.75 0 0 0-1.06-1.06L8 6.94 4.28 3.22z"/></svg>
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="Link to account (optional)"
                    value={newEventDraft.accountQuery}
                    onFocus={() => {
                      if (!newEventDraft.accountQuery.trim()) {
                        const results = allAccountsRef.current.slice(0, 8);
                        setNewEventDraft((d) => d ? { ...d, accountResults: results } : d);
                      }
                    }}
                    onBlur={() => {
                      setTimeout(() => setNewEventDraft((d) => d ? { ...d, accountResults: [] } : d), 150);
                    }}
                    onChange={(e) => {
                      const q = e.target.value;
                      const results = q.trim()
                        ? allAccountsRef.current.filter((a) => a.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8)
                        : allAccountsRef.current.slice(0, 8);
                      setNewEventDraft((d) => d ? { ...d, accountQuery: q, accountResults: results } : d);
                    }}
                    onKeyDown={(e) => { if (e.key === "Escape") setNewEventDraft((d) => d ? { ...d, accountQuery: "", accountResults: [] } : d); }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  {newEventDraft.accountResults.length > 0 && (
                    <ul className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-y-auto max-h-48">
                      {newEventDraft.accountResults.map((a) => (
                        <li key={a.id}>
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 transition-colors truncate"
                            onClick={() => setNewEventDraft((d) => d ? { ...d, selectedAccount: a, accountQuery: "", accountResults: [] } : d)}
                          >
                            {a.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setNewEventDraft(null)}
                className="flex-1 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                id="new-event-save-btn"
                type="button"
                disabled={!newEventDraft.title.trim() || newEventSaving}
                onClick={async () => {
                  if (!newEventDraft.title.trim()) return;
                  setNewEventSaving(true);
                  const { selectedAccount, type: draftType, title, start, end } = newEventDraft;
                  try {
                    if (draftType === "action-item") {
                      // Create a proper AirtableActionItem and schedule it on the calendar
                      const { data: newItem } = await airtableApi.createActionItem({
                        task: title.trim(),
                        status: "Open",
                        priority: "Medium",
                        account: selectedAccount?.id ?? null,
                        account_name: selectedAccount?.name ?? null,
                        estimated_time: Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000),
                      });
                      saveScheduledItem({ airtableId: newItem.airtable_id, task: newItem.task, accountName: newItem.account_name, start, end });
                      setScheduledItems(readScheduledItems());
                      // Add account link so the tile shows the account name immediately
                      if (selectedAccount) {
                        const scheduledUid = `scheduled-${newItem.airtable_id}__${start.slice(0, 16)}`;
                        setEventAccountLinks((prev) => {
                          const next = new Map(prev);
                          next.set(scheduledUid, { accountId: selectedAccount.id, accountName: selectedAccount.name });
                          return next;
                        });
                      }
                      // Signal the sidebar to refresh
                      window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated", newValue: "1" }));
                      openItemsPanel("action-items");
                    } else {
                      const payload: Partial<CalendarEvent> = {
                        title: title.trim(),
                        start_datetime: start,
                        end_datetime: end,
                        calendar_id: "primary",
                        status: "confirmed",
                        all_day: false,
                      };
                      const created = await schedulerApi.createEvent(payload);
                      setEvents((prev) => [...prev, created.data]);
                      if (selectedAccount) {
                        // Link by google_event_id if available; also by numeric id as fallback
                        // for events that haven't synced to Google yet
                        const uid = created.data.google_event_id || String(created.data.id);
                        void linkEventToAccount(selectedAccount.id, selectedAccount.name, uid);
                      }
                    }
                    setNewEventDraft(null);
                    setDropToast({ msg: `Created "${title.trim()}"`, type: "success" });
                    setTimeout(() => setDropToast(null), 3000);
                  } catch {
                    setDropToast({ msg: "Failed to create", type: "warn" });
                    setTimeout(() => setDropToast(null), 3000);
                  } finally {
                    setNewEventSaving(false);
                  }
                }}
                className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {newEventSaving ? "Saving…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {ctxMenu && (() => {
        const ev = ctxMenu.event;
        const isWorkItem = ctxMenu.type !== "meeting";
        const isRemovable = ctxMenu.type !== "meeting";
        const isMeeting = ctxMenu.type === "meeting";
        const eventDate = ev.start_datetime.slice(0, 10);
        const linkedAcct = (ev.google_event_id ? eventAccountLinks.get(ev.google_event_id) : undefined)
          ?? eventAccountLinks.get(String(ev.id));
        const accountName = linkedAcct?.accountName ?? ev.account_name ?? ev.owner_username ?? null;

        // Clamp menu to viewport
        const menuW = 220;
        const menuH = 280;
        const x = ctxMenu.x + menuW > window.innerWidth ? ctxMenu.x - menuW : ctxMenu.x;
        const y = ctxMenu.y + menuH > window.innerHeight ? ctxMenu.y - menuH : ctxMenu.y;

        function menuBtn(label: string, icon: string, onClick: () => void, danger = false) {
          return (
            <button
              key={label}
              className={[
                "w-full text-left px-3 py-2 text-[13px] flex items-center gap-2.5 transition-colors rounded-lg",
                danger ? "text-red-600 hover:bg-red-50" : "text-gray-700 hover:bg-gray-100",
              ].join(" ")}
              onClick={() => { setCtxMenu(null); onClick(); }}
            >
              <span className="text-[15px] leading-none w-4 text-center">{icon}</span>
              {label}
            </button>
          );
        }

        return (
          <>
            <div className="fixed inset-0 z-[100]" onClick={() => setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }} />
            <div
              className="fixed z-[101] bg-white border border-gray-100 rounded-xl shadow-2xl py-1.5 px-1.5 flex flex-col gap-0.5"
              style={{ top: y, left: x, minWidth: menuW }}
            >
              {/* Event title header */}
              <div className="px-3 pt-1 pb-2 border-b border-gray-100 mb-0.5">
                <p className="text-[12px] font-semibold text-gray-800 truncate max-w-[180px]">{ev.title}</p>
                {accountName && <p className="text-[11px] text-gray-400 truncate">{accountName}</p>}
              </div>

              {/* 1. Edit — open event detail panel */}
              {menuBtn("Edit", "✏️", () => {
                setSelectedEvent(ev);
                setMeetingPanelCollapsed(false);
              })}

              {/* 1b. Comment */}
              {isMeeting && menuBtn("Comment", "💬", () => {
                const cx = ctxMenu.x;
                const cy = ctxMenu.y;
                const rlabel = ev.title;
                // FullCalendar strips `id` from extendedProps (it's a standard FC prop),
                // so ev.id is always undefined. Look up the Django PK by google_event_id.
                const calEv = eventsRef.current.find(e =>
                  e.google_event_id === ev.google_event_id || String(e.id) === ctxMenu.airtableId
                );
                const rid = calEv?.id ?? 0;
                if (!rid) return;
                requestAnimationFrame(() => {
                  openComments({ resourceType: "calendar_event", resourceId: rid, resourceLabel: rlabel, x: cx, y: cy });
                });
              })}

              {/* 2. Copy details */}
              {menuBtn("Copy details", "📋", () => {
                const start = new Date(ev.start_datetime).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
                const end = new Date(ev.end_datetime).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
                const lines = [ev.title, `${start} – ${end}`];
                if (accountName) lines.push(accountName);
                if (ev.description) lines.push(ev.description);
                if (ev.location) lines.push(`📍 ${ev.location}`);
                if (ev.meet_link) lines.push(ev.meet_link);
                navigator.clipboard.writeText(lines.join("\n")).catch(() => {});
              })}

              {/* 3. Convert — meeting ↔ action item */}
              {menuBtn(
                isMeeting ? "Convert to action item" : "Convert to meeting",
                isMeeting ? "✅" : "📅",
                () => {
                  setNewEventDraft({
                    start: ev.start_datetime,
                    end: ev.end_datetime,
                    title: ev.title,
                    type: isMeeting ? "action-item" : "meeting",
                    accountQuery: accountName ?? "",
                    selectedAccount: linkedAcct ? { id: linkedAcct.accountId, name: linkedAcct.accountName } : null,
                    accountResults: [],
                  });
                }
              )}

              {/* 4. Add reminder — 10 min before the event */}
              {menuBtn("Add reminder", "🔔", () => {
                const due = new Date(ev.start_datetime);
                due.setMinutes(due.getMinutes() - 10);
                const dueStr = due.toISOString().slice(0, 16) + ":00";
                schedulerApi.createReminder({
                  title: `Reminder: ${ev.title}`,
                  body: "",
                  due_at: dueStr,
                  resource_type: "calendar_event",
                  resource_id: String(ev.id > 0 ? ev.id : ev.google_event_id),
                  resource_label: ev.title,
                  notify_in_app: true,
                }).then(({ data: r }) => {
                  const startLocal = toLocalISO(due.toISOString().slice(0, 19));
                  const endLocal = addMsToLocalISO(due.toISOString().slice(0, 19), 15 * 60 * 1000);
                  saveScheduledReminder({ reminderId: r.id, title: r.title, start: startLocal, end: endLocal });
                  setScheduledReminders(readScheduledReminders());
                  window.dispatchEvent(new StorageEvent("storage", { key: "remindersUpdated", newValue: "1" }));
                }).catch(() => {});
              })}

              {/* 5. Log time — switch to log time mode for this event's account */}
              {menuBtn("Log time", "⏱", () => {
                if (accountName) {
                  setLogTimeModeAccount(accountName);
                  setSelectedAccountName(accountName);
                  setContentView("accounts");
                }
              })}

              {/* 6. Mark as logged */}
              {menuBtn(
                loggedDates.has(`${eventDate}||${accountName ?? ""}`) ? "Unmark as logged" : "Mark as logged",
                "✓",
                () => {
                  if (!accountName) return;
                  const key = `logtime::${accountName}::manuallyLoggedDays`;
                  const existing: string[] = JSON.parse(localStorage.getItem(key) ?? "[]");
                  const idx = existing.indexOf(eventDate);
                  if (idx === -1) existing.push(eventDate); else existing.splice(idx, 1);
                  localStorage.setItem(key, JSON.stringify(existing));
                  setLoggedDates(readLoggedDates());
                  window.dispatchEvent(new StorageEvent("storage", { key: LOGGED_DATES_EVENT }));
                }
              )}

              {/* Divider + 7. Remove from calendar (work items only) */}
              {isRemovable && (
                <>
                  <div className="border-t border-gray-100 my-0.5" />
                  {menuBtn("Remove from calendar", "🗑", () => {
                    let uid: string;
                    if (ctxMenu.type === "db-work") uid = ctxMenu.airtableId;
                    else if (ctxMenu.type === "scheduled") uid = `scheduled-${ctxMenu.airtableId}`;
                    else uid = `active-timer-${ctxMenu.airtableId}`;
                    handleRemoveFromCalendar(uid);
                  }, true)}
                </>
              )}
            </div>
          </>
        );
      })()}

      {/* ── Scrollable main content ── */}
      <div
        className="flex-1 overflow-auto py-8 transition-[padding] duration-200"
        style={{
          paddingLeft,
          paddingRight: (selectedEvent ? (meetingPanelCollapsed ? GAP : MEETING_W + GAP) : 0) + (itemsPanelOpen ? ACTION_W + GAP : 72),
        }}
      >
        {/* Attendee-confirmation modal for meeting reschedule */}
        {pendingReschedule && (() => {
          const { ev, newStart, newEnd } = pendingReschedule;
          const others = (ev.attendees ?? []).filter((a) => a.email && a.email !== userEmail);
          const fmtDt = (iso: string) => {
            const d = new Date(iso);
            return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
          };
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setPendingReschedule(null)}>
              <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                    <svg viewBox="0 0 20 20" fill="none" stroke="#d97706" strokeWidth="1.6" className="w-5 h-5">
                      <path d="M10 2a8 8 0 100 16A8 8 0 0010 2zm0 4v4m0 3h.01" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--twilio-navy)]">Move meeting for all attendees?</h3>
                    <p className="text-xs text-gray-500 mt-1">
                      <span className="font-medium text-gray-700">{ev.title}</span> has {others.length} other attendee{others.length !== 1 ? "s" : ""}.
                    </p>
                    <p className="text-xs text-gray-500 mt-2">
                      New time: <span className="font-medium text-gray-700">{fmtDt(newStart)}</span>
                      {" – "}
                      <span className="font-medium text-gray-700">{new Date(newEnd).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
                    </p>
                    {others.length <= 5 && (
                      <p className="text-xs text-gray-400 mt-1 truncate">
                        {others.map((a) => a.displayName || a.email).join(", ")}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setPendingReschedule(null)}
                    className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      applyMeetingReschedule(ev, newStart, newEnd);
                      setPendingReschedule(null);
                    }}
                    className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors"
                  >
                    Move meeting
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {dropToast && (
          <div className={[
            "fixed bottom-6 right-6 z-50 flex items-center gap-2 text-sm px-4 py-2.5 rounded-xl shadow-lg transition-all",
            dropToast.type === "success"
              ? "bg-[var(--twilio-navy)] text-white"
              : "bg-amber-500 text-white",
          ].join(" ")}>
            {dropToast.type === "success"
              ? <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 shrink-0"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
              : <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 shrink-0"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
            }
            {dropToast.msg}
          </div>
        )}
        {lastLinkedEventName && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-indigo-600 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 shrink-0"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
            Account linked to <span className="font-semibold ml-1 truncate max-w-[180px]">{lastLinkedEventName}</span>
          </div>
        )}
        <div className="text-center mb-6">
          <h1 className="text-3xl font-semibold text-[var(--twilio-navy)] flex items-center justify-center gap-2"><CalendarIcon width={24} height={24} style={{ flexShrink: 0 }} />Calendar</h1>
          <p className="text-sm text-[var(--twilio-navy)] mt-1">
            Synced from Google Calendar. Ask the agent to schedule events.
          </p>
        </div>

        {/* Calendar — takes full available width */}
        <div className="relative">
        <div ref={calendarWrapRef} className="bg-white rounded-lg border border-gray-200 shadow-sm p-4" data-content-view={contentView}>
          <style>{`
            /* Base colour for all toolbar buttons */
            .fc .fc-button {
              background-color: #606B85 !important;
              border-color: #606B85 !important;
              color: #fff !important;
            }
            .fc .fc-button:hover {
              background-color: #4e5870 !important;
              border-color: #4e5870 !important;
            }
            /* FC-native active state (e.g. current view: week/month/day) */
            .fc .fc-button-active,
            .fc .fc-button:not(:disabled):active,
            .fc .fc-button-group .fc-button-active,
            .fc .fc-button-group .fc-button:not(:disabled):active {
              background-color: #1f2937 !important;
              border-color: #1f2937 !important;
              color: #fff !important;
            }
            /* Action-item drag shadow — semi-transparent purple ghost block */
            .fc-event-mirror {
              opacity: 0.55 !important;
              border-style: dashed !important;
              border-width: 2px !important;
            }
            /* Content-view filter button active state */
            [data-content-view="all"] .fc-viewAll-button,
            [data-content-view="meetings"] .fc-viewMeetings-button,
            [data-content-view="action-items"] .fc-viewActionItems-button,
            [data-content-view="reminders"] .fc-viewReminders-button,
            [data-content-view="accounts"] .fc-viewAccounts-button {
              background-color: #1f2937 !important;
              border-color: #1f2937 !important;
              color: #fff !important;
            }
            /* 15-minute (short) events: slim the resize handle so the click/drag-move
               area isn't swallowed — the default 8px handle is too large for ~22px events */
            .fc-timegrid-event.fc-short {
              min-height: 22px !important;
            }
            .fc-timegrid-event.fc-short .fc-event-resizer-end {
              height: 4px !important;
              cursor: s-resize;
            }
            .fc-timegrid-event.fc-short .fc-event-resizer-start {
              height: 4px !important;
              cursor: n-resize;
            }
          `}</style>
          <FullCalendar
            ref={calendarRef}
            weekends={showWeekends}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            customButtons={{
              toggleWeekends: {
                text: showWeekends ? "Hide weekends" : "Show weekends",
                click: () => setShowWeekends((prev) => !prev),
              },
              viewAll: {
                text: "All",
                click: () => { setContentView("all"); setSelectedAccountName(null); },
              },
              viewMeetings: {
                text: "Meetings",
                click: () => { setContentView("meetings"); setSelectedAccountName(null); },
              },
              viewActionItems: {
                text: "Action Items",
                click: () => { setContentView("action-items"); setSelectedAccountName(null); openItemsPanel("action-items"); },
              },
              viewReminders: {
                text: "Reminders",
                click: () => { setContentView("reminders"); setSelectedAccountName(null); openItemsPanel("reminders"); },
              },
              viewAccounts: {
                text: "Accounts",
                click: () => { setContentView("accounts"); setAccountPanelOpen(true); },
              },
            }}
            headerToolbar={{
              left: "prev,next today",
              center: "title",
              right: "viewAll,viewMeetings,viewActionItems,viewReminders,viewAccounts toggleWeekends dayGridMonth,timeGridWeek,timeGridDay",
            }}
            events={filteredEvents.map((e) => {
              const base = toFullCalendarEvent(e);
              if (e.google_event_id && absentEventIds.has(e.google_event_id)) {
                return { ...base, backgroundColor: "#d1d5db", borderColor: "#9ca3af" };
              }
              const date = e.start_datetime.slice(0, 10);
              const linkedAcctName =
                (e.google_event_id ? eventAccountLinks.get(e.google_event_id) : undefined)?.accountName
                ?? eventAccountLinks.get(String(e.id))?.accountName
                ?? e.account_name
                ?? (e.owner_username || null);
              if (linkedAcctName && loggedDates.has(`${date}||${linkedAcctName}`)) {
                const faded = fadeColor(base.backgroundColor as string);
                return { ...base, backgroundColor: faded, borderColor: faded };
              }
              return base;
            })}
            eventContent={(arg) => {
              const e = arg.event.extendedProps as CalendarEvent;
              const isWorkSession = e.calendar_id === "work_tracking";
              const rsvp = isWorkSession ? null : getRsvp(e, userEmail);
              const declined = rsvp === "declined";
              const absent = !!(e.google_event_id && absentEventIds.has(e.google_event_id));
              const linkedAcctFromMap = (e.google_event_id ? eventAccountLinks.get(e.google_event_id) : undefined)
                ?? eventAccountLinks.get(String(e.id));
              const linkedAcct = linkedAcctFromMap
                ?? (e.account_name ? { accountName: e.account_name, accountId: 0 } : null)
                ?? (e.owner_username && e.calendar_id === "work_tracking" ? { accountName: e.owner_username, accountId: 0 } : null);
              const durationMs = arg.event.end && arg.event.start
                ? arg.event.end.getTime() - arg.event.start.getTime()
                : Infinity;
              const isShort = durationMs <= 15 * 60 * 1000;
              const acctStyle = { color: "rgba(255,255,255,0.75)" };
              if (isShort) {
                // 15-min events: 2 very tight lines at 9px so title + time + account all fit
                return (
                  <div className={["flex flex-col px-1 py-0 w-full overflow-hidden min-h-0 gap-[1px]", absent ? "opacity-60" : ""].join(" ")}>
                    <div className="flex items-center gap-0.5 min-w-0">
                      {rsvp && !absent && <RsvpDot rsvp={rsvp} />}
                      <span className={["text-[9px] font-semibold leading-none truncate min-w-0", declined ? "line-through opacity-50" : "", absent ? "italic" : ""].join(" ")}>
                        {arg.event.title}
                      </span>
                    </div>
                    {(arg.timeText || linkedAcct) && (
                      <span className="text-[9px] leading-none truncate opacity-80 flex items-center gap-0.5">
                        {arg.timeText && <span className={declined ? "line-through opacity-40" : ""}>{arg.timeText}</span>}
                        {linkedAcct && <span className="italic truncate" style={acctStyle}>· {linkedAcct.accountName}</span>}
                      </span>
                    )}
                  </div>
                );
              }
              return (
                <div className={["flex flex-col px-1 py-0 w-full overflow-hidden min-h-0", absent ? "opacity-60" : ""].join(" ")}>
                  <div className="flex items-start gap-1">
                    {rsvp && !absent && <RsvpDot rsvp={rsvp} />}
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className={["text-[11px] font-medium leading-tight truncate", declined ? "line-through opacity-50" : "", absent ? "italic" : ""].join(" ")}>
                        {arg.event.title}
                      </span>
                      {arg.timeText && (
                        <span className={["text-[10px] leading-tight truncate opacity-80", declined ? "line-through opacity-40" : "", absent ? "italic" : ""].join(" ")}>
                          {arg.timeText}
                        </span>
                      )}
                    </div>
                  </div>
                  {linkedAcct && (
                    <span className="text-[10px] italic leading-tight truncate mt-auto pt-0.5 text-right ml-auto block w-full" style={acctStyle}>
                      {linkedAcct.accountName}
                    </span>
                  )}
                </div>
              );
            }}
            eventDidMount={(info) => {
              const el = info.el;
              const extProps = info.event.extendedProps as CalendarEvent;
              // Use google_event_id when available; fall back to DB id so locally-created
              // events (not yet synced to Google) can also accept account drops.
              const uid = extProps.google_event_id || (extProps.id ? String(extProps.id) : "");
              if (!uid) return;
              el.addEventListener("dragover", (e) => {
                // Only intercept when an account card is being dragged — not during FC's own event drags
                if (!(window as unknown as Record<string, string>)[CALENDAR_DRAG_ACCOUNT_KEY]) return;
                e.preventDefault();
                el.style.outline = "2px solid #6366f1";
                el.style.borderRadius = "4px";
              });
              el.addEventListener("dragleave", () => { el.style.outline = ""; });
              el.addEventListener("drop", (e) => {
                el.style.outline = "";
                const accountId = Number((window as unknown as Record<string, string>)[CALENDAR_DRAG_ACCOUNT_KEY]);
                const accountName = (window as unknown as Record<string, string>)[`${CALENDAR_DRAG_ACCOUNT_KEY}_name`] || "";
                // Only handle account-card drops; let FC handle its own event-drag drops
                if (!accountId) return;
                e.preventDefault();
                e.stopPropagation();
                delete (window as unknown as Record<string, string>)[CALENDAR_DRAG_ACCOUNT_KEY];
                delete (window as unknown as Record<string, string>)[`${CALENDAR_DRAG_ACCOUNT_KEY}_name`];
                linkEventToAccountRef.current(accountId, accountName, uid);
              });
              // Right-click context menu — all events
              el.addEventListener("contextmenu", (e) => {
                e.preventDefault();
                let type: "scheduled" | "timer" | "db-work" | "meeting" = "meeting";
                let uidBody = uid;
                if (uid.startsWith("active-timer-")) {
                  type = "timer";
                  uidBody = uid.slice("active-timer-".length);
                } else if (uid.startsWith("scheduled-")) {
                  type = "scheduled";
                  uidBody = uid.slice("scheduled-".length);
                } else if (extProps.calendar_id === "work_tracking" && extProps.is_synced && !!extProps.agentpm_airtable_id) {
                  type = "db-work";
                  uidBody = uid;
                } else {
                  type = "meeting";
                  uidBody = uid;
                }
                setCtxMenu({ x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY, airtableId: uidBody, type, event: extProps });
              });
            }}
            selectable
            select={handleDateSelect}
            eventClick={handleEventClick}
            datesSet={handleDatesSet}
            editable
            droppable
            drop={handleCalendarDrop}
            eventResize={handleEventResize}
            eventDrop={handleEventDrop}
            eventDragStart={(info) => {
              const wrap = calendarWrapRef.current;
              if (!wrap) return;
              const ms = getMsFromY(wrap, (info.jsEvent as MouseEvent).clientY);
              if (ms !== null) dragInfoRef.current = { startMs: Math.round(ms / (15 * 60000)) * 15 * 60000 };
            }}
            eventDragStop={() => { dragInfoRef.current = null; setHoverTooltip(null); }}
            eventResizeStart={(info) => {
              const wrap = calendarWrapRef.current;
              if (!wrap) return;
              const ms = getMsFromY(wrap, (info.jsEvent as MouseEvent).clientY);
              if (ms !== null) dragInfoRef.current = { startMs: Math.round(ms / (15 * 60000)) * 15 * 60000 };
            }}
            eventResizeStop={() => { dragInfoRef.current = null; setHoverTooltip(null); }}
            slotDuration="00:15:00"
            slotLabelInterval="00:30:00"
            allDaySlot={false}
            height={calendarExpanded ? "60rem" : "43rem"}
            nowIndicator
            scrollTime={calendarExpanded ? "09:00:00" : "07:00:00"}
            slotMinTime="00:00:00"
            slotMaxTime="24:00:00"
            eventMinHeight={22}
            eventShortHeight={44}
          />

          {/* Daily time totals footer */}
          {visibleDays.length > 0 && (
            <div className="mt-2 border-t border-gray-100 pt-1">
              <div className="relative h-6">
                {visibleDays.map((day, idx) => {
                  const label = fmtMins(dailyTotals[day] ?? 0);
                  const pos = colPositions[day];
                  if (!pos) return null;
                  const isLast = idx === visibleDays.length - 1;
                  return (
                    <span
                      key={day}
                      className="absolute top-0 h-full flex items-center"
                      style={{ left: pos.left, width: pos.width }}
                    >
                      {/* Day total — centered in the column */}
                      {label && (
                        <span className="flex-1 text-center text-[10px] font-semibold text-indigo-600">
                          {label}
                        </span>
                      )}
                      {/* Weekly total — tucked into the right side of the last column */}
                      {isLast && weekTotal > 0 && (
                        <span className="flex flex-col items-end justify-center pr-1 shrink-0">
                          <span className="text-[11px] font-bold text-[var(--twilio-navy)] leading-none">{fmtMins(weekTotal)}</span>
                          <span className="text-[9px] text-[var(--twilio-gray-60)] uppercase tracking-wide leading-none mt-0.5">total</span>
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Month-view weekly + monthly totals overlay */}
        {currentView === "dayGridMonth" && monthWeekRows.length > 0 && (() => {
          const monthTotal = visibleDays.reduce((s, d) => s + (dailyTotals[d] ?? 0), 0);
          return (
            <>
              {monthWeekRows.map((row, i) => {
                const weekSecs = row.weekDates.reduce((s, d) => s + (dailyTotals[d] ?? 0), 0);
                if (weekSecs <= 0) return null;
                return (
                  <div
                    key={i}
                    className="absolute right-0 flex items-center justify-end pointer-events-none pr-2"
                    style={{ top: row.top, height: row.height, zIndex: 5 }}
                  >
                    <span className="bg-white/90 border border-indigo-100 rounded-lg px-2 py-0.5 text-[10px] font-semibold text-indigo-600 shadow-sm">
                      {fmtMins(weekSecs)}
                    </span>
                  </div>
                );
              })}
              {monthTotal > 0 && (
                <div className="flex justify-end pr-2 mt-1.5">
                  <span className="flex items-center gap-1.5 bg-[var(--twilio-navy)] text-white rounded-lg px-3 py-1 text-[11px] font-semibold shadow-sm">
                    <span className="opacity-70 font-normal">Month total</span>
                    {fmtMins(monthTotal)}
                  </span>
                </div>
              )}
            </>
          );
        })()}

        {/* Expand/collapse tab — sits on the bottom border of the calendar */}
        <div className="flex justify-center">
          <button
            onClick={() => setCalendarExpanded((v) => !v)}
            title={calendarExpanded ? "Collapse calendar" : "Expand calendar (9am–5pm)"}
            className="flex items-center justify-center px-5 py-0.5 -mt-px rounded-b-lg bg-white border border-t-0 border-gray-200 shadow-sm text-[var(--twilio-gray-60)] hover:text-[var(--twilio-navy)] hover:border-gray-300 transition-colors text-[11px] font-semibold select-none tracking-widest"
          >
            {calendarExpanded ? "↑" : "↓"}
          </button>
        </div>
        </div>{/* end outer relative wrapper */}

        {/* Log Time panel — appears below calendar when mode is active */}
        {logTimeModeAccount && (
          <LogTimePanel
            key={logTimeModeAccount}
            accountName={logTimeModeAccount}
            visibleDays={visibleDays}
            events={filteredEvents}
            eventAccountLinks={eventAccountLinks}
            scheduledItems={scheduledItems}
            weekStart={visibleDays[0] ?? ""}
            onExit={() => setLogTimeModeAccount(null)}
          />
        )}

        {/* Account context — full width below the calendar */}
        {selectedEvent && (
          <>
            <DayBar
              events={events}
              selectedEvent={selectedEvent}
              onSelect={setSelectedEvent}
            />
            <MeetingDetail
              event={selectedEvent}
              reloadTrigger={meetingDetailReloadTrigger}
              attended={!selectedEvent.google_event_id || !absentEventIds.has(selectedEvent.google_event_id)}
              onToggleAttendance={() => {
                const uid = selectedEvent.google_event_id;
                if (!uid) return;
                setAbsentEventIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(uid)) next.delete(uid); else next.add(uid);
                  return next;
                });
              }}
            />
          </>
        )}
      </div>

      {/* ── Calendar hover time tooltip ──────────────────────────────────────── */}
      {hoverTooltip && (
        <div
          className="fixed z-[9999] pointer-events-none select-none"
          style={{ left: hoverTooltip.x + 14, top: hoverTooltip.y - 10 }}
        >
          <div className="bg-[var(--twilio-navy)] text-white text-[11px] font-semibold px-2.5 py-1 rounded-lg shadow-lg whitespace-nowrap">
            {hoverTooltip.label}
          </div>
        </div>
      )}
    </div>
  );
}
