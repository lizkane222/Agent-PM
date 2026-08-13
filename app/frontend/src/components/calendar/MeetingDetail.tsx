import React, { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import type {
  Account,
  AccountTeamMember,
  ActionItemAttachment,
  AirtableAccount,
  AirtableActionItem,
  AirtableMeeting,
  CalendarEvent,
  EventMatchResult,
  MeetingNote,
  Reminder,
  SalesforceProject,
  TeamMember,
} from "../../types";
import { accountsApi, airtableApi, integrationsApi, salesforceApi, schedulerApi, teamApi } from "../../lib/api";
import { getAccessToken } from "../../lib/auth";
import { useCurrentUser } from "../../context/CurrentUserContext";
import { useCommentContext } from "../comments/CommentContext";
import InlineCommentThread from "../comments/InlineCommentThread";
import KanbanCard from "./KanbanCard";
import LogTimeModal from "./LogTimeModal";
import ActivityLogSection from "../ActivityLogSection";
import { convertActionItemToEvent, convertEventToActionItem, restoreConversion } from "../../hooks/useConvert";

interface Props {
  event: CalendarEvent;
  attended?: boolean;
  onToggleAttendance?: () => void;
  reloadTrigger?: number;
}

const KANBAN_COLUMNS: AirtableActionItem["status"][] = [
  "Open",
  "In Progress",
  "Done",
  "Blocked",
  "Backlogged",
];

function formatDuration(seconds: number): string {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── Attachments Section (reused inside ActionItemEditModal) ──────────────────

function AttachmentsSection({ item }: { item: AirtableActionItem }) {
  const [attachments, setAttachments] = useState<ActionItemAttachment[]>(item.attachments ?? []);
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [addingLink, setAddingLink] = useState(false);

  useEffect(() => {
    airtableApi.listAttachments(item.id)
      .then(({ data }) => setAttachments((data as { results?: ActionItemAttachment[] }).results ?? (data as ActionItemAttachment[])))
      .catch(() => {});
  }, [item.id]);

  async function handleAddLink() {
    if (!linkName.trim() || !linkUrl.trim()) return;
    try {
      const { data } = await airtableApi.addAttachmentLink(item.id, linkName.trim(), linkUrl.trim());
      setAttachments(prev => [...prev, data]);
      setLinkName(""); setLinkUrl(""); setAddingLink(false);
    } catch { /* keep form open */ }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { data } = await airtableApi.uploadAttachmentFile(item.id, file);
      setAttachments(prev => [...prev, data]);
    } catch { /* silent */ }
    e.target.value = "";
  }

  async function handleDelete(attachmentId: number) {
    try {
      await airtableApi.deleteAttachment(item.id, attachmentId);
      setAttachments(prev => prev.filter(a => a.id !== attachmentId));
    } catch { /* silent */ }
  }

  return (
    <div>
      <label className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)] font-semibold mb-2 block">Attachments</label>
      {attachments.length > 0 && (
        <ul className="space-y-1 mb-2">
          {attachments.map(a => (
            <li key={a.id} className="flex items-center gap-2 text-sm">
              <a href={a.url ?? undefined} target="_blank" rel="noreferrer" className="flex-1 truncate text-indigo-600 hover:underline text-xs">{a.name || a.url}</a>
              <button
                type="button"
                onClick={() => void handleDelete(a.id)}
                className="shrink-0 text-gray-300 hover:text-red-400 transition-colors text-sm leading-none"
                title="Remove"
              >×</button>
            </li>
          ))}
        </ul>
      )}
      {attachments.length === 0 && <p className="text-xs text-gray-400 italic mb-2">No attachments.</p>}
      <div className="flex gap-2">
        <label className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border border-dashed border-gray-300 text-xs text-gray-500 hover:border-indigo-300 hover:text-indigo-600 cursor-pointer transition-colors">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 shrink-0"><path d="M8 2v8M5 5l3-3 3 3" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 12h12" strokeLinecap="round"/></svg>
          Upload
          <input type="file" className="sr-only" onChange={handleUpload} />
        </label>
        <button
          type="button"
          onClick={() => setAddingLink(v => !v)}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border border-dashed border-gray-300 text-xs text-gray-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 shrink-0"><path d="M6 9a3 3 0 0 0 4.5.4l1.5-1.5a3 3 0 0 0-4.2-4.2L6.5 5" strokeLinecap="round"/><path d="M10 7a3 3 0 0 0-4.5-.4L4 8.1a3 3 0 0 0 4.2 4.2l1.3-1.3" strokeLinecap="round"/></svg>
          Add link
        </button>
      </div>
      {addingLink && (
        <div className="mt-2 space-y-1.5">
          <input
            value={linkName}
            onChange={e => setLinkName(e.target.value)}
            placeholder="Label"
            className="w-full text-xs rounded border border-gray-200 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-300"
          />
          <input
            value={linkUrl}
            onChange={e => setLinkUrl(e.target.value)}
            placeholder="https://…"
            type="url"
            className="w-full text-xs rounded border border-gray-200 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-300"
          />
          <div className="flex gap-1.5 justify-end">
            <button type="button" onClick={() => setAddingLink(false)} className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-500">Cancel</button>
            <button type="button" onClick={() => void handleAddLink()} disabled={!linkName.trim() || !linkUrl.trim()} className="text-xs px-2 py-1 rounded bg-indigo-600 text-white disabled:opacity-40">Add</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Action Item Edit Modal ────────────────────────────────────────────────────

const STATUSES: AirtableActionItem["status"][] = ["Open", "In Progress", "Blocked", "Backlogged", "Done"];
const PRIORITIES = ["Critical", "High", "Medium", "Low"] as const;

const STATUS_COLORS: Record<string, string> = {
  Open: "bg-blue-100 text-blue-700 border-blue-200",
  "In Progress": "bg-yellow-100 text-yellow-700 border-yellow-200",
  Blocked: "bg-red-100 text-red-700 border-red-200",
  Backlogged: "bg-slate-100 text-slate-600 border-slate-200",
  Done: "bg-emerald-100 text-emerald-700 border-emerald-200",
};
const PRIORITY_COLORS_EDIT: Record<string, string> = {
  Critical: "bg-red-100 text-red-700 border-red-200",
  High: "bg-orange-100 text-orange-700 border-orange-200",
  Medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
  Low: "bg-gray-100 text-gray-600 border-gray-200",
};

function ActionItemEditModal({
  item,
  onClose,
  onSaved,
  onConverted,
  onDeleted,
}: {
  item: AirtableActionItem;
  onClose: () => void;
  onSaved: (updated: AirtableActionItem) => void;
  onConverted?: () => void;
  onDeleted?: (id: number) => void;
}) {
  const [form, setForm] = useState({
    task: item.task,
    task_details: item.task_details ?? "",
    status: item.status,
    priority: item.priority,
    due_date: item.due_date ?? "",
    assignee_name: item.assignee_name ?? "",
    estimated_time: item.estimated_time ?? 0,
    time_spent: item.time_spent ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const commentBtnRef = useRef<HTMLButtonElement>(null);
  const { openComments } = useCommentContext();

  async function handleDelete() {
    if (!window.confirm("Delete this action item? This cannot be undone.")) return;
    setDeleting(true);
    try {
      await airtableApi.deleteActionItem(item.id);
      onDeleted?.(item.id);
      onClose();
    } catch { /* silent */ } finally {
      setDeleting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const patch: Partial<AirtableActionItem> = {};
      if (form.task !== item.task) patch.task = form.task;
      if (form.task_details !== (item.task_details ?? "")) patch.task_details = form.task_details;
      if (form.status !== item.status) patch.status = form.status as AirtableActionItem["status"];
      if (form.priority !== item.priority) patch.priority = form.priority as AirtableActionItem["priority"];
      if ((form.due_date || null) !== item.due_date) patch.due_date = form.due_date || null;
      if ((form.assignee_name || "") !== item.assignee_name) patch.assignee_name = form.assignee_name || "";
      if (form.estimated_time !== item.estimated_time) patch.estimated_time = form.estimated_time;
      if (form.time_spent !== item.time_spent) patch.time_spent = form.time_spent;
      if (Object.keys(patch).length > 0) {
        const { data } = await airtableApi.updateActionItemFields(item.airtable_id, patch);
        onSaved({ ...item, ...data });
      } else {
        onClose();
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleConvertToEvent() {
    if (converting) return;
    setConverting(true);
    try {
      await convertActionItemToEvent(item);
      onConverted?.();
      onClose();
    } catch { /* best effort */ } finally {
      setConverting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-[var(--twilio-navy)]">Edit Action Item</h2>
          <div className="flex items-center gap-1.5">
            {!item.airtable_id.startsWith("local-") && (
              <button
                ref={commentBtnRef}
                onClick={() => {
                  const rect = commentBtnRef.current?.getBoundingClientRect();
                  openComments({ resourceType: "action_item", resourceId: item.id, resourceLabel: item.task ?? "", x: rect ? rect.left : 200, y: rect ? rect.bottom + 4 : 200 });
                }}
                className="text-gray-400 hover:text-indigo-600 transition-colors p-1 rounded"
                title="Comments"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
                  <path d="M14 9.5a5 5 0 0 1-5 5H3l-1.5 1.5V5a5 5 0 0 1 5-5h2.5a5 5 0 0 1 5 5v4.5z" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Task name */}
          <div>
            <label className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)] font-semibold mb-1 block">Task</label>
            <input
              autoFocus
              value={form.task}
              onChange={(e) => setForm((f) => ({ ...f, task: e.target.value }))}
              className="w-full text-sm text-[var(--twilio-navy)] rounded-lg border border-gray-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>

          {/* Details */}
          <div>
            <label className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)] font-semibold mb-1 block">Details</label>
            <textarea
              value={form.task_details}
              onChange={(e) => setForm((f) => ({ ...f, task_details: e.target.value }))}
              rows={3}
              placeholder="Optional notes…"
              className="w-full text-sm text-[var(--twilio-navy)] rounded-lg border border-gray-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none leading-relaxed"
            />
          </div>

          {/* Status + Priority */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)] font-semibold mb-1 block">Status</label>
              <div className="flex flex-wrap gap-1">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, status: s }))}
                    className={[
                      "px-2 py-0.5 rounded-full border text-[11px] font-semibold transition-colors",
                      form.status === s ? STATUS_COLORS[s] : "bg-white border-gray-200 text-gray-400 hover:border-gray-300",
                    ].join(" ")}
                  >{s}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)] font-semibold mb-1 block">Priority</label>
              <div className="flex flex-wrap gap-1">
                {PRIORITIES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, priority: p }))}
                    className={[
                      "px-2 py-0.5 rounded-full border text-[11px] font-semibold transition-colors",
                      form.priority === p ? PRIORITY_COLORS_EDIT[p] : "bg-white border-gray-200 text-gray-400 hover:border-gray-300",
                    ].join(" ")}
                  >{p}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Due date + Assignee */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)] font-semibold mb-1 block">Due date</label>
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 [color-scheme:light]"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)] font-semibold mb-1 block">Assignee</label>
              <input
                value={form.assignee_name}
                onChange={(e) => setForm((f) => ({ ...f, assignee_name: e.target.value }))}
                placeholder="Name…"
                className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
          </div>

          {/* Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)] font-semibold mb-1 block">Est. time (min)</label>
              <input
                type="number"
                min="0"
                value={form.estimated_time ? Math.round(form.estimated_time / 60) : ""}
                onChange={(e) => setForm((f) => ({ ...f, estimated_time: Math.round((parseFloat(e.target.value) || 0) * 60) }))}
                placeholder="0"
                className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)] font-semibold mb-1 block">Time spent (min)</label>
              <input
                type="number"
                min="0"
                value={form.time_spent ? Math.round(form.time_spent / 60) : ""}
                onChange={(e) => setForm((f) => ({ ...f, time_spent: Math.round((parseFloat(e.target.value) || 0) * 60) }))}
                placeholder="0"
                className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
          </div>

          {/* Attachments */}
          {!item.airtable_id.startsWith("local-") && <AttachmentsSection item={item} />}

          {/* Activity log */}
          <div>
            <label className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)] font-semibold mb-2 block">Activity</label>
            <ActivityLogSection
              resourceType="action_item"
              resourceId={item.airtable_id}
              variant="inline"
              onRestore={async (rd) => { await restoreConversion(rd); onConverted?.(); onClose(); }}
            />
          </div>

          {/* Timestamps */}
          {!item.airtable_id.startsWith("local-") && (
            <div className="pt-3 border-t border-gray-100 flex flex-wrap gap-x-5 gap-y-1">
              <span className="text-[11px] text-[var(--twilio-gray-60)]">
                <span className="font-semibold uppercase tracking-wide">Created</span>{" "}
                {item.created_at ? new Date(item.created_at).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}
              </span>
              {item.marked_done_at && (
                <span className="text-[11px] text-emerald-600">
                  <span className="font-semibold uppercase tracking-wide">Completed</span>{" "}
                  {new Date(item.marked_done_at).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 space-y-2">
          <button
            type="button"
            disabled={converting}
            onClick={() => void handleConvertToEvent()}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-50 transition-colors"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 shrink-0">
              <rect x="2" y="3" width="12" height="11" rx="1.5"/>
              <path d="M5 2v2M11 2v2M2 7h12" strokeLinecap="round"/>
            </svg>
            {converting ? "Converting…" : "Convert to Event"}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deleting}
              title="Delete action item"
              className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-40 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >Cancel</button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || !form.task.trim()}
              className="flex-1 py-2 rounded-xl bg-[var(--twilio-navy)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 transition-colors"
            >{saving ? "Saving…" : "Save"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-semibold uppercase tracking-widest text-[var(--twilio-gray-60)] mb-3">
      {children}
    </h3>
  );
}

function CategorizationPrompt({
  accounts,
  onSelect,
}: {
  accounts: AirtableAccount[];
  onSelect: (accountId: number | null, categorization: string) => void;
}) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
      <p className="text-sm font-medium text-amber-800 mb-3">
        We couldn't automatically match this meeting to an account. How should we categorize it?
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        <button
          onClick={() => onSelect(null, "Internal Meeting")}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm font-medium text-[var(--twilio-gray-80)] hover:bg-gray-100"
        >
          Internal Meeting
        </button>
        <button
          onClick={() => onSelect(null, "Admin")}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm font-medium text-[var(--twilio-gray-80)] hover:bg-gray-100"
        >
          Admin
        </button>
      </div>
      {accounts.length > 0 && (
        <>
          <p className="text-sm text-[var(--twilio-navy)] mb-2">Or link to an account:</p>
          <div className="flex flex-wrap gap-1.5">
            {accounts.map((a) => (
              <button
                key={a.id}
                onClick={() => onSelect(a.id, "")}
                className="px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
              >
                {a.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const CALENDAR_DRAG_KEY = "calendarDragActionItemId";

// ── Event Reminders Section ───────────────────────────────────────────────────

function EventRemindersSection({
  event,
  eventReminders,
  setEventReminders,
  actionItems,
}: {
  event: CalendarEvent;
  eventReminders: Reminder[];
  setEventReminders: React.Dispatch<React.SetStateAction<Reminder[]>>;
  actionItems: AirtableActionItem[];
}) {
  const [showForm, setShowForm] = useState(false);
  const [remTitle, setRemTitle] = useState("");
  const [remDate, setRemDate] = useState("");
  const [remTime, setRemTime] = useState("09:00");
  const [saving, setSaving] = useState(false);

  const hasAny = eventReminders.length > 0 || actionItems.some((i) => i.reminder_id);

  async function handleCreate() {
    if (!remDate) return;
    setSaving(true);
    try {
      const due = new Date(`${remDate}T${remTime}:00`);
      const { data } = await schedulerApi.createReminder({
        title: remTitle.trim() || event.title,
        resource_type: "calendar_event",
        resource_id: event.id,
        resource_label: event.title,
        due_at: due.toISOString(),
        notify_in_app: true,
      } as Parameters<typeof schedulerApi.createReminder>[0]);
      setEventReminders((prev) => [...prev, data]);
      setRemTitle(""); setRemDate(""); setRemTime("09:00"); setShowForm(false);
    } catch { /* keep form open */ }
    finally { setSaving(false); }
  }

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-[var(--twilio-gray-60)]">Reminders</h3>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3 h-3">
            <path d="M8 3v10M3 8h10"/>
          </svg>
          Set reminder
        </button>
      </div>

      {showForm && (
        <div className="mb-3 bg-white border border-indigo-100 rounded-xl p-3 space-y-2">
          <input
            value={remTitle}
            onChange={(e) => setRemTitle(e.target.value)}
            placeholder={`Reminder: ${event.title}`}
            className="w-full text-xs rounded border border-gray-200 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-300"
          />
          <div className="flex gap-2">
            <div className="flex-1">
              <p className="text-[10px] text-gray-400 mb-0.5">Date</p>
              <input
                type="date"
                value={remDate}
                onChange={(e) => setRemDate(e.target.value)}
                className="w-full text-xs rounded border border-gray-200 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-300 [color-scheme:light]"
              />
            </div>
            <div className="flex-1">
              <p className="text-[10px] text-gray-400 mb-0.5">Time</p>
              <input
                type="time"
                value={remTime}
                onChange={(e) => setRemTime(e.target.value)}
                className="w-full text-xs rounded border border-gray-200 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-300"
              />
            </div>
          </div>
          <div className="flex gap-1.5 justify-end">
            <button type="button" onClick={() => setShowForm(false)} className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50">Cancel</button>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={!remDate || saving}
              className="text-xs px-3 py-1 rounded bg-indigo-600 text-white font-semibold disabled:opacity-40 hover:bg-indigo-700 transition-colors"
            >{saving ? "Saving…" : "Set Reminder"}</button>
          </div>
        </div>
      )}

      {hasAny && (
        <div className="flex flex-wrap gap-2">
          {eventReminders.map((r) => (
            <div key={r.id} className="inline-flex items-center gap-2 bg-white border border-gray-200 rounded-full px-3 py-1.5 text-sm">
              <svg width="12" height="12" viewBox="0 0 24 24" fill={r.status === "pending" ? "#f59e0b" : "#9ca3af"} stroke={r.status === "pending" ? "#f59e0b" : "#9ca3af"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              <span className="text-[var(--twilio-navy)]">{r.title}</span>
              <span className="text-[11px] text-[var(--twilio-gray-60)]">
                {new Date(r.due_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                {r.status !== "pending" && <span className="ml-1 capitalize">· {r.status}</span>}
              </span>
            </div>
          ))}
          {actionItems.filter((i) => i.reminder_id).map((i) => (
            <div key={`ai-${i.airtable_id}`} className="inline-flex items-center gap-2 bg-white border border-gray-200 rounded-full px-3 py-1.5 text-sm">
              <svg width="12" height="12" viewBox="0 0 24 24" fill={i.reminder_status === "pending" ? "#f59e0b" : "#9ca3af"} stroke={i.reminder_status === "pending" ? "#f59e0b" : "#9ca3af"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              <span className="text-[11px] text-[var(--twilio-gray-60)] italic">Action item:</span>
              <span className="text-[var(--twilio-navy)]">{i.task}</span>
              {i.reminder_due_at && (
                <span className="text-[11px] text-[var(--twilio-gray-60)]">
                  {new Date(i.reminder_due_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  {i.reminder_status && i.reminder_status !== "pending" && <span className="ml-1 capitalize">· {i.reminder_status}</span>}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {!hasAny && !showForm && (
        <p className="text-xs text-gray-400 italic">No reminders set.</p>
      )}
    </div>
  );
}

export default function MeetingDetail({ event, attended = true, onToggleAttendance, reloadTrigger }: Props) {
  const [result, setResult] = useState<EventMatchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionItems, setActionItems] = useState<AirtableActionItem[]>([]);
  const [actionItemDropOver, setActionItemDropOver] = useState(false);
  const [dragOverCol, setDragOverCol] = useState<AirtableActionItem["status"] | null>(null);
  const [sfProjects, setSfProjects] = useState<SalesforceProject[]>([]);
  const [logTimeProject, setLogTimeProject] = useState<SalesforceProject | null>(null);
  const [notes, setNotes] = useState<MeetingNote[]>([]);
  const [eventReminders, setEventReminders] = useState<Reminder[]>([]);
  const [showMeetingDetails, setShowMeetingDetails] = useState(false);
  const [showSfProjects, setShowSfProjects] = useState(false);
  const [editingItem, setEditingItem] = useState<AirtableActionItem | null>(null);
  const [convertingEvent, setConvertingEvent] = useState(false);
  const [accountTeamMembers, setAccountTeamMembers] = useState<AccountTeamMember[]>([]);
  // Work-tracking sessions for this event (populated when calendar_id === "work_tracking")
  const [workSessions, setWorkSessions] = useState<CalendarEvent[]>([]);
  // Track note IDs we just created locally so the WS echo doesn't duplicate them
  const locallyCreatedNoteIds = useRef<Set<number>>(new Set());

  async function handleConvertEventToActionItem() {
    if (convertingEvent) return;
    setConvertingEvent(true);
    try {
      await convertEventToActionItem(event);
      // The event has been converted — navigate away or let parent handle
      window.history.back();
    } catch { /* best effort */ } finally {
      setConvertingEvent(false);
    }
  }

  // Load meeting notes
  useEffect(() => {
    schedulerApi.listMeetingNotes(event.id).then(({ data }) => {
      setNotes(data.results ?? []);
    }).catch(() => {});
  }, [event.id]);

  // Load reminders attached to this calendar event
  useEffect(() => {
    schedulerApi.listReminders({ resource_type: "calendar_event", resource_id: String(event.id) })
      .then(({ data }) => setEventReminders(data.results ?? []))
      .catch(() => {});
  }, [event.id]);

  // Load all work-tracking sessions for this action item (when this IS a work-tracking event)
  useEffect(() => {
    if (event.calendar_id !== "work_tracking" || !event.agentpm_airtable_id) return;
    schedulerApi.listEvents({ calendar_id: "work_tracking", agentpm_airtable_id: event.agentpm_airtable_id })
      .then(({ data }) => {
        const sessions = (Array.isArray(data) ? data : (data as { results?: CalendarEvent[] }).results ?? []) as CalendarEvent[];
        setWorkSessions(sessions.sort((a, b) => new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime()));
      })
      .catch(() => {});
  }, [event.id, event.calendar_id, event.agentpm_airtable_id]);

  // WebSocket — receive real-time note updates from other editors
  useEffect(() => {
    const token = getAccessToken();
    const qs = token ? `?token=${encodeURIComponent(token)}` : "";
    const wsBase = window.location.origin.replace(/^http/, "ws");
    const ws = new WebSocket(`${wsBase}/ws/meeting-notes/${event.id}/${qs}`);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string);
        if (msg.type !== "note.update") return;
        const { action: act, note } = msg as { action: string; note: MeetingNote & { id: number } };
        if (act === "created") {
          // Skip if we created this note locally (REST response already added it)
          if (locallyCreatedNoteIds.current.has(note.id)) {
            locallyCreatedNoteIds.current.delete(note.id);
            return;
          }
          setNotes((prev) => prev.some((n) => n.id === note.id) ? prev : [...prev, note].sort((a, b) => a.position - b.position || a.id - b.id));
        } else if (act === "updated") {
          setNotes((prev) => prev.map((n) => n.id === note.id ? note : n));
        } else if (act === "deleted") {
          setNotes((prev) => prev.filter((n) => n.id !== note.id));
        }
      } catch { /* ignore malformed messages */ }
    };
    return () => {
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.onopen = () => ws.close();
      } else {
        ws.close();
      }
    };
  }, [event.id]);

  const eventUid = String(event.google_event_id || event.id);

  const loadMatch = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await airtableApi.matchEvent({
        event_uid: eventUid,
        title: event.title,
        description: event.description || "",
        attendee_emails: event.attendees.map((a) => a.email),
      });
      console.log("[MeetingDetail] matchEvent response:", { needs_categorization: data.needs_categorization, account: data.account?.name, action_items_count: (data.action_items ?? []).length });
      setResult(data);
      setActionItems(data.action_items ?? []);

      // Load Salesforce projects for the matched account (by name match)
      if (!data.needs_categorization && data.account) {
        try {
          const { data: sfData } = await salesforceApi.listProjects();
          const accountName = data.account.name.toLowerCase();
          const allProjects = sfData.results ?? [];
          const matched = allProjects.filter(
            (p) => p.account_name?.toLowerCase().includes(accountName) ||
                   accountName.includes(p.account_name?.toLowerCase() ?? "____")
          );
          console.log("[MeetingDetail] SF projects:", { total: allProjects.length, matched: matched.length, accountName });
          setSfProjects(matched);
        } catch (sfErr) {
          console.log("[MeetingDetail] SF projects fetch failed:", sfErr);
        }
        // Fetch Django account team members for smart mention tagging
        try {
          const { data: acctData } = await accountsApi.listAccounts({ search: data.account.name, page_size: "5" });
          const results = acctData.results ?? [];
          // Find exact company_name match (search is partial, so filter)
          const searchName = data.account.name.toLowerCase();
          const acct = (results as Account[]).find(
            (r) => r.company_name.toLowerCase() === searchName
          ) ?? (results as Account[])[0];
          console.log("[MeetingDetail] account team lookup:", {
            airtableName: data.account.name,
            candidates: results.map((r: Account) => r.company_name),
            matched: acct?.company_name,
            teamMembers: acct?.team_members?.map((m) => m.full_name),
          });
          if (acct?.team_members) setAccountTeamMembers(acct.team_members);
        } catch (e) {
          console.warn("[MeetingDetail] account team lookup failed:", e);
        }
      }
    } catch (err) {
      console.error("[MeetingDetail] matchEvent failed:", err);
      setResult(null);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventUid, event.title, event.description, event.attendees, reloadTrigger]);

  useEffect(() => {
    console.log("[MeetingDetail] loadMatch effect fired, eventUid:", eventUid);
    void loadMatch();
  }, [loadMatch]);

  async function handleCategorize(accountId: number | null, categorization: string) {
    try {
      const { data } = await airtableApi.categorizeEvent({
        event_uid: eventUid,
        account_id: accountId,
        categorization,
      });
      setResult(data);
      setActionItems(data.action_items ?? []);
    } catch {}
  }

  function handleStatusChange(airtableId: string, newStatus: AirtableActionItem["status"]) {
    setActionItems((prev) =>
      prev.map((item) =>
        item.airtable_id === airtableId ? { ...item, status: newStatus } : item
      )
    );
  }

  async function handleDropActionItem(e: React.DragEvent) {
    e.preventDefault();
    setActionItemDropOver(false);
    const w = window as unknown as Record<string, string>;
    const airtableId = (e.dataTransfer.getData("text/plain") || w[CALENDAR_DRAG_KEY]).trim();
    if (!airtableId) return;
    // Already in list?
    if (actionItems.some((i) => i.airtable_id === airtableId)) return;
    // Fetch the item so we can show it immediately, then patch the account
    const accountName = result?.account?.name ?? null;
    const accountId = result?.account ? (result.account as AirtableAccount & { id: number }).id : null;
    try {
      // Optimistic: fetch item details
      const { data: allItems } = await airtableApi.listActionItems({ status: "Open,In Progress,Blocked,Backlogged,Complete" });
      const dropped = (allItems as AirtableActionItem[]).find((i) => i.airtable_id === airtableId);
      if (dropped) {
        setActionItems((prev) => [...prev, dropped]);
        // Associate the action item with this meeting's account if we have one
        if (accountId && accountName) {
          await airtableApi.updateActionItemFields(airtableId, { account: accountId, account_name: accountName }).catch(() => {});
          window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated", newValue: "1" }));
        }
      }
    } catch { /* best effort */ }
  }

  const durationSecs =
    (new Date(event.end_datetime).getTime() - new Date(event.start_datetime).getTime()) / 1000;

  return (
    <>
    <div className="mt-6 border-t border-gray-200 pt-6">
      <div className="flex flex-col gap-5">

        {/* ── Row 1: Account+Details | Meeting Notes | Meeting Summary ─────── */}
        <div className="grid grid-cols-3 gap-5">

        {/* ── Col 1: Account + SF Projects + Meeting Details ──────────────── */}
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 space-y-5">

          {/* Account match */}
          <section>
            <SectionHeading>Account</SectionHeading>
            {loading ? (
              <p className="text-sm text-[var(--twilio-gray-60)]">Matching account…</p>
            ) : result?.needs_categorization ? (
              <CategorizationPrompt accounts={result.accounts ?? []} onSelect={handleCategorize} />
            ) : result?.account ? (
              <AccountCard account={result.account} matchMethod={result.match_method} />
            ) : result?.categorization ? (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-[var(--twilio-navy)]">
                  {result.categorization}
                </span>
                <button onClick={() => setResult({ ...result, needs_categorization: true })} className="text-sm text-indigo-500 hover:underline">
                  Change
                </button>
              </div>
            ) : null}
          </section>

          {/* Salesforce Projects — collapsible */}
          {sfProjects.length > 0 && (
            <section>
              <button
                onClick={() => setShowSfProjects((v) => !v)}
                className="w-full flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-[var(--twilio-navy)] hover:bg-gray-50 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-[var(--twilio-gray-60)]">
                    <path d="M2 4h12M2 8h8M2 12h5"/>
                  </svg>
                  Salesforce Projects
                  <span className="text-[11px] font-normal text-[var(--twilio-gray-60)]">({sfProjects.length})</span>
                </span>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                  className={`w-3.5 h-3.5 text-[var(--twilio-gray-60)] transition-transform ${showSfProjects ? "rotate-180" : ""}`}>
                  <path d="M4 6l4 4 4-4"/>
                </svg>
              </button>
              {showSfProjects && (
                <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
                  {sfProjects.map((project) => {
                    const desc = ADMIN_PROJECT_DESCRIPTIONS[project.name];
                    return (
                      <div key={project.sf_id} className="bg-white rounded-xl border border-gray-200 px-3 py-2 flex flex-col gap-1.5" title={desc ? `${project.name}\n\n${desc}` : undefined}>
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-[var(--twilio-navy)] leading-snug line-clamp-2">{project.name}</p>
                          {project.status && (
                            <span className="text-[10px] font-medium text-indigo-600">{project.status}</span>
                          )}
                        </div>
                        <button onClick={() => setLogTimeProject(project)} className="w-full flex items-center justify-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium text-white mt-auto" style={{ background: "#0263E0" }}>
                          + Log Time
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* Meeting Details — collapsible */}
          <section>
            <button
              onClick={() => setShowMeetingDetails((v) => !v)}
              className="w-full flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-[var(--twilio-navy)] hover:bg-gray-50 transition-colors"
            >
              <span className="flex items-center gap-2">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-[var(--twilio-gray-60)]">
                  <rect x="1" y="1" width="14" height="14" rx="2"/>
                  <path d="M5 5h6M5 8h4M5 11h3"/>
                </svg>
                Meeting Details
              </span>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                className={`w-3.5 h-3.5 text-[var(--twilio-gray-60)] transition-transform ${showMeetingDetails ? "rotate-180" : ""}`}>
                <path d="M4 6l4 4 4-4"/>
              </svg>
            </button>

            {showMeetingDetails && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)]">Date</p>
                    <p className="text-[var(--twilio-navy)]">
                      {new Date(event.start_datetime).toLocaleDateString(undefined, {
                        weekday: "short", month: "short", day: "numeric",
                      })}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)]">Time</p>
                    <p className="text-[var(--twilio-navy)]">
                      {new Date(event.start_datetime).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                      {" – "}
                      {new Date(event.end_datetime).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)]">Duration</p>
                    <p className="text-[var(--twilio-navy)]">{formatDuration(durationSecs)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)]">Attendees</p>
                    <p className="text-[var(--twilio-navy)]">{event.attendees.length}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)] mb-1">Attendance</p>
                    <button
                      onClick={onToggleAttendance}
                      className={[
                        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border transition-colors",
                        attended
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                          : "bg-gray-100 text-[var(--twilio-gray-60)] border-gray-200 hover:bg-gray-200 line-through",
                      ].join(" ")}
                    >
                      <span className={["h-2 w-2 rounded-full shrink-0", attended ? "bg-emerald-500" : "bg-gray-400"].join(" ")} />
                      {attended ? "Attended" : "Did not attend"}
                    </button>
                    {!attended && (
                      <p className="text-[11px] text-[var(--twilio-gray-60)] mt-1">Time excluded from daily totals</p>
                    )}
                  </div>
                </div>
                {event.attendees.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {event.attendees.map((a) => (
                      <span key={a.email} className="text-[11px] bg-gray-100 text-[var(--twilio-navy)] px-2 py-0.5 rounded-full" title={a.email}>
                        {a.displayName ?? a.email}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

        </div>{/* end col 1 */}

        {/* ── Col 2: Meeting Notes ─────────────────────────────────────────── */}
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
          <SectionHeading>Meeting Notes</SectionHeading>
          <MeetingNotesSection
            eventId={event.id}
            eventTitle={event.title}
            accountName={result?.account?.name ?? null}
            notes={notes}
            setNotes={setNotes}
            locallyCreatedNoteIds={locallyCreatedNoteIds}
            onActionItemCreated={(item) => setActionItems((prev) => [...prev, item])}
          />
        </div>

        {/* ── Col 3: Meeting Summary ───────────────────────────────────────── */}
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
          <SectionHeading>Meeting Summary</SectionHeading>
          <MeetingSummarySection
            eventId={event.id}
            meetingId={result?.this_meeting?.id}
            existingNotes={result?.this_meeting?.gong_notes ?? undefined}
            accountName={result?.account?.name ?? null}
            airtableAccountId={result?.account ? (result.account as { id?: number }).id ?? null : null}
            accountTeamMembers={accountTeamMembers}
            onCreatedActionItem={(item) => setActionItems((prev) => [...prev, item])}
          />
        </div>

        </div>{/* end grid row 1 */}

        {/* ── Row 2: Action Items kanban + Reminders ───────────────────────── */}
        <div
          className={[
            "rounded-2xl border p-5 transition-colors",
            actionItemDropOver ? "border-indigo-300 bg-indigo-50" : "border-gray-200 bg-gray-50",
          ].join(" ")}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("kanbancardid")) return; // handled by columns
            e.preventDefault();
            setActionItemDropOver(true);
          }}
          onDragLeave={() => setActionItemDropOver(false)}
          onDrop={(e) => void handleDropActionItem(e)}
        >
          <h2 className="text-sm font-semibold uppercase tracking-widest text-[var(--twilio-gray-60)] mb-4 flex items-center gap-2">
            Action Items
            {actionItemDropOver && <span className="text-[11px] text-indigo-500 font-medium normal-case tracking-normal">Drop to associate</span>}
          </h2>

          {/* 4-column kanban */}
          <div className="grid grid-cols-4 gap-4">
            {KANBAN_COLUMNS.map((col) => {
              const colItems = actionItems.filter((i) => i.status === col);
              const isOver = dragOverCol === col;
              return (
                <div
                  key={col}
                  className={["rounded-xl border p-3 transition-colors", isOver ? "border-indigo-400 bg-indigo-50" : "bg-white border-gray-200"].join(" ")}
                  onDragOver={(e) => {
                    // Only accept kanban card drags, not account/sidebar drags
                    if (e.dataTransfer.types.includes("kanbancardid")) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setDragOverCol(col);
                    }
                  }}
                  onDragLeave={(e) => {
                    // Only clear if leaving the column entirely (not entering a child)
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverCol(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOverCol(null);
                    const airtableId = e.dataTransfer.getData("kanbanCardId");
                    if (!airtableId) return;
                    const item = actionItems.find((i) => i.airtable_id === airtableId);
                    if (!item || item.status === col) return;
                    // Optimistic update — KanbanCard's own handler does the API call
                    handleStatusChange(airtableId, col);
                    airtableApi.updateActionItemStatus(airtableId, col).catch(() => {
                      // Revert on failure
                      handleStatusChange(airtableId, item.status);
                    });
                  }}
                >
                  <div className="flex items-center gap-1.5 mb-3">
                    <p className="text-sm font-semibold text-[var(--twilio-navy)]">{col}</p>
                    <span className="text-xs bg-gray-100 text-[var(--twilio-navy)] rounded-full px-1.5 py-0.5">{colItems.length}</span>
                  </div>
                  <div className="space-y-2">
                    {colItems.map((item) => (
                      <KanbanCard key={item.airtable_id} item={item} onStatusChange={handleStatusChange} onDoubleClick={setEditingItem} />
                    ))}
                    {colItems.length === 0 && (
                      <div className={["border-2 border-dashed rounded-lg h-14 flex items-center justify-center", isOver ? "border-indigo-300" : "border-gray-100"].join(" ")}>
                        <span className="text-xs text-[var(--twilio-gray-40)]">{isOver ? "Drop here" : "—"}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Reminders — always shown; includes a Set Reminder form for the event itself */}
          <EventRemindersSection
            event={event}
            eventReminders={eventReminders}
            setEventReminders={setEventReminders}
            actionItems={actionItems}
          />

          {/* Airtable meeting record */}
          {result?.meetings && result.meetings.length > 0 && (
            <div className="mt-5">
              <AirtableMeetingSection meetings={result.meetings} eventTitle={event.title} />
            </div>
          )}

          {/* Work-tracking session timeline */}
          {event.calendar_id === "work_tracking" && workSessions.length > 0 && (
            <div className="mt-5">
              <SectionHeading>Tracked Sessions</SectionHeading>
              <div className="space-y-1.5">
                {workSessions.map((s) => {
                  const start = new Date(s.start_datetime);
                  const end = new Date(s.end_datetime);
                  const durSec = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
                  const h = Math.floor(durSec / 3600);
                  const m = Math.floor((durSec % 3600) / 60);
                  const durLabel = h > 0 ? `${h}h ${m}m` : `${m}m`;
                  const fmtTime = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
                  const fmtDate = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                  const sameDay = start.toDateString() === end.toDateString();
                  const isActive = s.id === event.id;
                  return (
                    <div
                      key={s.id}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-xs ${isActive ? "bg-indigo-50 border border-indigo-200" : "bg-white border border-gray-100"}`}
                    >
                      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 shrink-0 text-[var(--twilio-gray-60)]">
                        <circle cx="6" cy="6" r="5"/><path d="M6 3v3l2 1.5" strokeLinecap="round"/>
                      </svg>
                      <span className="flex-1 text-[var(--twilio-navy)] tabular-nums">
                        {fmtTime(start)} – {fmtTime(end)}
                        {!sameDay && <span className="text-[var(--twilio-gray-60)]"> ({fmtDate(end)})</span>}
                      </span>
                      <span className="font-semibold text-indigo-700 tabular-nums shrink-0">{durLabel}</span>
                    </div>
                  );
                })}
                {/* Total */}
                {workSessions.length > 1 && (() => {
                  const totalSec = workSessions.reduce((acc, s) => {
                    const durSec = Math.max(0, Math.floor((new Date(s.end_datetime).getTime() - new Date(s.start_datetime).getTime()) / 1000));
                    return acc + durSec;
                  }, 0);
                  const th = Math.floor(totalSec / 3600);
                  const tm = Math.floor((totalSec % 3600) / 60);
                  return (
                    <div className="flex items-center justify-between px-3 py-1.5 text-xs font-semibold text-[var(--twilio-navy)] border-t border-gray-100 mt-1 pt-2">
                      <span>Total tracked</span>
                      <span className="text-indigo-700 tabular-nums">{th > 0 ? `${th}h ${tm}m` : `${tm}m`}</span>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Convert */}
          <div className="mt-5">
            <button
              type="button"
              disabled={convertingEvent}
              onClick={() => void handleConvertEventToActionItem()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 shrink-0">
                <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {convertingEvent ? "Converting…" : "Convert to Action Item"}
            </button>
          </div>

          {/* Activity Log */}
          <div className="mt-5">
            <SectionHeading>Activity Log</SectionHeading>
            <ActivityLogSection
              resourceType="calendar_event"
              resourceId={event.id}
              variant="inline"
              onRestore={async (rd) => { await restoreConversion(rd); }}
            />
          </div>

          {/* New Comments */}
          <div className="mt-5">
            <InlineCommentThread
              resourceType="calendar_event"
              resourceId={event.id}
              resourceLabel={event.title}
              compact
            />
          </div>

        </div>{/* end row 2 */}

      </div>{/* end flex-col wrapper */}
    </div>

      {logTimeProject && (
        <LogTimeModal
          project={logTimeProject}
          onClose={() => setLogTimeProject(null)}
          onLogged={() => setLogTimeProject(null)}
        />
      )}

      {editingItem && (
        <ActionItemEditModal
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSaved={(updated) => {
            setActionItems((prev) => prev.map((i) => i.airtable_id === updated.airtable_id ? updated : i));
            setEditingItem(null);
          }}
          onConverted={() => {
            setActionItems((prev) => prev.filter((i) => i.airtable_id !== editingItem.airtable_id));
            setEditingItem(null);
          }}
          onDeleted={() => {
            setActionItems((prev) => prev.filter((i) => i.airtable_id !== editingItem.airtable_id));
            setEditingItem(null);
          }}
        />
      )}
    </>
  );
}

// ── Meeting Notes ─────────────────────────────────────────────────────────────

// Strip @mention tokens from display text for action payloads
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

function stripMentions(text: string) {
  return text.replace(/@\S+/g, "").replace(/\s{2,}/g, " ").trim();
}

// Render note text: @mentions → indigo, [text](url) → clickable link
function renderNoteInline(text: string): React.ReactNode[] {
  const TOKEN = /(\[([^\]]+)\]\((https?:\/\/[^)]+)\))|(@\S+)/g;
  const parts: React.ReactNode[] = [];
  let last = 0, match: RegExpExecArray | null;
  while ((match = TOKEN.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1]) {
      parts.push(<a key={match.index} href={match[3]} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline underline-offset-2 hover:opacity-75" onClick={(e) => e.stopPropagation()}>{match[2]}</a>);
    } else {
      parts.push(<span key={match.index} className="text-indigo-500 font-medium">{match[0]}</span>);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// On paste: if text is selected and clipboard is a URL, wrap as [selection](url)
function handleLinkPaste(
  e: React.ClipboardEvent<HTMLTextAreaElement>,
  value: string,
  setValue: (v: string) => void,
) {
  const pasted = e.clipboardData.getData("text").trim();
  if (!/^https?:\/\/\S+$/.test(pasted)) return;
  const el = e.currentTarget;
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  if (start === end) return;
  e.preventDefault();
  const selected = value.slice(start, end);
  const replacement = `[${selected}](${pasted})`;
  const next = value.slice(0, start) + replacement + value.slice(end);
  setValue(next);
  requestAnimationFrame(() => {
    const pos = start + replacement.length;
    el.setSelectionRange(pos, pos);
  });
}

// Extract @mentioned names from text
function extractMentions(text: string): string[] {
  return (text.match(/@(\S+)/g) ?? []).map((m) => m.slice(1));
}

// Icon components matching sidebar icons (inline SVG for size control)
function IconChecklist({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M8 5h9M8 10h9M8 15h9" strokeLinecap="round"/>
      <path d="M3 5l1.5 1.5L7 3M3 10l1.5 1.5L7 8M3 15l1.5 1.5L7 13" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function IconCalendar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <rect x="2" y="4" width="16" height="14" rx="2"/>
      <path d="M2 8h16M6 2v4M14 2v4" strokeLinecap="round"/>
    </svg>
  );
}
function IconSchedule({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <circle cx="10" cy="10" r="7"/>
      <path d="M10 6v4l3 2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function IconAgent({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M3 5a2 2 0 012-2h10a2 2 0 012 2v7a2 2 0 01-2 2H7l-4 3V5z" strokeLinejoin="round"/>
      <path d="M7 9h6M7 12h4" strokeLinecap="round"/>
    </svg>
  );
}

function NoteRow({
  note,
  eventId,
  eventTitle,
  accountName,
  teamMembers,
  onSave,
  onDelete,
  onActionItemCreated,
}: {
  note: MeetingNote;
  eventId: number;
  eventTitle: string;
  accountName?: string | null;
  teamMembers: TeamMember[];
  onSave: (n: MeetingNote) => void;
  onDelete: (id: number) => void;
  onActionItemCreated?: (item: AirtableActionItem) => void;
}) {
  const currentUser = useCurrentUser();
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(note.text);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // @mention state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  // Which tooltip is open: null | "action" | "calendar" | "reminder"
  const [openTooltip, setOpenTooltip] = useState<"action" | "calendar" | "reminder" | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipPanelRef = useRef<HTMLDivElement>(null);
  const actionBtnRef = useRef<HTMLButtonElement>(null);
  const calBtnRef = useRef<HTMLButtonElement>(null);
  const remBtnRef = useRef<HTMLButtonElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; right: number } | null>(null);

  // Action Item form state
  const mentionsInNote = extractMentions(note.text);
  const preselected = teamMembers.filter((m) =>
    mentionsInNote.some((name) => m.full_name.replace(/\s+/g, "").toLowerCase() === name.toLowerCase())
  );
  const [aiAssignees, setAiAssignees] = useState<TeamMember[]>([]);
  const [aiPriority, setAiPriority] = useState<"Low" | "Medium" | "High" | "Critical">("Medium");
  const [aiDue, setAiDue] = useState("");
  const [aiSaved, setAiSaved] = useState(false);

  // Calendar form state
  const [calTitle, setCalTitle] = useState(stripMentions(note.text).slice(0, 80) || "Follow-up Meeting");
  const [calStart, setCalStart] = useState("");
  const [calEnd, setCalEnd] = useState("");
  const [calSaved, setCalSaved] = useState(false);

  // Reminder form state
  const [remDate, setRemDate] = useState("");
  const [remTime, setRemTime] = useState("09:00");
  const [remSaved, setRemSaved] = useState(false);

  const _nlsKey = `note-actions::${note.id}`;
  const [doneActions, setDoneActions] = useState<Set<"action" | "calendar" | "reminder">>(() => {
    try { const v = localStorage.getItem(_nlsKey); return v ? new Set(JSON.parse(v) as ("action" | "calendar" | "reminder")[]) : new Set(); } catch { return new Set(); }
  });
  function markNoteDone(kind: "action" | "calendar" | "reminder") {
    setDoneActions((p) => { const n = new Set([...p, kind]); try { localStorage.setItem(_nlsKey, JSON.stringify([...n])); } catch {} return n; });
  }

  function openTooltipAt(which: "action" | "calendar" | "reminder") {
    const btn = which === "action" ? actionBtnRef.current : which === "calendar" ? calBtnRef.current : remBtnRef.current;
    if (btn) {
      const r = btn.getBoundingClientRect();
      const panelHeight = which === "reminder" ? 180 : 360;
      const spaceBelow = window.innerHeight - r.bottom - 6;
      if (spaceBelow < panelHeight && r.top > panelHeight) {
        setTooltipPos({ top: r.top - panelHeight - 6, right: window.innerWidth - r.right });
      } else {
        setTooltipPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
      }
    }
    setOpenTooltip(which === openTooltip ? null : which);
  }

  // Close tooltip on outside click — check both the button bar and the floating tooltip panel
  useEffect(() => {
    if (!openTooltip) return;
    function handler(e: MouseEvent) {
      const target = e.target as Node;
      const inBar = tooltipRef.current?.contains(target);
      const inPanel = tooltipPanelRef.current?.contains(target);
      if (!inBar && !inPanel) setOpenTooltip(null);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openTooltip]);

  // Pre-fill assignees from mentions whenever tooltip opens
  useEffect(() => {
    if (openTooltip === "action") setAiAssignees(preselected);
    if (openTooltip === "calendar") {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(10, 0, 0, 0);
      const end = new Date(tomorrow); end.setHours(11, 0, 0, 0);
      const pad = (n: number) => String(n).padStart(2, "0");
      const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      setCalStart(fmt(tomorrow)); setCalEnd(fmt(end));
      setCalTitle(stripMentions(note.text).slice(0, 80) || "Follow-up Meeting");
    }
    if (openTooltip === "reminder") {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      const pad = (n: number) => String(n).padStart(2, "0");
      setRemDate(`${tomorrow.getFullYear()}-${pad(tomorrow.getMonth()+1)}-${pad(tomorrow.getDate())}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTooltip]);

  useEffect(() => {
    if (editing && inputRef.current) {
      const el = inputRef.current;
      el.focus();
      // Size to content so wrapped lines are fully visible
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [editing]);

  useEffect(() => {
    if (!editing || !inputRef.current) return;
    const el = inputRef.current;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editing, editText]);

  function handleChange(val: string) {
    setEditText(val);
    // Detect @mention trigger
    const atIdx = val.lastIndexOf("@");
    if (atIdx >= 0) {
      const query = val.slice(atIdx + 1);
      if (!query.includes(" ")) {
        setMentionQuery(query.toLowerCase());
        setMentionIndex(0);
        return;
      }
    }
    setMentionQuery(null);
  }

  const mentionMatches = mentionQuery !== null
    ? teamMembers.filter((m) =>
        m.full_name.toLowerCase().includes(mentionQuery) ||
        m.email.toLowerCase().includes(mentionQuery)
      ).slice(0, 6)
    : [];

  function acceptMention(member: TeamMember) {
    const atIdx = editText.lastIndexOf("@");
    const newText = editText.slice(0, atIdx) + `@${member.full_name.replace(/\s+/g, "")} `;
    setEditText(newText);
    setMentionQuery(null);
    inputRef.current?.focus();
  }

  function commitEdit() {
    setEditing(false);
    setMentionQuery(null);
    const trimmed = editText.trim();
    if (!trimmed || trimmed === note.text) return;
    schedulerApi.updateMeetingNote(note.id, { html: trimmed, text: trimmed })
      .then(({ data }) => onSave(data))
      .catch(() => {});
  }

  // ── Action submit handlers ────────────────────────────────────────────────

  function submitActionItem() {
    const assignees = aiAssignees.length > 0 ? aiAssignees : preselected;
    const primary = assignees[0];
    const assigneeName = primary?.full_name || currentUser?.display_name || "";
    const assigneeId = primary ? "" : currentUser?.airtable_collaborator_id || "";
    airtableApi.createActionItem({
      task: stripMentions(note.text),
      task_details: note.text,
      status: "Open",
      priority: aiPriority,
      due_date: aiDue || null,
      account_name: accountName ?? undefined,
      assignee_name: assigneeName,
      assignee_airtable_id: assigneeId,
    } as Parameters<typeof airtableApi.createActionItem>[0])
      .then(({ data }) => {
        setAiSaved(true);
        markNoteDone("action");
        onActionItemCreated?.(data);
        setTimeout(() => { setAiSaved(false); setOpenTooltip(null); }, 1400);
      })
      .catch(() => {});
  }

  function submitMeeting() {
    if (!calStart || !calEnd) return;
    const attendees = aiAssignees.map((m) => ({
      email: m.email, displayName: m.full_name, responseStatus: "needsAction" as const,
    }));
    schedulerApi.createEvent({
      title: calTitle,
      description: `From meeting note: ${note.text}`,
      start_datetime: new Date(calStart).toISOString(),
      end_datetime: new Date(calEnd).toISOString(),
      attendees,
    } as Parameters<typeof schedulerApi.createEvent>[0])
      .then(() => { setCalSaved(true); markNoteDone("calendar"); setTimeout(() => { setCalSaved(false); setOpenTooltip(null); }, 1400); })
      .catch(() => {});
  }

  function submitReminder() {
    if (!remDate) return;
    const due = new Date(`${remDate}T${remTime}:00`);
    schedulerApi.createReminder({
      title: stripMentions(note.text).slice(0, 200) || "Meeting note reminder",
      body: note.text,
      resource_type: "calendar_event",
      resource_id: eventId,
      resource_label: eventTitle,
      due_at: due.toISOString(),
      notify_in_app: true,
    } as Parameters<typeof schedulerApi.createReminder>[0])
      .then(() => { setRemSaved(true); markNoteDone("reminder"); setTimeout(() => { setRemSaved(false); setOpenTooltip(null); }, 1400); })
      .catch(() => {});
  }

  function handleSendToAgent() {
    window.dispatchEvent(new CustomEvent("chat-inject", { detail: { text: note.text } }));
  }

  return (
    <li className="group relative flex items-start gap-2 px-3 py-2 hover:bg-gray-50 transition-colors">
      <span className="mt-[6px] h-1.5 w-1.5 rounded-full bg-[var(--twilio-navy)] shrink-0 opacity-50" />

      {/* Text or edit input — buttons float right so first line shares space, subsequent lines use full width */}
      <div className="flex-1 min-w-0 pb-0.5">
        {editing ? (
          <div className="relative">
            <textarea
              ref={inputRef}
              value={editText}
              rows={1}
              onChange={(e) => handleChange(e.target.value)}
              onPaste={(e) => handleLinkPaste(e, editText, setEditText)}
              onBlur={() => { if (mentionQuery === null) commitEdit(); }}
              onKeyDown={(e) => {
                if (mentionQuery !== null && mentionMatches.length > 0) {
                  if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i) => Math.min(i + 1, mentionMatches.length - 1)); return; }
                  if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex((i) => Math.max(i - 1, 0)); return; }
                  if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); acceptMention(mentionMatches[mentionIndex]); return; }
                  if (e.key === "Escape") { setMentionQuery(null); return; }
                }
                if (e.key === "Enter" && e.shiftKey) { return; } // Shift+Enter → newline (default textarea behaviour)
                if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
                if (e.key === "Escape") { setEditing(false); setEditText(note.text); setMentionQuery(null); }
              }}
              style={{ overflow: "hidden" }}
              className="w-full text-sm text-[var(--twilio-navy)] bg-indigo-50 border border-indigo-200 rounded px-2 py-0.5 outline-none focus:ring-1 focus:ring-indigo-400 resize-none leading-relaxed"
            />
            {/* @mention dropdown */}
            {mentionQuery !== null && mentionMatches.length > 0 && (
              <ul className="absolute left-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg w-56 py-1 text-sm">
                {mentionMatches.map((m, i) => (
                  <li
                    key={m.id}
                    className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer ${i === mentionIndex ? "bg-indigo-50 text-indigo-700" : "text-[var(--twilio-navy)] hover:bg-gray-50"}`}
                    onMouseDown={(e) => { e.preventDefault(); acceptMention(m); }}
                  >
                    <span className="h-5 w-5 rounded-full bg-indigo-100 flex items-center justify-center text-[10px] font-bold text-indigo-600 shrink-0">
                      {m.full_name[0]}
                    </span>
                    <span className="truncate">{m.full_name}</span>
                    {m.title && <span className="text-[11px] text-[var(--twilio-gray-60)] truncate">{m.title}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div
            className="text-sm text-[var(--twilio-navy)] leading-relaxed cursor-text"
            onClick={() => { setEditing(true); setEditText(note.text); }}
          >
            {note.text.split("\n").map((line, li) => {
              const isSub = line.startsWith("- ");
              const content = isSub ? line.slice(2) : line;
              return (
                <div key={li} className={isSub ? "flex items-start gap-1.5 ml-4 mt-0.5" : (li > 0 ? "mt-0.5" : "")}>
                  {isSub && <span className="shrink-0 mt-[5px] h-1 w-1 rounded-full bg-[var(--twilio-gray-60)] opacity-60" />}
                  <span>{renderNoteInline(content)}</span>
                </div>
              );
            })}
          </div>
        )}
        {/* Hover action icons — CSS float so text wraps naturally beneath them */}
        {!editing && (
          <div ref={tooltipRef} className="float-right flex items-center gap-0.5 bg-transparent group-hover:bg-gray-50/90 rounded-md px-0.5 ml-1 transition-colors">
            {/* Action Item */}
            <button ref={actionBtnRef} onClick={() => openTooltipAt("action")} title="Create action item"
              className={`p-1 rounded transition-colors ${doneActions.has("action") ? "text-blue-600 opacity-100" : openTooltip === "action" ? "text-[var(--twilio-navy)] bg-gray-100 opacity-100" : "opacity-0 group-hover:opacity-100 text-[var(--twilio-gray-40)] hover:text-[var(--twilio-navy)] hover:bg-gray-100"}`}>
              <IconChecklist className="w-3.5 h-3.5" />
            </button>

            {/* Calendar */}
            <button ref={calBtnRef} onClick={() => openTooltipAt("calendar")} title="Create meeting"
              className={`p-1 rounded transition-colors ${doneActions.has("calendar") ? "text-blue-600 opacity-100" : openTooltip === "calendar" ? "text-[var(--twilio-navy)] bg-gray-100 opacity-100" : "opacity-0 group-hover:opacity-100 text-[var(--twilio-gray-40)] hover:text-[var(--twilio-navy)] hover:bg-gray-100"}`}>
              <IconCalendar className="w-3.5 h-3.5" />
            </button>

            {/* Reminder */}
            <button ref={remBtnRef} onClick={() => openTooltipAt("reminder")} title="Set reminder"
              className={`p-1 rounded transition-colors ${doneActions.has("reminder") ? "text-blue-600 opacity-100" : openTooltip === "reminder" ? "text-[var(--twilio-navy)] bg-gray-100 opacity-100" : "opacity-0 group-hover:opacity-100 text-[var(--twilio-gray-40)] hover:text-[var(--twilio-navy)] hover:bg-gray-100"}`}>
              <IconSchedule className="w-3.5 h-3.5" />
            </button>

            {/* Agent */}
            <button onClick={handleSendToAgent} title="Send to agent chat"
              className="p-1 rounded transition-colors opacity-0 group-hover:opacity-100 text-[var(--twilio-gray-40)] hover:text-[var(--twilio-navy)] hover:bg-gray-100">
              <IconAgent className="w-3.5 h-3.5" />
            </button>

            <span className="h-3 w-px bg-gray-200 mx-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />

            {/* Delete */}
            <button onClick={() => onDelete(note.id)} title="Delete note"
              className="p-1 rounded transition-colors opacity-0 group-hover:opacity-100 text-[var(--twilio-gray-40)] hover:text-red-500 hover:bg-red-50">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
                <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9h8l1-9" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        )}

        {/* Author — right-aligned, only visible on hover */}
        {!editing && note.author_display && (
          <div className="text-right text-[10px] text-[var(--twilio-gray-40)] opacity-0 group-hover:opacity-100 transition-opacity" title={note.author_display}>
            {note.author_display}
          </div>
        )}

      </div>

      {/* Floating tooltip panels — portalled to body so overflow:hidden ancestors can't clip them */}
      {!editing && (
        <div>
          {/* ── Action Item tooltip ───────────────────────────────────────── */}
          {openTooltip === "action" && tooltipPos && createPortal(
            <div ref={tooltipPanelRef} className="fixed z-[9999] w-72 bg-white border border-gray-200 rounded-xl shadow-lg p-3 space-y-2.5" style={{ top: tooltipPos.top, right: tooltipPos.right }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)]">Create Action Item</p>
              <div className="text-xs text-[var(--twilio-gray-80)] bg-gray-50 rounded-lg px-2 py-1.5 line-clamp-2">{stripMentions(note.text)}</div>

              {/* Assignees multi-select */}
              <div>
                <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">Assign to</p>
                <div className="flex flex-wrap gap-1 mb-1">
                  {aiAssignees.map((m) => (
                    <span key={m.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-indigo-100 text-indigo-700">
                      {m.full_name}
                      <button onClick={() => setAiAssignees((prev) => prev.filter((a) => a.id !== m.id))} className="hover:text-red-500">×</button>
                    </span>
                  ))}
                </div>
                <select
                  className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
                  value=""
                  onChange={(e) => {
                    const member = teamMembers.find((m) => String(m.id) === e.target.value);
                    if (member && !aiAssignees.find((a) => a.id === member.id)) setAiAssignees((prev) => [...prev, member]);
                  }}
                >
                  <option value="">+ Add assignee…</option>
                  {teamMembers.filter((m) => !aiAssignees.find((a) => a.id === m.id)).map((m) => (
                    <option key={m.id} value={m.id}>{m.full_name}{m.title ? ` — ${m.title}` : ""}</option>
                  ))}
                </select>
              </div>

              {/* Priority + Due date */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">Priority</p>
                  <select value={aiPriority} onChange={(e) => setAiPriority(e.target.value as typeof aiPriority)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400 bg-white">
                    {(["Low","Medium","High","Critical"] as const).map((p) => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">Due date</p>
                  <input type="date" value={aiDue} onChange={(e) => setAiDue(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400 bg-white" />
                </div>
              </div>

              <button onClick={submitActionItem} disabled={aiSaved}
                className={`w-full text-xs font-semibold py-1.5 rounded-lg transition-colors ${aiSaved ? "bg-emerald-500 text-white" : "bg-[var(--twilio-navy)] text-white hover:bg-indigo-700"}`}>
                {aiSaved ? "✓ Created" : "Create Action Item"}
              </button>
            </div>
          , document.body)}

          {/* ── Calendar tooltip ──────────────────────────────────────────── */}
          {openTooltip === "calendar" && tooltipPos && createPortal(
            <div ref={tooltipPanelRef} className="fixed z-[9999] w-72 bg-white border border-gray-200 rounded-xl shadow-lg p-3 space-y-2.5" style={{ top: tooltipPos.top, right: tooltipPos.right }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)]">Create Meeting</p>

              <div>
                <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">Title</p>
                <input value={calTitle} onChange={(e) => setCalTitle(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400" />
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">Start</p>
                  <input type="datetime-local" value={calStart} onChange={(e) => setCalStart(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400" />
                </div>
                <div className="flex-1">
                  <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">End</p>
                  <input type="datetime-local" value={calEnd} onChange={(e) => setCalEnd(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400" />
                </div>
              </div>

              {/* Invite attendees — reuse aiAssignees pool */}
              <div>
                <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">Invite</p>
                <div className="flex flex-wrap gap-1 mb-1">
                  {aiAssignees.map((m) => (
                    <span key={m.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-indigo-100 text-indigo-700">
                      {m.full_name}
                      <button onClick={() => setAiAssignees((prev) => prev.filter((a) => a.id !== m.id))} className="hover:text-red-500">×</button>
                    </span>
                  ))}
                </div>
                <select className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
                  value=""
                  onChange={(e) => {
                    const member = teamMembers.find((m) => String(m.id) === e.target.value);
                    if (member && !aiAssignees.find((a) => a.id === member.id)) setAiAssignees((prev) => [...prev, member]);
                  }}>
                  <option value="">+ Add attendee…</option>
                  {teamMembers.filter((m) => !aiAssignees.find((a) => a.id === m.id)).map((m) => (
                    <option key={m.id} value={m.id}>{m.full_name}</option>
                  ))}
                </select>
              </div>

              <button onClick={submitMeeting} disabled={!calStart || !calEnd || calSaved}
                className={`w-full text-xs font-semibold py-1.5 rounded-lg transition-colors ${calSaved ? "bg-emerald-500 text-white" : "bg-[var(--twilio-navy)] text-white hover:bg-indigo-700 disabled:opacity-40"}`}>
                {calSaved ? "✓ Created" : "Create Meeting"}
              </button>
            </div>
          , document.body)}

          {/* ── Reminder tooltip ──────────────────────────────────────────── */}
          {openTooltip === "reminder" && tooltipPos && createPortal(
            <div ref={tooltipPanelRef} className="fixed z-[9999] w-64 bg-white border border-gray-200 rounded-xl shadow-lg p-3 space-y-2.5" style={{ top: tooltipPos.top, right: tooltipPos.right }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)]">Set Reminder</p>
              <div className="text-xs text-[var(--twilio-gray-80)] bg-gray-50 rounded-lg px-2 py-1.5 line-clamp-2">{stripMentions(note.text)}</div>

              {/* Quick picks */}
              <div className="flex flex-wrap gap-1">
                {[
                  { label: "In 1 hour", mins: 60 },
                  { label: "Tomorrow 9am", mins: null },
                  { label: "In 2 days", mins: null, days: 2 },
                ].map(({ label, mins, days }) => (
                  <button key={label}
                    onClick={() => {
                      const d = new Date();
                      if (mins) { d.setMinutes(d.getMinutes() + mins); }
                      else if (days) { d.setDate(d.getDate() + days); d.setHours(9, 0, 0, 0); }
                      else { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
                      const pad = (n: number) => String(n).padStart(2, "0");
                      setRemDate(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`);
                      setRemTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
                    }}
                    className="text-[11px] px-2 py-0.5 rounded-full border border-gray-200 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition-colors">
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">Date</p>
                  <input type="date" value={remDate} onChange={(e) => setRemDate(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400" />
                </div>
                <div className="flex-1">
                  <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">Time</p>
                  <input type="time" value={remTime} onChange={(e) => setRemTime(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400" />
                </div>
              </div>

              <button onClick={submitReminder} disabled={!remDate || remSaved}
                className={`w-full text-xs font-semibold py-1.5 rounded-lg transition-colors ${remSaved ? "bg-emerald-500 text-white" : "bg-[var(--twilio-navy)] text-white hover:bg-indigo-700 disabled:opacity-40"}`}>
                {remSaved ? "✓ Reminder Set" : "Set Reminder"}
              </button>
            </div>
          , document.body)}
        </div>
      )}
    </li>
  );
}

// ── Gong / Meeting Summary paste section ──────────────────────────────────────

function detectMentionsInSummary(
  text: string,
  teamMembers: TeamMember[],
  accountTeamMembers: { id?: number; full_name: string }[] = [],
): { members: TeamMember[]; display: string } {
  // Build a set of full_names on the account team for O(1) lookup
  const accountNames = new Set(accountTeamMembers.map((m) => m.full_name.toLowerCase()));

  const found: TeamMember[] = [];
  for (const m of teamMembers) {
    const first = m.full_name.split(" ")[0];
    const fullPat = new RegExp(`(?<!@)\\b${m.full_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    const firstPat = new RegExp(`(?<!@)\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    if (fullPat.test(text) || firstPat.test(text)) {
      if (!found.find((f) => f.id === m.id)) found.push(m);
    }
  }

  // Only rewrite names for members who are on this account's team
  console.log("[detectMentions] accountTeamMembers:", accountTeamMembers.map((m) => m.full_name), "found:", found.map((m) => m.full_name));
  let display = text;
  for (const m of found) {
    if (!accountNames.has(m.full_name.toLowerCase())) continue;
    const first = m.full_name.split(" ")[0];
    const fullPat = new RegExp(`(?<!@)\\b${m.full_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    const firstPat = new RegExp(`(?<!@)\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    display = display.replace(fullPat, `@${m.full_name}`).replace(firstPat, `@${m.full_name}`);
  }

  return { members: found, display };
}

type GongItem = { kind: "heading"; text: string } | { kind: "subheading"; text: string } | { kind: "bullet"; text: string };

// Section headings recognised from Gong ("Recap", "Key Points", "Next Steps")
// and Zoom ("Quick recap", "Next steps", "Summary", and named sub-sections like "Use Case Discussion Planning")
const GONG_HEADINGS = /^(recap|quick\s+recap|key\s+points?|next\s+steps?|summary|collaboration):?$/i;

// A line is a Zoom "Next steps" person-name subheading when it is a standalone
// name with NO bullet prefix and falls inside the "Next steps" section.
// We use a simple heuristic: not a bullet, not a known heading, and under 40
// characters (person names are short).
function isPersonSubheading(line: string, inNextSteps: boolean): boolean {
  if (!inNextSteps) return false;
  const trimmed = line.trim();
  if (!trimmed) return false;
  // Must not start with a bullet marker
  if (/^[\s]*[-•*▪◦–—]/.test(trimmed)) return false;
  if (/^[\s]*\d+[.)]/.test(trimmed)) return false;
  // Must not be a known section heading itself
  if (GONG_HEADINGS.test(trimmed.replace(/:$/, ""))) return false;
  // Short, no sentence-ending punctuation — looks like a name
  return trimmed.length <= 50 && !/[.?!]$/.test(trimmed);
}

function parseBullets(text: string): GongItem[] {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  let inNextSteps = false;
  const result: GongItem[] = [];
  for (const l of lines) {
    const stripped = l.replace(/^[\s]*[-•*▪◦–—][\s]+/, "").replace(/^[\s]*\d+[.)]\s+/, "").trim();
    const headingText = stripped.replace(/:$/, "");
    if (GONG_HEADINGS.test(headingText)) {
      inNextSteps = /next\s+steps?/i.test(headingText);
      result.push({ kind: "heading", text: headingText });
    } else if (isPersonSubheading(l, inNextSteps)) {
      result.push({ kind: "subheading", text: stripped });
    } else {
      result.push({ kind: "bullet", text: stripped });
    }
  }
  return result;
}

function renderWithMentions(text: string): React.ReactNode {
  const parts = text.split(/(@\S+)/g);
  return parts.map((p, i) =>
    p.startsWith("@") ? <span key={i} style={{ color: "#2563eb", fontWeight: 600 }}>{p}</span> : p
  );
}

function GongActionTooltip({ kind, noteText, eventId, accountName, airtableAccountId, mentionedMembers, anchorRect, onDone, onCreated, onClose }: {
  kind: "action" | "reminder" | "calendar";
  noteText: string;
  eventId: number;
  accountName?: string | null;
  airtableAccountId?: number | null;
  mentionedMembers?: TeamMember[];
  anchorRect: DOMRect;
  onDone?: (kind: "action" | "reminder" | "calendar") => void;
  onCreated?: (item: AirtableActionItem) => void;
  onClose: () => void;
}) {
  const currentUser = useCurrentUser();
  const [priority, setPriority] = useState<"Low"|"Medium"|"High"|"Critical">("Medium");
  const [due, setDue] = useState("");
  const [remDate, setRemDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0,10); });
  const [remTime, setRemTime] = useState("09:00");
  const [calTitle, setCalTitle] = useState(noteText.slice(0, 80));
  const [calStart, setCalStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10,0,0,0); return d.toISOString().slice(0,16); });
  const [calEnd, setCalEnd] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(11,0,0,0); return d.toISOString().slice(0,16); });
  const [done, setDone] = useState(false);
  const tooltipElRef = useRef<HTMLDivElement>(null);
  // Compute fixed position from anchor: prefer below, flip above if too close to viewport bottom
  const TOOLTIP_HEIGHT_ESTIMATE = 180;
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const openUpward = spaceBelow < TOOLTIP_HEIGHT_ESTIMATE + 8;
  const fixedTop = openUpward ? anchorRect.top - TOOLTIP_HEIGHT_ESTIMATE - 4 : anchorRect.bottom + 4;
  const fixedRight = window.innerWidth - anchorRect.right;

  const stripped = noteText.replace(/@\S+/g, "").trim();
  const assignee = mentionedMembers?.[0];

  async function submit() {
    if (kind === "action") {
      const { data } = await airtableApi.createActionItem({
        task: stripped, status: "Open", priority, due_date: due || null,
        account: airtableAccountId ?? undefined,
        account_name: accountName ?? undefined,
        assignee_name: assignee?.full_name || currentUser?.display_name || "",
        assignee_airtable_id: assignee ? String(assignee.id) : currentUser?.airtable_collaborator_id || "",
      } as Parameters<typeof airtableApi.createActionItem>[0]);
      onCreated?.(data);
      localStorage.setItem("actionItemsUpdated", String(Date.now()));
      window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated", newValue: String(Date.now()) }));
    } else if (kind === "reminder") {
      await schedulerApi.createReminder({ title: stripped.slice(0, 200) || "Note reminder", body: noteText, resource_type: "calendar_event", resource_id: eventId, due_at: new Date(`${remDate}T${remTime}:00`).toISOString(), notify_in_app: true } as Parameters<typeof schedulerApi.createReminder>[0]);
    } else {
      await schedulerApi.createEvent({ title: calTitle, description: `From meeting note: ${noteText}`, start_datetime: new Date(calStart).toISOString(), end_datetime: new Date(calEnd).toISOString() } as Parameters<typeof schedulerApi.createEvent>[0]);
    }
    setDone(true);
    onDone?.(kind);
    setTimeout(onClose, 1200);
  }

  const label = kind === "action" ? "Create Action Item" : kind === "reminder" ? "Set Reminder" : "Create Meeting";

  return (
    <div ref={tooltipElRef} style={{ position: "fixed", top: fixedTop, right: fixedRight, zIndex: 9999, background: "#fff", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "10px 12px", width: "240px", boxShadow: "0 4px 16px rgba(0,0,0,0.12)", display: "flex", flexDirection: "column", gap: "8px" }}>
      <p style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#6b7280", margin: 0 }}>{label}</p>
      <div style={{ fontSize: "0.75rem", background: "#f9fafb", borderRadius: "5px", padding: "4px 7px", color: "#374151", lineHeight: 1.4, maxHeight: "40px", overflow: "hidden" }}>{stripped}</div>
      {kind === "action" && (
        <div style={{ display: "flex", gap: "6px" }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: "0.6875rem", color: "#9ca3af", marginBottom: "3px" }}>Priority</p>
            <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} style={{ width: "100%", fontSize: "0.75rem", border: "1px solid #e5e7eb", borderRadius: "5px", padding: "3px 6px", outline: "none" }}>
              {(["Low","Medium","High","Critical"] as const).map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: "0.6875rem", color: "#9ca3af", marginBottom: "3px" }}>Due date</p>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={{ width: "100%", fontSize: "0.75rem", border: "1px solid #e5e7eb", borderRadius: "5px", padding: "3px 6px", outline: "none" }} />
          </div>
        </div>
      )}
      {kind === "reminder" && (
        <div style={{ display: "flex", gap: "6px" }}>
          <div style={{ flex: 1 }}><p style={{ fontSize: "0.6875rem", color: "#9ca3af", marginBottom: "3px" }}>Date</p><input type="date" value={remDate} onChange={(e) => setRemDate(e.target.value)} style={{ width: "100%", fontSize: "0.75rem", border: "1px solid #e5e7eb", borderRadius: "5px", padding: "3px 6px", outline: "none" }} /></div>
          <div style={{ flex: 1 }}><p style={{ fontSize: "0.6875rem", color: "#9ca3af", marginBottom: "3px" }}>Time</p><input type="time" value={remTime} onChange={(e) => setRemTime(e.target.value)} style={{ width: "100%", fontSize: "0.75rem", border: "1px solid #e5e7eb", borderRadius: "5px", padding: "3px 6px", outline: "none" }} /></div>
        </div>
      )}
      {kind === "calendar" && (
        <>
          <div><p style={{ fontSize: "0.6875rem", color: "#9ca3af", marginBottom: "3px" }}>Title</p><input value={calTitle} onChange={(e) => setCalTitle(e.target.value)} style={{ width: "100%", fontSize: "0.75rem", border: "1px solid #e5e7eb", borderRadius: "5px", padding: "3px 6px", outline: "none", boxSizing: "border-box" }} /></div>
          <div style={{ display: "flex", gap: "6px" }}>
            <div style={{ flex: 1 }}><p style={{ fontSize: "0.6875rem", color: "#9ca3af", marginBottom: "3px" }}>Start</p><input type="datetime-local" value={calStart} onChange={(e) => setCalStart(e.target.value)} style={{ width: "100%", fontSize: "0.6875rem", border: "1px solid #e5e7eb", borderRadius: "5px", padding: "3px 6px", outline: "none" }} /></div>
            <div style={{ flex: 1 }}><p style={{ fontSize: "0.6875rem", color: "#9ca3af", marginBottom: "3px" }}>End</p><input type="datetime-local" value={calEnd} onChange={(e) => setCalEnd(e.target.value)} style={{ width: "100%", fontSize: "0.6875rem", border: "1px solid #e5e7eb", borderRadius: "5px", padding: "3px 6px", outline: "none" }} /></div>
          </div>
        </>
      )}
      <button onClick={() => void submit()} style={{ padding: "5px 0", fontSize: "0.75rem", fontWeight: 700, background: done ? "#10b981" : "#6366f1", color: "#fff", border: "none", borderRadius: "5px", cursor: "pointer" }}>
        {done ? "✓ Done" : label}
      </button>
    </div>
  );
}

function _strHash(s: string): number {
  let h = 0;
  for (let i = 0; i < Math.min(s.length, 120); i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function GongBulletRow({ text, eventId, accountName, airtableAccountId, isLast, onCreatedActionItem, mentionedMembers, persistKey }: { text: string; eventId: number; accountName?: string | null; airtableAccountId?: number | null; isLast: boolean; onCreatedActionItem?: (item: AirtableActionItem) => void; mentionedMembers?: TeamMember[]; persistKey: string }) {
  const [openAction, setOpenAction] = useState<"action" | "reminder" | "calendar" | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [doneActions, setDoneActions] = useState<Set<"action" | "calendar" | "reminder">>(() => {
    try { const v = localStorage.getItem(persistKey); return v ? new Set(JSON.parse(v) as ("action" | "calendar" | "reminder")[]) : new Set(); } catch { return new Set(); }
  });
  const tooltipRef = useRef<HTMLDivElement>(null);

  function openWith(kind: "action" | "reminder" | "calendar", e: React.MouseEvent<HTMLButtonElement>) {
    if (openAction === kind) { setOpenAction(null); setAnchorRect(null); return; }
    setAnchorRect(e.currentTarget.getBoundingClientRect());
    setOpenAction(kind);
  }

  useEffect(() => {
    if (!openAction) return;
    function handler(e: MouseEvent) {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) setOpenAction(null);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openAction]);

  return (
    <div className="group" style={{ display: "flex", alignItems: "flex-start", gap: "6px", padding: "6px 10px", borderBottom: isLast ? undefined : "1px solid rgba(0,0,0,0.05)", position: "relative" }}>
      <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#9ca3af", flexShrink: 0, marginTop: "7px" }} />
      <p style={{ flex: 1, fontSize: "0.8125rem", color: "var(--twilio-navy)", lineHeight: 1.5, margin: 0 }}>{renderWithMentions(text)}</p>
      <div ref={tooltipRef} style={{ display: "flex", alignItems: "center", gap: "2px", flexShrink: 0 }}>
        <button title="Create action item" onClick={(e) => openWith("action", e)} style={{ padding: "2px", borderRadius: "3px", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", color: doneActions.has("action") ? "#2563eb" : "#9ca3af" }} className={doneActions.has("action") ? "transition-opacity" : "opacity-0 group-hover:opacity-100 transition-opacity"}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: "12px", height: "12px" }}><path d="M8 5h9M8 10h9M8 15h9" strokeLinecap="round"/><path d="M3 5l1.5 1.5L7 3M3 10l1.5 1.5L7 8M3 15l1.5 1.5L7 13" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <button title="Set reminder" onClick={(e) => openWith("reminder", e)} style={{ padding: "2px", borderRadius: "3px", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", color: doneActions.has("reminder") ? "#2563eb" : "#9ca3af" }} className={doneActions.has("reminder") ? "transition-opacity" : "opacity-0 group-hover:opacity-100 transition-opacity"}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: "12px", height: "12px" }}><circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <button title="Create meeting" onClick={(e) => openWith("calendar", e)} style={{ padding: "2px", borderRadius: "3px", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", color: doneActions.has("calendar") ? "#2563eb" : "#9ca3af" }} className={doneActions.has("calendar") ? "transition-opacity" : "opacity-0 group-hover:opacity-100 transition-opacity"}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: "12px", height: "12px" }}><rect x="2" y="4" width="16" height="14" rx="2"/><path d="M2 8h16M6 2v4M14 2v4" strokeLinecap="round"/></svg>
        </button>
        {openAction && anchorRect && (
          <GongActionTooltip
            kind={openAction}
            noteText={text}
            eventId={eventId}
            accountName={accountName}
            airtableAccountId={airtableAccountId}
            mentionedMembers={mentionedMembers}
            anchorRect={anchorRect}
            onDone={(kind) => setDoneActions((prev) => { const n = new Set([...prev, kind]); try { localStorage.setItem(persistKey, JSON.stringify([...n])); } catch {} return n; })}
            onCreated={onCreatedActionItem}
            onClose={() => { setOpenAction(null); setAnchorRect(null); }}
          />
        )}
      </div>
    </div>
  );
}

function MeetingSummarySection({ eventId, meetingId, existingNotes, accountName, airtableAccountId, accountTeamMembers, onCreatedActionItem }: {
  eventId: number;
  meetingId?: number;
  existingNotes?: string;
  accountName?: string | null;
  airtableAccountId?: number | null;
  accountTeamMembers?: AccountTeamMember[];
  onCreatedActionItem?: (item: AirtableActionItem) => void;
}) {
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [raw, setRaw] = useState(existingNotes ?? "");
  const [items, setItems] = useState<(GongItem & { mentionedMembers?: TeamMember[] })[]>(() =>
    existingNotes?.trim() ? parseBullets(existingNotes) : []
  );
  const [showPaste, setShowPaste] = useState(!existingNotes?.trim());
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const resolvedMeetingId = useRef<number | undefined>(meetingId);

  useEffect(() => {
    teamApi.listMembers().then(({ data }) => setTeamMembers(data.results ?? [])).catch(() => {});
  }, []);

  const prevExistingRef = useRef(existingNotes);
  useEffect(() => {
    if (existingNotes !== prevExistingRef.current) {
      prevExistingRef.current = existingNotes;
      resolvedMeetingId.current = meetingId;
      setRaw(existingNotes ?? "");
      setItems(existingNotes?.trim() ? parseBullets(existingNotes) : []);
      setShowPaste(!existingNotes?.trim());
    }
  }, [existingNotes, meetingId]);

  async function persistAndNotify(text: string, parsed: GongItem[]) {
    const notified = new Set<number>();
    const enriched = parsed.map((item) => {
      if (item.kind !== "bullet") return item;
      const { members, display } = detectMentionsInSummary(item.text, teamMembers, accountTeamMembers ?? []);
      return { ...item, text: display, mentionedMembers: members };
    });
    setItems(enriched);
    setShowPaste(false);

    if (!resolvedMeetingId.current && !eventId) return;
    setSaveState("saving");
    try {
      if (resolvedMeetingId.current) {
        await airtableApi.updateMeetingGongNotesByPk(resolvedMeetingId.current, text.trim());
      } else {
        const { data } = await airtableApi.updateMeetingGongNotes(eventId, text.trim());
        resolvedMeetingId.current = data.id;
      }
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2500);
    } catch {
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 3000);
    }

    const summaryText = enriched.filter((i) => i.kind === "bullet").map((i) => `• ${i.text}`).join("\n");
    for (const item of enriched) {
      if (item.kind !== "bullet" || !item.mentionedMembers?.length) continue;
      for (const member of item.mentionedMembers) {
        if (notified.has(member.id) || !member.slack_handle) continue;
        notified.add(member.id);
        const msg = `👋 You were mentioned in meeting notes${accountName ? ` for *${accountName}*` : ""}:\n\n${summaryText}`;
        integrationsApi.notifySlackMention(member.slack_handle, msg).catch(() => {});
      }
    }
  }

  async function handleParse() {
    const parsed = parseBullets(raw);
    if (parsed.length === 0) return;
    await persistAndNotify(raw, parsed);
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = e.clipboardData.getData("text");
    if (!pasted.trim()) return;
    const ta = e.target as HTMLTextAreaElement;
    const before = ta.value.slice(0, ta.selectionStart ?? 0);
    const after = ta.value.slice(ta.selectionEnd ?? ta.value.length);
    const fullText = before + pasted + after;
    setRaw(fullText);
    const parsed = parseBullets(fullText);
    if (parsed.length > 0) {
      void persistAndNotify(fullText, parsed);
    } else {
      void saveRaw(fullText);
    }
  }

  async function saveRaw(text: string) {
    if (!text.trim()) return;
    if (!resolvedMeetingId.current && !eventId) return;
    setSaveState("saving");
    try {
      if (resolvedMeetingId.current) {
        await airtableApi.updateMeetingGongNotesByPk(resolvedMeetingId.current, text.trim());
      } else {
        const { data } = await airtableApi.updateMeetingGongNotes(eventId, text.trim());
        resolvedMeetingId.current = data.id;
      }
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2500);
    } catch {
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 3000);
    }
  }

  async function handleClear() {
    setItems([]);
    setRaw("");
    setShowPaste(true);
    if (!resolvedMeetingId.current && !eventId) return;
    setSaveState("saving");
    try {
      if (resolvedMeetingId.current) {
        await airtableApi.updateMeetingGongNotesByPk(resolvedMeetingId.current, "");
      } else {
        await airtableApi.updateMeetingGongNotes(eventId, "");
      }
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2500);
    } catch {
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 3000);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {saveState === "saving" && <span style={{ fontSize: "0.6875rem", color: "#9ca3af" }}>Saving…</span>}
          {saveState === "saved" && <span style={{ fontSize: "0.6875rem", color: "#16a34a" }}>✓ Saved</span>}
          {saveState === "error" && <span style={{ fontSize: "0.6875rem", color: "#dc2626" }}>Save failed</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {items.length > 0 && (
            <button onClick={() => void handleClear()} style={{ fontSize: "0.6875rem", color: "#9ca3af", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              Clear
            </button>
          )}
          <button onClick={() => setShowPaste((v) => !v)} style={{ fontSize: "0.6875rem", fontWeight: 600, color: "#6366f1", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            {showPaste ? "Hide" : items.length > 0 ? "Edit paste" : "+ Paste summary"}
          </button>
        </div>
      </div>

      {showPaste && (
        <div style={{ marginBottom: "8px" }}>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onPaste={handlePaste}
            onBlur={() => { if (raw.trim()) void saveRaw(raw); }}
            rows={7}
            placeholder="Paste your Gong AI summary, meeting notes, or any bulleted text here…"
            style={{ width: "100%", fontSize: "0.8125rem", border: "1px solid #e5e7eb", borderRadius: "7px", padding: "8px 10px", outline: "none", resize: "vertical", lineHeight: 1.5, boxSizing: "border-box", color: "var(--twilio-navy)" }}
          />
          <button onClick={() => void handleParse()} disabled={!raw.trim()} style={{ marginTop: "5px", width: "100%", padding: "5px 0", fontSize: "0.75rem", fontWeight: 700, background: "#6366f1", color: "#fff", border: "none", borderRadius: "6px", cursor: raw.trim() ? "pointer" : "not-allowed", opacity: raw.trim() ? 1 : 0.4 }}>
            Parse & Save
          </button>
        </div>
      )}

      {items.length > 0 && (
        <div style={{ border: "1px solid rgba(0,0,0,0.08)", borderRadius: "8px", background: "#fff", overflow: "hidden" }}>
          {items.map((item, i) => {
            if (item.kind === "heading") {
              return (
                <div key={i} style={{ padding: "6px 10px 3px", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                  <p style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "capitalize", color: "var(--twilio-navy)", margin: 0, letterSpacing: "0.01em" }}>{item.text}</p>
                </div>
              );
            }
            if (item.kind === "subheading") {
              return (
                <div key={i} style={{ padding: "4px 10px 2px 20px", background: "rgba(99,102,241,0.04)" }}>
                  <p style={{ fontSize: "0.6875rem", fontWeight: 600, color: "#6366f1", margin: 0, letterSpacing: "0.01em" }}>{item.text}</p>
                </div>
              );
            }
            const isLast = i === items.length - 1 || items[i + 1]?.kind === "heading" || items[i + 1]?.kind === "subheading";
            return (
              <GongBulletRow key={i} persistKey={`gong-actions::${eventId}::${_strHash(item.text)}`} text={item.text} eventId={eventId} accountName={accountName} airtableAccountId={airtableAccountId} isLast={isLast} onCreatedActionItem={onCreatedActionItem} mentionedMembers={item.mentionedMembers} />
            );
          })}
        </div>
      )}

      {!showPaste && items.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center h-16">
          <button onClick={() => setShowPaste(true)} className="text-sm text-[var(--twilio-gray-40)] hover:text-indigo-500 transition-colors">
            + Paste Gong, Zoom, or meeting summary
          </button>
        </div>
      )}
    </div>
  );
}

function MeetingNotesSection({
  eventId,
  eventTitle,
  accountName,
  notes,
  setNotes,
  locallyCreatedNoteIds,
  onActionItemCreated,
}: {
  eventId: number;
  eventTitle: string;
  accountName?: string | null;
  notes: MeetingNote[];
  setNotes: React.Dispatch<React.SetStateAction<MeetingNote[]>>;
  locallyCreatedNoteIds: MutableRefObject<Set<number>>;
  onActionItemCreated?: (item: AirtableActionItem) => void;
}) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  // @mention state for the new-note input
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const draftInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    teamApi.listMembers().then(({ data }) => setTeamMembers(data.results ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    const el = draftInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  function handleDraftChange(val: string) {
    setDraft(val);
    if (saveError) setSaveError(false);
    const atIdx = val.lastIndexOf("@");
    if (atIdx >= 0) {
      const query = val.slice(atIdx + 1);
      if (!query.includes(" ")) {
        setMentionQuery(query.toLowerCase());
        setMentionIndex(0);
        return;
      }
    }
    setMentionQuery(null);
  }

  const mentionMatches = mentionQuery !== null
    ? teamMembers.filter((m) =>
        m.full_name.toLowerCase().includes(mentionQuery) ||
        m.email.toLowerCase().includes(mentionQuery)
      ).slice(0, 6)
    : [];

  function acceptDraftMention(member: TeamMember) {
    const atIdx = draft.lastIndexOf("@");
    const newText = draft.slice(0, atIdx) + `@${member.full_name.replace(/\s+/g, "")} `;
    setDraft(newText);
    setMentionQuery(null);
    draftInputRef.current?.focus();
  }

  async function handleAddNote() {
    const text = draft.trim();
    if (!text || saving) return;
    // Synthetic events (negative IDs) don't have a DB record — notes can't be saved
    if (eventId <= 0) { setSaveError(true); return; }
    setSaving(true);
    setSaveError(false);
    try {
      const { data } = await schedulerApi.createMeetingNote({
        event: eventId,
        html: text,
        text,
        position: notes.length,
      });
      locallyCreatedNoteIds.current.add(data.id);
      setNotes((prev) => prev.some((n) => n.id === data.id) ? prev : [...prev, data]);
      setDraft("");
    } catch (err) {
      console.error("[MeetingNotes] Failed to save note:", err);
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  function handleSaveEdit(updated: MeetingNote) {
    setNotes((prev) => prev.map((n) => n.id === updated.id ? updated : n));
  }

  async function handleDelete(id: number) {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    try { await schedulerApi.deleteMeetingNote(id); } catch { /* best effort */ }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      {/* New note input */}
      <div className={`relative flex items-start gap-2 px-3 py-2 ${notes.length > 0 ? "border-b border-gray-100" : ""}`}>
        <span className="mt-[7px] h-1.5 w-1.5 rounded-full bg-gray-300 shrink-0" />
        <textarea
          ref={draftInputRef}
          value={draft}
          rows={1}
          onChange={(e) => handleDraftChange(e.target.value)}
          onPaste={(e) => handleLinkPaste(e, draft, setDraft)}
          onKeyDown={(e) => {
            if (mentionQuery !== null && mentionMatches.length > 0) {
              if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i) => Math.min(i + 1, mentionMatches.length - 1)); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex((i) => Math.max(i - 1, 0)); return; }
              if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); acceptDraftMention(mentionMatches[mentionIndex]); return; }
              if (e.key === "Escape") { setMentionQuery(null); return; }
            }
            if (e.key === "Enter" && e.shiftKey) { return; } // Shift+Enter → newline
            if (e.key === "Enter") { e.preventDefault(); void handleAddNote(); }
          }}
          placeholder="Add a note… (Shift+Enter for new line, '- ' for sub-bullet)"
          style={{ overflow: "hidden" }}
          className="flex-1 text-sm text-[var(--twilio-navy)] placeholder-gray-400 bg-transparent outline-none py-0.5 resize-none leading-relaxed"
          disabled={saving}
        />
        {draft.trim() && (
          <button
            onClick={() => void handleAddNote()}
            disabled={saving}
            className="text-[11px] font-medium text-indigo-500 hover:text-indigo-700 shrink-0 transition-colors self-start mt-0.5"
          >
            {saving ? "Saving…" : "Add"}
          </button>
        )}
        {saveError && (
          <span className="text-[10px] text-red-500 shrink-0 self-start mt-1">
            {eventId <= 0 ? "Sync event to save notes" : "Save failed — try again"}
          </span>
        )}
        {/* @mention dropdown for new-note input */}
        {mentionQuery !== null && mentionMatches.length > 0 && (
          <ul className="absolute left-6 bottom-full mb-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg w-56 py-1 text-sm">
            {mentionMatches.map((m, i) => (
              <li
                key={m.id}
                className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer ${i === mentionIndex ? "bg-indigo-50 text-indigo-700" : "text-[var(--twilio-navy)] hover:bg-gray-50"}`}
                onMouseDown={(e) => { e.preventDefault(); acceptDraftMention(m); }}
              >
                <span className="h-5 w-5 rounded-full bg-indigo-100 flex items-center justify-center text-[10px] font-bold text-indigo-600 shrink-0">
                  {m.full_name[0]}
                </span>
                <span className="truncate">{m.full_name}</span>
                {m.title && <span className="text-[11px] text-[var(--twilio-gray-60)] truncate">{m.title}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {notes.length > 0 && (
        <ul className="divide-y divide-gray-100">
          {notes.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              eventId={eventId}
              eventTitle={eventTitle}
              accountName={accountName}
              teamMembers={teamMembers}
              onSave={handleSaveEdit}
              onDelete={handleDelete}
              onActionItemCreated={onActionItemCreated}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AccountCard({
  account,
  matchMethod,
}: {
  account: AirtableAccount;
  matchMethod?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      <div className="col-span-2">
        <p className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)]">Account</p>
        <div className="flex items-center gap-2 mt-0.5">
          <p className="text-[var(--twilio-navy)] font-semibold">{account.name}</p>
          {account.health_score && (
            <span className="text-[11px] font-medium bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
              {account.health_score}
            </span>
          )}
          {matchMethod && (
            <span className="text-[11px] bg-gray-100 text-[var(--twilio-gray-60)] px-2 py-0.5 rounded-full">
              via {matchMethod}
            </span>
          )}
        </div>
        {account.email_domain && (
          <p className="text-[11px] text-[var(--twilio-gray-60)] mt-0.5">{account.email_domain}</p>
        )}
      </div>
      {account.open_ticket_count > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)]">Open tickets</p>
          <p className="text-[var(--twilio-navy)]">{account.open_ticket_count}</p>
        </div>
      )}
      {account.time_budget > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)]">Time budget</p>
          <p className="text-[var(--twilio-navy)]">{formatDuration(account.time_budget)}</p>
        </div>
      )}
      {account.total_meeting_duration > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)]">Total meetings</p>
          <p className="text-[var(--twilio-navy)]">{formatDuration(account.total_meeting_duration)}</p>
        </div>
      )}
      {account.next_meeting && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)]">Next meeting</p>
          <p className="text-[var(--twilio-navy)]">
            {new Date(account.next_meeting).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </p>
        </div>
      )}
    </div>
  );
}

function AirtableMeetingSection({
  meetings,
  eventTitle,
}: {
  meetings: AirtableMeeting[];
  eventTitle: string;
}) {
  const match =
    meetings.find((m) => m.name.toLowerCase().includes(eventTitle.toLowerCase())) ??
    meetings[0];

  if (!match) return null;

  return (
    <section>
      <SectionHeading>Meeting Record</SectionHeading>
      <div className="space-y-4">
        {match.expected_topics && (
          <div>
            <p className="text-sm font-medium text-[var(--twilio-navy)] mb-1">Expected Topics</p>
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm text-[var(--twilio-gray-80)] whitespace-pre-wrap">
              {match.expected_topics}
            </div>
          </div>
        )}
        {match.gong_notes ? (
          <div>
            <p className="text-sm font-medium text-[var(--twilio-navy)] mb-1">Meeting Notes</p>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-[var(--twilio-gray-80)] whitespace-pre-wrap">
              {match.gong_notes}
            </div>
            {match.gong_url && (
              <a
                href={match.gong_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-indigo-500 hover:underline mt-1 inline-block"
              >
                View Gong recording →
              </a>
            )}
          </div>
        ) : (
          <div>
            <p className="text-sm font-medium text-[var(--twilio-navy)] mb-1">Meeting Notes</p>
            <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-lg p-3 text-sm text-[var(--twilio-gray-60)] italic">
              Notes will appear here after the meeting.
            </div>
          </div>
        )}
        <div className="flex gap-3">
          {match.customer_slack && (
            <a href={match.customer_slack} target="_blank" rel="noopener noreferrer"
              className="text-sm text-indigo-500 hover:underline">
              Customer Slack →
            </a>
          )}
          {match.account_team_slack && (
            <a href={match.account_team_slack} target="_blank" rel="noopener noreferrer"
              className="text-sm text-indigo-500 hover:underline">
              Account Team Slack →
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
