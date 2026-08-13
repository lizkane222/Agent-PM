import { useState, useEffect } from "react";
import { useActionItemFieldOptions } from "../../hooks/useActionItemFieldOptions";
import DOMPurify from "dompurify";
import { schedulerApi } from "../../lib/api";
import { toLocalISO } from "twilio-agent-pm-shared";
import type { CalendarEvent, AirtableActionItem } from "../../types";
import type { EventCategory } from "../../types/calendar";
import CorporateIcon from "../../assets/icons/Corporate.svg?react";
import {
  WORK_TRACKING_COLOR,
  CATEGORY_COLORS,
  PRIORITY_COLORS_CAL,
  STATUS_COLORS_CAL,
  CalPillSelect,
  CalPillNumber,
  CalPillDate,
  CALENDAR_DRAG_EVENT_KEY,
  CALENDAR_DRAG_ACCOUNT_KEY,
} from "./calendarHelpers";
import type { CalCreateForm } from "./calendarHelpers";

const EDIT_CATEGORY_META: { id: EventCategory; label: string; icon: string; activeClass: string }[] = [
  { id: "meeting",          label: "Meeting",          icon: "🗓", activeClass: "bg-blue-500  border-blue-500  text-white" },
  { id: "task",             label: "Task",             icon: "✓",  activeClass: "bg-pink-500  border-pink-500  text-white" },
  { id: "out_of_office",   label: "Out of Office",    icon: "🚫", activeClass: "bg-rose-500  border-rose-500  text-white" },
  { id: "focus_time",      label: "Focus Time",       icon: "🎯", activeClass: "bg-amber-500 border-amber-500 text-white" },
  { id: "working_location", label: "Working Location", icon: "📍", activeClass: "bg-emerald-500 border-emerald-500 text-white" },
  { id: "appointment",     label: "Appointment",      icon: "📅", activeClass: "bg-indigo-500 border-indigo-500 text-white" },
];

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function statusColor(status: CalendarEvent["status"]): string {
  return status === "cancelled"
    ? "#d1d5db"
    : status === "tentative"
    ? "#60a5fa"
    : "#3b82f6"; // blue-500 — meetings
}

export interface EventDetailPanelProps {
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
  onSaveMeeting?: (updated: CalendarEvent) => void;
}

export default function EventDetailPanel({ event, onClose, onCollapse, linkedAccount, onDropAccount, onUnlink, onRemove, onDelete, onUpdateReminder, actionItem, onUpdateActionItem, onUpdateScheduleTime, onSaveMeeting }: EventDetailPanelProps) {
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
  // Solo meeting: regular calendar event with 0 or 1 attendee (the organizer) — editable
  const isSoloMeeting = !isWorkSession && !isScheduledReminder && !isScheduledActionItem && event.attendees.length <= 1;

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

  // Meeting edit state (solo meetings only)
  const [meetingEditing, setMeetingEditing] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState(event.title);
  const [meetingStartDate, setMeetingStartDate] = useState(() => toDatetimeLocal(event.start_datetime).slice(0, 10));
  const [meetingStartTime, setMeetingStartTime] = useState(() => toDatetimeLocal(event.start_datetime).slice(11));
  const [meetingEndDate, setMeetingEndDate] = useState(() => toDatetimeLocal(event.end_datetime).slice(0, 10));
  const [meetingEndTime, setMeetingEndTime] = useState(() => toDatetimeLocal(event.end_datetime).slice(11));
  const [meetingDesc, setMeetingDesc] = useState(event.description ?? "");
  const [meetingCategory, setMeetingCategory] = useState<EventCategory>(event.event_category ?? "meeting");
  const [meetingSaving, setMeetingSaving] = useState(false);

  // Reset meeting form when the event prop changes (e.g. different event selected)
  useEffect(() => {
    setMeetingEditing(false);
    setMeetingTitle(event.title);
    const startLocal = toDatetimeLocal(event.start_datetime);
    const endLocal = toDatetimeLocal(event.end_datetime);
    setMeetingStartDate(startLocal.slice(0, 10));
    setMeetingStartTime(startLocal.slice(11));
    setMeetingEndDate(endLocal.slice(0, 10));
    setMeetingEndTime(endLocal.slice(11));
    setMeetingDesc(event.description ?? "");
    setMeetingCategory(event.event_category ?? "meeting");
  }, [event.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function commitMeetingEdit() {
    if (!onSaveMeeting) return;
    setMeetingSaving(true);
    try {
      const startISO = toLocalISO(`${meetingStartDate}T${meetingStartTime}:00`);
      const endISO = toLocalISO(`${meetingEndDate}T${meetingEndTime}:00`);
      const { data: updated } = await schedulerApi.updateEvent(event.id, {
        title: meetingTitle.trim() || event.title,
        start_datetime: startISO,
        end_datetime: endISO,
        description: meetingDesc,
        event_category: meetingCategory,
      } as Partial<CalendarEvent>);
      onSaveMeeting(updated);
      setMeetingEditing(false);
    } catch {
      // best-effort
    } finally {
      setMeetingSaving(false);
    }
  }

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
        resource_id: event.id,
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

  const headerColor = isWorkSession
    ? WORK_TRACKING_COLOR
    : isScheduledReminder
    ? "#f59e0b"
    : (CATEGORY_COLORS[event.event_category ?? "meeting"] ?? statusColor(event.status));

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
      ) : meetingEditing ? (
        /* ── Meeting edit form ── */
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
          <div>
            <p className="text-[11px] text-[var(--twilio-gray-60)] uppercase tracking-wide font-semibold mb-1">Title</p>
            <input
              autoFocus
              value={meetingTitle}
              onChange={(e) => setMeetingTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void commitMeetingEdit(); if (e.key === "Escape") setMeetingEditing(false); }}
              className="w-full text-sm text-[var(--twilio-navy)] rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 focus:outline-none focus:border-indigo-400 focus:bg-white transition-colors"
            />
          </div>
          <div className="flex flex-col gap-2">
            <div>
              <p className="text-[11px] text-[var(--twilio-gray-60)] uppercase tracking-wide font-semibold mb-1">Start</p>
              <div className="flex gap-1.5">
                <input
                  type="date"
                  value={meetingStartDate}
                  onChange={(e) => {
                    const newDate = e.target.value;
                    setMeetingStartDate(newDate);
                    if (`${newDate}T${meetingStartTime}` >= `${meetingEndDate}T${meetingEndTime}`) {
                      const durMs = Math.max(
                        new Date(`${meetingEndDate}T${meetingEndTime}`).getTime() - new Date(`${meetingStartDate}T${meetingStartTime}`).getTime(),
                        15 * 60 * 1000
                      );
                      const local = toDatetimeLocal(new Date(new Date(`${newDate}T${meetingStartTime}`).getTime() + durMs).toISOString());
                      setMeetingEndDate(local.slice(0, 10));
                      setMeetingEndTime(local.slice(11));
                    }
                  }}
                  className="flex-1 min-w-0 text-sm rounded-md border border-gray-200 px-2 py-1.5 focus:outline-none focus:border-indigo-300 [color-scheme:light]"
                />
                <input
                  type="time"
                  value={meetingStartTime}
                  onChange={(e) => {
                    const newTime = e.target.value;
                    setMeetingStartTime(newTime);
                    if (`${meetingStartDate}T${newTime}` >= `${meetingEndDate}T${meetingEndTime}`) {
                      const local = toDatetimeLocal(new Date(new Date(`${meetingStartDate}T${newTime}`).getTime() + 30 * 60 * 1000).toISOString());
                      setMeetingEndDate(local.slice(0, 10));
                      setMeetingEndTime(local.slice(11));
                    }
                  }}
                  className="w-[5.5rem] text-sm rounded-md border border-gray-200 px-2 py-1.5 focus:outline-none focus:border-indigo-300 [color-scheme:light]"
                />
              </div>
            </div>
            <div>
              <p className="text-[11px] text-[var(--twilio-gray-60)] uppercase tracking-wide font-semibold mb-1">End</p>
              <div className="flex gap-1.5">
                <input
                  type="date"
                  value={meetingEndDate}
                  min={meetingStartDate}
                  onChange={(e) => setMeetingEndDate(e.target.value)}
                  className="flex-1 min-w-0 text-sm rounded-md border border-gray-200 px-2 py-1.5 focus:outline-none focus:border-indigo-300 [color-scheme:light]"
                />
                <input
                  type="time"
                  value={meetingEndTime}
                  onChange={(e) => setMeetingEndTime(e.target.value)}
                  className="w-[5.5rem] text-sm rounded-md border border-gray-200 px-2 py-1.5 focus:outline-none focus:border-indigo-300 [color-scheme:light]"
                />
              </div>
            </div>
          </div>
          <div>
            <p className="text-[11px] text-[var(--twilio-gray-60)] uppercase tracking-wide font-semibold mb-1">Type</p>
            <div className="flex flex-wrap gap-1.5">
              {EDIT_CATEGORY_META.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setMeetingCategory(cat.id)}
                  className={[
                    "inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-full border transition-colors",
                    meetingCategory === cat.id
                      ? cat.activeClass
                      : "bg-white border-gray-200 text-[var(--twilio-gray-60)] hover:border-gray-400 hover:text-gray-700",
                  ].join(" ")}
                >
                  <span>{cat.icon}</span>
                  {cat.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[11px] text-[var(--twilio-gray-60)] uppercase tracking-wide font-semibold mb-1">Description</p>
            <textarea
              value={meetingDesc}
              onChange={(e) => setMeetingDesc(e.target.value)}
              rows={3}
              placeholder="Optional notes…"
              className="w-full text-sm text-[var(--twilio-navy)] rounded-md border border-gray-200 px-3 py-1.5 focus:outline-none focus:border-indigo-300 resize-none leading-relaxed placeholder:text-gray-400"
            />
          </div>
          {/* Account drop zone remains visible during edit mode */}
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
              <p className="text-[var(--twilio-gray-60)] text-center text-xs">Drop an account to link</p>
            )}
          </div>
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
        {isSoloMeeting && onSaveMeeting && (
          meetingEditing ? (
            <div className="flex gap-2">
              <button
                onClick={() => setMeetingEditing(false)}
                className="flex-1 text-[12px] font-medium py-2 rounded-lg border border-gray-200 text-[var(--twilio-gray-60)] hover:bg-gray-50 transition-colors"
              >Cancel</button>
              <button
                onClick={() => void commitMeetingEdit()}
                disabled={meetingSaving || !meetingTitle.trim()}
                className="flex-1 text-[12px] font-semibold py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >{meetingSaving ? "Saving…" : "Save"}</button>
            </div>
          ) : (
            <button
              onClick={() => setMeetingEditing(true)}
              className="w-full text-[12px] font-semibold py-2 rounded-lg border border-indigo-200 text-indigo-600 hover:bg-indigo-50 transition-colors"
            >Edit meeting</button>
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
