import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate } from "react-router-dom";
import CorporateIcon from "../assets/icons/Corporate.svg?react";
import documentIconUrl from "../assets/icons/Document.svg";
import imageIconUrl from "../assets/icons/Image.svg";
import statisticsIconUrl from "../assets/icons/Statistics.svg";
import cloudUploadIconUrl from "../assets/icons/Cloud Upload.svg";
import { accountsApi, airtableApi, teamApi, skillsApi, schedulerApi, integrationsApi, searchApi } from "../lib/api";
import type { GmailThread, MeetingNotesEmailReport, MeetingNotesSource, SearchResult } from "../lib/api";
import { MeetingSummarySourceToggle, preferredMeetingSource } from "../components/account/MeetingSummarySourceToggle";
import type { Account, AccountArtifact, AccountNote, AccountQuickLink, ActionItemAttachment, AirtableAccount, AirtableActionItem, AirtableMeeting, Attendee, CalendarEvent, CustomerContact, CustomerContactNote, MeetingNote, Reminder, TeamMember } from "../types";
import { ROLE_META, getTitleRole } from "../lib/titleRoles";
import { useLogGlow } from "../hooks/useLogGlow";
import { addLog } from "../lib/appLog";
import { useScheduledOccurrences } from "../hooks/useScheduledOccurrences";
import { useActionItemFieldOptions } from "../hooks/useActionItemFieldOptions";
import { useCurrentUser } from "../context/CurrentUserContext";
import { useRightClickComment } from "../components/comments/CommentContext";
import CommentTrigger from "../components/comments/CommentTrigger";
import CommentPreviewList from "../components/comments/CommentPreviewList";
import CommentCountBadge from "../components/comments/CommentCountBadge";
import { useCommentMenuItem } from "../components/comments/commentMenuItem";
import { ContextMenu, FocusPinBadge, focusPinMenuItem } from "../components/action-items/ContextMenu";
import StepsPanel from "../components/action-items/StepsPanel";
import { ACTION_ITEMS_UPDATED_KEY } from "../lib/actionItemEvents";
import ArtifactPicker from "../components/action-items/ArtifactPicker";
import { useFocusPins } from "../hooks/useFocusPins";
import InlineCommentThread from "../components/comments/InlineCommentThread";
import ActivityLogSection from "../components/ActivityLogSection";
import { convertActionItemToEvent, restoreConversion } from "../hooks/useConvert";
import RichTextMentionEditor, { type RichTextMentionEditorHandle } from "../components/shared/RichTextMentionEditor";
import { htmlToPreviewText, sanitizeHtml, plainToHtml } from "../lib/noteHelpers";

// ── Edit Modal ────────────────────────────────────────────────────────────────

function EditAccountModal({
  account,
  members,
  onClose,
  onSave,
}: {
  account: Account;
  members: TeamMember[];
  onClose: () => void;
  onSave: (updated: Account) => void;
}) {
  const [form, setForm] = useState({
    company_name: account.company_name,
    website: account.website ?? "",
    industry: account.industry ?? "",
    status: account.status,
    arr: account.arr ?? "",
    team_member_ids: (account.team_members ?? []).map((m) => m.id),
  });
  const [saving, setSaving] = useState(false);

  const set = (key: string, value: unknown) => setForm((f) => ({ ...f, [key]: value }));

  async function handleSave() {
    setSaving(true);
    try {
      const { data } = await accountsApi.updateAccount(account.id, {
        ...form,
        arr: form.arr === "" ? null : form.arr,
      } as Partial<Account>);
      onSave(data);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="rounded-xl shadow-xl w-full max-w-lg mx-4 p-6"
        style={{ background: "var(--surface, #fff)", fontFamily: "var(--font-base)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-semibold mb-5" style={{ color: "var(--text-primary, #111)" }}>Edit Account</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">Company name *</label>
            <input
              autoFocus
              value={form.company_name}
              onChange={(e) => set("company_name", e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-200"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">Status</label>
              <select
                value={form.status}
                onChange={(e) => set("status", e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-200"
              >
                <option value="prospect">Prospect</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="churned">Churned</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">Industry</label>
              <input
                value={form.industry}
                onChange={(e) => set("industry", e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-200"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">Website</label>
              <input
                value={form.website}
                onChange={(e) => set("website", e.target.value)}
                placeholder="https://…"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-200"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">ARR ($)</label>
              <input
                type="number"
                value={form.arr}
                onChange={(e) => set("arr", e.target.value)}
                placeholder="0"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-200"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-2">Team members</label>
            <div className="flex flex-wrap gap-2">
              {members.map((m) => {
                const selected = form.team_member_ids.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() =>
                      set(
                        "team_member_ids",
                        selected
                          ? form.team_member_ids.filter((id) => id !== m.id)
                          : [...form.team_member_ids, m.id]
                      )
                    }
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium transition-all"
                    style={
                      selected
                        ? { background: "var(--twilio-red, #e22)", border: "1px solid var(--twilio-red, #e22)", color: "#fff" }
                        : { background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", color: "var(--text-primary, #111)" }
                    }
                  >
                    {m.full_name}
                  </button>
                );
              })}
              {members.length === 0 && <p className="text-sm text-[var(--twilio-gray-60)]">No team members found.</p>}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm font-medium hover:opacity-80 transition-opacity"
            style={{ border: "1px solid var(--border, rgba(0,0,0,0.08))", color: "var(--text-primary, #111)", background: "var(--surface, #fff)" }}
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving || !form.company_name}
            className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
            style={{ background: "var(--twilio-red, #e22)", color: "#fff", border: "none" }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, string> = {
  Critical: "bg-red-50 text-red-700",
  High: "bg-orange-50 text-orange-700",
  Medium: "bg-sky-50 text-sky-700",
  Low: "bg-gray-100 text-[var(--twilio-navy)]",
};

const PRIORITY_ACCENT: Record<string, string> = {
  Critical: "#ef4444",
  High: "#f97316",
  Medium: "#0ea5e9",
  Low: "#9ca3af",
};

const STATUS_PILLS: Record<string, string> = {
  "Open": "bg-gray-100 text-gray-700",
  "In Progress": "bg-indigo-50 text-indigo-700",
  "Done": "bg-emerald-50 text-emerald-700",
  "Blocked": "bg-red-50 text-red-700",
  "Backlogged": "bg-slate-100 text-slate-600",
};

// ── Pill helpers for new action item form ─────────────────────────────────────

const NEW_AI_STATUS_COLORS: Record<string, string> = {
  "Open": "bg-gray-100 text-[var(--twilio-navy)]",
  "In Progress": "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
  "Done": "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  "Blocked": "bg-red-50 text-red-700 ring-1 ring-red-200",
  "Backlogged": "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
};

const NEW_AI_PRIORITY_COLORS: Record<string, string> = {
  Critical: "bg-red-50 text-red-700 ring-1 ring-red-200",
  High: "bg-orange-50 text-orange-700 ring-1 ring-orange-200",
  Medium: "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
  Low: "bg-gray-100 text-[var(--twilio-navy)] ring-1 ring-gray-200",
};

function AccPillSelect<T extends string>({ value, options, colorMap, placeholder, onChange }: {
  value: T | undefined;
  options: readonly T[];
  colorMap: Record<string, string>;
  placeholder: string;
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSelectElement>(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  const cls = value ? colorMap[value] ?? "bg-gray-100 text-[var(--twilio-navy)]" : "bg-gray-100 text-[var(--twilio-gray-60)]";
  if (open) {
    return (
      <select ref={ref} value={value ?? ""} onChange={(e) => { onChange(e.target.value as T); setOpen(false); }} onBlur={() => setOpen(false)}
        className="rounded-full border border-indigo-400 bg-white px-2.5 py-0.5 text-[12px] font-semibold focus:outline-none cursor-pointer">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return (
    <button type="button" onClick={() => setOpen(true)} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold cursor-pointer hover:opacity-75 transition-opacity ${cls}`}>
      {value ?? placeholder}
      <svg viewBox="0 0 8 5" fill="currentColor" className="w-1.5 h-1.5 opacity-50"><path d="M0 0l4 5 4-5z"/></svg>
    </button>
  );
}

function AccPillDate({ value, onChange }: { value: string | null | undefined; onChange: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  const label = value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Due date";
  if (open) {
    return <input ref={ref} type="date" defaultValue={value ? value.slice(0, 10) : ""} onBlur={(e) => { onChange(e.target.value || null); setOpen(false); }}
      className="rounded-full border border-indigo-400 bg-white px-2.5 py-0.5 text-[12px] font-semibold focus:outline-none" />;
  }
  return (
    <button type="button" onClick={() => setOpen(true)} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold hover:opacity-75 transition-opacity cursor-pointer ${value ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200" : "bg-gray-100 text-[var(--twilio-gray-60)]"}`}>
      {value && <svg viewBox="0 0 12 12" fill="currentColor" className="w-2.5 h-2.5 opacity-70"><path d="M4 0a1 1 0 011 1h2a1 1 0 112 0h1a2 2 0 012 2v7a2 2 0 01-2 2H2a2 2 0 01-2-2V3a2 2 0 012-2h1a1 1 0 011-1zM2 5v5h8V5H2z"/></svg>}
      {label}
    </button>
  );
}

function AccPillNumber({ value, label, onChange }: { value: number | null | undefined; label: string; onChange: (v: number | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { ref.current?.focus(); ref.current?.select(); } }, [open]);
  const mins = value != null && value > 0 ? Math.round(value / 60) : null;
  if (open) {
    return <input ref={ref} type="number" min={0} defaultValue={mins ?? ""} onBlur={(e) => { onChange(e.target.value !== "" ? Number(e.target.value) * 60 : null); setOpen(false); }}
      className="w-16 rounded-full border border-indigo-400 bg-white px-2.5 py-0.5 text-[12px] font-semibold focus:outline-none" placeholder="0" />;
  }
  return (
    <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold bg-gray-100 text-[var(--twilio-navy)] hover:opacity-75 transition-opacity cursor-pointer">
      {mins != null ? `${mins}m` : label}
    </button>
  );
}

function AccPillUrl({ value, onChange }: { value: string | undefined; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  if (open) {
    return <input ref={ref} type="url" defaultValue={value ?? ""} onBlur={(e) => { onChange(e.target.value); setOpen(false); }} placeholder="https://…"
      className="w-40 rounded-full border border-indigo-400 bg-white px-2.5 py-0.5 text-[12px] font-semibold focus:outline-none" />;
  }
  if (value) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 px-2.5 py-0.5 text-[12px] font-semibold">
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 hover:underline"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-2.5 h-2.5 shrink-0"><path d="M6 2a2 2 0 00-2 2v5a2 2 0 002 2h1v2l2.5-2.5A1 1 0 0110 10h2a2 2 0 002-2V4a2 2 0 00-2-2H6z"/></svg>
          Slack ↗
        </a>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ml-0.5 text-indigo-400 hover:text-indigo-700 leading-none"
          title="Edit URL"
        >✎</button>
      </span>
    );
  }
  return (
    <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold hover:opacity-75 transition-opacity cursor-pointer bg-gray-100 text-[var(--twilio-gray-60)]">
      <svg viewBox="0 0 16 16" fill="currentColor" className="w-2.5 h-2.5"><path d="M6 2a2 2 0 00-2 2v5a2 2 0 002 2h1v2l2.5-2.5A1 1 0 0110 10h2a2 2 0 002-2V4a2 2 0 00-2-2H6z"/></svg>
      Slack
    </button>
  );
}

// ── New Action Item card — Unstaged-style, pinned right ──────────────────────

const BLANK_NEW_FORM = (): Partial<AirtableActionItem> => ({
  task: "",
  task_details: "",
  status: "Open",
  priority: "Medium",
  due_date: null,
  estimated_time: 0,
  time_spent: 0,
  prep_time: 0,
  slack_thread_url: "",
  assignee_name: "",
  assignee_airtable_id: "",
});

function NewActionItemCard({
  accountName,
  teamMembers,
  onSave,
}: {
  accountName: string;
  teamMembers: TeamMember[];
  onSave: (item: AirtableActionItem) => void;
}) {
  const currentUser = useCurrentUser();
  const { status: statusOptions } = useActionItemFieldOptions();
  const [form, setForm] = useState<Partial<AirtableActionItem>>(BLANK_NEW_FORM());
  const [saving, setSaving] = useState(false);
  const memberNames = ["Unassigned", ...teamMembers.map((m) => m.full_name)] as string[];

  const set = (patch: Partial<AirtableActionItem>) => setForm((f) => ({ ...f, ...patch }));
  const accentColor = form.priority ? PRIORITY_ACCENT[form.priority] : "#e5e7eb";

  async function handleSave() {
    if (saving || !form.task?.trim()) return;
    setSaving(true);
    try {
      const { data } = await airtableApi.createActionItem({
        ...form,
        account_name: accountName,
        assignee_name: form.assignee_name || currentUser?.display_name || "",
        assignee_airtable_id: form.assignee_airtable_id || currentUser?.airtable_collaborator_id || "",
      } as Parameters<typeof airtableApi.createActionItem>[0]);
      onSave(data);
      setForm(BLANK_NEW_FORM());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="rounded-xl flex flex-col overflow-hidden select-none"
      style={{ background: "#F4F4F6", width: "240px", flexShrink: 0, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}
    >
      {/* Task title */}
      <div className="px-4 pt-3 pb-2">
        <input
          value={form.task ?? ""}
          onChange={(e) => set({ task: e.target.value })}
          placeholder="Name or short description"
          className="w-full text-xs font-semibold text-[var(--twilio-navy)] bg-transparent border-b border-gray-200 focus:border-indigo-400 focus:outline-none pb-1 placeholder:text-[var(--twilio-gray-60)] placeholder:font-normal"
        />
      </div>

      {/* Badge row: priority + status pills */}
      <div className="px-4 pb-3 flex items-center gap-1.5 flex-wrap">
        <AccPillSelect
          value={form.priority}
          options={["Critical", "High", "Medium", "Low"] as const}
          colorMap={NEW_AI_PRIORITY_COLORS}
          placeholder="Priority"
          onChange={(v) => set({ priority: v })}
        />
        <AccPillSelect
          value={form.status}
          options={statusOptions as AirtableActionItem["status"][]}
          colorMap={NEW_AI_STATUS_COLORS}
          placeholder="Status"
          onChange={(v) => set({ status: v })}
        />
      </div>

      {/* Fields */}
      <div className="px-4 pb-3 flex-1 flex flex-col gap-2.5" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
        <div className="mt-3">
          <RichTextMentionEditor
            value={form.task_details ?? ""}
            onChange={(html) => set({ task_details: html })}
            placeholder="Additional context or notes…"
            minHeightClassName="min-h-[48px]"
          />
        </div>
        <div className="flex flex-wrap gap-1.5 items-center">
          <AccPillDate value={form.due_date} onChange={(v) => set({ due_date: v })} />
          <AccPillNumber value={form.estimated_time} label="Est." onChange={(v) => set({ estimated_time: v ?? 0 })} />
          <AccPillNumber value={form.time_spent} label="Spent" onChange={(v) => set({ time_spent: v ?? 0 })} />
          <AccPillNumber value={form.prep_time} label="Prep" onChange={(v) => set({ prep_time: v ?? 0 })} />
          <AccPillUrl value={form.slack_thread_url} onChange={(v) => set({ slack_thread_url: v })} />
        </div>
        {teamMembers.length > 0 && (
          <div className="flex flex-wrap gap-1.5 items-center">
            <AccPillSelect
              value={(form.assignee_name || "Unassigned") as string}
              options={memberNames as string[]}
              colorMap={{}}
              placeholder="Unassigned"
              onChange={(v) => {
                const member = teamMembers.find((m) => m.full_name === v);
                set({ assignee_airtable_id: member ? String(member.id) : "", assignee_name: member?.full_name ?? "" });
              }}
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
        <div
          className="text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: accentColor }}
        >
          + New
        </div>
        <button
          disabled={saving || !form.task?.trim()}
          onClick={() => void handleSave()}
          className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ── Action Item display card (Stage Today style) ───────────────────────────────

function ActionItemCardOccurrences({ airtableId }: { airtableId: string }) {
  const occurrences = useScheduledOccurrences(airtableId);
  if (occurrences.length === 0) return null;
  return (
    <div className="mt-0.5 pt-1.5 border-t border-gray-200/70">
      <p className="text-[9px] font-semibold text-indigo-500 uppercase tracking-wide mb-0.5">On calendar</p>
      {occurrences.map((o) => (
        <p key={o.start} className="text-[10px] text-indigo-600 leading-tight">
          {new Date(o.start).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </p>
      ))}
    </div>
  );
}

function ActionItemModal({
  item,
  teamMembers = [],
  meetings = [],
  onClose,
  onUpdated,
  onConverted,
  onDeleted,
}: {
  item: AirtableActionItem;
  teamMembers?: TeamMember[];
  meetings?: AirtableMeeting[];
  onClose: () => void;
  onUpdated?: (updated: AirtableActionItem) => void;
  onConverted?: () => void;
  onDeleted?: (id: number) => void;
}) {
  const { status: statusOptions } = useActionItemFieldOptions();
  const [form, setForm] = useState<Partial<AirtableActionItem>>({ ...item });
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ActionItemAttachment[]>(item.attachments ?? []);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const attachFileRef = useRef<HTMLInputElement>(null);
  const memberNames = ["Unassigned", ...teamMembers.map((m) => m.full_name)] as string[];

  useEffect(() => {
    if (item.airtable_id.startsWith("local-")) return;
    airtableApi.listAttachments(item.id).then(({ data }) => setAttachments(data)).catch(() => {});
  }, [item.id, item.airtable_id]);

  const accent = PRIORITY_ACCENT[form.priority ?? item.priority] ?? "#9ca3af";
  const set = (patch: Partial<AirtableActionItem>) => setForm((f) => ({ ...f, ...patch }));

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
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { data } = await airtableApi.updateActionItemFields(item.airtable_id, form as Parameters<typeof airtableApi.updateActionItemFields>[1]);
      onUpdated?.(data);
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Save failed";
      setSaveError(msg);
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

  async function handleAttachFiles(files: FileList | File[]) {
    setUploadingAttachment(true);
    setAttachError(null);
    const failed: string[] = [];
    let lastError: unknown = null;
    for (const f of Array.from(files)) {
      try {
        const { data } = await airtableApi.uploadAttachmentFile(item.id, f);
        setAttachments((prev) => [data, ...prev]);
      } catch (err: unknown) {
        // Never swallow this: silence here reads as "I picked a file and nothing happened".
        failed.push(f.name);
        lastError = err;
      }
    }
    if (failed.length) {
      const data = (lastError as { response?: { data?: { detail?: string; error?: string } } })?.response?.data;
      setAttachError(`${data?.detail ?? data?.error ?? "Upload failed."} (${failed.join(", ")})`);
    }
    setUploadingAttachment(false);
  }

  async function handleDeleteAttachment(attachId: number) {
    await airtableApi.deleteAttachment(item.id, attachId);
    setAttachments((prev) => prev.filter((a) => a.id !== attachId));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ background: "#fff", width: "480px", maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 48px)", borderLeft: `4px solid ${accent}` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid rgba(0,0,0,0.07)" }}>
          <textarea
            autoFocus
            value={form.task ?? ""}
            onChange={(e) => set({ task: e.target.value })}
            placeholder="Task name…"
            rows={2}
            className="flex-1 text-sm font-semibold text-[var(--twilio-navy)] bg-transparent border-b border-transparent focus:border-indigo-400 focus:outline-none pb-0.5 mr-3 resize-none leading-snug"
            style={{ overflow: "hidden", fieldSizing: "content" } as React.CSSProperties}
          />
          <div className="flex items-center gap-1.5 shrink-0">
            <CommentTrigger
              resourceType="action_item"
              resourceId={item.id}
              resourceLabel={item.task ?? ""}
              disabled={item.airtable_id.startsWith("local-")}
            />
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none transition-colors">×</button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Existing comments, in place — the header icon opens the full thread. */}
          {!item.airtable_id.startsWith("local-") && (
            <CommentPreviewList
              resourceType="action_item"
              resourceId={item.id}
              resourceLabel={item.task ?? ""}
              variant="panel"
            />
          )}

          {/* Priority + Status pills */}
          <div className="flex items-center gap-2 flex-wrap">
            <AccPillSelect
              value={form.priority}
              options={["Critical", "High", "Medium", "Low"] as const}
              colorMap={NEW_AI_PRIORITY_COLORS}
              placeholder="Priority"
              onChange={(v) => set({ priority: v })}
            />
            <AccPillSelect
              value={form.status}
              options={statusOptions as AirtableActionItem["status"][]}
              colorMap={NEW_AI_STATUS_COLORS}
              placeholder="Status"
              onChange={(v) => set({ status: v })}
            />
            <AccPillDate value={form.due_date} onChange={(v) => set({ due_date: v })} />
          </div>

          {/* Description. Steps live in the Checklist section below. */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)] mb-1.5">
              Description
            </p>
            <RichTextMentionEditor
              value={form.task_details ?? ""}
              onChange={(html) => set({ task_details: html })}
              placeholder="Additional context or notes…"
              minHeightClassName="min-h-[64px]"
            />
          </div>

          {/* Checklist — its own field, directly below the description. Real Airtable items
              only: steps key off the numeric PK, which a local-* draft lacks until promoted. */}
          {!item.airtable_id.startsWith("local-") && (
            <div className="pt-3 border-t border-gray-100">
              <StepsPanel actionItemId={item.id} />
            </div>
          )}

          {/* Time + Slack */}
          <div className="flex flex-wrap gap-2 items-center">
            <AccPillNumber value={form.estimated_time} label="Est." onChange={(v) => set({ estimated_time: v ?? 0 })} />
            <AccPillNumber value={form.time_spent} label="Spent" onChange={(v) => set({ time_spent: v ?? 0 })} />
            <AccPillNumber value={form.prep_time} label="Prep" onChange={(v) => set({ prep_time: v ?? 0 })} />
            <AccPillUrl value={form.slack_thread_url} onChange={(v) => set({ slack_thread_url: v })} />
          </div>

          {/* Assignee */}
          {teamMembers.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--twilio-gray-60)]">Assignee</span>
              <AccPillSelect
                value={(form.assignee_name || "Unassigned") as string}
                options={memberNames as string[]}
                colorMap={{}}
                placeholder="Unassigned"
                onChange={(v) => {
                  const member = teamMembers.find((m) => m.full_name === v);
                  set({ assignee_airtable_id: member ? String(member.id) : "", assignee_name: member?.full_name ?? "" });
                }}
              />
            </div>
          )}

          {/* Account */}
          {item.account_name && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--twilio-gray-60)]">Account</span>
              <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--twilio-navy)] bg-gray-100 px-2 py-0.5 rounded-full">
                <CorporateIcon width={10} height={10} className="shrink-0 opacity-60" />
                {item.account_name}
              </span>
            </div>
          )}

          {/* Link to meeting — only shown for Done items */}
          {(form.status === "Done" || item.status === "Done") && meetings.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--twilio-gray-60)] shrink-0">Pin to meeting</span>
              <select
                value={form.linked_meeting ?? ""}
                onChange={(e) => set({ linked_meeting: e.target.value ? Number(e.target.value) : null })}
                className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-[var(--twilio-navy)] focus:bg-white focus:border-indigo-400 focus:outline-none"
              >
                <option value="">— No meeting —</option>
                {meetings.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}{m.date ? ` (${new Date(m.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })})` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Attachments */}
          {!item.airtable_id.startsWith("local-") && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)]">
                  Attachments{attachments.length > 0 && ` (${attachments.length})`}
                </span>
                <div className="flex items-center gap-1">
                  {uploadingAttachment && <span className="text-[11px] text-gray-400 animate-pulse">Uploading…</span>}
                  <button
                    onClick={() => attachFileRef.current?.click()}
                    className="text-[11px] px-2 py-0.5 rounded border border-gray-200 text-[var(--twilio-navy)] hover:bg-gray-50 transition-colors"
                  >+ File</button>
                  <ArtifactPicker
                    actionItemId={item.id}
                    accountName={item.account_name}
                    onAttached={(a) => setAttachments((prev) => [a, ...prev])}
                    onError={setAttachError}
                  />
                  <input ref={attachFileRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && void handleAttachFiles(e.target.files)} />
                </div>
              </div>
              {attachError && (
                <p role="alert" className="text-xs text-red-600 mb-2 bg-red-50 border border-red-200 rounded px-2 py-1">
                  {attachError}
                </p>
              )}
              {attachments.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No attachments yet.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {attachments.map((a) => {
                    const href = a.file_url ?? a.url ?? "";
                    return (
                      <div key={a.id} className="flex items-center gap-2 text-xs bg-gray-50 rounded-lg px-3 py-1.5">
                        <span className="shrink-0">📎</span>
                        {href ? (
                          <a href={href} target="_blank" rel="noreferrer" className="flex-1 truncate text-indigo-600 hover:underline">{a.name || href}</a>
                        ) : (
                          <span className="flex-1 truncate text-[var(--twilio-navy)]">{a.name}</span>
                        )}
                        <button onClick={() => void handleDeleteAttachment(a.id)} className="shrink-0 text-gray-300 hover:text-red-400 transition-colors">×</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <ActionItemCardOccurrences airtableId={item.airtable_id} />

          {/* Activity log */}
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)] mb-2 block">Activity</span>
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
        <div className="px-5 py-3 space-y-2" style={{ borderTop: "1px solid rgba(0,0,0,0.07)" }}>
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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => void handleDelete()}
                disabled={deleting}
                title="Delete action item"
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-40 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              </button>
              <button
                onClick={onClose}
                className="text-sm font-medium text-[var(--twilio-gray-60)] hover:text-[var(--twilio-navy)] transition-colors"
              >
                Cancel
              </button>
              {saveError && <span className="text-xs text-red-600">{saveError}</span>}
            </div>
            <button
              disabled={saving}
              onClick={() => void handleSave()}
              className="px-4 py-1.5 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionItemCard({
  item,
  onDragStart,
  teamMembers = [],
  meetings = [],
  onUpdated,
  onDeleted,
}: {
  item: AirtableActionItem;
  onDragStart?: (e: React.DragEvent) => void;
  teamMembers?: TeamMember[];
  meetings?: AirtableMeeting[];
  onUpdated?: (updated: AirtableActionItem) => void;
  onDeleted?: (id: number) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [ctxPos, setCtxPos] = useState<{ x: number; y: number } | null>(null);
  const { isPinned, toggle: toggleFocusPin } = useFocusPins();
  const accent = PRIORITY_ACCENT[item.priority] ?? "#9ca3af";

  // Never pin a local-* blank — promoteBlankItem discards that id for a real recXXX.
  const canPin = !item.airtable_id.startsWith("local-");
  const isPinnedToFocus = canPin && isPinned(item.airtable_id);
  const commentItem = useCommentMenuItem("action_item", canPin ? item.id : null, item.task ?? "", ctxPos);

  return (
    <>
      <div
        draggable={!!onDragStart}
        onDragStart={onDragStart}
        onClick={() => setModalOpen(true)}
        onContextMenu={(e) => {
          // `canPin` doubles as "this row exists server-side", which is also the
          // precondition for commenting — a local-* blank has neither menu entry.
          if (!canPin) return;
          e.preventDefault();
          e.stopPropagation();
          setCtxPos({ x: e.clientX, y: e.clientY });
        }}
        className="rounded-lg select-none flex flex-col gap-1.5 cursor-pointer hover:shadow-md transition-shadow shrink-0"
        style={{
          position: "relative",
          background: "#F4F4F6",
          borderLeft: `3px solid ${accent}`,
          padding: "8px 10px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          width: "208px",
          height: "100%",
        }}
      >
        {isPinnedToFocus && <FocusPinBadge />}
        <p className="text-sm font-semibold text-[var(--twilio-navy)] leading-snug truncate">
          {item.task || <span className="italic opacity-50">Untitled</span>}
        </p>
        {item.task_details && (
          <p className="text-[11px] text-[var(--twilio-navy)] opacity-60 leading-snug"
            style={{ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
            {htmlToPreviewText(item.task_details)}
          </p>
        )}
        <div className="flex flex-wrap gap-1">
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${STATUS_PILLS[item.status] ?? "bg-gray-100 text-gray-700"}`}>{item.status}</span>
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${PRIORITY_COLORS[item.priority] ?? ""}`}>{item.priority}</span>
          {item.due_date && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">
              {new Date(item.due_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
          )}
          {item.assignee_name && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 truncate max-w-[80px]">{item.assignee_name}</span>
          )}
          {(item.time_spent ?? 0) > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600">
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-2.5 h-2.5 shrink-0"><circle cx="6" cy="6" r="5"/><path d="M6 3v3l2 1.5" strokeLinecap="round"/></svg>
              {Math.floor(item.time_spent / 60)}m
            </span>
          )}
        </div>
        <ActionItemCardOccurrences airtableId={item.airtable_id} />
        <CommentPreviewList
          resourceType="action_item"
          resourceId={canPin ? item.id : null}
          resourceLabel={item.task ?? ""}
        />
      </div>
      {ctxPos && (
        <ContextMenu
          x={ctxPos.x}
          y={ctxPos.y}
          items={[
            focusPinMenuItem(isPinnedToFocus, () => toggleFocusPin(item.airtable_id)),
            commentItem,
          ]}
          onClose={() => setCtxPos(null)}
        />
      )}
      {modalOpen && (
        <ActionItemModal
          item={item}
          teamMembers={teamMembers}
          meetings={meetings}
          onClose={() => setModalOpen(false)}
          onUpdated={(updated) => { onUpdated?.(updated); setModalOpen(false); }}
          onConverted={() => { onUpdated?.({ ...item, status: "Done" } as AirtableActionItem); setModalOpen(false); }}
          onDeleted={(id) => { onDeleted?.(id); setModalOpen(false); }}
        />
      )}
    </>
  );
}

const ACCOUNT_STATUS_STYLES: Record<string, React.CSSProperties> = {
  prospect: { background: "#fef9c3", color: "#a16207" },
  active: { background: "#dcfce7", color: "#15803d" },
  inactive: { background: "var(--bg, #f5f5f5)", color: "var(--text-secondary, #888)" },
  churned: { background: "#fee2e2", color: "#dc2626" },
};

function fmtDuration(secs: number): string {
  if (!secs) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function Avatar({ name, avatarUrl, size = 9 }: { name: string; avatarUrl?: string; size?: number }) {
  const mc = ROLE_META[getTitleRole("")];
  const initials = name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  const cls = `h-${size} w-${size} rounded-full flex items-center justify-center text-[11px] font-semibold ring-2 ring-white shrink-0`;
  if (avatarUrl) return <img src={avatarUrl} alt={name} className={`${cls} object-cover`} />;
  return <div className={cls} style={{ backgroundColor: mc.bg, color: mc.text }}>{initials}</div>;
}

// ── Inline reminder manager (used in SidePanel + standalone) ─────────────────

const REMINDER_STATUS_COLORS: Record<string, string> = {
  pending: "#f97316",
  sent: "#9ca3af",
  dismissed: "#9ca3af",
  snoozed: "#6366f1",
};

function ReminderBell({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className} style={style}>
      <path d="M10 2a6 6 0 00-6 6v3l-1.5 2.5h15L16 11V8a6 6 0 00-6-6z" strokeLinejoin="round"/>
      <path d="M8.5 16.5a1.5 1.5 0 003 0" strokeLinecap="round"/>
    </svg>
  );
}

function ReminderSection({
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

// ── Meeting Notes (shared between Calendar and Account panels) ────────────────

function MeetingNotesPanel({ eventId, accountName, airtableAccountId, onCreatedActionItem }: { eventId: number; accountName?: string | null; airtableAccountId?: number | null; onCreatedActionItem?: (item: AirtableActionItem) => void }) {
  const [notes, setNotes] = useState<MeetingNote[]>([]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const locallyCreatedIds = useRef<Set<number>>(new Set());
  const draftEditorRef = useRef<RichTextMentionEditorHandle>(null);

  useEffect(() => {
    schedulerApi.listMeetingNotes(eventId)
      .then(({ data }) => setNotes(data.results ?? []))
      .catch(() => {});
  }, [eventId]);


  async function addNote() {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      const { data } = await schedulerApi.createMeetingNote({ event: eventId, html: text, text: htmlToPreviewText(text), position: notes.length });
      locallyCreatedIds.current.add(data.id);
      setNotes((prev) => [...prev, data]);
      setDraft("");
      draftEditorRef.current?.clear();
    } catch { /* best effort */ } finally { setSaving(false); }
  }

  async function deleteNote(id: number) {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    try { await schedulerApi.deleteMeetingNote(id); } catch { /* best effort */ }
  }

  async function saveNote(updated: MeetingNote) {
    setNotes((prev) => prev.map((n) => n.id === updated.id ? updated : n));
    try { await schedulerApi.updateMeetingNote(updated.id, { text: htmlToPreviewText(updated.html), html: updated.html }); } catch { /* best effort */ }
  }

  return (
    <div style={{ marginTop: "12px" }}>
      <p style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--twilio-gray-60)", marginBottom: "6px" }}>Meeting Notes</p>
      <div style={{ border: "1px solid rgba(0,0,0,0.08)", borderRadius: "8px", background: "#fff", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "6px", padding: "6px 10px", borderBottom: notes.length > 0 ? "1px solid rgba(0,0,0,0.06)" : undefined }}>
          <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#d1d5db", flexShrink: 0, marginTop: "7px" }} />
          <div style={{ flex: 1 }}>
            <RichTextMentionEditor
              ref={draftEditorRef}
              value={draft}
              onChange={setDraft}
              onSubmit={() => void addNote()}
              placeholder="Add a note…"
              minHeightClassName="min-h-[28px]"
            />
          </div>
          {draft.trim() && (
            <button onClick={() => void addNote()} disabled={saving} style={{ fontSize: "0.6875rem", fontWeight: 600, color: "#6366f1", background: "none", border: "none", cursor: "pointer", padding: "2px 0", flexShrink: 0, marginTop: "4px" }}>
              Add
            </button>
          )}
        </div>
        {notes.length > 0 && (
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {notes.map((note) => (
              <AccountNoteRowSimple key={note.id} note={note} onSave={saveNote} onDelete={deleteNote} accountName={accountName} airtableAccountId={airtableAccountId} eventId={eventId} onCreatedActionItem={onCreatedActionItem} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Inline editable note row for the account panel (no @mention, minimal UI)
function AccountNoteRowSimple({
  note, onSave, onDelete, accountName, airtableAccountId, eventId, onCreatedActionItem,
}: {
  note: MeetingNote;
  onSave: (n: MeetingNote) => void;
  onDelete: (id: number) => void;
  accountName?: string | null;
  airtableAccountId?: number | null;
  eventId: number;
  onCreatedActionItem?: (item: AirtableActionItem) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.html);
  const [openAction, setOpenAction] = useState<"action" | "calendar" | "reminder" | null>(null);
  const [tooltipAnchorY, setTooltipAnchorY] = useState<number | undefined>(undefined);
  const _nlsKey = `note-actions::${note.id}`;
  const [doneActions, setDoneActions] = useState<Set<"action" | "calendar" | "reminder">>(() => {
    try { const v = localStorage.getItem(_nlsKey); return v ? new Set(JSON.parse(v) as ("action" | "calendar" | "reminder")[]) : new Set(); } catch { return new Set(); }
  });
  function markSimpleDone(kind: "action" | "calendar" | "reminder") {
    setDoneActions((p) => { const n = new Set([...p, kind]); try { localStorage.setItem(_nlsKey, JSON.stringify([...n])); } catch {} return n; });
  }
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Close tooltip on outside click
  useEffect(() => {
    if (!openAction) return;
    function handler(e: MouseEvent) {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) setOpenAction(null);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openAction]);

  function commit() {
    setEditing(false);
    const trimmed = text.trim();
    if (!trimmed || trimmed === note.html) return;
    onSave({ ...note, text: htmlToPreviewText(trimmed), html: trimmed });
  }

  return (
    <li className="group" style={{ display: "flex", alignItems: "flex-start", gap: "6px", padding: "5px 10px", position: "relative" }}>
      <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--twilio-navy)", opacity: 0.35, flexShrink: 0, marginTop: "7px" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <div
            onBlur={commit}
            onKeyDownCapture={(e) => {
              if (e.key === "Escape") { e.preventDefault(); setEditing(false); setText(note.html); }
            }}
          >
            <RichTextMentionEditor
              value={text}
              onChange={setText}
              onSubmit={commit}
              placeholder="Add a note…"
              minHeightClassName="min-h-[28px]"
              autoFocus
            />
          </div>
        ) : (
          <div
            onClick={() => { setEditing(true); setText(note.html); }}
            style={{ fontSize: "0.8125rem", color: "var(--twilio-navy)", lineHeight: 1.5, cursor: "text" }}
            className="prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(plainToHtml(note.html)) }}
          />
        )}
      </div>
      {/* Hover actions */}
      {!editing && (
        <div ref={tooltipRef} style={{ display: "flex", alignItems: "center", gap: "2px", flexShrink: 0, position: "relative" }}>
          <button
            title="Create action item"
            onClick={(e) => { setTooltipAnchorY(e.currentTarget.getBoundingClientRect().bottom); setOpenAction(openAction === "action" ? null : "action"); }}
            style={{ padding: "2px", borderRadius: "3px", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", color: doneActions.has("action") ? "#2563eb" : "#9ca3af" }}
            className={doneActions.has("action") ? "transition-opacity" : "opacity-0 group-hover:opacity-100 transition-opacity"}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: "12px", height: "12px" }}><path d="M8 5h9M8 10h9M8 15h9" strokeLinecap="round"/><path d="M3 5l1.5 1.5L7 3M3 10l1.5 1.5L7 8M3 15l1.5 1.5L7 13" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button
            title="Set reminder"
            onClick={(e) => { setTooltipAnchorY(e.currentTarget.getBoundingClientRect().bottom); setOpenAction(openAction === "reminder" ? null : "reminder"); }}
            style={{ padding: "2px", borderRadius: "3px", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", color: doneActions.has("reminder") ? "#2563eb" : "#9ca3af" }}
            className={doneActions.has("reminder") ? "transition-opacity" : "opacity-0 group-hover:opacity-100 transition-opacity"}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: "12px", height: "12px" }}><circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button
            title="Create meeting"
            onClick={(e) => { setTooltipAnchorY(e.currentTarget.getBoundingClientRect().bottom); setOpenAction(openAction === "calendar" ? null : "calendar"); }}
            style={{ padding: "2px", borderRadius: "3px", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", color: doneActions.has("calendar") ? "#2563eb" : "#9ca3af" }}
            className={doneActions.has("calendar") ? "transition-opacity" : "opacity-0 group-hover:opacity-100 transition-opacity"}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: "12px", height: "12px" }}><rect x="2" y="4" width="16" height="14" rx="2"/><path d="M2 8h16M6 2v4M14 2v4" strokeLinecap="round"/></svg>
          </button>
          <span style={{ width: "1px", height: "10px", background: "#e5e7eb", margin: "0 2px" }} className="opacity-0 group-hover:opacity-100 transition-opacity" />
          <NoteActionButton title="Delete" onClick={() => onDelete(note.id)} danger>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: "12px", height: "12px" }}><path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9h8l1-9" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </NoteActionButton>
          {openAction && (
            <NoteActionTooltip
              kind={openAction}
              noteText={note.html}
              eventId={eventId}
              accountName={accountName}
              airtableAccountId={airtableAccountId}
              anchorY={tooltipAnchorY}
              onDone={markSimpleDone}
              onCreated={onCreatedActionItem}
              onClose={() => setOpenAction(null)}
            />
          )}
        </div>
      )}
    </li>
  );
}

function NoteActionButton({ title, onClick, danger, children }: { title: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button title={title} onClick={onClick} style={{ padding: "2px", borderRadius: "3px", background: "none", border: "none", cursor: "pointer", color: danger ? "#9ca3af" : "#9ca3af", display: "flex", alignItems: "center" }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = danger ? "#ef4444" : "var(--twilio-navy)"; (e.currentTarget as HTMLButtonElement).style.background = danger ? "#fef2f2" : "#f3f4f6"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; (e.currentTarget as HTMLButtonElement).style.background = "none"; }}>
      {children}
    </button>
  );
}

function NoteActionTooltip({ kind, noteText, eventId, accountName, airtableAccountId, mentionedMembers, anchorY, onDone, onCreated, onClose }: {
  kind: "action" | "reminder" | "calendar";
  noteText: string;
  eventId: number;
  accountName?: string | null;
  airtableAccountId?: number | null;
  mentionedMembers?: TeamMember[];
  anchorY?: number;
  onDone?: (kind: "action" | "reminder" | "calendar") => void;
  onCreated?: (item: AirtableActionItem) => void;
  onClose: () => void;
}) {
  const currentUser = useCurrentUser();
  const [priority, setPriority] = useState<"Low"|"Medium"|"High"|"Critical">("Medium");
  const [due, setDue] = useState("");
  const [remDate, setRemDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0,10); });
  const [remTime, setRemTime] = useState("09:00");
  const tooltipElRef = useRef<HTMLDivElement>(null);
  const [openUpward] = useState(() => anchorY != null ? anchorY > window.innerHeight - 300 : false);
  const [calTitle, setCalTitle] = useState(htmlToPreviewText(noteText).slice(0, 80));
  const [calStart, setCalStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10,0,0,0); return d.toISOString().slice(0,16); });
  const [calEnd, setCalEnd] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(11,0,0,0); return d.toISOString().slice(0,16); });
  const [done, setDone] = useState(false);

  const stripped = htmlToPreviewText(noteText).replace(/@\S+/g, "").trim();
  // Use first mentioned member as assignee, fall back to current user
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
      // Signal ActionItemsPage to reload so zone placement picks up account_name
      localStorage.setItem("actionItemsUpdated", String(Date.now()));
      window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated", newValue: String(Date.now()) }));
    } else if (kind === "reminder") {
      await schedulerApi.createReminder({ title: stripped.slice(0, 200) || "Note reminder", body: htmlToPreviewText(noteText), resource_type: "calendar_event", resource_id: eventId, due_at: new Date(`${remDate}T${remTime}:00`).toISOString(), notify_in_app: true } as Parameters<typeof schedulerApi.createReminder>[0]);
    } else {
      await schedulerApi.createEvent({ title: calTitle, description: `From meeting note: ${noteText}`, start_datetime: new Date(calStart).toISOString(), end_datetime: new Date(calEnd).toISOString() } as Parameters<typeof schedulerApi.createEvent>[0]);
    }
    setDone(true);
    onDone?.(kind);
    setTimeout(onClose, 1200);
  }

  const label = kind === "action" ? "Create Action Item" : kind === "reminder" ? "Set Reminder" : "Create Meeting";

  return (
    <div ref={tooltipElRef} style={{ position: "absolute", right: 0, ...(openUpward ? { bottom: "100%", marginBottom: "4px" } : { top: "100%", marginTop: "4px" }), zIndex: 9999, background: "#fff", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "10px 12px", width: "240px", boxShadow: "0 4px 16px rgba(0,0,0,0.12)", display: "flex", flexDirection: "column", gap: "8px" }}>
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

// ── Gong / meeting summary paste section ─────────────────────────────────────

// Detect team members mentioned by name in a Gong bullet.
// Returns the members found and a new display string with @FirstLast substitutions.
function detectMentions(text: string, teamMembers: TeamMember[]): { members: TeamMember[]; display: string } {
  const found: TeamMember[] = [];
  let display = text;
  for (const m of teamMembers) {
    const first = m.full_name.split(" ")[0];
    // Match full name or first name (word boundary, case-insensitive), not already @-prefixed
    const patterns = [
      new RegExp(`(?<!@)\\b${m.full_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"),
      new RegExp(`(?<!@)\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"),
    ];
    for (const pat of patterns) {
      if (pat.test(display)) {
        if (!found.find((f) => f.id === m.id)) found.push(m);
        display = display.replace(pat, `@${m.full_name}`);
        break;
      }
    }
  }
  return { members: found, display };
}

type GongItem = { kind: "heading"; text: string } | { kind: "bullet"; text: string };

const GONG_HEADINGS = /^(recap|key\s+points?|next\s+steps?):?$/i;

function parseBullets(text: string): GongItem[] {
  return text.split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l): GongItem => {
      // Strip leading bullet marker to get the bare text
      const stripped = l.replace(/^[\s]*[-•*▪◦–—][\s]+/, "").replace(/^[\s]*\d+[.)]\s+/, "").trim();
      if (GONG_HEADINGS.test(stripped)) return { kind: "heading", text: stripped.replace(/:$/, "") };
      return { kind: "bullet", text: stripped };
    });
}

type NotesBySource = Record<MeetingNotesSource, string>;

function GongSummaryPanel({ eventId, meetingId: meetingIdProp, existingNotes, existingZoomNotes, accountName, airtableAccountId, onCreatedActionItem, onSaved, teamMembers = [] }: { eventId: number; meetingId?: number; existingNotes?: string; existingZoomNotes?: string; accountName?: string | null; airtableAccountId?: number | null; onCreatedActionItem?: (item: AirtableActionItem) => void; onSaved?: (updated: AirtableMeeting) => void; teamMembers?: TeamMember[] }) {
  // Both providers' summaries are held at once so switching the toggle doesn't need a
  // round-trip; `raw` / `items` / `showPaste` are the view of whichever is active.
  const [notesBySource, setNotesBySource] = useState<NotesBySource>(() => ({
    gong: existingNotes ?? "",
    zoom: existingZoomNotes ?? "",
  }));
  const [source, setSource] = useState<MeetingNotesSource>(() =>
    preferredMeetingSource(existingNotes, existingZoomNotes)
  );
  const initialText = notesBySource[source];
  const [raw, setRaw] = useState(initialText);
  const [items, setItems] = useState<(GongItem & { mentionedMembers?: TeamMember[] })[]>(() =>
    initialText.trim() ? parseBullets(initialText).map((item) => item) : []
  );
  const [showPaste, setShowPaste] = useState(!initialText.trim());
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // Once the backend creates a stub meeting via by-event, cache its PK for future saves
  const resolvedMeetingId = useRef<number | undefined>(meetingIdProp);

  // Point raw/items/showPaste at `next`'s text. Unsaved textarea edits are dropped on
  // switch — the same thing that already happens when the panel's meeting changes.
  function showSource(next: MeetingNotesSource, store: NotesBySource) {
    setSource(next);
    const text = store[next] ?? "";
    setRaw(text);
    setItems(text.trim() ? parseBullets(text).map((i) => i) : []);
    setShowPaste(!text.trim());
  }

  // Re-initialize when the target meeting changes (covers same-notes-text case too)
  const prevMeetingRef = useRef<number | undefined>(meetingIdProp);
  const prevEventRef = useRef<number>(eventId);
  useEffect(() => {
    const meetingChanged = meetingIdProp !== prevMeetingRef.current;
    const eventChanged = eventId !== prevEventRef.current;
    if (meetingChanged || eventChanged) {
      prevMeetingRef.current = meetingIdProp;
      prevEventRef.current = eventId;
      resolvedMeetingId.current = meetingIdProp;
      const store: NotesBySource = { gong: existingNotes ?? "", zoom: existingZoomNotes ?? "" };
      setNotesBySource(store);
      showSource(preferredMeetingSource(store.gong, store.zoom), store);
    }
  }, [meetingIdProp, eventId, existingNotes, existingZoomNotes]);

  // Always fetch the latest notes from the server when the panel mounts or the
  // event/meeting changes — this ensures notes saved on the Calendar page, or imported
  // from a recap email by "GET Meeting Notes", are reflected here without a reload.
  useEffect(() => {
    const fetchMeeting = meetingIdProp
      ? airtableApi.getMeeting(meetingIdProp).then(({ data }) => data)
      : eventId
        ? airtableApi.listMeetings({ calendar_event_id: String(eventId) })
            .then(({ data }) => (data.results ?? [])[0] as AirtableMeeting | undefined)
        : Promise.resolve(undefined);

    fetchMeeting
      .then((m) => {
        if (!m) return;
        resolvedMeetingId.current = m.id;
        // Whitespace-only counts as empty: Airtable's richText columns report "\n"
        // forever once written and cleared, so a truthiness test would render an empty
        // recap as content and hide the paste box.
        const store: NotesBySource = {
          gong: (m.gong_notes ?? "").trim() ? m.gong_notes : "",
          zoom: (m.zoom_notes ?? "").trim() ? m.zoom_notes : "",
        };
        if (!store.gong && !store.zoom) return;
        setNotesBySource(store);
        if (store[source] && store[source] !== raw) {
          showSource(source, store);
        } else if (!store[source]) {
          // The active source came back empty but the other one has content — land on
          // whichever the server actually filled in rather than showing a paste box.
          showSource(preferredMeetingSource(store.gong, store.zoom), store);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, meetingIdProp]);

  async function persistAndNotify(text: string, parsed: GongItem[]) {
    const notified = new Set<number>();
    const enriched = parsed.map((item) => {
      if (item.kind !== "bullet") return item;
      const { members, display } = detectMentions(item.text, teamMembers);
      return { ...item, text: display, mentionedMembers: members };
    });
    setItems(enriched);
    setShowPaste(false);

    // Whichever provider the toggle is on is the one this text belongs to, so the save
    // targets that column. The other provider's notes are untouched.
    setNotesBySource((prev) => ({ ...prev, [source]: text }));

    const canSave = resolvedMeetingId.current || eventId;
    if (!canSave) return;
    setSaveState("saving");
    try {
      let savedMeeting;
      if (resolvedMeetingId.current) {
        const save = source === "zoom"
          ? airtableApi.updateMeetingZoomNotesByPk
          : airtableApi.updateMeetingGongNotesByPk;
        const { data } = await save(resolvedMeetingId.current, text.trim());
        savedMeeting = data;
      } else {
        // by-event will create a stub meeting if none exists; cache its PK
        const save = source === "zoom"
          ? airtableApi.updateMeetingZoomNotes
          : airtableApi.updateMeetingGongNotes;
        const { data } = await save(eventId, text.trim());
        savedMeeting = data;
        resolvedMeetingId.current = savedMeeting.id;
      }
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2500);
      onSaved?.(savedMeeting);
    } catch {
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 3000);
    }

    // Slack DMs to mentioned members (once per member)
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
    // Compute what the textarea will contain after the paste
    const ta = e.target as HTMLTextAreaElement;
    const before = ta.value.slice(0, ta.selectionStart ?? 0);
    const after = ta.value.slice(ta.selectionEnd ?? ta.value.length);
    const fullText = before + pasted + after;
    // Update controlled state immediately so textarea reflects the paste
    setRaw(fullText);
    const parsed = parseBullets(fullText);
    if (parsed.length === 0) return;
    void persistAndNotify(fullText, parsed);
  }

  return (
    <div style={{ marginTop: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
        <p style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--twilio-gray-60)", margin: 0 }}>Meeting Summary</p>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {saveState === "saving" && <span style={{ fontSize: "0.6875rem", color: "#9ca3af" }}>Saving…</span>}
          {saveState === "saved" && <span style={{ fontSize: "0.6875rem", color: "#16a34a" }}>✓ Saved</span>}
          {saveState === "error" && <span style={{ fontSize: "0.6875rem", color: "#dc2626" }}>Save failed</span>}
          <MeetingSummarySourceToggle
            value={source}
            onChange={(next) => showSource(next, notesBySource)}
            hasGong={!!notesBySource.gong.trim()}
            hasZoom={!!notesBySource.zoom.trim()}
          />
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
            rows={8}
            placeholder={source === "zoom"
              ? "Paste your Zoom AI Companion summary or any bulleted text here…"
              : "Paste your Gong notes, meeting summary, or any bulleted text here…"}
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
            const isLast = i === items.length - 1 || items[i + 1]?.kind === "heading";
            return (
              <GongBulletRow key={i} persistKey={`gong-actions::${meetingIdProp ?? eventId}::${_strHash(item.text)}`} text={item.text} eventId={eventId} accountName={accountName} airtableAccountId={airtableAccountId} isLast={isLast} onCreatedActionItem={onCreatedActionItem} mentionedMembers={item.mentionedMembers} />
            );
          })}
        </div>
      )}
    </div>
  );
}

function renderWithMentions(text: string): React.ReactNode {
  const parts = text.split(/(@\S+)/g);
  return parts.map((p, i) =>
    p.startsWith("@") ? <span key={i} style={{ color: "#2563eb", fontWeight: 600 }}>{p}</span> : p
  );
}

function _strHash(s: string): number {
  let h = 0;
  for (let i = 0; i < Math.min(s.length, 120); i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function GongBulletRow({ text, eventId, accountName, airtableAccountId, isLast, onCreatedActionItem, mentionedMembers, persistKey }: { text: string; eventId: number; accountName?: string | null; airtableAccountId?: number | null; isLast: boolean; onCreatedActionItem?: (item: AirtableActionItem) => void; mentionedMembers?: TeamMember[]; persistKey?: string }) {
  const [openAction, setOpenAction] = useState<"action" | "reminder" | "calendar" | null>(null);
  const [tooltipAnchorY, setTooltipAnchorY] = useState<number | undefined>(undefined);
  const [doneActions, setDoneActions] = useState<Set<"action" | "calendar" | "reminder">>(() => {
    if (!persistKey) return new Set();
    try { const v = localStorage.getItem(persistKey); return v ? new Set(JSON.parse(v) as ("action" | "calendar" | "reminder")[]) : new Set(); } catch { return new Set(); }
  });
  const tooltipRef = useRef<HTMLDivElement>(null);

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
      <div ref={tooltipRef} style={{ display: "flex", alignItems: "center", gap: "2px", flexShrink: 0, position: "relative" }}>
        <button
          title="Create action item"
          onClick={(e) => { setTooltipAnchorY(e.currentTarget.getBoundingClientRect().bottom); setOpenAction(openAction === "action" ? null : "action"); }}
          style={{ padding: "2px", borderRadius: "3px", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", color: doneActions.has("action") ? "#2563eb" : "#9ca3af" }}
          className={doneActions.has("action") ? "transition-opacity" : "opacity-0 group-hover:opacity-100 transition-opacity"}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: "12px", height: "12px" }}><path d="M8 5h9M8 10h9M8 15h9" strokeLinecap="round"/><path d="M3 5l1.5 1.5L7 3M3 10l1.5 1.5L7 8M3 15l1.5 1.5L7 13" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <button
          title="Set reminder"
          onClick={(e) => { setTooltipAnchorY(e.currentTarget.getBoundingClientRect().bottom); setOpenAction(openAction === "reminder" ? null : "reminder"); }}
          style={{ padding: "2px", borderRadius: "3px", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", color: doneActions.has("reminder") ? "#2563eb" : "#9ca3af" }}
          className={doneActions.has("reminder") ? "transition-opacity" : "opacity-0 group-hover:opacity-100 transition-opacity"}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: "12px", height: "12px" }}><circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <button
          title="Create meeting"
          onClick={(e) => { setTooltipAnchorY(e.currentTarget.getBoundingClientRect().bottom); setOpenAction(openAction === "calendar" ? null : "calendar"); }}
          style={{ padding: "2px", borderRadius: "3px", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", color: doneActions.has("calendar") ? "#2563eb" : "#9ca3af" }}
          className={doneActions.has("calendar") ? "transition-opacity" : "opacity-0 group-hover:opacity-100 transition-opacity"}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: "12px", height: "12px" }}><rect x="2" y="4" width="16" height="14" rx="2"/><path d="M2 8h16M6 2v4M14 2v4" strokeLinecap="round"/></svg>
        </button>
        {openAction && (
          <NoteActionTooltip
            kind={openAction}
            noteText={text}
            eventId={eventId}
            accountName={accountName}
            airtableAccountId={airtableAccountId}
            mentionedMembers={mentionedMembers}
            anchorY={tooltipAnchorY}
            onDone={(kind) => setDoneActions((prev) => { const n = new Set([...prev, kind]); if (persistKey) { try { localStorage.setItem(persistKey, JSON.stringify([...n])); } catch {} } return n; })}
            onCreated={onCreatedActionItem}
            onClose={() => setOpenAction(null)}
          />
        )}
      </div>
    </div>
  );
}

// ── Customer Contacts Panel ───────────────────────────────────────────────────

function ContactNoteRow({
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
          <RichTextMentionEditor
            value={draft}
            onChange={setDraft}
            autoFocus
            minHeightClassName="min-h-[40px]"
            onSubmit={() => void commit()}
            onKeyDownCapture={(e) => {
              if (e.key === "Escape") { e.preventDefault(); setEditing(false); setDraft(note.content); }
            }}
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
      <span
        className="flex-1 leading-relaxed prose prose-sm max-w-none"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(plainToHtml(note.content)) }}
      />
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

function CustomerContactModal({
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

  const noteDraftEditorRef = useRef<RichTextMentionEditorHandle>(null);

  async function handleAddNote() {
    const content = noteDraft.trim();
    if (!content) return;
    const { data } = await accountsApi.addContactNote(contact.id, content);
    setNotes((prev) => [data, ...prev]);
    setNoteDraft("");
    noteDraftEditorRef.current?.clear();
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
            <div className="flex gap-2 mb-3 items-start">
              <div className="flex-1">
                <RichTextMentionEditor
                  ref={noteDraftEditorRef}
                  value={noteDraft}
                  onChange={setNoteDraft}
                  onSubmit={() => void handleAddNote()}
                  placeholder="Add a note…"
                  minHeightClassName="min-h-[32px]"
                />
              </div>
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

// ── Side detail panel ─────────────────────────────────────────────────────────

type PanelItem =
  | { kind: "action"; item: AirtableActionItem }
  | { kind: "meeting"; item: AirtableMeeting }
  | { kind: "member"; item: TeamMember }
  | { kind: "contact"; item: CustomerContact }
  | { kind: "calendar"; item: CalendarEvent; linkedMeeting?: AirtableMeeting; reminders?: Reminder[]; onAddReminder?: (due_at: string, title: string) => Promise<void>; onDismissReminder?: (id: number) => Promise<void> };

function AttendeeList({
  attendees,
  responseColor,
  account,
  teamMembers,
  contacts,
  onContactsChange,
}: {
  attendees: Attendee[];
  responseColor: Record<string, string>;
  account?: Account | null;
  teamMembers: TeamMember[];
  contacts: CustomerContact[];
  onAccountUpdated?: (a: Account) => void;
  onContactsChange?: (c: CustomerContact[]) => void;
}) {
  const [popover, setPopover] = useState<{ index: number; mode: "pick" | "twilio-search" | "customer-form" } | null>(null);
  const [search, setSearch] = useState("");
  const [addingMember, setAddingMember] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopover(null);
        setSearch("");
      }
    }
    if (popover) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [popover]);

  const currentAttendee = popover != null ? attendees[popover.index] : null;

  async function handleAddToTwilio(memberId: number) {
    if (!account || addingMember) return;
    setAddingMember(true);
    try {
      await accountsApi.addTeamMember(account.id, memberId);
    } finally {
      setAddingMember(false);
      setPopover(null);
      setSearch("");
    }
  }

  async function handleAddAsContact(name: string, email: string, role: string) {
    if (!account || addingContact) return;
    setAddingContact(true);
    try {
      const { data } = await accountsApi.createContact(account.id, { name, email, role });
      onContactsChange?.([...(contacts ?? []), data]);
    } finally {
      setAddingContact(false);
      setPopover(null);
      setSearch("");
    }
  }

  const filteredMembers = teamMembers.filter((m) =>
    !search.trim() ||
    m.full_name.toLowerCase().includes(search.toLowerCase()) ||
    m.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <p className="font-medium mb-1.5">Attendees ({attendees.length})</p>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {attendees.map((a, i) => (
          <div key={i} className="group relative" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ width: "7px", height: "7px", borderRadius: "50%", flexShrink: 0, background: responseColor[a.responseStatus] ?? "#888", display: "inline-block" }} title={a.responseStatus} />
            <span style={{ fontSize: "0.75rem", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {a.displayName
                ? <><span style={{ fontWeight: 500 }}>{a.displayName}</span> <span className="opacity-50">{a.email}</span></>
                : a.email}
            </span>
            {account && (
              <button
                onClick={() => { setPopover({ index: i, mode: "pick" }); setSearch(""); }}
                className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-indigo-600 hover:bg-indigo-50"
                style={{ fontSize: "14px", lineHeight: 1 }}
                title="Add to team or contacts"
              >+</button>
            )}

            {/* Popover */}
            {popover?.index === i && (
              <div ref={popoverRef} className="absolute right-0 top-6 z-50 rounded-xl shadow-xl border border-gray-100 bg-white overflow-hidden" style={{ width: "220px" }}>
                {popover.mode === "pick" && (
                  <div className="p-1.5 flex flex-col gap-0.5">
                    <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)]">
                      {a.displayName || a.email}
                    </p>
                    <button
                      onClick={() => setPopover({ index: i, mode: "twilio-search" })}
                      className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-[var(--twilio-navy)] hover:bg-indigo-50 rounded-lg transition-colors text-left"
                    >
                      <span className="text-indigo-500">👥</span> Add to Twilio Team
                    </button>
                    <button
                      onClick={() => setPopover({ index: i, mode: "customer-form" })}
                      className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-[var(--twilio-navy)] hover:bg-indigo-50 rounded-lg transition-colors text-left"
                    >
                      <span className="text-indigo-500">🏢</span> Add as Customer Contact
                    </button>
                  </div>
                )}

                {popover.mode === "twilio-search" && (
                  <div className="p-3 flex flex-col gap-2">
                    <p className="text-[11px] font-semibold text-[var(--twilio-navy)]">Link to Twilio Team member</p>
                    <input
                      autoFocus
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search by name or email…"
                      className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-[var(--twilio-navy)] focus:border-indigo-400 focus:outline-none"
                    />
                    <div className="max-h-32 overflow-y-auto flex flex-col gap-0.5">
                      {filteredMembers.length === 0
                        ? <p className="text-[11px] text-gray-400 italic px-1">No matches</p>
                        : filteredMembers.map((m) => (
                          <button
                            key={m.id}
                            disabled={addingMember}
                            onClick={() => void handleAddToTwilio(m.id)}
                            className="flex flex-col items-start px-2 py-1.5 text-left rounded-lg hover:bg-indigo-50 transition-colors disabled:opacity-40"
                          >
                            <span className="text-xs font-medium text-[var(--twilio-navy)]">{m.full_name}</span>
                            <span className="text-[10px] text-[var(--twilio-gray-60)]">{m.email}</span>
                          </button>
                        ))
                      }
                    </div>
                    <button onClick={() => setPopover({ index: i, mode: "pick" })} className="text-[11px] text-[var(--twilio-gray-60)] hover:text-[var(--twilio-navy)] transition-colors text-left">← Back</button>
                  </div>
                )}

                {popover.mode === "customer-form" && currentAttendee && (
                  <CustomerContactQuickForm
                    defaultName={currentAttendee.displayName ?? ""}
                    defaultEmail={currentAttendee.email}
                    saving={addingContact}
                    onSave={(name, email, role) => void handleAddAsContact(name, email, role)}
                    onBack={() => setPopover({ index: i, mode: "pick" })}
                  />
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomerContactQuickForm({
  defaultName, defaultEmail, saving, onSave, onBack,
}: {
  defaultName: string; defaultEmail: string; saving: boolean;
  onSave: (name: string, email: string, role: string) => void;
  onBack: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [role, setRole] = useState("");
  return (
    <div className="p-3 flex flex-col gap-2">
      <p className="text-[11px] font-semibold text-[var(--twilio-navy)]">Add as customer contact</p>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name *"
        className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-[var(--twilio-navy)] focus:border-indigo-400 focus:outline-none" />
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email"
        className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-[var(--twilio-navy)] focus:border-indigo-400 focus:outline-none" />
      <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role / title"
        className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-[var(--twilio-navy)] focus:border-indigo-400 focus:outline-none" />
      <div className="flex items-center justify-between pt-0.5">
        <button onClick={onBack} className="text-[11px] text-[var(--twilio-gray-60)] hover:text-[var(--twilio-navy)] transition-colors">← Back</button>
        <button
          disabled={saving || !name.trim()}
          onClick={() => onSave(name.trim(), email.trim(), role.trim())}
          className="px-3 py-1 text-[11px] font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
        >{saving ? "Adding…" : "Add"}</button>
      </div>
    </div>
  );
}

// ── Action item full-editor inside the right-hand side panel ─────────────────

function ActionItemSidePanelContent({
  item,
  teamMembers = [],
  onUpdated,
}: {
  item: AirtableActionItem;
  teamMembers?: TeamMember[];
  onUpdated?: (updated: AirtableActionItem) => void;
}) {
  const { status: statusOptions } = useActionItemFieldOptions();
  const [form, setForm] = useState<Partial<AirtableActionItem>>({ ...item });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [attachments, setAttachments] = useState<ActionItemAttachment[]>(item.attachments ?? []);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const attachFileRef = useRef<HTMLInputElement>(null);
  const memberNames = ["Unassigned", ...teamMembers.map((m) => m.full_name)] as string[];

  // Timer state
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerElapsed, setTimerElapsed] = useState(0); // seconds this session
  const timerStartRef = useRef<number | null>(null);
  const timerRafRef = useRef<number | null>(null);

  useEffect(() => {
    if (item.airtable_id.startsWith("local-")) return;
    airtableApi.listAttachments(item.id).then(({ data }) => setAttachments(data)).catch(() => {});
  }, [item.id, item.airtable_id]);

  // Re-sync form when item prop changes (e.g. parent re-fetched)
  useEffect(() => {
    setForm((f) => ({ ...item, ...f }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.airtable_id]);

  // Live timer tick
  useEffect(() => {
    if (!timerRunning) {
      if (timerRafRef.current) cancelAnimationFrame(timerRafRef.current);
      return;
    }
    function tick() {
      if (timerStartRef.current != null) {
        setTimerElapsed(Math.floor((Date.now() - timerStartRef.current) / 1000));
      }
      timerRafRef.current = requestAnimationFrame(tick);
    }
    timerRafRef.current = requestAnimationFrame(tick);
    return () => { if (timerRafRef.current) cancelAnimationFrame(timerRafRef.current); };
  }, [timerRunning]);

  function handleTimerToggle() {
    if (timerRunning) {
      // Stop: accumulate elapsed seconds into time_spent
      const added = timerElapsed;
      const prev = form.time_spent ?? 0;
      setForm((f) => ({ ...f, time_spent: prev + added }));
      setTimerRunning(false);
      setTimerElapsed(0);
      timerStartRef.current = null;
    } else {
      timerStartRef.current = Date.now();
      setTimerElapsed(0);
      setTimerRunning(true);
    }
  }

  function fmtTimer(s: number) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
      : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  const set = (patch: Partial<AirtableActionItem>) => setForm((f) => ({ ...f, ...patch }));

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      const { data } = await airtableApi.updateActionItemFields(item.airtable_id, form as Parameters<typeof airtableApi.updateActionItemFields>[1]);
      onUpdated?.(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  async function handleAttachFiles(files: FileList | File[]) {
    setUploadingAttachment(true);
    setAttachError(null);
    const failed: string[] = [];
    let lastError: unknown = null;
    for (const f of Array.from(files)) {
      try {
        const { data } = await airtableApi.uploadAttachmentFile(item.id, f);
        setAttachments((prev) => [data, ...prev]);
      } catch (err: unknown) {
        // Never swallow this: silence here reads as "I picked a file and nothing happened".
        failed.push(f.name);
        lastError = err;
      }
    }
    if (failed.length) {
      const data = (lastError as { response?: { data?: { detail?: string; error?: string } } })?.response?.data;
      setAttachError(`${data?.detail ?? data?.error ?? "Upload failed."} (${failed.join(", ")})`);
    }
    setUploadingAttachment(false);
  }

  async function handleDeleteAttachment(id: number) {
    await airtableApi.deleteAttachment(item.id, id);
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  const accent = PRIORITY_ACCENT[form.priority ?? item.priority] ?? "#9ca3af";

  return (
    <div className="flex flex-col gap-4">
      {/* Title */}
      <input
        value={form.task ?? ""}
        onChange={(e) => set({ task: e.target.value })}
        placeholder="Task name…"
        className="w-full text-sm font-semibold text-[var(--twilio-navy)] bg-transparent border-b border-transparent focus:border-indigo-400 focus:outline-none pb-0.5"
        style={{ borderBottom: `2px solid ${accent}` }}
      />

      {/* Status · Priority · Due date pills */}
      <div className="flex flex-wrap gap-1.5 items-center">
        <AccPillSelect
          value={form.status}
          options={statusOptions as AirtableActionItem["status"][]}
          colorMap={NEW_AI_STATUS_COLORS}
          placeholder="Status"
          onChange={(v) => set({ status: v })}
        />
        <AccPillSelect
          value={form.priority}
          options={["Critical", "High", "Medium", "Low"] as const}
          colorMap={NEW_AI_PRIORITY_COLORS}
          placeholder="Priority"
          onChange={(v) => set({ priority: v })}
        />
        <AccPillDate value={form.due_date} onChange={(v) => set({ due_date: v })} />
      </div>

      {/* Description. Steps live in the Checklist section below. */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)] mb-1.5">
          Description
        </p>
        <RichTextMentionEditor
          value={form.task_details ?? ""}
          onChange={(html) => set({ task_details: html })}
          placeholder="Additional context or notes…"
          minHeightClassName="min-h-[64px]"
        />
      </div>

      {/* Checklist — its own field, directly below the description. Real Airtable items
          only: steps key off the numeric PK, which a local-* draft lacks until promoted. */}
      {!item.airtable_id.startsWith("local-") && (
        <div className="pt-3 border-t border-gray-100">
          <StepsPanel actionItemId={item.id} />
        </div>
      )}

      {/* Time tracking */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 flex flex-col gap-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)]">Time Tracking</p>
        {/* Live timer */}
        <div className="flex items-center gap-3">
          <span className={`font-mono text-lg tabular-nums font-semibold ${timerRunning ? "text-emerald-600" : "text-[var(--twilio-navy)]"}`}>
            {fmtTimer(timerElapsed)}
          </span>
          <button
            onClick={handleTimerToggle}
            className={`px-3 py-1 rounded-lg text-xs font-semibold uppercase tracking-wide transition-colors ${
              timerRunning
                ? "bg-red-50 text-red-700 hover:bg-red-100 ring-1 ring-red-200"
                : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 ring-1 ring-emerald-200"
            }`}
          >
            {timerRunning ? "Stop" : "Track"}
          </button>
          {timerRunning && (
            <span className="text-[10px] text-emerald-600 font-medium animate-pulse">● Recording</span>
          )}
        </div>
        {/* Est / Spent / Prep pills */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <AccPillNumber value={form.estimated_time} label="Est." onChange={(v) => set({ estimated_time: v ?? 0 })} />
          <AccPillNumber value={form.time_spent} label="Spent" onChange={(v) => set({ time_spent: v ?? 0 })} />
          <AccPillNumber value={form.prep_time} label="Prep" onChange={(v) => set({ prep_time: v ?? 0 })} />
        </div>
      </div>

      {/* Assignee */}
      {teamMembers.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--twilio-gray-60)] shrink-0">Assignee</span>
          <AccPillSelect
            value={(form.assignee_name || "Unassigned") as string}
            options={memberNames as string[]}
            colorMap={{}}
            placeholder="Unassigned"
            onChange={(v) => {
              const member = teamMembers.find((m) => m.full_name === v);
              set({ assignee_airtable_id: member ? String(member.id) : "", assignee_name: member?.full_name ?? "" });
            }}
          />
        </div>
      )}

      {/* Slack URL */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--twilio-gray-60)] shrink-0">Slack</span>
        <AccPillUrl value={form.slack_thread_url} onChange={(v) => set({ slack_thread_url: v })} />
      </div>

      {/* Account badge */}
      {item.account_name && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--twilio-gray-60)] shrink-0">Account</span>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--twilio-navy)] bg-gray-100 px-2 py-0.5 rounded-full">
            <CorporateIcon width={10} height={10} className="shrink-0 opacity-60" />
            {item.account_name}
          </span>
        </div>
      )}

      {/* Calendar occurrences */}
      <ActionItemCardOccurrences airtableId={item.airtable_id} />

      {/* Attachments */}
      {!item.airtable_id.startsWith("local-") && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)]">
              Attachments{attachments.length > 0 && ` (${attachments.length})`}
            </span>
            <div className="flex items-center gap-1">
              {uploadingAttachment && <span className="text-[11px] text-gray-400 animate-pulse">Uploading…</span>}
              <button
                onClick={() => attachFileRef.current?.click()}
                className="text-[11px] px-2 py-0.5 rounded border border-gray-200 text-[var(--twilio-navy)] hover:bg-gray-50 transition-colors"
              >+ File</button>
              <ArtifactPicker
                actionItemId={item.id}
                accountName={item.account_name}
                onAttached={(a) => setAttachments((prev) => [a, ...prev])}
                onError={setAttachError}
              />
              <input ref={attachFileRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && void handleAttachFiles(e.target.files)} />
            </div>
          </div>
          {attachError && (
            <p role="alert" className="text-xs text-red-600 mb-2 bg-red-50 border border-red-200 rounded px-2 py-1">
              {attachError}
            </p>
          )}
          {attachments.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No attachments yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {attachments.map((a) => {
                const href = a.file_url ?? a.url ?? "";
                return (
                  <div key={a.id} className="flex items-center gap-2 text-xs bg-gray-50 rounded-lg px-3 py-1.5">
                    <span className="shrink-0">📎</span>
                    {href ? (
                      <a href={href} target="_blank" rel="noreferrer" className="flex-1 truncate text-indigo-600 hover:underline">{a.name || href}</a>
                    ) : (
                      <span className="flex-1 truncate text-[var(--twilio-navy)]">{a.name}</span>
                    )}
                    <button onClick={() => void handleDeleteAttachment(a.id)} className="shrink-0 text-gray-300 hover:text-red-400 transition-colors">×</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Save button */}
      <button
        disabled={saving}
        onClick={() => void handleSave()}
        className={`w-full py-2 text-sm font-semibold rounded-lg transition-colors ${
          saved
            ? "bg-emerald-600 text-white"
            : "bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
        }`}
      >
        {saved ? "✓ Saved" : saving ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
}

function ContactSidePanelContent({
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

  const noteDraftEditorRef = useRef<RichTextMentionEditorHandle>(null);

  async function handleAddNote() {
    const content = noteDraft.trim();
    if (!content) return;
    const { data } = await accountsApi.addContactNote(contact.id, content);
    setNotes((prev) => [data, ...prev]);
    setNoteDraft("");
    noteDraftEditorRef.current?.clear();
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
        <div className="flex gap-2 mb-3 items-start">
          <div className="flex-1">
            <RichTextMentionEditor
              ref={noteDraftEditorRef}
              value={noteDraft}
              onChange={setNoteDraft}
              onSubmit={() => void handleAddNote()}
              placeholder="Add a note…"
              minHeightClassName="min-h-[32px]"
            />
          </div>
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

function SidePanel({ panel, onClose, onCreatedActionItem, onMeetingUpdated, onUpdatedActionItem, teamMembers = [], airtableAccountId, account, contacts, onContactsChange }: { panel: PanelItem; onClose: () => void; onCreatedActionItem?: (item: AirtableActionItem) => void; onMeetingUpdated?: (updated: AirtableMeeting) => void; onUpdatedActionItem?: (updated: AirtableActionItem) => void; teamMembers?: TeamMember[]; airtableAccountId?: number | null; account?: Account | null; contacts?: CustomerContact[]; onContactsChange?: (c: CustomerContact[]) => void }) {
  return (
    <div className="w-full h-full bg-white flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <p className="text-sm font-semibold text-[var(--twilio-navy)] capitalize">
          {panel.kind === "calendar" ? "Event Details" : panel.kind === "contact" ? "Customer Contact" : `${panel.kind} Details`}
        </p>
        <button onClick={onClose} className="text-lg leading-none hover:opacity-60 transition-opacity" style={{ color: "var(--text-secondary, #888)" }}>✕</button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 text-sm text-[var(--twilio-navy)]">
        {panel.kind === "action" && (
          <ActionItemSidePanelContent
            item={panel.item}
            teamMembers={teamMembers}
            onUpdated={onUpdatedActionItem}
          />
        )}
        {panel.kind === "meeting" && (
          <>
            <p className="font-semibold text-base leading-snug">{panel.item.name || <span className="italic opacity-50">Untitled meeting</span>}</p>
            {panel.item.date && <p><span className="opacity-50">Date </span>{new Date(panel.item.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</p>}
            {panel.item.duration > 0 && <p><span className="opacity-50">Duration </span>{fmtDuration(panel.item.duration)}</p>}
            {panel.item.expected_topics && (
              <div>
                <p className="font-medium mb-1">Expected Topics</p>
                <p className="opacity-70 leading-relaxed whitespace-pre-wrap">{panel.item.expected_topics}</p>
              </div>
            )}
            {panel.item.gong_url && <a href={panel.item.gong_url} target="_blank" rel="noreferrer" className="underline text-xs" style={{ color: "var(--twilio-red, #e22)" }}>Gong recording ↗</a>}
            {panel.item.customer_slack && <a href={panel.item.customer_slack} target="_blank" rel="noreferrer" className="block underline text-xs" style={{ color: "var(--twilio-red, #e22)" }}>Customer Slack ↗</a>}
            <GongSummaryPanel eventId={0} meetingId={panel.item.id} existingNotes={panel.item.gong_notes} existingZoomNotes={panel.item.zoom_notes} accountName={panel.item.account_name} airtableAccountId={airtableAccountId} onCreatedActionItem={onCreatedActionItem} onSaved={onMeetingUpdated} teamMembers={teamMembers} />
          </>
        )}
        {panel.kind === "member" && (
          <>
            <div className="flex items-center gap-3">
              <Avatar name={panel.item.full_name} avatarUrl={panel.item.avatar_url} size={12} />
              <div>
                <p className="font-semibold">{panel.item.full_name}</p>
                {panel.item.title && <p className="text-xs opacity-60">{panel.item.title}</p>}
              </div>
            </div>
            {panel.item.department && <p><span className="opacity-50">Dept </span>{panel.item.department}</p>}
            {panel.item.email && <p className="text-xs" style={{ color: "var(--twilio-red, #e22)" }}>{panel.item.email}</p>}
            {panel.item.slack_handle && <p><span className="opacity-50">Slack </span>@{panel.item.slack_handle}</p>}
          </>
        )}
        {panel.kind === "contact" && (
          <ContactSidePanelContent
            contact={panel.item}
            onUpdated={(updated) => {
              onContactsChange?.((contacts ?? []).map((c) => c.id === updated.id ? updated : c));
            }}
            onDeleted={(id) => {
              onContactsChange?.((contacts ?? []).filter((c) => c.id !== id));
              onClose();
            }}
          />
        )}
        {panel.kind === "calendar" && (() => {
          const ev = panel.item;
          const start = new Date(ev.start_datetime);
          const end = new Date(ev.end_datetime);
          const durationMin = Math.round((end.getTime() - start.getTime()) / 60000);
          const responseColor: Record<string, string> = {
            accepted: "#15803d", declined: "#dc2626", tentative: "#a16207", needsAction: "#888",
          };
          return (
            <>
              {/* Status badge */}
              {ev.status !== "confirmed" && (
                <span style={{ display: "inline-block", fontSize: "0.6875rem", fontWeight: 600, padding: "2px 8px", borderRadius: "6px", background: ev.status === "cancelled" ? "#fee2e2" : "#fef9c3", color: ev.status === "cancelled" ? "#dc2626" : "#a16207", marginBottom: "2px" }}>
                  {ev.status}
                </span>
              )}

              {/* Title */}
              <p className="font-semibold text-base leading-snug" style={{ color: "var(--text-primary, #111)" }}>{ev.title || <span className="italic opacity-50">Untitled event</span>}</p>

              {/* Time */}
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <p>
                  <span className="opacity-50">Start </span>
                  {start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                  {" "}
                  {ev.all_day ? <span className="opacity-50">(all day)</span> : start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                </p>
                {!ev.all_day && durationMin > 0 && (
                  <p><span className="opacity-50">Duration </span>{durationMin < 60 ? `${durationMin}m` : `${Math.floor(durationMin / 60)}h${durationMin % 60 > 0 ? ` ${durationMin % 60}m` : ""}`}</p>
                )}
              </div>

              {/* Location */}
              {ev.location && (
                <p>
                  <span className="opacity-50">Location </span>
                  {/^https?:\/\//i.test(ev.location) ? (
                    <a href={ev.location} target="_blank" rel="noreferrer" style={{ color: "var(--twilio-red, #e22)", textDecoration: "underline" }}>{ev.location}</a>
                  ) : ev.location}
                </p>
              )}

              {/* Meet link */}
              {ev.meet_link && (
                <a href={ev.meet_link} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "0.75rem", fontWeight: 600, color: "#fff", background: "#0f9d58", padding: "5px 10px", borderRadius: "6px", textDecoration: "none" }}>
                  <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: "13px", height: "13px" }}><path d="M20 18h-2V7.25L11 12 4 7.25V18H2V6h1.2L11 10.75 18.8 6H20v12z"/></svg>
                  Join Google Meet ↗
                </a>
              )}

              {/* Description — render URLs as links */}
              {ev.description && (
                <div>
                  <p className="font-medium mb-1">Description</p>
                  <div className="opacity-70 leading-relaxed whitespace-pre-wrap break-words" style={{ fontSize: "0.75rem" }}>
                    {ev.description.split(/(https?:\/\/[^\s<>"]+)/g).map((part, i) =>
                      /^https?:\/\//i.test(part)
                        ? <a key={i} href={part} target="_blank" rel="noreferrer" style={{ color: "var(--twilio-red, #e22)", textDecoration: "underline", wordBreak: "break-all" }}>{part}</a>
                        : part
                    )}
                  </div>
                </div>
              )}

              {/* Attendees */}
              {ev.attendees?.length > 0 && (
                <AttendeeList
                  attendees={ev.attendees}
                  responseColor={responseColor}
                  account={account}
                  teamMembers={teamMembers}
                  contacts={contacts ?? []}
                  onAccountUpdated={(updated) => { /* account refresh handled by parent re-fetch */ void updated; }}
                  onContactsChange={onContactsChange}
                />
              )}

              {/* Reminders for this meeting */}
              {panel.kind === "calendar" && panel.onAddReminder && (
                <div style={{ borderTop: "1px solid rgba(0,0,0,0.06)", paddingTop: "10px", marginTop: "4px" }}>
                  <ReminderSection
                    reminders={panel.reminders ?? []}
                    onAdd={panel.onAddReminder}
                    onDismiss={panel.onDismissReminder ?? (() => Promise.resolve())}
                    compact
                  />
                </div>
              )}

              {/* Meeting notes — synced with Calendar page */}
              <div style={{ borderTop: "1px solid rgba(0,0,0,0.06)", paddingTop: "10px", marginTop: "4px" }}>
                <MeetingNotesPanel eventId={ev.id} accountName={ev.account_name} airtableAccountId={airtableAccountId} onCreatedActionItem={onCreatedActionItem} />
                <GongSummaryPanel eventId={ev.id} meetingId={panel.kind === "calendar" ? panel.linkedMeeting?.id : undefined} existingNotes={panel.kind === "calendar" ? panel.linkedMeeting?.gong_notes : undefined} existingZoomNotes={panel.kind === "calendar" ? panel.linkedMeeting?.zoom_notes : undefined} accountName={ev.account_name} airtableAccountId={airtableAccountId} onCreatedActionItem={onCreatedActionItem} onSaved={onMeetingUpdated} teamMembers={teamMembers} />
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}

// ── Account Timeline (horizontal, day-by-day) ─────────────────────────────────

const DAY_ABBR = ["Su", "M", "T", "W", "Th", "F", "Sa"];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Returns an array of Date objects for each weekday (Mon–Fri) over the window. */
function buildDayWindow(centerDate: Date, halfWeeks = 3): Date[] {
  const days: Date[] = [];
  const start = new Date(centerDate);
  // go back halfWeeks weeks to Monday
  const dow = start.getDay(); // 0=Sun
  const daysToMon = (dow === 0 ? 6 : dow - 1);
  start.setDate(start.getDate() - daysToMon - halfWeeks * 7);

  for (let i = 0; i < (halfWeeks * 2 + 1) * 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    if (d.getDay() !== 0 && d.getDay() !== 6) days.push(d); // weekdays only
  }
  return days;
}

function AccountTimeline({
  meetings,
  actionItems,
  calendarEvents,
  onSelectMeeting,
  onSelectAction,
  onSelectCalEvent,
  onDropActionOnDay,
}: {
  meetings: AirtableMeeting[];
  actionItems: AirtableActionItem[];
  calendarEvents: CalendarEvent[];
  onSelectMeeting: (m: AirtableMeeting) => void;
  onSelectAction: (i: AirtableActionItem) => void;
  onSelectCalEvent: (ev: CalendarEvent) => void;
  onDropActionOnDay?: (airtableId: string, dateStr: string) => void;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = isoDate(today);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);

  const days = buildDayWindow(today, 3);

  // Build lookup maps by date string
  const meetingsByDate: Record<string, AirtableMeeting[]> = {};
  for (const m of meetings) {
    if (!m.date) continue;
    const d = isoDate(new Date(m.date));
    (meetingsByDate[d] ??= []).push(m);
  }

  // Done items pinned to a specific meeting (by meeting Django PK)
  const pinnedByMeeting: Record<number, AirtableActionItem[]> = {};
  for (const item of actionItems) {
    if (item.linked_meeting != null) {
      (pinnedByMeeting[item.linked_meeting] ??= []).push(item);
    }
  }

  const actionsByDate: Record<string, AirtableActionItem[]> = {};
  for (const item of actionItems) {
    if (!item.due_date) continue;
    const d = isoDate(new Date(item.due_date));
    (actionsByDate[d] ??= []).push(item);
  }

  const calByDate: Record<string, CalendarEvent[]> = {};
  for (const ev of calendarEvents) {
    const d = isoDate(new Date(ev.start_datetime));
    (calByDate[d] ??= []).push(ev);
  }

  const hasAny = meetings.length > 0 || actionItems.length > 0 || calendarEvents.length > 0;

  // Auto-scroll today's column into view (centered)
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const todayEl = container.querySelector<HTMLElement>("[data-today='true']");
    if (todayEl) {
      const containerW = container.offsetWidth;
      const elLeft = todayEl.offsetLeft;
      const elW = todayEl.offsetWidth;
      container.scrollLeft = elLeft - containerW / 2 + elW / 2;
    }
  }, []);

  if (!hasAny) {
    return <p className="text-xs text-[var(--twilio-gray-60)] italic py-1">No meetings, action items, or calendar events yet.</p>;
  }

  return (
    <div
      ref={scrollRef}
      className="overflow-x-auto pb-2"
      style={{ scrollbarWidth: "thin" }}
    >
      <div style={{ display: "flex", gap: "6px", minWidth: "max-content" }}>
        {days.map((day) => {
          const ds = isoDate(day);
          const isToday = ds === todayStr;
          const isPast = day < today;
          const dayMeetings = meetingsByDate[ds] ?? [];
          const dayActions = actionsByDate[ds] ?? [];
          const dayCalEvs = calByDate[ds] ?? [];
          const hasItems = dayMeetings.length > 0 || dayActions.length > 0 || dayCalEvs.length > 0;

          return (
            <div
              key={ds}
              data-today={isToday ? "true" : undefined}
              onDragOver={(e) => { e.preventDefault(); setDragOverDay(ds); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverDay(null); }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverDay(null);
                const aid = e.dataTransfer.getData("timelineActionId");
                if (aid && onDropActionOnDay) onDropActionOnDay(aid, ds);
              }}
              style={{
                width: "120px",
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              {/* ── Day card (header + meetings + cal events only) ── */}
              <div
                style={{
                  borderRadius: "8px",
                  border: dragOverDay === ds
                    ? "1.5px solid var(--twilio-blue, #0263E0)"
                    : isToday
                    ? "1.5px solid var(--twilio-red, #e22)"
                    : hasItems
                    ? "1px solid rgba(0,0,0,0.1)"
                    : "1px solid rgba(0,0,0,0.05)",
                  background: dragOverDay === ds
                    ? "rgba(2,99,224,0.06)"
                    : isToday
                    ? "rgba(226,34,34,0.04)"
                    : isPast
                    ? "rgba(0,0,0,0.02)"
                    : "var(--surface, #fff)",
                  padding: "6px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  minHeight: "52px",
                }}
              >
                {/* Day header */}
                <div style={{ textAlign: "center", paddingBottom: "4px", borderBottom: isToday ? "1px solid rgba(226,34,34,0.2)" : "1px solid rgba(0,0,0,0.06)" }}>
                  <div style={{
                    fontSize: "0.625rem",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: isToday ? "var(--twilio-red, #e22)" : isPast ? "var(--twilio-gray-40, #aaa)" : "var(--twilio-gray-60, #606b85)",
                  }}>
                    {DAY_ABBR[day.getDay()]}
                  </div>
                  <div style={{
                    fontSize: "0.8125rem",
                    fontWeight: isToday ? 700 : 500,
                    color: isToday ? "var(--twilio-red, #e22)" : isPast ? "var(--twilio-gray-40, #aaa)" : "var(--twilio-navy, #121c2d)",
                    lineHeight: 1.2,
                  }}>
                    {(day.getMonth() + 1)}/{day.getDate()}
                  </div>
                </div>

                {/* Meetings + calendar events */}
                <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                  {dayMeetings.map((m) => (
                    <div key={m.airtable_id} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                      <MeetingTimelineBtn
                        m={m}
                        isPast={isPast}
                        onSelectMeeting={onSelectMeeting}
                      />
                      {/* Pinned Done action items linked to this meeting */}
                      {(pinnedByMeeting[m.id] ?? []).map((pinned) => (
                        <button
                          key={pinned.airtable_id}
                          onClick={() => onSelectAction(pinned)}
                          title={pinned.task}
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: "4px",
                            width: "100%",
                            textAlign: "left",
                            background: "rgba(21,128,61,0.08)",
                            border: "1px solid rgba(21,128,61,0.22)",
                            borderRadius: "3px",
                            padding: "2px 5px",
                            marginLeft: "6px",
                            cursor: "pointer",
                          }}
                        >
                          <span style={{ flexShrink: 0, fontSize: "0.6rem", color: "#15803d", marginTop: "2px" }}>✓</span>
                          <span style={{
                            fontSize: "0.6rem",
                            fontWeight: 500,
                            lineHeight: 1.3,
                            color: "#15803d",
                            textDecoration: "line-through",
                            overflow: "hidden",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            wordBreak: "break-word",
                          }}>
                            {pinned.task}
                          </span>
                        </button>
                      ))}
                    </div>
                  ))}
                  {dayCalEvs.map((ev) => (
                    <CalEventTimelineBtn
                      key={ev.google_event_id || ev.id}
                      ev={ev}
                      isPast={isPast}
                      onSelectCalEvent={onSelectCalEvent}
                    />
                  ))}
                </div>
              </div>

              {/* ── Action items — below the card, outside the border ── */}
              {dayActions.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                  {dayActions.map((item) => {
                    const isDone = item.status === "Done";
                    const isOverdue = isPast && !isDone;
                    return (
                      <button
                        key={item.airtable_id}
                        className="card-btn"
                        onClick={() => onSelectAction(item)}
                        title={item.task || "Action item"}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: "5px",
                          width: "100%",
                          textAlign: "left",
                          background: isDone ? "rgba(21,128,61,0.09)" : isOverdue ? "rgba(220,38,38,0.1)" : "rgba(124,58,237,0.1)",
                          border: isDone ? "1px solid rgba(21,128,61,0.25)" : isOverdue ? "1px solid rgba(220,38,38,0.25)" : "1px solid rgba(124,58,237,0.25)",
                          borderRadius: "4px",
                          padding: "3px 5px",
                          cursor: "pointer",
                          opacity: isDone ? 0.7 : 1,
                        }}
                      >
                        <span style={{
                          flexShrink: 0,
                          marginTop: "3px",
                          width: "6px",
                          height: "6px",
                          borderRadius: "50%",
                          background: isDone ? "#15803d" : isOverdue ? "#dc2626" : "#7c3aed",
                          display: "inline-block",
                        }} />
                        <span style={{
                          fontSize: "0.625rem",
                          fontWeight: 500,
                          lineHeight: 1.35,
                          color: isDone ? "#15803d" : isOverdue ? "#dc2626" : "#6d28d9",
                          textDecoration: isDone ? "line-through" : "none",
                          overflow: "hidden",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          wordBreak: "break-word",
                        }}>
                          {item.task || "Action item"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: "12px", marginTop: "8px", paddingLeft: "2px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <div style={{ width: "10px", height: "10px", borderRadius: "2px", background: "rgba(226,34,34,0.12)", border: "1px solid rgba(226,34,34,0.2)" }} />
          <span style={{ fontSize: "0.625rem", color: "var(--twilio-gray-60)" }}>Meetings</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <div style={{ width: "10px", height: "10px", borderRadius: "2px", background: "rgba(2,99,224,0.1)", border: "1px solid rgba(2,99,224,0.2)" }} />
          <span style={{ fontSize: "0.625rem", color: "var(--twilio-gray-60)" }}>Calendar events</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: "var(--twilio-gray-40)" }} />
          <span style={{ fontSize: "0.625rem", color: "var(--twilio-gray-60)" }}>Action items due</span>
        </div>
      </div>
    </div>
  );
}

// ── Project Goals ─────────────────────────────────────────────────────────────

interface GoalResource { id: string; label: string; url: string }
interface GoalSection {
  id: string;
  name: string;
  description?: string;
  url?: string;           // hyperlink for the project itself
  actionIds: string[];    // airtable_id refs
  meetingIds: string[];   // airtable_id refs
  goalIds: string[];      // linked goal column IDs
  resources: GoalResource[];
}

function uid() { return Math.random().toString(36).slice(2, 9); }

function ProjectGoals({
  goals,
  actionItems,
  meetings,
  onChange,
  onSelectAction,
  onNoteDropped,
}: {
  goals: GoalSection[];
  actionItems: AirtableActionItem[];
  meetings: AirtableMeeting[];
  onChange: (g: GoalSection[]) => void;
  onSelectAction?: (i: AirtableActionItem) => void;
  onNoteDropped?: (noteText: string, goalId: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingUrlId, setEditingUrlId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [newResourceGoal, setNewResourceGoal] = useState<string | null>(null);
  const [resourceForm, setResourceForm] = useState({ label: "", url: "" });
  const [linkingGoalId, setLinkingGoalId] = useState<string | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const newProjectInputRef = useRef<HTMLInputElement>(null);

  const actionMap = Object.fromEntries(actionItems.map((a) => [a.airtable_id, a]));
  const meetingMap = Object.fromEntries(meetings.map((m) => [m.airtable_id, m]));

  function addGoal() {
    const name = newProjectName.trim() || "New Project";
    const newGoal = { id: uid(), name, url: "", actionIds: [], meetingIds: [], goalIds: [], resources: [] };
    onChange([...goals, newGoal]);
    setCreatingProject(false);
    setNewProjectName("");
  }

  function updateName(id: string, name: string) {
    onChange(goals.map((g) => g.id === id ? { ...g, name } : g));
  }

  function removeGoal(id: string) {
    onChange(goals.filter((g) => g.id !== id));
  }

  function removeAction(goalId: string, airtableId: string) {
    onChange(goals.map((g) => g.id === goalId ? { ...g, actionIds: g.actionIds.filter((x) => x !== airtableId) } : g));
  }

  function removeMeeting(goalId: string, airtableId: string) {
    onChange(goals.map((g) => g.id === goalId ? { ...g, meetingIds: g.meetingIds.filter((x) => x !== airtableId) } : g));
  }

  function addResource(goalId: string) {
    if (!resourceForm.label.trim()) return;
    onChange(goals.map((g) => g.id === goalId
      ? { ...g, resources: [...g.resources, { id: uid(), label: resourceForm.label.trim(), url: resourceForm.url.trim() }] }
      : g));
    setResourceForm({ label: "", url: "" });
    setNewResourceGoal(null);
  }

  function removeResource(goalId: string, resourceId: string) {
    onChange(goals.map((g) => g.id === goalId ? { ...g, resources: g.resources.filter((r) => r.id !== resourceId) } : g));
  }

  function updateUrl(id: string, url: string) {
    onChange(goals.map((g) => g.id === id ? { ...g, url } : g));
  }

  function linkGoal(projectId: string, linkedGoalId: string) {
    onChange(goals.map((g) => {
      if (g.id !== projectId) return g;
      const already = (g.goalIds ?? []).includes(linkedGoalId);
      return already ? g : { ...g, goalIds: [...(g.goalIds ?? []), linkedGoalId] };
    }));
    setLinkingGoalId(null);
  }

  function unlinkGoal(projectId: string, linkedGoalId: string) {
    onChange(goals.map((g) => g.id === projectId ? { ...g, goalIds: (g.goalIds ?? []).filter((x) => x !== linkedGoalId) } : g));
  }

  function handleDragOver(e: React.DragEvent, goalId: string) {
    e.preventDefault();
    setDropTarget(goalId);
  }

  function handleDrop(e: React.DragEvent, goalId: string) {
    e.preventDefault();
    setDropTarget(null);
    const actionId = e.dataTransfer.getData("goalActionId");
    const meetingId = e.dataTransfer.getData("goalMeetingId");
    const noteText = e.dataTransfer.getData("noteText");
    if (noteText && onNoteDropped) {
      onNoteDropped(noteText, goalId);
      return;
    }
    onChange(goals.map((g) => {
      if (g.id !== goalId) return g;
      if (actionId && !g.actionIds.includes(actionId)) return { ...g, actionIds: [...g.actionIds, actionId] };
      if (meetingId && !g.meetingIds.includes(meetingId)) return { ...g, meetingIds: [...g.meetingIds, meetingId] };
      return g;
    }));
  }

  return (
    <div>
      {/* Horizontally-scrolling column board */}
      <div
        className="flex flex-row gap-3 overflow-x-auto pb-3"
        style={{ scrollbarWidth: "thin" }}
      >
        {goals.map((goal) => (
          <div
            key={goal.id}
            onDragOver={(e) => handleDragOver(e, goal.id)}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(e) => handleDrop(e, goal.id)}
            className="flex flex-col rounded-lg transition-all shrink-0"
            style={{
              width: 220,
              minHeight: 120,
              ...(dropTarget === goal.id
                ? { border: "1px solid var(--twilio-red, #e22)", background: "rgba(226,34,34,0.04)", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }
                : { border: "1px solid var(--border, rgba(0,0,0,0.08))", background: "var(--bg, #f5f5f5)" }),
            }}
          >
            {/* Column header */}
            <div
              className="flex flex-col rounded-t-lg shrink-0"
              style={{ borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))", background: "var(--surface, #fff)" }}
            >
              <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5">
                {editingId === goal.id ? (
                  <input
                    autoFocus
                    value={goal.name}
                    onChange={(e) => updateName(goal.id, e.target.value)}
                    onBlur={() => setEditingId(null)}
                    onKeyDown={(e) => { if (e.key === "Enter") setEditingId(null); }}
                    className="flex-1 text-xs font-semibold rounded px-1.5 py-0.5 focus:outline-none min-w-0"
                    style={{ background: "var(--bg, #f5f5f5)", border: "1px solid var(--twilio-red, #e22)", color: "var(--text-primary, #111)" }}
                  />
                ) : (
                  <button
                    onClick={() => setEditingId(goal.id)}
                    className="flex-1 text-left text-xs font-semibold leading-tight transition-colors hover:opacity-70 min-w-0 truncate"
                    style={{ color: "var(--text-primary, #111)" }}
                    title={goal.description ? `${goal.name}\n\n${goal.description}` : goal.name}
                  >
                    {goal.name}
                  </button>
                )}
                {/* Open URL if set */}
                {goal.url && (
                  <a href={goal.url} target="_blank" rel="noreferrer" title={goal.url} className="shrink-0 text-blue-400 hover:text-blue-600 transition-colors" onClick={(e) => e.stopPropagation()}>
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M8.636 3.5a.5.5 0 00-.5-.5H1.5A1.5 1.5 0 000 4.5v10A1.5 1.5 0 001.5 16h10a1.5 1.5 0 001.5-1.5V7.864a.5.5 0 00-1 0V14.5a.5.5 0 01-.5.5h-10a.5.5 0 01-.5-.5v-10a.5.5 0 01.5-.5h6.636a.5.5 0 00.5-.5z"/><path d="M16 .5a.5.5 0 00-.5-.5h-5a.5.5 0 000 1h3.793L6.146 9.146a.5.5 0 10.708.708L15 1.707V5.5a.5.5 0 001 0v-5z"/></svg>
                  </a>
                )}
                {/* Edit URL button */}
                <button
                  onClick={() => setEditingUrlId(editingUrlId === goal.id ? null : goal.id)}
                  className="shrink-0 transition-colors"
                  title={goal.url ? "Edit link" : "Add link"}
                  style={{ color: goal.url ? "#6366f1" : "var(--twilio-gray-60)", lineHeight: 1 }}
                >
                  <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 hover:opacity-70"><path d="M4.715 6.542L3.343 7.914a3 3 0 104.243 4.243l1.828-1.829A3 3 0 008.586 8.4l-.7.7a2 2 0 11-2.83-2.83l1.37-1.37A2 2 0 014.716 6.54zm8.485-2.828a3 3 0 00-4.243 0L7.13 5.542a3 3 0 00.826 4.913l.7-.7a2 2 0 11.83-2.83l1.828-1.828a2 2 0 010 2.828z"/></svg>
                </button>
                <button
                  onClick={() => removeGoal(goal.id)}
                  className="shrink-0 text-[var(--twilio-gray-60)] hover:text-red-500 text-xs transition-colors leading-none"
                >✕</button>
              </div>
              {/* URL input row */}
              {editingUrlId === goal.id && (
                <div className="flex items-center gap-1.5 px-3 pb-2">
                  <input
                    autoFocus
                    type="url"
                    value={goal.url ?? ""}
                    onChange={(e) => updateUrl(goal.id, e.target.value)}
                    onBlur={() => setEditingUrlId(null)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditingUrlId(null); }}
                    placeholder="https://…"
                    className="flex-1 text-[11px] rounded px-2 py-0.5 focus:outline-none min-w-0"
                    style={{ border: "1px solid #c7d2fe", background: "#f5f3ff", color: "var(--text-primary, #111)" }}
                  />
                </div>
              )}
            </div>

            {/* Column body — scrollable */}
            <div className="flex-1 overflow-y-auto px-2.5 py-2.5 flex flex-col gap-2" style={{ scrollbarWidth: "thin" }}>

              {/* Resources */}
              {goal.resources.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-[9px] font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide">Resources</p>
                  {goal.resources.map((r) => (
                    <div key={r.id} className="group flex items-center gap-1.5 bg-white rounded px-2 py-1 border border-gray-200 text-[11px]">
                      <svg viewBox="0 0 16 16" fill="currentColor" className="w-2.5 h-2.5 text-blue-400 shrink-0"><path d="M7.293 1.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L11.586 9H2a1 1 0 110-2h9.586L7.293 2.707a1 1 0 010-1.414z"/></svg>
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noreferrer" className="flex-1 underline truncate" style={{ color: "var(--twilio-red, #e22)" }}>{r.label}</a>
                      ) : (
                        <span className="flex-1 text-[var(--twilio-navy)] truncate">{r.label}</span>
                      )}
                      <button onClick={() => removeResource(goal.id, r.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all shrink-0">✕</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Linked goals */}
              {(goal.goalIds ?? []).length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-[9px] font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide">Goals</p>
                  {(goal.goalIds ?? []).map((gid) => {
                    const linked = goals.find((g) => g.id === gid);
                    if (!linked) return null;
                    return (
                      <div key={gid} className="group flex items-center gap-1.5 bg-white rounded px-2 py-1 border border-indigo-100 text-[11px]">
                        <svg viewBox="0 0 16 16" fill="currentColor" className="w-2.5 h-2.5 text-indigo-400 shrink-0"><circle cx="8" cy="8" r="3"/><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 1a6 6 0 110 12A6 6 0 018 2z"/></svg>
                        <span className="flex-1 text-[var(--twilio-navy)] truncate font-medium">{linked.name}</span>
                        <button onClick={() => unlinkGoal(goal.id, gid)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all shrink-0">✕</button>
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Link goal picker */}
              {linkingGoalId === goal.id && (
                <div className="flex flex-col gap-1">
                  <p className="text-[9px] font-semibold text-indigo-500 uppercase tracking-wide">Link a goal</p>
                  {goals.filter((g) => g.id !== goal.id && !(goal.goalIds ?? []).includes(g.id)).map((g) => (
                    <button
                      key={g.id}
                      onClick={() => linkGoal(goal.id, g.id)}
                      className="text-left text-[11px] rounded px-2 py-1 border border-indigo-100 bg-white hover:bg-indigo-50 transition-colors text-[var(--twilio-navy)] truncate"
                    >
                      {g.name}
                    </button>
                  ))}
                  {goals.filter((g) => g.id !== goal.id && !(goal.goalIds ?? []).includes(g.id)).length === 0 && (
                    <p className="text-[10px] text-[var(--twilio-gray-60)] italic">No other goals to link.</p>
                  )}
                  <button onClick={() => setLinkingGoalId(null)} className="text-[10px] text-[var(--twilio-gray-60)] hover:text-red-400 text-left mt-0.5">Cancel</button>
                </div>
              )}

              {/* Linked meetings */}
              {goal.meetingIds.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-[9px] font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide">Meetings</p>
                  {goal.meetingIds.map((mid) => {
                    const m = meetingMap[mid];
                    if (!m) return null;
                    return (
                      <div key={mid} className="group flex items-center gap-1.5 bg-white rounded px-2 py-1 border border-gray-200 text-[11px] text-[var(--twilio-navy)]">
                        <svg viewBox="0 0 16 16" fill="currentColor" className="w-2.5 h-2.5 shrink-0" style={{ color: "var(--twilio-red, #e22)", opacity: 0.6 }}><path d="M2 3a2 2 0 012-2h8a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V3zm8 1H6v1h4V4zM6 7h4v1H6V7zm0 3h3v1H6v-1z"/></svg>
                        <span className="flex-1 truncate">{m.name || "Meeting"}</span>
                        {m.date && <span className="text-[var(--twilio-gray-60)] shrink-0 text-[10px]">{new Date(m.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
                        <button onClick={() => removeMeeting(goal.id, mid)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all shrink-0">✕</button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Linked action items */}
              {goal.actionIds.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-[9px] font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide">Action Items</p>
                  {goal.actionIds.map((aid) => {
                    const item = actionMap[aid];
                    if (!item) return null;
                    return (
                      <div key={aid} className="group relative">
                        <div className="cursor-pointer" onClick={() => onSelectAction?.(item)}>
                          <ActionItemCard
                            item={item}
                            onDragStart={(e) => {
                              e.dataTransfer.setData("goalActionId", aid);
                              e.dataTransfer.setData("timelineActionId", aid);
                            }}
                          />
                        </div>
                        <button
                          onClick={() => removeAction(goal.id, aid)}
                          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-gray-300 hover:text-red-400 text-xs leading-none"
                          style={{ background: "rgba(255,255,255,0.9)", borderRadius: 3, padding: "1px 3px" }}
                        >✕</button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Drop target hint */}
              {dropTarget === goal.id && (
                <div className="rounded-md py-3 text-center text-[11px]" style={{ border: "1px dashed var(--twilio-red, #e22)", color: "var(--twilio-red, #e22)", background: "rgba(226,34,34,0.03)" }}>
                  Drop here
                </div>
              )}

              {/* Empty column placeholder */}
              {goal.actionIds.length === 0 && goal.meetingIds.length === 0 && goal.resources.length === 0 && (goal.goalIds ?? []).length === 0 && linkingGoalId !== goal.id && dropTarget !== goal.id && (
                <div className="rounded-md py-4 text-center text-[11px] text-[var(--twilio-gray-60)]" style={{ border: "1px dashed var(--border, rgba(0,0,0,0.15))" }}>
                  Drag items here
                </div>
              )}
            </div>

            {/* Column footer — add resource */}
            <div className="shrink-0 px-2.5 pb-2.5">
              {newResourceGoal === goal.id ? (
                <div className="flex flex-col gap-1.5 mt-1">
                  <input
                    autoFocus
                    placeholder="Label"
                    value={resourceForm.label}
                    onChange={(e) => setResourceForm((f) => ({ ...f, label: e.target.value }))}
                    className="w-full text-[11px] rounded px-2 py-1 focus:outline-none"
                    style={{ border: "1px solid var(--border, rgba(0,0,0,0.08))", background: "var(--surface, #fff)" }}
                  />
                  <input
                    placeholder="URL (optional)"
                    value={resourceForm.url}
                    onChange={(e) => setResourceForm((f) => ({ ...f, url: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") addResource(goal.id); }}
                    className="w-full text-[11px] rounded px-2 py-1 focus:outline-none"
                    style={{ border: "1px solid var(--border, rgba(0,0,0,0.08))", background: "var(--surface, #fff)" }}
                  />
                  <div className="flex gap-1">
                    <button onClick={() => addResource(goal.id)} className="flex-1 text-[11px] px-2 py-1 rounded hover:opacity-90 transition-opacity" style={{ background: "var(--twilio-red, #e22)", color: "#fff", border: "none" }}>Add</button>
                    <button onClick={() => setNewResourceGoal(null)} className="text-[11px] px-2 py-1 border border-gray-300 rounded text-[var(--twilio-navy)] hover:bg-gray-50">✕</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 mt-1">
                  <button
                    onClick={() => { setNewResourceGoal(goal.id); setResourceForm({ label: "", url: "" }); }}
                    className="text-[10px] transition-colors hover:opacity-70"
                    style={{ color: "var(--text-secondary, #888)" }}
                  >
                    + Add resource
                  </button>
                  <button
                    onClick={() => setLinkingGoalId(linkingGoalId === goal.id ? null : goal.id)}
                    className="text-[10px] transition-colors hover:opacity-70"
                    style={{ color: "#6366f1" }}
                  >
                    + Link goal
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Add project column */}
        {creatingProject ? (
          <div
            className="shrink-0 rounded-lg flex flex-col gap-2 p-3 self-start"
            style={{ width: 200, border: "1px solid var(--twilio-red, #e22)", background: "var(--surface, #fff)" }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--twilio-gray-60)" }}>New Project</p>
            <input
              ref={newProjectInputRef}
              autoFocus
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addGoal();
                if (e.key === "Escape") { setCreatingProject(false); setNewProjectName(""); }
              }}
              placeholder="Project name…"
              className="w-full text-xs rounded px-2 py-1 border focus:outline-none focus:ring-1 focus:ring-red-300"
              style={{ border: "1px solid rgba(0,0,0,0.12)", color: "var(--text-primary, #111)" }}
            />
            <div className="flex gap-1.5">
              <button
                onClick={addGoal}
                className="flex-1 text-xs font-semibold py-1 rounded-lg text-white transition-colors"
                style={{ background: "var(--twilio-red, #e22)" }}
              >
                Create
              </button>
              <button
                onClick={() => { setCreatingProject(false); setNewProjectName(""); }}
                className="flex-1 text-xs font-semibold py-1 rounded-lg border transition-colors hover:bg-gray-50"
                style={{ color: "var(--text-secondary, #888)", border: "1px solid rgba(0,0,0,0.1)" }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="shrink-0 flex flex-row gap-2 self-start">
            <button
              onClick={() => setCreatingProject(true)}
              className="rounded-lg flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors hover:opacity-80"
              style={{
                color: "var(--twilio-red, #e22)",
                border: "1px dashed var(--twilio-red, #e22)",
                background: "rgba(226,34,34,0.03)",
              }}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-3 h-3">
                <path d="M8 3v10M3 8h10"/>
              </svg>
              New Project
            </button>
            <button
              onClick={() => {
                const newGoal = { id: uid(), name: "New Goal", url: "", actionIds: [], meetingIds: [], goalIds: [], resources: [] };
                onChange([...goals, newGoal]);
                setEditingId(newGoal.id);
              }}
              className="rounded-lg flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors hover:opacity-80"
              style={{
                color: "var(--twilio-gray-60)",
                border: "1px dashed rgba(0,0,0,0.15)",
                background: "var(--bg, #f5f5f5)",
              }}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-3 h-3">
                <path d="M8 3v10M3 8h10"/>
              </svg>
              New Goal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Quick Links Panel ─────────────────────────────────────────────────────────

function QuickLinksPanel({
  accountId,
  links,
  onLinksChange,
}: {
  accountId: number;
  links: AccountQuickLink[];
  onLinksChange: (links: AccountQuickLink[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) nameInputRef.current?.focus();
  }, [adding]);

  async function handleCreate() {
    const name = newName.trim();
    const url = newUrl.trim();
    if (!name || !url) return;
    setSaving(true);
    try {
      const { data } = await accountsApi.createQuickLink(accountId, name, url);
      onLinksChange([...links, data]);
      setNewName("");
      setNewUrl("");
      setAdding(false);
    } catch { /* best effort */ } finally {
      setSaving(false);
    }
  }

  function startEdit(link: AccountQuickLink) {
    setEditingId(link.id);
    setEditName(link.name);
    setEditUrl(link.url);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
    setEditUrl("");
  }

  async function commitEdit() {
    if (editingId === null) return;
    const name = editName.trim();
    const url = editUrl.trim();
    if (!name || !url) { cancelEdit(); return; }
    setSaving(true);
    try {
      const { data } = await accountsApi.updateQuickLink(editingId, { name, url });
      onLinksChange(links.map((l) => (l.id === editingId ? data : l)));
      cancelEdit();
    } catch { /* best effort */ } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await accountsApi.deleteQuickLink(id);
      onLinksChange(links.filter((l) => l.id !== id));
    } catch { /* best effort */ }
  }

  function getFaviconUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      const h = parsed.hostname.replace(/^www\./, "");
      const p = parsed.pathname;
      // Google products — favicon API returns generic G; use gstatic CDN instead
      if (h === "docs.google.com") {
        if (p.startsWith("/spreadsheets/")) return "https://ssl.gstatic.com/images/branding/product/1x/sheets_2020q4_32dp.png";
        if (p.startsWith("/presentation/")) return "https://ssl.gstatic.com/images/branding/product/1x/slides_2020q4_32dp.png";
        if (p.startsWith("/forms/")) return "https://ssl.gstatic.com/images/branding/product/1x/forms_2020q4_32dp.png";
        return "https://ssl.gstatic.com/images/branding/product/1x/docs_2020q4_32dp.png";
      }
      if (h === "sheets.google.com") return "https://ssl.gstatic.com/images/branding/product/1x/sheets_2020q4_32dp.png";
      if (h === "slides.google.com") return "https://ssl.gstatic.com/images/branding/product/1x/slides_2020q4_32dp.png";
      if (h === "forms.google.com") return "https://ssl.gstatic.com/images/branding/product/1x/forms_2020q4_32dp.png";
      if (h === "drive.google.com") return "https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png";
      if (h === "calendar.google.com") return "https://ssl.gstatic.com/images/branding/product/1x/calendar_2020q4_32dp.png";
      if (h === "mail.google.com" || h === "gmail.com") return "https://ssl.gstatic.com/images/branding/product/1x/gmail_2020q4_32dp.png";
      if (h === "sites.google.com") return "https://ssl.gstatic.com/images/branding/product/1x/sites_2020q4_32dp.png";
      if (h === "notebooklm.google.com") return "https://www.gstatic.com/images/branding/product/1x/notebooklm_32dp.png";
      if (h === "gemini.google.com") return "https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg";
      // Everything else — generic favicon API works fine for non-Google domains
      return `https://www.google.com/s2/favicons?sz=16&domain=${h}`;
    } catch { return null; }
  }

  return (
    <div style={{ borderTop: "1px solid var(--border, rgba(0,0,0,0.08))", paddingTop: "0.75rem", margin: "0 1rem 0.75rem" }}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] text-[var(--twilio-gray-60)] uppercase tracking-wide">Quick Links</p>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="text-[11px] font-medium hover:opacity-70 transition-opacity"
            style={{ color: "var(--twilio-red, #e22)" }}
            title="Add quick link"
          >+ Add</button>
        )}
      </div>

      {/* Existing links */}
      <div className="flex flex-col gap-1">
        {links.map((link) => {
          const favicon = getFaviconUrl(link.url);
          if (editingId === link.id) {
            return (
              <div key={link.id} className="flex flex-col gap-1.5">
                <input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(resolveEmojiShortcodes(e.target.value))}
                  placeholder="Link name"
                  className="w-full text-xs rounded border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-red-300"
                  style={{ border: "1px solid rgba(0,0,0,0.12)", color: "var(--text-primary, #111)" }}
                  onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }}
                />
                <input
                  value={editUrl}
                  onChange={(e) => setEditUrl(e.target.value)}
                  placeholder="https://…"
                  className="w-full text-xs rounded border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-red-300"
                  style={{ border: "1px solid rgba(0,0,0,0.12)", color: "var(--text-primary, #111)" }}
                  onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }}
                />
                <div className="flex gap-1.5">
                  <button
                    onClick={commitEdit}
                    disabled={saving || !editName.trim() || !editUrl.trim()}
                    className="flex-1 text-xs font-semibold py-1 rounded-lg text-white disabled:opacity-40 transition-colors"
                    style={{ background: "var(--twilio-red, #e22)" }}
                  >Save</button>
                  <button
                    onClick={cancelEdit}
                    className="flex-1 text-xs font-semibold py-1 rounded-lg border transition-colors hover:bg-gray-50"
                    style={{ color: "var(--text-secondary, #888)", border: "1px solid rgba(0,0,0,0.1)" }}
                  >Cancel</button>
                </div>
              </div>
            );
          }
          return (
            <div key={link.id} className="group flex items-center gap-1.5">
              {favicon && <img src={favicon} alt="" className="w-3.5 h-3.5 shrink-0 rounded-sm" />}
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 text-xs truncate hover:underline"
                style={{ color: "var(--twilio-red, #e22)" }}
                title={link.url}
              >{resolveEmojiShortcodes(link.name)}</a>
              <button
                onClick={() => startEdit(link)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] leading-none hover:text-[var(--twilio-navy)]"
                style={{ color: "var(--twilio-gray-60)" }}
                title="Edit"
              >✎</button>
              <button
                onClick={() => handleDelete(link.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] leading-none hover:text-red-500"
                style={{ color: "var(--twilio-gray-60)" }}
                title="Remove"
              >✕</button>
            </div>
          );
        })}
        {links.length === 0 && !adding && (
          <p className="text-[11px] italic" style={{ color: "var(--twilio-gray-60)" }}>No quick links yet</p>
        )}
      </div>

      {/* Inline add form */}
      {adding && (
        <div className="mt-2 flex flex-col gap-1.5">
          <input
            ref={nameInputRef}
            value={newName}
            onChange={(e) => setNewName(resolveEmojiShortcodes(e.target.value))}
            placeholder="Link name"
            className="w-full text-xs rounded border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-red-300"
            style={{ border: "1px solid rgba(0,0,0,0.12)", color: "var(--text-primary, #111)" }}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") { setAdding(false); setNewName(""); setNewUrl(""); } }}
          />
          <input
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="https://…"
            className="w-full text-xs rounded border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-red-300"
            style={{ border: "1px solid rgba(0,0,0,0.12)", color: "var(--text-primary, #111)" }}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") { setAdding(false); setNewName(""); setNewUrl(""); } }}
          />
          <div className="flex gap-1.5">
            <button
              onClick={handleCreate}
              disabled={saving || !newName.trim() || !newUrl.trim()}
              className="flex-1 text-xs font-semibold py-1 rounded-lg text-white disabled:opacity-40 transition-colors"
              style={{ background: "var(--twilio-red, #e22)" }}
            >Add</button>
            <button
              onClick={() => { setAdding(false); setNewName(""); setNewUrl(""); }}
              className="flex-1 text-xs font-semibold py-1 rounded-lg border transition-colors hover:bg-gray-50"
              style={{ color: "var(--text-secondary, #888)", border: "1px solid rgba(0,0,0,0.1)" }}
            >Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Artifacts Panel ───────────────────────────────────────────────────────────

// ── Artifact icon catalog ────────────────────────────────────────────────────

interface ArtifactIconEntry {
  key: string;
  label: string;
  /** favicon domain for Google Favicon API, or null to use emoji/asset fallback */
  faviconDomain?: string;
  /** emoji fallback when no favicon domain */
  emoji?: string;
  /** asset image URL fallback */
  assetUrl?: string;
}

const ARTIFACT_ICON_CATALOG: ArtifactIconEntry[] = [
  // Google products — use stable gstatic CDN URLs (favicon API returns generic G for all subdomains)
  { key: "google_docs",     label: "Google Docs",      assetUrl: "https://ssl.gstatic.com/images/branding/product/1x/docs_2020q4_32dp.png" },
  { key: "google_sheets",   label: "Google Sheets",    assetUrl: "https://ssl.gstatic.com/images/branding/product/1x/sheets_2020q4_32dp.png" },
  { key: "google_slides",   label: "Google Slides",    assetUrl: "https://ssl.gstatic.com/images/branding/product/1x/slides_2020q4_32dp.png" },
  { key: "google_forms",    label: "Google Forms",     assetUrl: "https://ssl.gstatic.com/images/branding/product/1x/forms_2020q4_32dp.png" },
  { key: "google_drive",    label: "Google Drive",     assetUrl: "https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png" },
  { key: "google_calendar", label: "Google Calendar",  assetUrl: "https://ssl.gstatic.com/images/branding/product/1x/calendar_2020q4_32dp.png" },
  { key: "gmail",           label: "Gmail",            assetUrl: "https://ssl.gstatic.com/images/branding/product/1x/gmail_2020q4_32dp.png" },
  { key: "notebooklm",      label: "NotebookLM",       assetUrl: "https://www.gstatic.com/images/branding/product/1x/notebooklm_32dp.png" },
  { key: "google_sites",    label: "Google Sites",     assetUrl: "https://ssl.gstatic.com/images/branding/product/1x/sites_2020q4_32dp.png" },
  { key: "gemini",          label: "Gemini",           assetUrl: "https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg" },
  // Work services
  { key: "slack",               label: "Slack",               faviconDomain: "slack.com" },
  { key: "airtable",            label: "Airtable",            faviconDomain: "airtable.com" },
  { key: "salesforce",          label: "Salesforce",          faviconDomain: "salesforce.com" },
  { key: "gong",                label: "Gong",                faviconDomain: "gong.io" },
  { key: "zoom",                label: "Zoom",                faviconDomain: "zoom.us" },
  { key: "github",              label: "GitHub",              faviconDomain: "github.com" },
  { key: "notion",              label: "Notion",              faviconDomain: "notion.so" },
  { key: "confluence",          label: "Confluence",          faviconDomain: "confluence.atlassian.net" },
  { key: "jira",                label: "Jira",                faviconDomain: "jira.atlassian.com" },
  { key: "figma",               label: "Figma",               faviconDomain: "figma.com" },
  { key: "loom",                label: "Loom",                faviconDomain: "loom.com" },
  { key: "lucidchart",          label: "Lucidchart",          faviconDomain: "lucidchart.com" },
  { key: "microsoft_teams",     label: "Microsoft Teams",     faviconDomain: "teams.microsoft.com" },
  // File types
  { key: "file_doc",    label: "Document",    assetUrl: documentIconUrl },
  { key: "file_sheet",  label: "Spreadsheet", assetUrl: statisticsIconUrl },
  { key: "file_image",  label: "Image",       assetUrl: imageIconUrl },
  { key: "file_upload", label: "File",        assetUrl: cloudUploadIconUrl },
  // Generic
  { key: "link",        label: "Link",        emoji: "🔗" },
];

const CATALOG_BY_KEY = Object.fromEntries(ARTIFACT_ICON_CATALOG.map((e) => [e.key, e]));

function getAutoIconKey(url: string): string {
  try {
    const parsed = new URL(url);
    const h = parsed.hostname.replace(/^www\./, "");
    const p = parsed.pathname;
    if (h === "docs.google.com") {
      if (p.startsWith("/spreadsheets/")) return "google_sheets";
      if (p.startsWith("/presentation/")) return "google_slides";
      if (p.startsWith("/forms/")) return "google_forms";
      return "google_docs";
    }
    if (h === "drive.google.com") return "google_drive";
    if (h === "calendar.google.com") return "google_calendar";
    if (h === "mail.google.com" || h === "gmail.com") return "gmail";
    if (h === "notebooklm.google.com") return "notebooklm";
    if (h === "sites.google.com") return "google_sites";
    if (h === "gemini.google.com") return "gemini";
    if (h.endsWith("slack.com")) return "slack";
    if (h.endsWith("airtable.com")) return "airtable";
    if (h.endsWith("salesforce.com")) return "salesforce";
    if (h.endsWith("gong.io")) return "gong";
    if (h.endsWith("zoom.us")) return "zoom";
    if (h.endsWith("github.com")) return "github";
    if (h.endsWith("notion.so")) return "notion";
    if (h.endsWith("atlassian.net") || h.endsWith("atlassian.com")) {
      if (p.includes("/wiki") || p.includes("confluence")) return "confluence";
      return "jira";
    }
    if (h.endsWith("figma.com")) return "figma";
    if (h.endsWith("loom.com")) return "loom";
    if (h.endsWith("lucidchart.com")) return "lucidchart";
    if (h.endsWith("teams.microsoft.com") || h.endsWith("office.com")) return "microsoft_teams";
  } catch { /* ignore */ }
  return "link";
}

function ArtifactIconImg({
  entry, size, onError,
}: {
  entry: ArtifactIconEntry;
  size: number;
  onError?: () => void;
}) {
  if (entry.faviconDomain) {
    return (
      <img
        src={`https://www.google.com/s2/favicons?sz=32&domain=${entry.faviconDomain}`}
        alt={entry.label}
        width={size}
        height={size}
        style={{ borderRadius: 3, objectFit: "contain", display: "block", flexShrink: 0 }}
        onError={onError}
      />
    );
  }
  if (entry.assetUrl) {
    return (
      <img
        src={entry.assetUrl}
        alt={entry.label}
        width={size}
        height={size}
        style={{ objectFit: "contain", display: "block", flexShrink: 0 }}
        onError={onError}
      />
    );
  }
  return <span style={{ fontSize: size, lineHeight: 1 }}>{entry.emoji ?? "🔗"}</span>;
}

function ArtifactIcon({
  artifactType, mime, name, url, iconKey, size = 18,
}: {
  artifactType: string;
  mime: string;
  name: string;
  url?: string | null;
  iconKey?: string;
  size?: number;
}) {
  const [imgFailed, setImgFailed] = useState(false);

  if (artifactType === "link") {
    const resolvedKey = (iconKey && iconKey !== "") ? iconKey : getAutoIconKey(url ?? "");
    const entry = CATALOG_BY_KEY[resolvedKey] ?? CATALOG_BY_KEY["link"];
    if (!imgFailed) {
      return <ArtifactIconImg entry={entry} size={size} onError={() => setImgFailed(true)} />;
    }
    return <span style={{ fontSize: size, lineHeight: 1 }}>🔗</span>;
  }

  // File type — use asset icons
  const m = mime.toLowerCase();
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  let fileEntry: ArtifactIconEntry;
  if (m.startsWith("image/")) fileEntry = CATALOG_BY_KEY["file_image"];
  else if (m.includes("spreadsheet") || ext === "xlsx" || ext === "csv") fileEntry = CATALOG_BY_KEY["file_sheet"];
  else fileEntry = CATALOG_BY_KEY["file_upload"];

  return <ArtifactIconImg entry={fileEntry} size={size} />;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function ArtifactsPanel({ accountId, airtableAccountId }: { accountId: number; airtableAccountId?: number }) {
  const [artifacts, setArtifacts] = useState<AccountArtifact[]>([]);
  const [actionItemAttachments, setActionItemAttachments] = useState<ActionItemAttachment[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [viewer, setViewer] = useState<AccountArtifact | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const load = useCallback(() => {
    accountsApi.listArtifacts(accountId)
      .then(({ data }) => setArtifacts(data))
      .catch(() => {});
  }, [accountId]);

  const loadActionItemAttachments = useCallback(() => {
    if (!airtableAccountId) return;
    airtableApi.listActionItems({ account: String(airtableAccountId) })
      .then(({ data }) => {
        const all: ActionItemAttachment[] = [];
        for (const item of data) {
          if (item.attachments?.length) all.push(...item.attachments);
        }
        setActionItemAttachments(all);
      })
      .catch(() => {});
  }, [airtableAccountId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadActionItemAttachments(); }, [loadActionItemAttachments]);
  useEffect(() => {
    const handler = () => load();
    window.addEventListener("artifact-added", handler);
    return () => window.removeEventListener("artifact-added", handler);
  }, [load]);

  async function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    if (!arr.length) return;
    setUploading(true);
    try {
      for (const f of arr) {
        await accountsApi.uploadArtifactFile(accountId, f);
      }
      load();
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: number) {
    await accountsApi.deleteArtifact(id);
    setArtifacts((prev) => prev.filter((a) => a.id !== id));
    if (viewer?.id === id) setViewer(null);
  }

  function handleArtifactClick(artifact: AccountArtifact, e: React.MouseEvent) {
    const href = artifact.file_url ?? artifact.url ?? "";
    if (!href) return;
    if (e.metaKey || e.ctrlKey) {
      window.open(href, "_blank", "noopener,noreferrer");
    } else {
      setViewer(artifact);
    }
  }

  const isPreviewable = (a: AccountArtifact) => {
    const mime = a.mime_type.toLowerCase();
    const url = a.file_url ?? a.url ?? "";
    return mime.startsWith("image/") || mime === "application/pdf" || /docs\.google\.com/i.test(url);
  };

  return (
    <div
      className="rounded-lg px-5 py-4"
      style={{ position: "relative", background: "var(--surface, #fff)", border: dragOver ? "1px solid var(--twilio-red, #e22)" : "1px solid var(--border, rgba(0,0,0,0.08))", boxShadow: dragOver ? "0 0 0 3px rgba(226,34,34,0.10)" : "0 1px 4px rgba(0,0,0,0.04)", transition: "border-color 0.15s, box-shadow 0.15s" }}
      onDragEnter={(e) => {
        e.preventDefault();
        dragCounterRef.current += 1;
        if (dragCounterRef.current === 1) setDragOver(true);
      }}
      onDragOver={(e) => { e.preventDefault(); }}
      onDragLeave={() => {
        dragCounterRef.current -= 1;
        if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setDragOver(false); }
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragCounterRef.current = 0;
        setDragOver(false);
        const noteText = e.dataTransfer.getData("noteText");
        if (noteText) {
          accountsApi.addArtifactLink(accountId, _stripMentions(noteText).slice(0, 255) || "Note", "")
            .then(() => load())
            .catch(() => {});
          return;
        }
        if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
      }}
    >
      {/* Full-panel drop overlay */}
      {dragOver && (
        <div style={{ position: "absolute", inset: 0, zIndex: 20, borderRadius: "inherit", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(226,34,34,0.06)", border: "2px dashed var(--twilio-red, #e22)", pointerEvents: "none" }}>
          <p style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--twilio-red, #e22)" }}>Drop files to upload</p>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
        <p className="text-xs font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide" style={{ margin: 0 }}>
          Artifacts {artifacts.length > 0 && <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>({artifacts.length})</span>}
        </p>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            className="card-btn"
            onClick={() => fileInputRef.current?.click()}
            style={{ fontSize: "0.75rem", fontWeight: 600, padding: "4px 10px", borderRadius: "6px", background: "var(--bg, #f5f5f5)", border: "1px solid var(--border, rgba(0,0,0,0.08))", color: "var(--text-secondary, #888)", cursor: "pointer" }}
          >
            + File
          </button>
          <button
            className="card-btn"
            onClick={() => setShowAddModal(true)}
            style={{ fontSize: "0.75rem", fontWeight: 600, padding: "4px 10px", borderRadius: "6px", background: "var(--bg, #f5f5f5)", border: "1px solid var(--border, rgba(0,0,0,0.08))", color: "var(--text-secondary, #888)", cursor: "pointer" }}
          >
            + Link
          </button>
        </div>
      </div>

      {artifacts.length === 0 ? (
        <button
          className="card-btn"
          onClick={() => fileInputRef.current?.click()}
          style={{ width: "100%", padding: "20px", border: "1.5px dashed var(--border, rgba(0,0,0,0.15))", borderRadius: "8px", background: "transparent", color: "var(--text-secondary, #aaa)", fontSize: "0.8125rem", cursor: "pointer", textAlign: "center" }}
        >
          Drop files here, or click to upload
        </button>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {artifacts.map((a) => (
            <div
              key={a.id}
              style={{ position: "relative", display: "flex", alignItems: "center", gap: "7px", padding: "7px 10px", borderRadius: "8px", background: "var(--bg, #f5f5f5)", border: "1px solid var(--border, rgba(0,0,0,0.08))", cursor: "pointer", maxWidth: "260px", userSelect: "none" }}
              onClick={(e) => handleArtifactClick(a, e)}
              title="Click to preview · Cmd+Click to open in new tab"
            >
              <ArtifactIcon artifactType={a.artifact_type} mime={a.mime_type} name={a.name} url={a.url} iconKey={a.icon_key} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ margin: 0, fontSize: "0.75rem", fontWeight: 600, color: "var(--text-primary, #111)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{resolveEmojiShortcodes(a.name)}</p>
                {a.file_size != null && (
                  <p style={{ margin: 0, fontSize: "0.625rem", color: "var(--text-secondary, #aaa)" }}>{formatBytes(a.file_size)}</p>
                )}
                {a.icon_key === "lucidchart" && (a.url || a.secondary_url) && (
                  <div style={{ display: "flex", gap: "6px", marginTop: "3px" }} onClick={(e) => e.stopPropagation()}>
                    {a.url && (
                      <a href={a.url} target="_blank" rel="noreferrer" style={{ fontSize: "0.625rem", fontWeight: 600, color: "#6366f1", textDecoration: "none", background: "rgba(99,102,241,0.08)", borderRadius: "4px", padding: "1px 5px" }}
                        title="Open edit link">Edit</a>
                    )}
                    {a.secondary_url && (
                      <a href={a.secondary_url} target="_blank" rel="noreferrer" style={{ fontSize: "0.625rem", fontWeight: 600, color: "#0891b2", textDecoration: "none", background: "rgba(8,145,178,0.08)", borderRadius: "4px", padding: "1px 5px" }}
                        title="Open published link">Published</a>
                    )}
                  </div>
                )}
              </div>
              <button
                className="card-btn"
                onClick={(e) => { e.stopPropagation(); void handleDelete(a.id); }}
                style={{ flexShrink: 0, background: "transparent", border: "none", cursor: "pointer", fontSize: "0.875rem", color: "var(--text-secondary, #bbb)", lineHeight: 1, padding: "0 2px" }}
                title="Remove"
              >×</button>
            </div>
          ))}
        </div>
      )}

      {uploading && (
        <p style={{ marginTop: "8px", fontSize: "0.75rem", color: "var(--twilio-red, #e22)" }}>Uploading…</p>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => { if (e.target.files) void handleFiles(e.target.files); e.target.value = ""; }}
      />

      {showAddModal && (
        <AddArtifactModal
          accountId={accountId}
          onClose={() => setShowAddModal(false)}
          onAdded={(a) => { setArtifacts((prev) => [a, ...prev]); setShowAddModal(false); }}
          onFileRequest={() => { setShowAddModal(false); setTimeout(() => fileInputRef.current?.click(), 50); }}
        />
      )}

      {viewer && (
        <ArtifactViewer
          artifact={viewer}
          onClose={() => setViewer(null)}
          canPreview={isPreviewable(viewer)}
        />
      )}

      {actionItemAttachments.length > 0 && (
        <div style={{ marginTop: "20px", borderTop: "1px solid var(--border, rgba(0,0,0,0.07))", paddingTop: "14px" }}>
          <p className="text-xs font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide" style={{ margin: "0 0 10px" }}>
            Artifacts from Action Items <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>({actionItemAttachments.length})</span>
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {actionItemAttachments.map((a) => {
              const href = a.file_url ?? a.url ?? "";
              return (
                <a
                  key={a.id}
                  href={href || undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "flex", alignItems: "center", gap: "7px", padding: "7px 10px", borderRadius: "8px", background: "var(--bg, #f5f5f5)", border: "1px solid var(--border, rgba(0,0,0,0.08))", maxWidth: "220px", textDecoration: "none", color: "inherit", cursor: href ? "pointer" : "default" }}
                  title={a.name}
                >
                  <ArtifactIcon artifactType={a.artifact_type} mime={a.mime_type} name={a.name} url={a.url} iconKey={a.icon_key} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{ margin: 0, fontSize: "0.75rem", fontWeight: 600, color: "var(--text-primary, #111)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{resolveEmojiShortcodes(a.name)}</p>
                    {a.file_size != null && (
                      <p style={{ margin: 0, fontSize: "0.625rem", color: "var(--text-secondary, #aaa)" }}>{formatBytes(a.file_size)}</p>
                    )}
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function AddArtifactModal({
  accountId,
  onClose,
  onAdded,
  onFileRequest,
}: {
  accountId: number;
  onClose: () => void;
  onAdded: (a: AccountArtifact) => void;
  onFileRequest: () => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [secondaryUrl, setSecondaryUrl] = useState("");
  const [iconKey, setIconKey] = useState("link");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Existing-artifact search
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!searchQ.trim()) { setSearchResults([]); return; }
    searchTimerRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const { data } = await searchApi.search(searchQ.trim());
        setSearchResults(data.results.filter((r) => r.type === "artifact"));
      } catch { setSearchResults([]); }
      finally { setSearchLoading(false); }
    }, 300);
  }, [searchQ]);

  function applyExistingArtifact(r: SearchResult) {
    const resolvedUrl = r.url && !r.url.startsWith("/") ? r.url : (r.detail ?? "");
    setUrl(resolvedUrl);
    setName(r.title);
    if (resolvedUrl) setIconKey(getAutoIconKey(resolvedUrl));
    setSearchQ("");
    setSearchResults([]);
  }

  const isLucidchart = iconKey === "lucidchart";

  function handleUrlChange(val: string) {
    setUrl(val);
    if (val.trim()) setIconKey(getAutoIconKey(val.trim()));
    else setIconKey("link");
  }

  async function handleSave() {
    if (!url.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const displayName = name.trim() || url.trim();
      const { data } = await accountsApi.addArtifactLink(accountId, displayName, url.trim(), iconKey, secondaryUrl.trim() || undefined);
      onAdded(data);
    } catch {
      setError("Failed to add link — please try again.");
      setSaving(false);
    }
  }

  const linkIcons = ARTIFACT_ICON_CATALOG.filter((e) => !e.key.startsWith("file_"));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        style={{ background: "var(--surface, #fff)", borderRadius: "12px", padding: "24px", width: "100%", maxWidth: "440px", boxShadow: "0 8px 32px rgba(0,0,0,0.15)", fontFamily: "var(--font-base)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 16px", fontSize: "1rem", fontWeight: 700, color: "var(--text-primary, #111)" }}>Add artifact</h3>

        {/* Link an existing artifact */}
        <div style={{ position: "relative", marginBottom: "16px" }}>
          <input
            type="text"
            placeholder="Search existing artifacts…"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1px solid var(--border, rgba(0,0,0,0.12))", fontSize: "0.8125rem", outline: "none", background: "var(--surface, #fff)", color: "var(--text-primary, #111)", boxSizing: "border-box" }}
          />
          {(searchResults.length > 0 || searchLoading) && (
            <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.12))", borderRadius: "8px", boxShadow: "0 4px 16px rgba(0,0,0,0.12)", zIndex: 10, maxHeight: "200px", overflowY: "auto" }}>
              {searchLoading && (
                <p style={{ margin: 0, padding: "10px 12px", fontSize: "0.75rem", color: "var(--text-secondary, #aaa)" }}>Searching…</p>
              )}
              {searchResults.map((r) => (
                <button
                  key={r.id}
                  className="card-btn"
                  onClick={() => applyExistingArtifact(r)}
                  style={{ width: "100%", textAlign: "left", padding: "8px 12px", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", fontSize: "0.8125rem", color: "var(--text-primary, #111)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg, #f5f5f5)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <ArtifactIcon artifactType={r.meta === "file" ? "file" : "link"} mime="" name={r.title} url={r.detail} size={14} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{ margin: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</p>
                    {r.account && <p style={{ margin: 0, fontSize: "0.6875rem", color: "var(--text-secondary, #aaa)" }}>{r.account}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
          <div style={{ flex: 1, height: "1px", background: "var(--border, rgba(0,0,0,0.08))" }} />
          <span style={{ fontSize: "0.75rem", color: "var(--text-secondary, #aaa)" }}>or add new</span>
          <div style={{ flex: 1, height: "1px", background: "var(--border, rgba(0,0,0,0.08))" }} />
        </div>

        <button
          className="card-btn"
          onClick={onFileRequest}
          style={{ width: "100%", padding: "12px 16px", borderRadius: "8px", border: "1.5px dashed var(--border, rgba(0,0,0,0.15))", background: "var(--bg, #f5f5f5)", color: "var(--text-secondary, #888)", fontSize: "0.8125rem", cursor: "pointer", marginBottom: "16px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
        >
          <span>📎</span> Upload a file from your computer
        </button>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.6875rem", fontWeight: 600, color: "var(--text-secondary, #888)", marginBottom: "4px" }}>
              {isLucidchart ? "Edit link" : "URL"}
            </label>
            <input
              type="text"
              placeholder="https://…"
              value={url}
              onChange={(e) => handleUrlChange(e.target.value)}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData("text");
                if (pasted) { e.preventDefault(); handleUrlChange(pasted.trim()); }
              }}
              autoFocus
              style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1px solid var(--border, rgba(0,0,0,0.12))", fontSize: "0.8125rem", outline: "none", background: "var(--surface, #fff)", color: "var(--text-primary, #111)", boxSizing: "border-box" }}
              onKeyDown={(e) => { if (e.key === "Enter") void handleSave(); }}
            />
          </div>
          {isLucidchart && (
            <div>
              <label style={{ display: "block", fontSize: "0.6875rem", fontWeight: 600, color: "var(--text-secondary, #888)", marginBottom: "4px" }}>
                Published link <span style={{ fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                type="text"
                placeholder="https://lucid.app/documents/published/…"
                value={secondaryUrl}
                onChange={(e) => setSecondaryUrl(e.target.value)}
                style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1px solid var(--border, rgba(0,0,0,0.12))", fontSize: "0.8125rem", outline: "none", background: "var(--surface, #fff)", color: "var(--text-primary, #111)", boxSizing: "border-box" }}
              />
            </div>
          )}
          <input
            type="text"
            placeholder="Display name (optional)"
            value={name}
            onChange={(e) => setName(resolveEmojiShortcodes(e.target.value))}
            style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1px solid var(--border, rgba(0,0,0,0.12))", fontSize: "0.8125rem", outline: "none", background: "var(--surface, #fff)", color: "var(--text-primary, #111)", boxSizing: "border-box" }}
          />
        </div>

        {/* Icon picker */}
        <div style={{ marginTop: "14px" }}>
          <p style={{ margin: "0 0 8px", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary, #888)" }}>Icon</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {linkIcons.map((entry) => {
              const selected = iconKey === entry.key;
              return (
                <button
                  key={entry.key}
                  title={entry.label}
                  onClick={() => setIconKey(entry.key)}
                  className="card-btn"
                  style={{
                    display: "flex", alignItems: "center", gap: "5px",
                    padding: "5px 8px", borderRadius: "7px", cursor: "pointer",
                    border: selected ? "2px solid var(--twilio-red, #e22)" : "1px solid var(--border, rgba(0,0,0,0.12))",
                    background: selected ? "rgba(226,34,34,0.06)" : "var(--bg, #f5f5f5)",
                    fontSize: "0.6875rem", fontWeight: selected ? 600 : 400,
                    color: "var(--text-primary, #111)",
                    outline: "none",
                  }}
                >
                  <ArtifactIconImg entry={entry} size={14} />
                  <span>{entry.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <p style={{ margin: "12px 0 0", fontSize: "0.75rem", color: "#dc2626" }}>{error}</p>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "18px" }}>
          <button className="card-btn" onClick={onClose} style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid var(--border, rgba(0,0,0,0.12))", background: "var(--surface, #fff)", fontSize: "0.8125rem", cursor: "pointer", color: "var(--text-secondary, #888)" }}>
            Cancel
          </button>
          <button
            className="card-btn"
            onClick={() => void handleSave()}
            disabled={!url.trim() || saving}
            style={{ padding: "8px 16px", borderRadius: "8px", border: "none", background: "var(--twilio-red, #e22)", color: "#fff", fontSize: "0.8125rem", fontWeight: 600, cursor: "pointer", opacity: (!url.trim() || saving) ? 0.5 : 1 }}
          >
            {saving ? "Adding…" : "Add link"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ArtifactViewer({
  artifact,
  onClose,
  canPreview,
}: {
  artifact: AccountArtifact;
  onClose: () => void;
  canPreview: boolean;
}) {
  const href = artifact.file_url ?? artifact.url ?? "";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", background: "rgba(0,0,0,0.6)", flexShrink: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <p style={{ margin: 0, fontSize: "0.875rem", fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }}>
          {resolveEmojiShortcodes(artifact.name)}
        </p>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {artifact.icon_key === "lucidchart" && artifact.secondary_url && (
            <a
              href={artifact.secondary_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: "0.75rem", fontWeight: 600, color: "#fff", background: "rgba(8,145,178,0.4)", padding: "6px 12px", borderRadius: "6px", textDecoration: "none" }}
              onClick={(e) => e.stopPropagation()}
            >Published ↗</a>
          )}
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: "0.75rem", fontWeight: 600, color: "#fff", background: "rgba(255,255,255,0.15)", padding: "6px 12px", borderRadius: "6px", textDecoration: "none" }}
              onClick={(e) => e.stopPropagation()}
            >
              {artifact.icon_key === "lucidchart" ? "Edit ↗" : "Open in new tab ↗"}
            </a>
          )}
          <button className="card-btn" onClick={onClose} style={{ background: "transparent", border: "none", color: "#fff", fontSize: "1.25rem", cursor: "pointer", lineHeight: 1, padding: "2px 6px" }}>×</button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={(e) => e.stopPropagation()}>
        {canPreview && artifact.mime_type.startsWith("image/") ? (
          <img src={href} alt={artifact.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
        ) : canPreview ? (
          <iframe src={href} title={artifact.name} style={{ width: "100%", height: "100%", border: "none", background: "#fff" }} />
        ) : (
          <div style={{ textAlign: "center", color: "#fff" }}>
            <div style={{ fontSize: "3rem", marginBottom: "12px", display: "flex", justifyContent: "center" }}>
              <ArtifactIcon artifactType={artifact.artifact_type} mime={artifact.mime_type} name={artifact.name} url={artifact.url} iconKey={artifact.icon_key} size={48} />
            </div>
            <p style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "8px" }}>{resolveEmojiShortcodes(artifact.name)}</p>
            <p style={{ fontSize: "0.8125rem", color: "rgba(255,255,255,0.6)", marginBottom: "20px" }}>Preview not available</p>
            <a href={href} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.875rem", fontWeight: 600, color: "#fff", background: "var(--twilio-red, #e22)", padding: "10px 20px", borderRadius: "8px", textDecoration: "none" }}>
              Open file ↗
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Account Notes helpers ─────────────────────────────────────────────────────

const EMOJI_SHORTCODES: Record<string, string> = {
  // Slack standard shortcodes
  link: "🔗", memo: "📝", pencil: "✏️", pencil2: "✏️", page_facing_up: "📄",
  page_with_curl: "📃", file_folder: "📁", open_file_folder: "📂", bar_chart: "📊",
  chart_with_upwards_trend: "📈", chart_with_downwards_trend: "📉", clipboard: "📋",
  pushpin: "📌", round_pushpin: "📍", bulb: "💡", star: "⭐", star2: "🌟",
  tada: "🎉", rocket: "🚀", fire: "🔥", zap: "⚡", check: "✅", white_check_mark: "✅",
  x: "❌", warning: "⚠️", construction: "🚧", lock: "🔒", key: "🔑",
  globe_with_meridians: "🌐", earth_americas: "🌎", world_map: "🗺️",
  computer: "💻", desktop_computer: "🖥️", iphone: "📱", phone: "📞",
  email: "📧", mailbox: "📬", bell: "🔔", eyes: "👀", brain: "🧠",
  hammer: "🔨", wrench: "🔧", gear: "⚙️", package: "📦", inbox_tray: "📥",
  outbox_tray: "📤", speech_balloon: "💬", thought_balloon: "💭",
  calendar: "📅", date: "📅", clock1: "🕐", hourglass: "⏳", timer_clock: "⏱️",
  trophy: "🏆", medal: "🏅", handshake: "🤝", wave: "👋", point_right: "👉",
  point_left: "👈", point_up: "☝️", thumbsup: "👍", thumbsdown: "👎",
  heart: "❤️", blue_heart: "💙", green_heart: "💚", purple_heart: "💜",
  snowflake: "❄️", sun: "☀️", rainbow: "🌈", cloud: "☁️", lightning: "⚡",
  // Vendor / brand shortcodes
  snowflakedb: "❄️", snowflake_db: "❄️",
  salesforce: "☁️", jira: "📋", confluence: "📖", slack: "💬",
  github: "🐙", notion: "📓", figma: "🎨", loom: "🎬",
  google_docs: "📄", google_sheets: "📊", google_slides: "📽️", google_drive: "📁",
};

function resolveEmojiShortcodes(text: string): string {
  return text.replace(/:([a-z0-9_]+):/gi, (match, code) => EMOJI_SHORTCODES[code.toLowerCase()] ?? match);
}

function _stripMentions(html: string) {
  return htmlToPreviewText(html).replace(/@\S+/g, "").replace(/\s{2,}/g, " ").trim();
}
function _extractMentions(html: string): string[] {
  return (htmlToPreviewText(html).match(/@(\S+)/g) ?? []).map((m) => m.slice(1));
}
function NoteIconChecklist({ className }: { className?: string }) {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}><path d="M8 5h9M8 10h9M8 15h9" strokeLinecap="round"/><path d="M3 5l1.5 1.5L7 3M3 10l1.5 1.5L7 8M3 15l1.5 1.5L7 13" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function NoteIconCalendar({ className }: { className?: string }) {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}><rect x="2" y="4" width="16" height="14" rx="2"/><path d="M2 8h16M6 2v4M14 2v4" strokeLinecap="round"/></svg>;
}
function NoteIconSchedule({ className }: { className?: string }) {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}><circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function NoteIconAgent({ className }: { className?: string }) {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}><path d="M3 5a2 2 0 012-2h10a2 2 0 012 2v7a2 2 0 01-2 2H7l-4 3V5z" strokeLinejoin="round"/><path d="M7 9h6M7 12h4" strokeLinecap="round"/></svg>;
}

function AccountNoteRow({
  note,
  accountId,
  accountName,
  airtableAccountId,
  teamMembers,
  onSave,
  onDelete,
  onCreatedActionItem,
}: {
  note: AccountNote;
  accountId: number;
  accountName: string;
  airtableAccountId?: number | null;
  teamMembers: TeamMember[];
  onSave: (n: AccountNote) => void;
  onDelete: (id: number) => void;
  onCreatedActionItem?: (item: AirtableActionItem) => void;
}) {
  const currentUser = useCurrentUser();
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(note.content);
  const [openTooltip, setOpenTooltip] = useState<"action" | "calendar" | "reminder" | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const mentionsInNote = _extractMentions(note.content);
  const preselected = teamMembers.filter((m) =>
    mentionsInNote.some((name) => m.full_name.replace(/\s+/g, "").toLowerCase() === name.toLowerCase())
  );
  const [aiAssignees, setAiAssignees] = useState<TeamMember[]>([]);
  const [aiPriority, setAiPriority] = useState<"Low" | "Medium" | "High" | "Critical">("Medium");
  const [aiDue, setAiDue] = useState("");
  const [aiSaved, setAiSaved] = useState(false);
  const [calTitle, setCalTitle] = useState(_stripMentions(note.content).slice(0, 80) || "Follow-up Meeting");
  const [calStart, setCalStart] = useState("");
  const [calEnd, setCalEnd] = useState("");
  const [calSaved, setCalSaved] = useState(false);
  const [remDate, setRemDate] = useState("");
  const [remTime, setRemTime] = useState("09:00");
  const [remSaved, setRemSaved] = useState(false);
  const _acctNlsKey = `acct-note-actions::${note.id}`;
  const [doneActions, setDoneActions] = useState<Set<"action" | "calendar" | "reminder">>(() => {
    try { const v = localStorage.getItem(_acctNlsKey); return v ? new Set(JSON.parse(v) as ("action" | "calendar" | "reminder")[]) : new Set(); } catch { return new Set(); }
  });
  function markDone(kind: "action" | "calendar" | "reminder") {
    setDoneActions((p) => { const n = new Set([...p, kind]); try { localStorage.setItem(_acctNlsKey, JSON.stringify([...n])); } catch {} return n; });
  }

  useEffect(() => {
    if (!openTooltip) return;
    function handler(e: MouseEvent) {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) setOpenTooltip(null);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openTooltip]);

  useEffect(() => {
    if (openTooltip === "action") setAiAssignees(preselected);
    if (openTooltip === "calendar") {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(10, 0, 0, 0);
      const end = new Date(tomorrow); end.setHours(11, 0, 0, 0);
      const pad = (n: number) => String(n).padStart(2, "0");
      const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      setCalStart(fmt(tomorrow)); setCalEnd(fmt(end));
      setCalTitle(_stripMentions(note.content).slice(0, 80) || "Follow-up Meeting");
    }
    if (openTooltip === "reminder") {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      const pad = (n: number) => String(n).padStart(2, "0");
      setRemDate(`${tomorrow.getFullYear()}-${pad(tomorrow.getMonth()+1)}-${pad(tomorrow.getDate())}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTooltip]);

  function commitEdit() {
    setEditing(false);
    const trimmed = editText.trim();
    if (!trimmed || trimmed === note.content) return;
    accountsApi.updateNote(note.id, trimmed).then(({ data }) => onSave(data)).catch(() => {});
  }

  function submitActionItem() {
    const assignees = aiAssignees.length > 0 ? aiAssignees : preselected;
    const assigneeName = assignees[0]?.full_name || currentUser?.display_name || "";
    const assigneeId = assignees[0] ? "" : currentUser?.airtable_collaborator_id || "";
    airtableApi.createActionItem({
      task: _stripMentions(note.content),
      task_details: note.content,
      status: "Open",
      priority: aiPriority,
      due_date: aiDue || null,
      account: airtableAccountId ?? undefined,
      account_name: accountName,
      assignee_name: assigneeName,
      assignee_airtable_id: assigneeId,
    } as Parameters<typeof airtableApi.createActionItem>[0])
      .then(({ data }) => {
        onCreatedActionItem?.(data);
        setAiSaved(true);
        markDone("action");
        localStorage.setItem("actionItemsUpdated", String(Date.now()));
        window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated", newValue: String(Date.now()) }));
        setTimeout(() => { setAiSaved(false); setOpenTooltip(null); }, 1400);
      })
      .catch(() => {});
  }

  function submitMeeting() {
    if (!calStart || !calEnd) return;
    schedulerApi.createEvent({
      title: calTitle,
      description: `From account note: ${note.content}`,
      start_datetime: new Date(calStart).toISOString(),
      end_datetime: new Date(calEnd).toISOString(),
      attendees: aiAssignees.map((m) => ({ email: m.email, displayName: m.full_name, responseStatus: "needsAction" as const })),
    } as Parameters<typeof schedulerApi.createEvent>[0])
      .then(() => { setCalSaved(true); markDone("calendar"); setTimeout(() => { setCalSaved(false); setOpenTooltip(null); }, 1400); })
      .catch(() => {});
  }

  function submitReminder() {
    if (!remDate) return;
    const due = new Date(`${remDate}T${remTime}:00`);
    schedulerApi.createReminder({
      title: _stripMentions(note.content).slice(0, 200) || "Account note reminder",
      body: htmlToPreviewText(note.content),
      resource_type: "account",
      resource_id: accountId,
      resource_label: accountName,
      due_at: due.toISOString(),
      notify_in_app: true,
    } as Parameters<typeof schedulerApi.createReminder>[0])
      .then(() => { setRemSaved(true); markDone("reminder"); setTimeout(() => { setRemSaved(false); setOpenTooltip(null); }, 1400); })
      .catch(() => {});
  }

  return (
    <li
      className="group relative flex items-start gap-2 px-3 py-2 hover:bg-gray-50 transition-colors"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("noteText", note.content);
        e.dataTransfer.setData("noteId", String(note.id));
        e.dataTransfer.effectAllowed = "copy";
      }}
    >
      <span className="mt-[6px] h-1.5 w-1.5 rounded-full bg-[var(--twilio-navy)] shrink-0 opacity-50 cursor-grab active:cursor-grabbing" />
      <div className="flex-1 min-w-0 relative">
        {editing ? (
          <div
            onBlur={() => commitEdit()}
            onKeyDownCapture={(e) => {
              if (e.key === "Escape") { e.preventDefault(); setEditing(false); setEditText(note.content); }
            }}
          >
            <RichTextMentionEditor
              value={editText}
              onChange={setEditText}
              onSubmit={commitEdit}
              placeholder="Add a note…"
              minHeightClassName="min-h-[32px]"
              autoFocus
            />
          </div>
        ) : (
          <div
            className="text-sm text-[var(--twilio-navy)] leading-relaxed cursor-text prose prose-sm max-w-none"
            onClick={() => { setEditing(true); setEditText(note.content); }}
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(plainToHtml(note.content)) }}
          />
        )}
      </div>

      {!editing && (
        <div ref={tooltipRef} className="relative flex items-center gap-0.5 shrink-0 mt-[1px]">
          <button onClick={() => setOpenTooltip(openTooltip === "action" ? null : "action")} title="Create action item"
            className={`p-1 rounded transition-colors ${doneActions.has("action") ? "text-blue-600" : openTooltip === "action" ? "text-[var(--twilio-navy)] bg-gray-100 opacity-100" : "opacity-0 group-hover:opacity-100 text-[var(--twilio-gray-40)] hover:text-[var(--twilio-navy)] hover:bg-gray-100"}`}>
            <NoteIconChecklist className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setOpenTooltip(openTooltip === "calendar" ? null : "calendar")} title="Create meeting"
            className={`p-1 rounded transition-colors ${doneActions.has("calendar") ? "text-blue-600" : openTooltip === "calendar" ? "text-[var(--twilio-navy)] bg-gray-100 opacity-100" : "opacity-0 group-hover:opacity-100 text-[var(--twilio-gray-40)] hover:text-[var(--twilio-navy)] hover:bg-gray-100"}`}>
            <NoteIconCalendar className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setOpenTooltip(openTooltip === "reminder" ? null : "reminder")} title="Set reminder"
            className={`p-1 rounded transition-colors ${doneActions.has("reminder") ? "text-blue-600" : openTooltip === "reminder" ? "text-[var(--twilio-navy)] bg-gray-100 opacity-100" : "opacity-0 group-hover:opacity-100 text-[var(--twilio-gray-40)] hover:text-[var(--twilio-navy)] hover:bg-gray-100"}`}>
            <NoteIconSchedule className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => window.dispatchEvent(new CustomEvent("chat-inject", { detail: { text: note.content } }))} title="Send to agent chat"
            className="p-1 rounded transition-colors opacity-0 group-hover:opacity-100 text-[var(--twilio-gray-40)] hover:text-[var(--twilio-navy)] hover:bg-gray-100">
            <NoteIconAgent className="w-3.5 h-3.5" />
          </button>
          <span className="h-3 w-px bg-gray-200 mx-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
          <button onClick={() => onDelete(note.id)} title="Delete note"
            className="p-1 rounded transition-colors opacity-0 group-hover:opacity-100 text-[var(--twilio-gray-40)] hover:text-red-500 hover:bg-red-50">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
              <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9h8l1-9" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          {note.author_display && (
            <span className="text-[10px] text-[var(--twilio-gray-40)] ml-1 max-w-[60px] truncate" title={note.author_display}>{note.author_display}</span>
          )}

          {openTooltip === "action" && (
            <div className="absolute right-0 top-full mt-1 z-50 w-72 bg-white border border-gray-200 rounded-xl shadow-lg p-3 space-y-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)]">Create Action Item</p>
              <div className="text-xs text-[var(--twilio-gray-80)] bg-gray-50 rounded-lg px-2 py-1.5 line-clamp-2">{_stripMentions(note.content)}</div>
              <div>
                <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">Assign to</p>
                <div className="flex flex-wrap gap-1 mb-1">
                  {aiAssignees.map((m) => (
                    <span key={m.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-indigo-100 text-indigo-700">
                      {m.full_name}<button onClick={() => setAiAssignees((prev) => prev.filter((a) => a.id !== m.id))} className="hover:text-red-500">×</button>
                    </span>
                  ))}
                </div>
                <select className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400 bg-white" value=""
                  onChange={(e) => { const member = teamMembers.find((m) => String(m.id) === e.target.value); if (member && !aiAssignees.find((a) => a.id === member.id)) setAiAssignees((prev) => [...prev, member]); }}>
                  <option value="">+ Add assignee…</option>
                  {teamMembers.filter((m) => !aiAssignees.find((a) => a.id === m.id)).map((m) => <option key={m.id} value={m.id}>{m.full_name}{m.title ? ` — ${m.title}` : ""}</option>)}
                </select>
              </div>
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
          )}

          {openTooltip === "calendar" && (
            <div className="absolute right-0 top-full mt-1 z-50 w-72 bg-white border border-gray-200 rounded-xl shadow-lg p-3 space-y-2.5">
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
              <div>
                <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">Invite</p>
                <div className="flex flex-wrap gap-1 mb-1">
                  {aiAssignees.map((m) => (
                    <span key={m.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-indigo-100 text-indigo-700">
                      {m.full_name}<button onClick={() => setAiAssignees((prev) => prev.filter((a) => a.id !== m.id))} className="hover:text-red-500">×</button>
                    </span>
                  ))}
                </div>
                <select className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400 bg-white" value=""
                  onChange={(e) => { const member = teamMembers.find((m) => String(m.id) === e.target.value); if (member && !aiAssignees.find((a) => a.id === member.id)) setAiAssignees((prev) => [...prev, member]); }}>
                  <option value="">+ Add attendee…</option>
                  {teamMembers.filter((m) => !aiAssignees.find((a) => a.id === m.id)).map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                </select>
              </div>
              <button onClick={submitMeeting} disabled={!calStart || !calEnd || calSaved}
                className={`w-full text-xs font-semibold py-1.5 rounded-lg transition-colors ${calSaved ? "bg-emerald-500 text-white" : "bg-[var(--twilio-navy)] text-white hover:bg-indigo-700 disabled:opacity-40"}`}>
                {calSaved ? "✓ Created" : "Create Meeting"}
              </button>
            </div>
          )}

          {openTooltip === "reminder" && (
            <div className="absolute right-0 top-full mt-1 z-50 w-64 bg-white border border-gray-200 rounded-xl shadow-lg p-3 space-y-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)]">Set Reminder</p>
              <div className="text-xs text-[var(--twilio-gray-80)] bg-gray-50 rounded-lg px-2 py-1.5 line-clamp-2">{_stripMentions(note.content)}</div>
              <div className="flex flex-wrap gap-1">
                {[{ label: "In 1 hour", mins: 60 }, { label: "Tomorrow 9am", mins: null }, { label: "In 2 days", mins: null, days: 2 }].map(({ label, mins, days }) => (
                  <button key={label} onClick={() => {
                    const d = new Date();
                    if (mins) { d.setMinutes(d.getMinutes() + mins); }
                    else if (days) { d.setDate(d.getDate() + days); d.setHours(9, 0, 0, 0); }
                    else { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
                    const pad = (n: number) => String(n).padStart(2, "0");
                    setRemDate(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`);
                    setRemTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
                  }} className="text-[11px] px-2 py-0.5 rounded-full border border-gray-200 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition-colors">
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
          )}
        </div>
      )}
    </li>
  );
}

// ── Account Meeting Notes ─────────────────────────────────────────────────────

function AccountMeetingNotes({
  accountId,
  accountName,
  airtableAccountId,
  notes,
  teamMembers,
  onAdd,
  onUpdate,
  onDelete,
  onCreatedActionItem,
}: {
  accountId: number;
  accountName: string;
  airtableAccountId?: number | null;
  notes: AccountNote[];
  teamMembers: TeamMember[];
  onAdd: (note: AccountNote) => void;
  onUpdate: (id: number, content: string) => void;
  onDelete: (id: number) => void;
  onCreatedActionItem?: (item: AirtableActionItem) => void;
}) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const draftEditorRef = useRef<RichTextMentionEditorHandle>(null);

  async function handleAddNote() {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      const { data } = await accountsApi.createNote(accountId, text);
      onAdd(data);
      setDraft("");
      draftEditorRef.current?.clear();
    } catch { /* best effort */ } finally {
      setSaving(false);
    }
  }

  function handleSaveEdit(updated: AccountNote) {
    onUpdate(updated.id, updated.content);
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className={`relative flex items-start gap-2 px-3 py-2 ${notes.length > 0 ? "border-b border-gray-100" : ""}`}>
        <span className="mt-[7px] h-1.5 w-1.5 rounded-full bg-gray-300 shrink-0" />
        <div className="flex-1">
          <RichTextMentionEditor
            ref={draftEditorRef}
            value={draft}
            onChange={setDraft}
            onSubmit={() => void handleAddNote()}
            placeholder="Add a note…"
            minHeightClassName="min-h-[32px]"
          />
        </div>
        {draft.trim() && (
          <button onClick={() => void handleAddNote()} disabled={saving}
            className="text-[11px] font-medium text-indigo-500 hover:text-indigo-700 shrink-0 transition-colors self-start mt-0.5">
            Add
          </button>
        )}
      </div>
      {notes.length > 0 && (
        <ul className="divide-y divide-gray-100">
          {notes.map((note) => (
            <AccountNoteRow
              key={note.id}
              note={note}
              accountId={accountId}
              accountName={accountName}
              airtableAccountId={airtableAccountId}
              teamMembers={teamMembers}
              onSave={handleSaveEdit}
              onDelete={onDelete}
              onCreatedActionItem={onCreatedActionItem}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Segment Workspaces editable field ────────────────────────────────────────

function SegmentWorkspacesField({ airtableAccount, airtableId, onSaved }: { airtableAccount: AirtableAccount | null; airtableId: string; onSaved: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(airtableAccount?.segment_workspaces ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Track the resolved airtable account PK (may need a lookup if parent didn't load it)
  const resolvedIdRef = useRef<number | null>(airtableAccount?.id ?? null);

  useEffect(() => {
    setValue(airtableAccount?.segment_workspaces ?? "");
    resolvedIdRef.current = airtableAccount?.id ?? null;
  }, [airtableAccount?.id, airtableAccount?.segment_workspaces]);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      // If we don't have a PK yet, look it up by airtable_id
      if (!resolvedIdRef.current && airtableId) {
        const { data: res } = await airtableApi.listAccounts({ airtable_id: airtableId });
        const found = (res.results ?? [])[0];
        if (!found) { setError("No linked Airtable account found."); return; }
        resolvedIdRef.current = found.id;
      }
      if (!resolvedIdRef.current) { setError("No linked Airtable account."); return; }
      const { data } = await airtableApi.updateAirtableAccount(resolvedIdRef.current, { segment_workspaces: value });
      onSaved(data.segment_workspaces);
      setEditing(false);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Save failed. Please try again.");
    } finally { setSaving(false); }
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <textarea
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={3}
          placeholder="One workspace URL per line"
          className="w-full text-xs rounded border border-indigo-300 focus:border-indigo-500 focus:outline-none px-2 py-1 resize-none"
          style={{ fontFamily: "var(--font-base)" }}
          onKeyDown={(e) => { if (e.key === "Escape") { setValue(airtableAccount?.segment_workspaces ?? ""); setEditing(false); } }}
        />
        {error && <p className="text-[11px]" style={{ color: "var(--twilio-red, #e22)" }}>{error}</p>}
        <div className="flex gap-1">
          <button
            onClick={save}
            disabled={saving}
            className="text-[11px] px-2 py-0.5 rounded font-medium"
            style={{ background: "var(--twilio-red, #e22)", color: "#fff", opacity: saving ? 0.6 : 1 }}
          >{saving ? "Saving…" : "Save"}</button>
          <button
            onClick={() => { setValue(airtableAccount?.segment_workspaces ?? ""); setEditing(false); setError(""); }}
            className="text-[11px] px-2 py-0.5 rounded font-medium"
            style={{ background: "rgba(0,0,0,0.06)", color: "var(--twilio-gray-60)" }}
          >Cancel</button>
        </div>
      </div>
    );
  }

  const workspaces = (airtableAccount?.segment_workspaces ?? "")
    .split(/[\n,]/).map((ws) => ws.trim()).filter(Boolean);

  const segmentSlug = (url: string) => url.match(/app\.segment\.com\/([^/?#]+)/)?.[1] ?? null;

  return (
    <div
      className="cursor-pointer rounded px-1 -mx-1 hover:bg-black/[0.03] transition-colors"
      onClick={() => setEditing(true)}
      title="Click to edit"
    >
      {workspaces.length > 0 ? (
        <div className="flex flex-col gap-1">
          {workspaces.map((ws) => {
            const slackMatch = ws.match(/^<([^|>]+)(?:\|([^>]+))?>$/);
            if (slackMatch) {
              const url = slackMatch[1];
              const label = segmentSlug(url) ?? slackMatch[2] ?? url.replace(/^https?:\/\//, "").replace(/\/$/, "");
              return (
                <a key={ws} href={url} target="_blank" rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-[11px] px-2 py-0.5 rounded-full font-medium truncate max-w-full"
                  style={{ background: "rgba(226,34,34,0.07)", color: "var(--twilio-red, #e22)" }}
                  title={url}
                >{label}</a>
              );
            }
            if (ws.startsWith("http")) {
              const label = segmentSlug(ws) ?? ws.replace(/^https?:\/\//, "").replace(/\/$/, "");
              return (
                <a key={ws} href={ws} target="_blank" rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-[11px] px-2 py-0.5 rounded-full font-medium truncate max-w-full"
                  style={{ background: "rgba(226,34,34,0.07)", color: "var(--twilio-red, #e22)" }}
                  title={ws}
                >{label}</a>
              );
            }
            return (
              <span key={ws} className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(226,34,34,0.07)", color: "var(--twilio-red, #e22)" }}>{ws}</span>
            );
          })}
        </div>
      ) : (
        <span style={{ color: "var(--twilio-gray-60)", fontStyle: "italic", fontSize: "0.75rem" }}>—</span>
      )}
    </div>
  );
}

// ── Inline-editable sidebar field ────────────────────────────────────────────

function SidebarField({
  label,
  value,
  onSave,
  type = "text",
  options,
  readOnly = false,
  renderValue,
}: {
  label: string;
  value: string;
  onSave?: (val: string) => Promise<void>;
  type?: "text" | "select" | "number" | "url";
  options?: { value: string; label: string }[];
  readOnly?: boolean;
  renderValue?: (val: string) => React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(value); }, [value]);

  async function commit() {
    if (readOnly || !onSave) { setEditing(false); return; }
    if (draft === value) { setEditing(false); return; }
    setSaving(true);
    try { await onSave(draft); } finally { setSaving(false); setEditing(false); }
  }

  const empty = <span style={{ color: "var(--twilio-gray-60)", fontStyle: "italic", fontSize: "0.75rem" }}>—</span>;
  const display = renderValue ? renderValue(value) : (value ? <span className="text-xs">{value}</span> : empty);

  return (
    <div>
      {label && (
        <div className="flex items-center gap-1 mb-0.5">
          <p className="text-[11px] text-[var(--twilio-gray-60)] uppercase tracking-wide">{label}</p>
          {!readOnly && !editing && (
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-2.5 h-2.5 opacity-0 group-hover/field:opacity-40 transition-opacity shrink-0" style={{ color: "var(--twilio-gray-60)" }}>
              <path d="M8 1.5l2.5 2.5-6 6L2 10.5l.5-2.5 6-6z" strokeLinejoin="round"/>
            </svg>
          )}
        </div>
      )}
      {editing ? (
        type === "select" ? (
          <select
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            className="w-full text-xs rounded border border-red-300 px-1.5 py-1 focus:outline-none focus:border-red-400 focus:ring-1 focus:ring-red-100"
            style={{ fontFamily: "var(--font-base)" }}
          >
            {options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <input
            autoFocus
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commit();
              if (e.key === "Escape") { setDraft(value); setEditing(false); }
            }}
            className="w-full text-xs rounded border border-red-300 px-1.5 py-1 focus:outline-none focus:border-red-400 focus:ring-1 focus:ring-red-100"
            style={{ fontFamily: "var(--font-base)" }}
          />
        )
      ) : (
        <div
          onClick={() => { if (!readOnly) { setDraft(value); setEditing(true); } }}
          className={`group/field leading-snug rounded px-1 -mx-1 py-0.5 -my-0.5 flex items-center gap-1.5 transition-colors ${!readOnly ? "cursor-pointer hover:bg-red-50" : ""} ${saving ? "opacity-40" : ""}`}
        >
          <span className="flex-1 min-w-0">{display}</span>
          {!readOnly && (
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-2.5 h-2.5 shrink-0 opacity-0 group-hover/field:opacity-30 transition-opacity" style={{ color: "var(--twilio-navy)" }}>
              <path d="M8 1.5l2.5 2.5-6 6L2 10.5l.5-2.5 6-6z" strokeLinejoin="round"/>
            </svg>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [account, setAccount] = useState<Account | null>(null);
  const [airtableAccount, setAirtableAccount] = useState<AirtableAccount | null>(null);
  const [actionItems, setActionItems] = useState<AirtableActionItem[]>([]);
  const [meetings, setMeetings] = useState<AirtableMeeting[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [notes, setNotes] = useState<AccountNote[]>([]);
  const [allMembers, setAllMembers] = useState<TeamMember[]>([]);
  const [accountReminders, setAccountReminders] = useState<Reminder[]>([]);
  const [meetingReminders, setMeetingReminders] = useState<Record<number, Reminder[]>>({});
  const [contacts, setContacts] = useState<CustomerContact[]>([]);
  const [quickLinks, setQuickLinks] = useState<AccountQuickLink[]>([]);
  const [selectedContact, setSelectedContact] = useState<CustomerContact | null>(null);
  const [addingContact, setAddingContact] = useState(false);
  const [addContactForm, setAddContactForm] = useState({ name: "", role: "", email: "", description: "" });
  const [addContactSaving, setAddContactSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [panel, setPanel] = useState<PanelItem | null>(null);
  const [goals, setGoals] = useState<GoalSection[]>([]);
  const [goalsLoaded, setGoalsLoaded] = useState(false);
  const prevGoalsRef = useRef<GoalSection[]>([]);
  const pendingGoalSaves = useRef(new Set<string>());
  const [reportState, setReportState] = useState<
    | { stage: "idle" }
    | { stage: "loading"; message: string }
    | { stage: "done"; report: string; durationMs: number }
    | { stage: "error"; message: string }
  >({ stage: "idle" });
  // "GET Meeting Notes" — scans the user's Gong/Zoom recap emails for meetings that
  // have no AI summary yet. Scans every meeting the user can see, not just this
  // account's, so the count in the result may exceed what this page displays.
  const [meetingNotesState, setMeetingNotesState] = useState<
    | { stage: "idle" }
    | { stage: "loading" }
    | { stage: "done"; report: MeetingNotesEmailReport }
    | { stage: "error"; message: string }
  >({ stage: "idle" });
  const [noteDragOverSection, setNoteDragOverSection] = useState<"actions" | "reminders" | "artifacts" | null>(null);
  const [kanbanDragOverCol, setKanbanDragOverCol] = useState<string | null>(null);
  const [kanbanMemberFilter, setKanbanMemberFilter] = useState<Set<string>>(new Set());
  const [kanbanViewMode, setKanbanViewMode] = useState<"all" | "unassigned" | "before_next">("all");
  const pageRef = useRef<HTMLDivElement>(null);
  useLogGlow(pageRef);

  // Close the sidebar panel whenever the viewed account changes
  useEffect(() => {
    setPanel(null);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const numId = Number(id);
    setLoading(true);
    setGoals([]);
    setGoalsLoaded(false);
    prevGoalsRef.current = [];
    pendingGoalSaves.current.clear();
    Promise.all([
      accountsApi.getAccount(numId),
      accountsApi.listNotes(numId),
      teamApi.listMembers(),
      accountsApi.listCalendarEvents(numId),
      accountsApi.listAccountReminders(numId),
    ]).then(([acctRes, notesRes, membersRes, calRes, remindersRes]) => {
      setAccount(acctRes.data);
      setNotes(notesRes.data);
      setAllMembers(membersRes.data.results);
      setCalendarEvents(calRes.data);
      setAccountReminders(remindersRes.data);
      // Load persisted account projects (skip admin — those are seeded from hardcoded list)
      if (acctRes.data.company_name.toLowerCase() !== "admin") {
        accountsApi.listProjectsByAccount(acctRes.data.company_name)
          .then(({ data }) => {
            const loaded = data.results.map((p) => ({
              id: String(p.id),
              name: p.name,
              description: p.description ?? "",
              url: "",
              actionIds: [],
              meetingIds: [],
              goalIds: [],
              resources: [],
            }));
            setGoals(loaded);
            prevGoalsRef.current = loaded;
            setGoalsLoaded(true);
          })
          .catch(() => setGoalsLoaded(true));
      }
      // Fetch Airtable data keyed by the account's airtable_id.
      //
      // Not every accounts.Account is linked to an AirtableAccount. Per-user Admin
      // accounts never are — they are private workspaces, and AirtableAccountViewSet
      // deliberately hides the shared Airtable "ADMIN" record from the accounts list — yet
      // their action items and meetings do live under that Airtable account. Without a
      // name fallback the whole block was skipped and the page showed nothing at all.
      const atId = acctRes.data.airtable_id;
      const atName = acctRes.data.company_name;
      if (atId || atName) {
        const scope: Record<string, string> = atId ? { account: String(atId) } : { account_name: String(atName) };
        return Promise.all([
          airtableApi.listActionItems(scope),
          airtableApi.listMeetings(scope),
          // Only resolvable by airtable_id; unlinked accounts have no Airtable record to show.
          atId ? airtableApi.listAccounts({ airtable_id: String(atId) }) : Promise.resolve(null),
        ]).then(([itemsRes, meetingsRes, atAcctRes]) => {
          setActionItems(itemsRes.data);
          setMeetings(meetingsRes.data.results);
          setAirtableAccount(atAcctRes?.data.results[0] ?? null);
        });
      }
    }).catch(() => {}).finally(() => setLoading(false));

    // Load customer contacts and quick links in parallel
    accountsApi.listContacts(numId).then(({ data }) => setContacts(data.results)).catch(() => {});
    accountsApi.listQuickLinks(numId).then(({ data }) => setQuickLinks(data)).catch(() => {});
  }, [id]);

  // Seed default project sections for the Admin account
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

  const ADMIN_DEFAULT_PROJECTS = [
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
  ];

  useEffect(() => {
    if (!account) return;
    if (account.company_name.toLowerCase() !== "admin") return;
    setGoals((prev) => {
      if (prev.length > 0) return prev;
      return ADMIN_DEFAULT_PROJECTS.map((name) => ({
        id: uid(),
        name,
        description: ADMIN_PROJECT_DESCRIPTIONS[name],
        actionIds: [],
        meetingIds: [],
        goalIds: [],
        resources: [],
      }));
    });
  }, [account]);

  // Refresh team list when a new member is added from TeamPage, and this account's action
  // items whenever one changes anywhere in the app (or in another tab). Without the second
  // branch this page only ever saw its own edits — an item created on the Action Items page
  // or the Calendar never appeared here.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === "teamUpdated") {
        teamApi.listMembers().then(({ data }) => setAllMembers(data.results)).catch(() => {});
        return;
      }
      if (e.key !== ACTION_ITEMS_UPDATED_KEY) return;
      if (!account) return;
      // Same account/account_name scoping as the initial fetch. noCache because the
      // mutation may have happened in another tab, which leaves this tab's GET cache warm.
      const scope: Record<string, string> = account.airtable_id
        ? { account: String(account.airtable_id) }
        : { account_name: account.company_name };
      airtableApi
        .listActionItems(scope, { fresh: true })
        .then(({ data }) => setActionItems(data))
        .catch(() => {});
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [account]);

  async function handleDropActionOnDay(airtableId: string, dateStr: string) {
    const item = actionItems.find((i) => i.airtable_id === airtableId);
    setActionItems((prev) => prev.map((i) =>
      i.airtable_id === airtableId ? { ...i, due_date: dateStr } : i
    ));
    try {
      await airtableApi.updateActionItemFields(airtableId, { due_date: dateStr });
      if (item) {
        const dateLabel = new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
        addLog({
          category: "action_item",
          message: `"${item.task || "Untitled"}" added to account timeline for ${dateLabel}`,
          links: [{ label: "View calendar", path: "/calendar" }],
          resource: { type: "action_item", id: airtableId },
        });
      }
    } catch { /* best effort */ }
  }

  async function handleDeleteNote(noteId: number) {
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
    await accountsApi.deleteNote(noteId);
  }

  function handleUpdateNote(noteId: number, content: string) {
    setNotes((prev) => prev.map((n) => n.id === noteId ? { ...n, content } : n));
  }

  async function handleAddAccountReminder(due_at: string, title: string) {
    if (!account) return;
    const { data } = await accountsApi.createAccountReminder(account.id, {
      title,
      due_at,
      notify_in_app: true,
    });
    setAccountReminders((prev) => [...prev, data]);
  }

  async function handleDismissAccountReminder(id: number) {
    await schedulerApi.dismissReminder(id);
    setAccountReminders((prev) => prev.map((r) => r.id === id ? { ...r, status: "dismissed" as const } : r));
  }

  async function handleAddMeetingReminder(calendarEventId: number, _accountId: number, calTitle: string) {
    return async (due_at: string, title: string) => {
      const { data } = await schedulerApi.createReminder({
        title,
        due_at,
        resource_type: "calendar_event",
        resource_id: calendarEventId,
        resource_label: calTitle,
        notify_in_app: true,
      });
      setMeetingReminders((prev) => ({ ...prev, [calendarEventId]: [...(prev[calendarEventId] ?? []), data] }));
    };
  }

  async function handleDismissMeetingReminder(calendarEventId: number, id: number) {
    await schedulerApi.dismissReminder(id);
    setMeetingReminders((prev) => ({
      ...prev,
      [calendarEventId]: (prev[calendarEventId] ?? []).map((r) => r.id === id ? { ...r, status: "dismissed" as const } : r),
    }));
  }

  // ── Note drag-to-section handlers ─────────────────────────────────────────

  async function handleNoteDropOnActions(e: React.DragEvent) {
    e.preventDefault();
    setNoteDragOverSection(null);
    const text = e.dataTransfer.getData("noteText");
    if (!text || !account) return;
    const { data } = await airtableApi.createActionItem({
      task: _stripMentions(text),
      task_details: text,
      status: "Open",
      priority: "Medium",
      account_name: account.company_name,
    } as Parameters<typeof airtableApi.createActionItem>[0]);
    setActionItems((prev) => [data, ...prev]);
  }

  async function handleNoteDropOnGoal(noteText: string, goalId: string) {
    if (!account) return;
    const { data } = await airtableApi.createActionItem({
      task: _stripMentions(noteText),
      task_details: noteText,
      status: "Open",
      priority: "Medium",
      account_name: account.company_name,
    } as Parameters<typeof airtableApi.createActionItem>[0]);
    setActionItems((prev) => [data, ...prev]);
    setGoals((prev) => prev.map((g) =>
      g.id === goalId && !g.actionIds.includes(data.airtable_id)
        ? { ...g, actionIds: [...g.actionIds, data.airtable_id] }
        : g
    ));
  }

  function handleGoalsChange(newGoals: GoalSection[]) {
    setGoals(newGoals);
    if (!account || account.company_name.toLowerCase() === "admin") {
      prevGoalsRef.current = newGoals;
      return;
    }
    const prev = prevGoalsRef.current;
    prevGoalsRef.current = newGoals;

    // Removed goals — only safe after initial load; before that prev is empty
    // so there's nothing to delete, but we guard explicitly to be safe.
    if (goalsLoaded) {
      for (const g of prev) {
        if (!newGoals.find((n) => n.id === g.id) && /^\d+$/.test(g.id)) {
          accountsApi.deleteProject(Number(g.id)).catch(() => {});
        }
      }
    }
    // Added goals
    for (const g of newGoals) {
      if (!prev.find((p) => p.id === g.id) && !pendingGoalSaves.current.has(g.id)) {
        pendingGoalSaves.current.add(g.id);
        accountsApi.createProject({ account: account.id, name: g.name, description: g.description ?? "" })
          .then(({ data: saved }) => {
            pendingGoalSaves.current.delete(g.id);
            const newId = String(saved.id);
            prevGoalsRef.current = prevGoalsRef.current.map((x) => x.id === g.id ? { ...x, id: newId } : x);
            setGoals((curr) => curr.map((x) => x.id === g.id ? { ...x, id: newId } : x));
          })
          .catch(() => { pendingGoalSaves.current.delete(g.id); });
      }
    }
    // Renamed goals (only for goals with a persisted backend ID)
    for (const g of newGoals) {
      const old = prev.find((p) => p.id === g.id);
      if (old && (old.name !== g.name || old.description !== g.description) && /^\d+$/.test(g.id)) {
        accountsApi.updateProject(Number(g.id), { name: g.name, description: g.description ?? "" }).catch(() => {});
      }
    }
  }

  async function handleNoteDropOnReminders(e: React.DragEvent) {
    e.preventDefault();
    setNoteDragOverSection(null);
    const text = e.dataTransfer.getData("noteText");
    if (!text || !account) return;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    const { data } = await accountsApi.createAccountReminder(account.id, {
      title: _stripMentions(text).slice(0, 200) || "Note reminder",
      due_at: tomorrow.toISOString(),
      notify_in_app: true,
    });
    setAccountReminders((prev) => [...prev, data]);
  }

  async function handleGetMeetingNotes() {
    if (!account || meetingNotesState.stage === "loading") return;
    setMeetingNotesState({ stage: "loading" });
    try {
      // No account_name — the scan covers every meeting the user can see, so recaps
      // land on other accounts' meetings too rather than needing a visit per account.
      const { data } = await integrationsApi.getMeetingNotesFromEmail();
      setMeetingNotesState({ stage: "done", report: data });

      // Re-read this account's meetings so any summary just imported shows up without
      // a reload. Mirrors the initial fetch's account/account_name scoping.
      const scope: Record<string, string> = account.airtable_id
        ? { account: String(account.airtable_id) }
        : { account_name: account.company_name };
      const refreshed = await airtableApi.listMeetings(scope);
      setMeetings(refreshed.data.results);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setMeetingNotesState({
        stage: "error",
        message: detail ?? "Could not read Gmail. Check the connection in Settings.",
      });
    }
  }

  if (loading) return <div className="flex items-center justify-center h-full text-sm text-[var(--twilio-navy)]">Loading…</div>;
  if (!account) return <div className="flex items-center justify-center h-full text-sm text-[var(--twilio-navy)]">Account not found.</div>;

  // Split team members: internal (have a TeamMember record) vs external
  const internalMemberIds = new Set(allMembers.map((m) => m.id));
  const internalMembers = (account.team_members ?? []).filter((m) => internalMemberIds.has(m.id));
  const openItems = actionItems.filter((i) => i.status !== "Done");
  const doneItems = actionItems.filter((i) => i.status === "Done");

  return (
    <div ref={pageRef} className="relative h-full overflow-hidden flex">

      {/* ── Left: Account Details sidebar ──────────────────────────────────── */}
      <div className="w-56 shrink-0 flex flex-col overflow-y-auto" style={{ background: "var(--surface, #fff)", borderRight: "1px solid var(--border, rgba(0,0,0,0.08))", fontFamily: "var(--font-base)" }}>
        <div className="px-4 py-4" style={{ borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
          <button
            onClick={() => navigate("/accounts")}
            className="flex items-center gap-1.5 text-xs mb-3 transition-colors hover:opacity-70"
            style={{ color: "var(--text-secondary, #888)" }}
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M10 12L6 8l4-4"/></svg>
            All Accounts
          </button>
          <div className="flex items-start gap-2 mb-2">
            <div className="h-9 w-9 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: "rgba(226,34,34,0.08)", color: "var(--twilio-red, #e22)" }}>
              <CorporateIcon className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <SidebarField
                label=""
                value={account.company_name}
                onSave={async (v) => {
                  const { data } = await accountsApi.updateAccount(account.id, { company_name: v } as Partial<Account>);
                  setAccount(data);
                }}
                renderValue={(v) => <span className="text-sm font-bold text-[var(--twilio-navy)] leading-tight">{v}</span>}
              />
            </div>
          </div>
          <SidebarField
            label=""
            value={account.status}
            type="select"
            options={[
              { value: "prospect", label: "Prospect" },
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
              { value: "churned", label: "Churned" },
            ]}
            onSave={async (v) => {
              const { data } = await accountsApi.updateAccount(account.id, { status: v as Account["status"] });
              setAccount(data);
            }}
            renderValue={(v) => (
              <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize" style={ACCOUNT_STATUS_STYLES[v] ?? {}}>{v}</span>
            )}
          />
        </div>

        <div className="px-4 py-3 space-y-3 text-sm text-[var(--twilio-navy)]">
          <SidebarField
            label="Industry"
            value={account.industry ?? ""}
            onSave={async (v) => {
              const { data } = await accountsApi.updateAccount(account.id, { industry: v } as Partial<Account>);
              setAccount(data);
            }}
          />
          <SidebarField
            label="ARR ($)"
            value={account.arr ?? ""}
            type="number"
            onSave={async (v) => {
              const { data } = await accountsApi.updateAccount(account.id, { arr: v === "" ? null : v } as Partial<Account>);
              setAccount(data);
            }}
            renderValue={(v) => v ? <span className="text-xs">${Number(v).toLocaleString()}</span> : <span style={{ color: "var(--twilio-gray-60)", fontStyle: "italic", fontSize: "0.75rem" }}>—</span>}
          />
          <SidebarField
            label="Website"
            value={account.website ?? ""}
            type="url"
            onSave={async (v) => {
              const { data } = await accountsApi.updateAccount(account.id, { website: v } as Partial<Account>);
              setAccount(data);
            }}
            renderValue={(v) => v
              ? <a href={v} target="_blank" rel="noreferrer" className="underline text-xs truncate block" style={{ color: "var(--twilio-red, #e22)" }} onClick={(e) => e.stopPropagation()}>{v.replace(/^https?:\/\//, "")}</a>
              : <span style={{ color: "var(--twilio-gray-60)", fontStyle: "italic", fontSize: "0.75rem" }}>—</span>
            }
          />
          <SidebarField
            label="Primary Contact"
            value={account.primary_contact_name ?? ""}
            readOnly
            renderValue={(v) => v ? <span className="text-xs">{v}</span> : <span style={{ color: "var(--twilio-gray-60)", fontStyle: "italic", fontSize: "0.75rem" }}>—</span>}
          />
          <SidebarField
            label="Owner"
            value={account.owner_username ?? ""}
            readOnly
            renderValue={(v) => v ? <span className="text-xs">{v}</span> : <span style={{ color: "var(--twilio-gray-60)", fontStyle: "italic", fontSize: "0.75rem" }}>—</span>}
          />
          <div>
            <p className="text-[11px] text-[var(--twilio-gray-60)] uppercase tracking-wide mb-0.5">Team Members</p>
            <div className="flex flex-wrap gap-1">
              {(account.team_members ?? []).length > 0
                ? (account.team_members ?? []).map((m) => (
                    <span key={m.id} className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(226,34,34,0.07)", color: "var(--twilio-red, #e22)" }}>
                      {m.full_name.split(" ")[0]}
                      <button
                        onClick={async () => {
                          const { data } = await accountsApi.removeTeamMember(account.id, m.id);
                          setAccount(data);
                        }}
                        className="ml-0.5 leading-none hover:opacity-60"
                        aria-label={`Remove ${m.full_name}`}
                        title={`Remove ${m.full_name}`}
                      >×</button>
                    </span>
                  ))
                : <span style={{ color: "var(--twilio-gray-60)", fontStyle: "italic", fontSize: "0.75rem" }}>—</span>
              }
            </div>
            <button className="mt-1 text-[11px] underline" style={{ color: "var(--twilio-red, #e22)" }} onClick={() => setEditOpen(true)}>Edit members</button>
          </div>
          <div style={{ borderTop: "1px solid var(--border, rgba(0,0,0,0.08))", paddingTop: "0.5rem" }}>
            <SidebarField
              label="Airtable ID"
              value={account.airtable_id ?? ""}
              readOnly
              renderValue={(v) => v ? <span className="text-[11px] font-mono break-all" style={{ color: "var(--twilio-gray-60)" }}>{v}</span> : <span style={{ color: "var(--twilio-gray-60)", fontStyle: "italic", fontSize: "0.75rem" }}>—</span>}
            />
            <div className="mt-2">
              <p className="text-[11px] text-[var(--twilio-gray-60)] uppercase tracking-wide mb-1">Segment Workspaces</p>
              <SegmentWorkspacesField
                airtableAccount={airtableAccount}
                airtableId={account.airtable_id ?? ""}
                onSaved={(updated) => setAirtableAccount((prev) => prev ? { ...prev, segment_workspaces: updated } : prev)}
              />
            </div>
          </div>
          <div>
            <p className="text-[11px] text-[var(--twilio-gray-60)] uppercase tracking-wide mb-0.5">Created</p>
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{new Date(account.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
          </div>
          <div>
            <p className="text-[11px] text-[var(--twilio-gray-60)] uppercase tracking-wide mb-0.5">Last Updated</p>
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{new Date(account.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
          </div>
          <div style={{ borderTop: "1px solid var(--border, rgba(0,0,0,0.08))", paddingTop: "0.5rem" }}>
            <p className="text-[11px] text-[var(--twilio-gray-60)] uppercase tracking-wide mb-0.5">Action Items</p>
            <p className="text-xs">{openItems.length} open · {doneItems.length} done</p>
          </div>
          <div>
            <p className="text-[11px] text-[var(--twilio-gray-60)] uppercase tracking-wide mb-0.5">Meetings</p>
            <p className="text-xs">{meetings.length} recorded</p>
          </div>
        </div>

        {/* ── Quick Links ─────────────────────────────────────────────────── */}
        <QuickLinksPanel
          accountId={account.id}
          links={quickLinks}
          onLinksChange={setQuickLinks}
        />
      </div>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">

        {/* Team row */}
        <div className="rounded-lg px-5 py-4" style={{ background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
          <div className="flex gap-8 flex-wrap">
            {/* Twilio / internal team */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide mb-2">Twilio Team</p>
              <div className="flex flex-wrap gap-2">
                {internalMembers.map((m) => {
                  const full = allMembers.find((tm) => tm.id === m.id);
                  const mc = ROLE_META[getTitleRole(m.title)];
                  const initials = m.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
                  const nameParts = m.full_name.trim().split(" ");
                  const firstName = nameParts[0] ?? "";
                  const lastName = nameParts.slice(1).join(" ");
                  return (
                    <button
                      key={m.id}
                      title={m.full_name}
                      onClick={() => full && setPanel({ kind: "member", item: full })}
                      className="group relative flex flex-col items-center gap-0.5 hover:opacity-80 transition-opacity"
                    >
                      {m.avatar_url
                        ? <img src={m.avatar_url} alt={m.full_name} className="h-9 w-9 rounded-full object-cover ring-2 ring-white" />
                        : <div className="h-9 w-9 rounded-full flex items-center justify-center text-[11px] font-semibold ring-2 ring-white" style={{ backgroundColor: mc.bg, color: mc.text }}>{initials}</div>
                      }
                      <span className="text-[10px] font-medium text-[var(--twilio-navy)] max-w-[56px] truncate leading-tight">{firstName}</span>
                      {lastName && <span className="text-[10px] text-[var(--twilio-navy)] opacity-60 max-w-[56px] truncate leading-tight">{lastName}</span>}
                    </button>
                  );
                })}
                {internalMembers.length === 0 && <p className="text-xs text-[var(--twilio-gray-60)] italic">No team members assigned</p>}
              </div>
            </div>

            {/* Customer contacts column */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide">
                  {account.company_name} Team
                </p>
                <button
                  onClick={() => { setAddContactForm({ name: "", role: "", email: "", description: "" }); setAddingContact(true); }}
                  className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
                >+ Add</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {contacts.map((c) => {
                  const initials = c.name.split(" ").map((p) => p[0]).join("").toUpperCase().slice(0, 2);
                  const nameParts = c.name.trim().split(" ");
                  const firstName = nameParts[0] ?? "";
                  const lastName = nameParts.slice(1).join(" ");
                  return (
                    <button
                      key={c.id}
                      title={`${c.name}${c.role ? ` · ${c.role}` : ""}`}
                      onClick={() => setPanel({ kind: "contact", item: c })}
                      className="flex flex-col items-center gap-0.5 hover:opacity-80 transition-opacity"
                    >
                      <div className="h-9 w-9 rounded-full flex items-center justify-center text-[11px] font-semibold ring-2 ring-white"
                        style={{ background: "rgba(99,102,241,0.13)", color: "#4f46e5" }}>
                        {initials}
                      </div>
                      <span className="text-[10px] font-medium text-[var(--twilio-navy)] max-w-[56px] truncate leading-tight">{firstName}</span>
                      {lastName && <span className="text-[10px] text-[var(--twilio-navy)] opacity-60 max-w-[56px] truncate leading-tight">{lastName}</span>}
                    </button>
                  );
                })}
                {contacts.length === 0 && <p className="text-xs text-[var(--twilio-gray-60)] italic">No contacts yet.</p>}
              </div>
            </div>
          </div>
        </div>

        {/* Add customer contact modal */}
        {addingContact && createPortal(
          <div
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}
            onClick={(e) => { if (e.target === e.currentTarget) setAddingContact(false); }}
          >
            <div style={{ background: "#fff", borderRadius: "12px", padding: "24px", width: "100%", maxWidth: "420px", boxShadow: "0 8px 32px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <p style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--twilio-navy)", margin: 0 }}>Add Customer Contact</p>
                <button onClick={() => setAddingContact(false)} style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer", color: "var(--twilio-gray-60)", lineHeight: 1 }}>×</button>
              </div>
              {(["name", "role", "email", "description"] as const).map((field) => (
                <div key={field} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--twilio-gray-60)", textTransform: "capitalize" }}>
                    {field}{field === "name" ? " *" : ""}
                  </label>
                  {field === "description" ? (
                    <textarea
                      rows={3}
                      value={addContactForm[field]}
                      onChange={(e) => setAddContactForm((f) => ({ ...f, [field]: e.target.value }))}
                      style={{ fontSize: "0.8125rem", border: "1px solid #e5e7eb", borderRadius: "7px", padding: "7px 10px", outline: "none", resize: "vertical", lineHeight: 1.5, color: "var(--twilio-navy)" }}
                    />
                  ) : (
                    <input
                      type={field === "email" ? "email" : "text"}
                      value={addContactForm[field]}
                      onChange={(e) => setAddContactForm((f) => ({ ...f, [field]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter" && field === "name") e.preventDefault(); }}
                      style={{ fontSize: "0.8125rem", border: "1px solid #e5e7eb", borderRadius: "7px", padding: "7px 10px", outline: "none", color: "var(--twilio-navy)" }}
                    />
                  )}
                </div>
              ))}
              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "4px" }}>
                <button onClick={() => setAddingContact(false)} style={{ padding: "7px 16px", fontSize: "0.8125rem", borderRadius: "7px", border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", color: "var(--twilio-gray-60)" }}>
                  Cancel
                </button>
                <button
                  disabled={!addContactForm.name.trim() || addContactSaving}
                  onClick={async () => {
                    if (!addContactForm.name.trim()) return;
                    setAddContactSaving(true);
                    try {
                      const { data } = await accountsApi.createContact(account.id, {
                        name: addContactForm.name.trim(),
                        role: addContactForm.role.trim(),
                        email: addContactForm.email.trim(),
                        description: addContactForm.description.trim(),
                      });
                      setContacts((prev) => [...prev, data]);
                      setAddingContact(false);
                    } catch { /* keep modal open */ }
                    setAddContactSaving(false);
                  }}
                  style={{ padding: "7px 16px", fontSize: "0.8125rem", fontWeight: 700, borderRadius: "7px", border: "none", background: "#6366f1", color: "#fff", cursor: addContactForm.name.trim() ? "pointer" : "not-allowed", opacity: addContactForm.name.trim() ? 1 : 0.5 }}
                >
                  {addContactSaving ? "Saving…" : "Add Contact"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Customer contact detail modal */}
        {selectedContact && (
          <CustomerContactModal
            contact={selectedContact}
            initialEditMode={(selectedContact as CustomerContact & { _editMode?: boolean })._editMode === true}
            onClose={() => setSelectedContact(null)}
            onUpdated={(updated) => {
              setContacts((prev) => prev.map((c) => c.id === updated.id ? updated : c));
              setSelectedContact(updated);
            }}
            onDeleted={(id) => {
              setContacts((prev) => prev.filter((c) => c.id !== id));
              setSelectedContact(null);
            }}
          />
        )}

        {/* Combined calendar + action-item timeline */}
        <div className="rounded-lg px-5 py-4" style={{ background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <p className="text-xs font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide">Timeline</p>
            <button
              onClick={() => void handleGetMeetingNotes()}
              disabled={meetingNotesState.stage === "loading"}
              title="Check your email for Gong or Zoom meeting summaries and attach them to meetings that don't have notes yet"
              className="flex items-center gap-1.5 text-xs font-medium disabled:opacity-60 px-3 py-1.5 rounded-md transition-opacity hover:opacity-90"
              style={{ background: "var(--twilio-red, #e22)", color: "#fff", border: "none" }}
            >
              {meetingNotesState.stage === "loading" ? (
                <>
                  <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                  </svg>
                  Checking email…
                </>
              ) : (
                <>
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
                    <rect x="1.5" y="3" width="13" height="10" rx="1.5"/>
                    <path d="M1.5 4.5L8 9l6.5-4.5" strokeLinecap="round"/>
                  </svg>
                  GET Meeting Notes
                </>
              )}
            </button>
          </div>

          {meetingNotesState.stage === "error" && (
            <p role="alert" className="text-[11px] mb-3" style={{ color: "var(--twilio-red, #e22)" }}>
              {meetingNotesState.message}
            </p>
          )}

          {meetingNotesState.stage === "done" && (() => {
            const { report } = meetingNotesState;
            const updated = report.updated;
            return (
              <div
                role="status"
                className="mb-3 rounded-md px-3 py-2"
                style={{ background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.2)" }}
              >
                <p className="text-[11px] font-semibold" style={{ color: "#4f46e5" }}>
                  {updated.length === 0
                    ? `No new meeting notes found — scanned ${report.scanned_emails} recap ${report.scanned_emails === 1 ? "email" : "emails"} against ${report.scanned_meetings} ${report.scanned_meetings === 1 ? "meeting" : "meetings"}.`
                    : `Added notes to ${updated.length} ${updated.length === 1 ? "meeting" : "meetings"}.`}
                </p>
                {updated.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {updated.map((item) => (
                      <li key={item.meeting_id} className="text-[11px] text-[var(--twilio-navy)]">
                        {item.meeting_name || "Untitled meeting"}
                        {item.date ? ` · ${new Date(item.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}
                        {" · "}
                        <span style={{ textTransform: "capitalize" }}>{item.sources.join(" + ")}</span>
                        {item.account_name && item.account_name !== account.company_name ? ` · ${item.account_name}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
                {report.summaries_truncated && (
                  <p className="text-[11px] mt-1" style={{ color: "var(--twilio-gray-60)" }}>
                    Stopped at the per-run limit of {report.max_summaries}. Run it again to pick up the rest.
                  </p>
                )}
              </div>
            );
          })()}

          <AccountTimeline
            meetings={meetings}
            actionItems={actionItems}
            calendarEvents={calendarEvents}
            onSelectMeeting={(m) => setPanel({ kind: "meeting", item: m })}
            onSelectAction={(i) => setPanel({ kind: "action", item: i })}
            onSelectCalEvent={(ev) => setPanel({
              kind: "calendar",
              item: ev,
              linkedMeeting: ev.agentpm_airtable_id ? meetings.find((m) => m.airtable_id === ev.agentpm_airtable_id) : undefined,
              reminders: meetingReminders[ev.id] ?? [],
              onAddReminder: async (due_at, title) => { await (await handleAddMeetingReminder(ev.id, account.id, ev.title))(due_at, title); },
              onDismissReminder: (id) => handleDismissMeetingReminder(ev.id, id),
            })}
            onDropActionOnDay={handleDropActionOnDay}
          />
        </div>

        {/* Action Items — status columns */}
        <div
          data-testid="action-items-section"
          className="rounded-lg px-4 py-4"
          style={{
            background: "var(--surface, #fff)",
            border: noteDragOverSection === "actions" ? "1px solid #6366f1" : "1px solid var(--border, rgba(0,0,0,0.08))",
            boxShadow: noteDragOverSection === "actions" ? "0 0 0 3px rgba(99,102,241,0.12)" : "0 1px 4px rgba(0,0,0,0.04)",
            transition: "border-color 0.15s, box-shadow 0.15s",
          }}
          onDragOver={(e) => { if (e.dataTransfer.types.includes("notetext")) { e.preventDefault(); setNoteDragOverSection("actions"); } }}
          onDragLeave={() => setNoteDragOverSection(null)}
          onDrop={(e) => { void handleNoteDropOnActions(e); }}
        >
          <p className="text-xs font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide mb-1">
            Action Items
            <span className="ml-2 text-[10px] font-normal normal-case" style={{ color: "var(--twilio-gray-60)" }}>
              {actionItems.length > 0 ? "drag to goals or timeline · drag a note here" : "drag a note here to create one"}
            </span>
          </p>
          {/* Kanban view selector bar */}
          {(() => {
            const today = new Date().toISOString().slice(0, 10);
            const nextFutureMeeting = meetings
              .filter((m): m is typeof m & { date: string } => m.date !== null && m.date >= today)
              .sort((a, b) => a.date.localeCompare(b.date))[0];
            const activeMembers = kanbanMemberFilter.size > 0 ? kanbanMemberFilter : null;
            return (
              <div data-testid="kanban-view-bar" className="flex flex-wrap gap-1 mb-3 mt-1">
                <button
                  className={`px-2 py-0.5 rounded text-xs font-medium ${activeMembers === null && kanbanViewMode === "all" ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                  onClick={() => { setKanbanViewMode("all"); setKanbanMemberFilter(new Set()); }}
                >All</button>
                <button
                  className={`px-2 py-0.5 rounded text-xs font-medium ${activeMembers === null && kanbanViewMode === "unassigned" ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                  onClick={() => { setKanbanViewMode("unassigned"); setKanbanMemberFilter(new Set()); }}
                >Unassigned</button>
                {nextFutureMeeting && (
                  <button
                    className={`px-2 py-0.5 rounded text-xs font-medium ${activeMembers === null && kanbanViewMode === "before_next" ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                    onClick={() => { setKanbanViewMode("before_next"); setKanbanMemberFilter(new Set()); }}
                  >Before Next Meeting</button>
                )}
                {internalMembers.map(m => (
                  <button
                    key={m.id}
                    className={`px-2 py-0.5 rounded text-xs font-medium ${activeMembers?.has(m.full_name) ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                    onClick={() => {
                      setKanbanViewMode("all");
                      setKanbanMemberFilter(prev => {
                        const next = new Set(prev);
                        if (next.has(m.full_name)) next.delete(m.full_name);
                        else next.add(m.full_name);
                        return next;
                      });
                    }}
                  >{m.full_name}</button>
                ))}
              </div>
            );
          })()}
          {/* Status columns — responsive grid */}
          {((): React.ReactNode => {
            const today = new Date().toISOString().slice(0, 10);
            const nextFutureMeeting = meetings
              .filter((m): m is typeof m & { date: string } => m.date !== null && m.date >= today)
              .sort((a, b) => a.date.localeCompare(b.date))[0];
            const kanbanItems = (() => {
              if (kanbanMemberFilter.size > 0) return actionItems.filter(i => kanbanMemberFilter.has(i.assignee_name ?? ""));
              if (kanbanViewMode === "unassigned") return actionItems.filter(i => !i.assignee_name);
              return actionItems;
            })();
            if (kanbanViewMode === "before_next" && kanbanMemberFilter.size === 0 && nextFutureMeeting) {
              const beforeItems = actionItems.filter(i => i.due_date && i.due_date <= nextFutureMeeting.date);
              const otherItems = actionItems.filter(i => !i.due_date || i.due_date > nextFutureMeeting.date);
              return (
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-medium text-indigo-700 mb-2">Due on or before: {nextFutureMeeting.name}</p>
                    <div className="text-xs text-gray-400">{beforeItems.length} item{beforeItems.length !== 1 ? "s" : ""}</div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-2">Other items</p>
                    <div className="text-xs text-gray-400">{otherItems.length} item{otherItems.length !== 1 ? "s" : ""}</div>
                  </div>
                </div>
              );
            }
            const KANBAN_COL_STYLE: Record<string, { header: string; dot: string; bg: string; dropBg: string }> = {
              "Open":        { header: "text-gray-500",    dot: "bg-gray-400",    bg: "bg-gray-50",       dropBg: "bg-gray-100" },
              "In Progress": { header: "text-indigo-600",  dot: "bg-indigo-500",  bg: "bg-indigo-50/50",  dropBg: "bg-indigo-100/60" },
              "Done":        { header: "text-emerald-600", dot: "bg-emerald-500", bg: "bg-emerald-50/50", dropBg: "bg-emerald-100/60" },
              "Blocked":     { header: "text-red-600",     dot: "bg-red-500",     bg: "bg-red-50/50",     dropBg: "bg-red-100/60" },
              "Backlogged":  { header: "text-slate-500",   dot: "bg-slate-400",   bg: "bg-slate-50/50",   dropBg: "bg-slate-100/60" },
            };

            async function handleKanbanDrop(e: React.DragEvent, targetStatus: AirtableActionItem["status"]) {
              e.preventDefault();
              setKanbanDragOverCol(null);
              const airtableId = e.dataTransfer.getData("kanbanItemId");
              if (!airtableId) return;
              const prev_item = actionItems.find((i) => i.airtable_id === airtableId);
              if (!prev_item || prev_item.status === targetStatus) return;
              setActionItems((prev) => prev.map((i) => i.airtable_id === airtableId ? { ...i, status: targetStatus } : i));
              try {
                await airtableApi.updateActionItemStatus(airtableId, targetStatus);
              } catch {
                setActionItems((prev) => prev.map((i) => i.airtable_id === airtableId ? { ...i, status: prev_item.status } : i));
              }
            }

            return (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(200px, 1fr)) minmax(200px, 1fr) minmax(252px, auto)", gap: "10px", alignItems: "start" }}>
                {(["Open", "In Progress", "Done"] as const).map((status) => {
                  const colItems = kanbanItems.filter((i) => i.status === status);
                  const { header, dot, bg, dropBg } = KANBAN_COL_STYLE[status];
                  const isOver = kanbanDragOverCol === status;
                  return (
                    <div
                      key={status}
                      className={`rounded-xl flex flex-col gap-2 p-3 transition-colors ${isOver ? dropBg : bg}`}
                      style={{ minHeight: 80, outline: isOver ? "2px solid #6366f1" : "none", outlineOffset: "-1px" }}
                      onDragOver={(e) => {
                        if (e.dataTransfer.types.includes("kanbanitemid")) { e.preventDefault(); setKanbanDragOverCol(status); }
                      }}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node)) setKanbanDragOverCol(null);
                      }}
                      onDrop={(e) => { void handleKanbanDrop(e, status); }}
                    >
                      <div className={`flex items-center gap-1.5 text-xs font-semibold ${header}`}>
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                        {status}
                        {colItems.length > 0 && (
                          <span className="ml-auto text-[10px] font-normal opacity-60">{colItems.length}</span>
                        )}
                      </div>
                      {colItems.map((item) => (
                        <ActionItemCard
                          key={item.airtable_id}
                          item={item}
                          teamMembers={allMembers}
                          meetings={meetings}
                          onUpdated={(updated) => setActionItems((prev) => prev.map((i) => i.airtable_id === updated.airtable_id ? updated : i))}
                          onDeleted={(id) => setActionItems((prev) => prev.filter((i) => i.id !== id))}
                          onDragStart={(e) => {
                            e.dataTransfer.setData("kanbanItemId", item.airtable_id);
                            e.dataTransfer.setData("goalActionId", item.airtable_id);
                            e.dataTransfer.setData("timelineActionId", item.airtable_id);
                          }}
                        />
                      ))}
                      {colItems.length === 0 && (
                        <p className="text-[11px] text-[var(--twilio-gray-60)] italic px-1">None</p>
                      )}
                    </div>
                  );
                })}
                {/* Blocked + Backlogged share one column, stacked */}
                <div className="flex flex-col gap-0" style={{ minHeight: 80 }}>
                  {(["Blocked", "Backlogged"] as const).map((status, i) => {
                    const colItems = kanbanItems.filter((item) => item.status === status);
                    const { header, dot, bg, dropBg } = KANBAN_COL_STYLE[status];
                    const isOver = kanbanDragOverCol === status;
                    return (
                      <div
                        key={status}
                        className={`flex flex-col gap-2 p-3 transition-colors ${isOver ? dropBg : bg}`}
                        style={{
                          minHeight: 80,
                          outline: isOver ? "2px solid #6366f1" : "none",
                          outlineOffset: "-1px",
                          borderRadius: i === 0 ? "12px 12px 0 0" : "0 0 12px 12px",
                          borderBottom: i === 0 ? "1px solid rgba(0,0,0,0.06)" : undefined,
                        }}
                        onDragOver={(e) => {
                          if (e.dataTransfer.types.includes("kanbanitemid")) { e.preventDefault(); setKanbanDragOverCol(status); }
                        }}
                        onDragLeave={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node)) setKanbanDragOverCol(null);
                        }}
                        onDrop={(e) => { void handleKanbanDrop(e, status); }}
                      >
                        <div className={`flex items-center gap-1.5 text-xs font-semibold ${header}`}>
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                          {status}
                          {colItems.length > 0 && (
                            <span className="ml-auto text-[10px] font-normal opacity-60">{colItems.length}</span>
                          )}
                        </div>
                        {colItems.map((item) => (
                          <ActionItemCard
                            key={item.airtable_id}
                            item={item}
                            teamMembers={allMembers}
                            meetings={meetings}
                            onUpdated={(updated) => setActionItems((prev) => prev.map((i) => i.airtable_id === updated.airtable_id ? updated : i))}
                            onDeleted={(id) => setActionItems((prev) => prev.filter((i) => i.id !== id))}
                            onDragStart={(e) => {
                              e.dataTransfer.setData("kanbanItemId", item.airtable_id);
                              e.dataTransfer.setData("goalActionId", item.airtable_id);
                              e.dataTransfer.setData("timelineActionId", item.airtable_id);
                            }}
                          />
                        ))}
                        {colItems.length === 0 && (
                          <p className="text-[11px] text-[var(--twilio-gray-60)] italic px-1">None</p>
                        )}
                      </div>
                    );
                  })}
                </div>
                {/* New column — min-width sized to fit the card */}
                <div className="rounded-xl flex flex-col gap-2 p-3 bg-gray-50" style={{ minHeight: 80 }}>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--twilio-gray-60)] italic">
                    New
                  </div>
                  <NewActionItemCard
                    accountName={account.company_name}
                    teamMembers={allMembers}
                    onSave={(newItem) => setActionItems((prev) => [newItem, ...prev])}
                  />
                </div>
              </div>
            );
          })()}
        </div>

        {/* Project Goals */}
        <div className="rounded-lg px-5 py-4" style={{ background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide">Project Goals</p>
            <button
              disabled={reportState.stage === "loading"}
              onClick={async () => {
                if (!account) return;
                if (goals.length === 0) {
                  setReportState({ stage: "error", message: "Add at least one goal section before generating a report." });
                  return;
                }
                setReportState({ stage: "loading", message: "Looking up skill…" });

                // Build goal payload with full linked data
                const goalPayload = goals.map((g) => ({
                  name: g.name,
                  meetings: g.meetingIds.flatMap((mid) => {
                    const m = meetings.find((x) => x.airtable_id === mid);
                    return m ? [{ name: m.name, date: m.date, duration: m.duration, expected_topics: m.expected_topics, gong_notes: m.gong_notes }] : [];
                  }),
                  action_items: g.actionIds.flatMap((aid) => {
                    const item = actionItems.find((x) => x.airtable_id === aid);
                    return item ? [{ task: item.task, status: item.status, priority: item.priority, due_date: item.due_date, assignee_name: item.assignee_name }] : [];
                  }),
                  resources: g.resources.map((r) => ({ label: r.label, url: r.url })),
                }));

                const today = new Date().toISOString().slice(0, 10);

                try {
                  // Find the skill by name
                  setReportState({ stage: "loading", message: "Finding skill…" });
                  const listRes = await skillsApi.list();
                  const SKILL_NAME = "generate project status report";
                  let skill = listRes.data.results.find(
                    (s) => s.name.toLowerCase() === SKILL_NAME
                  );

                  // If not found, import + register it
                  if (!skill) {
                    setReportState({ stage: "loading", message: "Registering skill…" });
                    const filesRes = await skillsApi.listFiles();
                    const fileEntry = filesRes.data.find(
                      (f) => f.name.toLowerCase() === SKILL_NAME
                    );
                    if (!fileEntry) {
                      setReportState({ stage: "error", message: "Skill file 'generate_project_status_report.py' not found in app/skills/." });
                      return;
                    }
                    const created = await skillsApi.create({
                      name: fileEntry.name,
                      description: "Generate a customer-ready project status report using Claude.",
                      code: fileEntry.code,
                    });
                    skill = created.data;
                  }

                  // Auto-approve if pending
                  if (skill.status === "pending_review" || skill.status === "rejected") {
                    setReportState({ stage: "loading", message: "Reviewing skill with Claude…" });
                    const reviewed = await skillsApi.review(skill.id);
                    skill = reviewed.data;
                  }

                  if (skill.status !== "approved") {
                    setReportState({ stage: "error", message: `Skill review returned status "${skill.status}". Check the Skills page for details.` });
                    return;
                  }

                  // Invoke
                  setReportState({ stage: "loading", message: "Claude is writing your status report…" });
                  const invokeRes = await skillsApi.invoke(skill.id, {
                    account_name: account.company_name,
                    report_date: today,
                    goals: goalPayload,
                  });

                  const result = invokeRes.data.result as { report?: string; error?: string };
                  if (result?.error) {
                    setReportState({ stage: "error", message: result.error });
                  } else {
                    setReportState({ stage: "done", report: result?.report ?? "", durationMs: invokeRes.data.duration_ms });
                  }
                } catch (err: unknown) {
                  const msg = err instanceof Error ? err.message : String(err);
                  setReportState({ stage: "error", message: msg });
                }
              }}
              className="flex items-center gap-1.5 text-xs font-medium disabled:opacity-60 px-3 py-1.5 rounded-md transition-opacity hover:opacity-90"
              style={{ background: "var(--twilio-red, #e22)", color: "#fff", border: "none" }}
            >
              {reportState.stage === "loading" ? (
                <>
                  <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                  </svg>
                  Generating…
                </>
              ) : (
                <>
                  <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                    <path d="M8 1a.5.5 0 01.45.28l5 10A.5.5 0 0113 12H3a.5.5 0 01-.45-.72l5-10A.5.5 0 018 1zm0 2.236L4.236 11h7.528L8 3.236z"/>
                  </svg>
                  + Status Report
                </>
              )}
            </button>
          </div>

          {/* Drag sources */}
          {(actionItems.length > 0 || meetings.length > 0) && (
            <div className="mb-3 p-2 bg-gray-50 rounded-md border border-dashed border-gray-300">
              <p className="text-[10px] text-[var(--twilio-gray-60)] uppercase tracking-wide mb-1.5">Drag to a goal section below · drag to calendar to set due date</p>
              {meetings.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                  {meetings.map((m) => (
                    <div
                      key={m.airtable_id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("goalMeetingId", m.airtable_id)}
                      className="flex items-center gap-1 rounded px-2 py-1 text-[11px] cursor-grab active:cursor-grabbing select-none"
                      style={{ background: "rgba(226,34,34,0.06)", border: "1px solid rgba(226,34,34,0.2)", color: "var(--twilio-red, #e22)" }}
                    >
                      <svg viewBox="0 0 16 16" fill="currentColor" className="w-2.5 h-2.5 shrink-0"><path d="M2 3a2 2 0 012-2h8a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V3zm8 1H6v1h4V4z"/></svg>
                      <span className="truncate max-w-[120px]">{m.name || "Meeting"}</span>
                    </div>
                  ))}
                </div>
              )}
              {actionItems.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {actionItems.map((item) => (
                    <ActionItemCard
                      key={item.airtable_id}
                      item={item}
                      meetings={meetings}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("goalActionId", item.airtable_id);
                        e.dataTransfer.setData("timelineActionId", item.airtable_id);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          <ProjectGoals
            goals={goals}
            actionItems={actionItems}
            meetings={meetings}
            onChange={handleGoalsChange}
            onSelectAction={(i) => setPanel({ kind: "action", item: i })}
            onNoteDropped={handleNoteDropOnGoal}
          />
        </div>

        {/* Meeting Notes */}
        <AccountMeetingNotes
          accountId={account.id}
          accountName={account.company_name}
          airtableAccountId={airtableAccount?.id}
          notes={notes}
          teamMembers={allMembers}
          onAdd={(n) => setNotes((prev) => [n, ...prev])}
          onUpdate={handleUpdateNote}
          onDelete={handleDeleteNote}
          onCreatedActionItem={(item) => setActionItems((prev) => [item, ...prev])}
        />

        {/* Account Reminders */}
        <div
          className="rounded-lg px-5 py-4"
          style={{
            background: "var(--surface, #fff)",
            border: noteDragOverSection === "reminders" ? "1px solid #f97316" : "1px solid var(--border, rgba(0,0,0,0.08))",
            boxShadow: noteDragOverSection === "reminders" ? "0 0 0 3px rgba(249,115,22,0.12)" : "0 1px 4px rgba(0,0,0,0.04)",
            transition: "border-color 0.15s, box-shadow 0.15s",
          }}
          onDragOver={(e) => { if (e.dataTransfer.types.includes("notetext")) { e.preventDefault(); setNoteDragOverSection("reminders"); } }}
          onDragLeave={() => setNoteDragOverSection(null)}
          onDrop={(e) => { void handleNoteDropOnReminders(e); }}
        >
          <p className="text-xs font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide mb-3">Reminders</p>
          <ReminderSection
            reminders={accountReminders}
            onAdd={handleAddAccountReminder}
            onDismiss={handleDismissAccountReminder}
          />
          {accountReminders.filter((r) => r.status === "dismissed" || r.status === "sent").length > 0 && (
            <details className="mt-3">
              <summary className="text-[11px] text-[var(--twilio-gray-60)] cursor-pointer hover:opacity-70 select-none">
                {accountReminders.filter((r) => r.status === "dismissed" || r.status === "sent").length} dismissed
              </summary>
              <div className="mt-1.5 space-y-1">
                {accountReminders.filter((r) => r.status === "dismissed" || r.status === "sent").map((r) => (
                  <div key={r.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg opacity-50"
                    style={{ background: "var(--bg, #f5f5f5)", border: "1px solid var(--border, rgba(0,0,0,0.06))" }}>
                    <ReminderBell className="w-3 h-3 shrink-0 text-gray-400" />
                    <p className="text-[11px] text-[var(--twilio-navy)] truncate">{r.title}</p>
                    <p className="text-[10px] text-[var(--twilio-gray-60)] ml-auto shrink-0">
                      {new Date(r.due_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </p>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

        {/* Account Comments */}
        <div className="rounded-lg px-5 py-4" style={{ background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
          <InlineCommentThread
            resourceType="account"
            resourceId={account.id}
            resourceLabel={account.company_name}
          />
        </div>

        {/* Artifacts */}
        <ArtifactsPanel accountId={account.id} airtableAccountId={airtableAccount?.id} />

        {/* Activity Log */}
        <ActivityLogSection resourceType="account" resourceId={account.id} />

        {/* Email Chain Summary & Status */}
        <EmailChainSection account={account} />

      </div>

      {/* ── Right: detail panel — space always reserved, content appears on selection ── */}
      <div className="w-80 shrink-0" style={{ borderLeft: "1px solid var(--border, rgba(0,0,0,0.08))", background: "var(--surface, #fff)" }}>
        {panel && <SidePanel panel={panel} onClose={() => setPanel(null)} onCreatedActionItem={(item) => setActionItems((prev) => [item, ...prev])} onMeetingUpdated={(updated) => { setMeetings((prev) => prev.map((m) => m.id === updated.id ? updated : m)); setPanel((p) => { if (!p) return p; if (p.kind === "meeting" && p.item.id === updated.id) return { kind: "meeting", item: updated }; if (p.kind === "calendar" && p.linkedMeeting?.id === updated.id) return { ...p, linkedMeeting: updated }; return p; }); }} onUpdatedActionItem={(updated) => { setActionItems((prev) => prev.map((a) => a.id === updated.id ? updated : a)); setPanel((p) => p?.kind === "action" && p.item.id === updated.id ? { kind: "action", item: updated } : p); }} teamMembers={allMembers} airtableAccountId={airtableAccount?.id} account={account} contacts={contacts} onContactsChange={setContacts} />}
      </div>

      {/* ── Edit Account modal ───────────────────────────────────────────────── */}
      {editOpen && (
        <EditAccountModal
          account={account}
          members={allMembers}
          onClose={() => setEditOpen(false)}
          onSave={(updated) => { setAccount(updated); setEditOpen(false); }}
        />
      )}

      {/* ── Status Report modal ──────────────────────────────────────────────── */}
      {reportState.stage !== "idle" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" style={{ background: "var(--surface, #fff)", fontFamily: "var(--font-base)" }}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "rgba(226,34,34,0.1)" }}>
                  <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5" style={{ color: "var(--twilio-red, #e22)" }}>
                    <path d="M8 1a.5.5 0 01.45.28l5 10A.5.5 0 0113 12H3a.5.5 0 01-.45-.72l5-10A.5.5 0 018 1zm0 2.236L4.236 11h7.528L8 3.236z"/>
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-[var(--twilio-navy)]">
                    Project Status Report — {account?.company_name}
                  </p>
                  {reportState.stage === "done" && (
                    <p className="text-[11px] text-[var(--twilio-gray-60)]">
                      Generated in {(reportState.durationMs / 1000).toFixed(1)}s · Ready to share
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={() => setReportState({ stage: "idle" })}
                className="text-[var(--twilio-gray-60)] hover:text-[var(--twilio-navy)] text-lg leading-none transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {reportState.stage === "loading" && (
                <div className="flex flex-col items-center justify-center gap-4 py-16">
                  <svg className="animate-spin w-8 h-8" style={{ color: "var(--twilio-red, #e22)" }} viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                  </svg>
                  <p className="text-sm text-[var(--twilio-navy)] font-medium">{reportState.message}</p>
                  <p className="text-xs text-[var(--twilio-gray-60)]">Claude is reviewing all goal sections, action items, and meeting notes…</p>
                </div>
              )}

              {reportState.stage === "error" && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-4">
                  <p className="text-sm font-semibold text-red-700 mb-1">Failed to generate report</p>
                  <p className="text-sm text-red-600">{reportState.message}</p>
                  <button
                    onClick={() => setReportState({ stage: "idle" })}
                    className="mt-3 text-xs text-red-600 underline hover:text-red-800"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {reportState.stage === "done" && (
                <div className="prose prose-sm max-w-none text-[var(--twilio-navy)]">
                  {reportState.report.split("\n").map((line, i) => {
                    if (line.startsWith("## ")) return <h2 key={i} className="text-base font-bold mt-5 mb-2 text-[var(--twilio-navy)]">{line.slice(3)}</h2>;
                    if (line.startsWith("### ")) return <h3 key={i} className="text-sm font-semibold mt-4 mb-1.5 text-[var(--twilio-navy)]">{line.slice(4)}</h3>;
                    if (line.startsWith("# ")) return <h1 key={i} className="text-lg font-bold mb-3 text-[var(--twilio-navy)]">{line.slice(2)}</h1>;
                    if (line.startsWith("- ") || line.startsWith("* ")) return <li key={i} className="ml-4 text-sm leading-relaxed">{renderInline(line.slice(2))}</li>;
                    if (line.startsWith("  - ") || line.startsWith("  * ")) return <li key={i} className="ml-8 text-sm leading-relaxed">{renderInline(line.slice(4))}</li>;
                    if (line.trim() === "") return <div key={i} className="h-2" />;
                    return <p key={i} className="text-sm leading-relaxed mb-1">{renderInline(line)}</p>;
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            {reportState.stage === "done" && (
              <div className="flex items-center justify-end gap-2 px-6 py-4" style={{ borderTop: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(reportState.report);
                  }}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 border border-gray-300 rounded-md text-[var(--twilio-navy)] hover:bg-gray-50 transition-colors"
                >
                  <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                    <path d="M4 2a2 2 0 00-2 2v9a2 2 0 002 2h5a2 2 0 002-2V4a2 2 0 00-2-2H4zm0 1h5a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1z"/>
                    <path d="M10 1h1a2 2 0 012 2v8a2 2 0 01-2 2h-1v-1h1a1 1 0 001-1V3a1 1 0 00-1-1h-1V1z"/>
                  </svg>
                  Copy Markdown
                </button>
                <button
                  onClick={() => {
                    const blob = new Blob([reportState.report], { type: "text/markdown" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `status-report-${(account?.company_name ?? "account").toLowerCase().replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md hover:opacity-90 transition-opacity"
                  style={{ background: "var(--twilio-red, #e22)", color: "#fff", border: "none" }}
                >
                  <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                    <path d="M2 14a1 1 0 001 1h10a1 1 0 001-1V5l-4-4H3a1 1 0 00-1 1v12zm9-9h2.5L11 2.5V5zM8 7v4m0 0l-1.5-1.5M8 11l1.5-1.5"/>
                  </svg>
                  Download .md
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Email Chain Summary & Status ──────────────────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  red:   { bg: "rgba(239,68,68,0.12)",   text: "#dc2626" },
  amber: { bg: "rgba(245,158,11,0.12)",  text: "#d97706" },
  green: { bg: "rgba(34,197,94,0.12)",   text: "#16a34a" },
  blue:  { bg: "rgba(37,99,235,0.12)",   text: "#2563eb" },
  gray:  { bg: "rgba(107,114,128,0.12)", text: "#6b7280" },
};

function EmailStatusBadge({ status, color }: { status: string; color: string }) {
  const c = STATUS_COLORS[color] ?? STATUS_COLORS.gray;
  return (
    <span style={{
      padding: "2px 8px", borderRadius: 4, fontSize: "0.6875rem", fontWeight: 700,
      background: c.bg, color: c.text, whiteSpace: "nowrap", letterSpacing: "0.02em",
    }}>{status}</span>
  );
}

function ThreadChatPanel({ thread, onClose }: { thread: GmailThread; onClose: () => void }) {
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; text: string }[]>([
    { role: "assistant", text: `I've read the "${thread.subject}" email chain (${thread.message_count} messages). Ask me anything about it.` },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", text }]);
    setSending(true);
    try {
      const threadContext = thread.messages
        .map(m => `From: ${m.from}\nDate: ${m.date}\n\n${m.body}`)
        .join("\n\n---\n\n")
        .slice(0, 8000);
      const token = localStorage.getItem("agentpm_access");
      const baseUrl = (import.meta.env["VITE_API_BASE_URL"] as string) ?? "/api/v1";
      const res = await fetch(`${baseUrl}/agents/sessions/send/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          message: `Email thread context:\n\nSubject: ${thread.subject}\n\n${threadContext}\n\n---\n\nUser question: ${text}`,
        }),
      });
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");
      const dec = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
      }
      setMessages(prev => [...prev, { role: "assistant", text: acc }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", text: `Error: ${e instanceof Error ? e.message : "Unknown"}` }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }} onClick={onClose}>
      <div style={{
        width: "100%", maxWidth: 540, maxHeight: "80vh", borderRadius: 12,
        background: "var(--surface, #fff)", boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
        display: "flex", flexDirection: "column", fontFamily: "var(--font-base)",
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ margin: 0, fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary, #111)" }}>Chat about this thread</p>
            <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "var(--text-secondary, #888)", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{thread.subject}</p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary, #888)", fontSize: "1.125rem", lineHeight: 1 }}>✕</button>
        </div>
        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ fontSize: "0.6875rem", fontWeight: 700, width: 64, flexShrink: 0, paddingTop: 2,
                color: m.role === "user" ? "var(--twilio-navy, #121c2d)" : "var(--twilio-red, #e22)" }}>
                {m.role === "user" ? "You" : "Agent PM"}
              </span>
              <p style={{ margin: 0, fontSize: "0.8125rem", lineHeight: 1.55, color: "var(--text-primary, #111)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.text}</p>
            </div>
          ))}
          {sending && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: "0.6875rem", fontWeight: 700, width: 64, color: "var(--twilio-red, #e22)" }}>Agent PM</span>
              <span style={{ display: "flex", gap: 3 }}>
                {[0,1,2].map(i => <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--twilio-red, #e22)", display: "inline-block", animation: `tfDot 1.2s ease-in-out ${i*0.2}s infinite` }} />)}
              </span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        {/* Input */}
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border, rgba(0,0,0,0.08))", display: "flex", gap: 8 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && void send()}
            placeholder="Ask about this email chain…"
            disabled={sending}
            style={{
              flex: 1, padding: "7px 11px", borderRadius: 7, fontSize: "0.875rem",
              border: "1px solid var(--border, rgba(0,0,0,0.15))", background: "var(--bg, #f5f5f5)",
              color: "var(--text-primary, #111)", outline: "none",
            }}
          />
          <button onClick={() => void send()} disabled={sending || !input.trim()} style={{
            padding: "7px 14px", borderRadius: 7, fontSize: "0.875rem", fontWeight: 600,
            background: "var(--twilio-red, #e22)", color: "#fff", border: "none",
            cursor: sending || !input.trim() ? "not-allowed" : "pointer", opacity: sending || !input.trim() ? 0.6 : 1,
          }}>Send</button>
        </div>
      </div>
    </div>
  );
}

function ThreadCard({ thread, isExpanded, onToggle, onChat }: {
  thread: GmailThread; isExpanded: boolean; onToggle: () => void; onChat: () => void;
}) {
  const color = STATUS_COLORS[thread.status_color] ?? STATUS_COLORS.gray;
  return (
    <div style={{
      minWidth: 260, maxWidth: 300, flexShrink: 0, borderRadius: 10,
      border: `1px solid ${isExpanded ? "var(--twilio-red, #e22)" : "var(--border, rgba(0,0,0,0.1))"}`,
      background: "var(--surface, #fff)", cursor: "pointer",
      boxShadow: isExpanded ? "0 0 0 2px rgba(226,35,26,0.18)" : "0 1px 4px rgba(0,0,0,0.06)",
      transition: "box-shadow 0.15s, border-color 0.15s",
    }}>
      <div style={{ padding: "14px 14px 10px" }} onClick={onToggle}>
        {/* Status + chat icon row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <EmailStatusBadge status={thread.status} color={thread.status_color} />
          <button
            onClick={e => { e.stopPropagation(); onChat(); }}
            title="Chat about this thread"
            style={{
              background: "rgba(226,35,26,0.07)", border: "none", borderRadius: 6,
              padding: "4px 7px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
              color: "var(--twilio-red, #e22)", fontSize: "0.6875rem", fontWeight: 600,
            }}
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 2h12v9H9l-3 3v-3H2V2z"/>
            </svg>
            Chat
          </button>
        </div>
        {/* Subject */}
        <p style={{ margin: "0 0 5px", fontSize: "0.8125rem", fontWeight: 700, color: "var(--text-primary, #111)", lineHeight: 1.35,
          overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
          {thread.subject}
        </p>
        {/* Summary */}
        <p style={{ margin: "0 0 8px", fontSize: "0.75rem", color: "var(--text-secondary, #666)", lineHeight: 1.45,
          overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
          {thread.summary || thread.snippet}
        </p>
        {/* Next action */}
        {thread.next_action && (
          <p style={{ margin: "0 0 8px", fontSize: "0.6875rem", padding: "4px 8px", borderRadius: 5,
            background: color.bg, color: color.text, lineHeight: 1.4 }}>
            → {thread.next_action}
          </p>
        )}
        {/* Meta row */}
        <div style={{ display: "flex", gap: 10, fontSize: "0.6875rem", color: "var(--text-secondary, #aaa)" }}>
          <span>{thread.message_count} msg{thread.message_count !== 1 ? "s" : ""}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {thread.participants.slice(0, 2).join(", ")}
          </span>
        </div>
      </div>
      {/* Expand chevron */}
      <div style={{ padding: "4px 14px 8px", textAlign: "right" }} onClick={onToggle}>
        <span style={{ fontSize: "0.6875rem", color: "var(--text-secondary, #aaa)" }}>
          {isExpanded ? "▲ collapse" : "▼ view thread"}
        </span>
      </div>
    </div>
  );
}

function ThreadExpanded({ thread, searchTerm }: { thread: GmailThread; searchTerm: string }) {
  const highlight = (text: string) => {
    if (!searchTerm.trim()) return text;
    const re = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    return text.replace(re, "**$1**");
  };

  return (
    <div style={{
      borderRadius: 10, border: "1px solid var(--border, rgba(0,0,0,0.1))",
      background: "var(--bg, #f5f5f5)", padding: "16px 20px",
      display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <p style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-primary, #111)", flex: 1 }}>
          {thread.subject}
        </p>
        <EmailStatusBadge status={thread.status} color={thread.status_color} />
        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary, #aaa)" }}>
          {thread.message_count} messages · {thread.participants.join(", ")}
        </span>
      </div>
      {thread.summary && (
        <p style={{ margin: 0, padding: "10px 14px", borderRadius: 7, fontSize: "0.8125rem", lineHeight: 1.55,
          background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))",
          color: "var(--text-primary, #111)" }}>
          <strong>Summary:</strong> {thread.summary}
        </p>
      )}
      {thread.messages.map((m, i) => {
        const body = highlight(m.body);
        const parts = body.split(/(\*\*[^*]+\*\*)/g);
        return (
          <div key={i} style={{
            padding: "12px 14px", borderRadius: 8, background: "var(--surface, #fff)",
            border: "1px solid var(--border, rgba(0,0,0,0.07))",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--twilio-navy, #121c2d)" }}>{m.from}</span>
              <span style={{ fontSize: "0.6875rem", color: "var(--text-secondary, #aaa)" }}>{m.date}</span>
            </div>
            <p style={{ margin: 0, fontSize: "0.8125rem", lineHeight: 1.55, color: "var(--text-primary, #111)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {parts.map((part, j) =>
                part.startsWith("**") && part.endsWith("**")
                  ? <mark key={j} style={{ background: "rgba(245,158,11,0.25)", borderRadius: 2, padding: "0 1px" }}>{part.slice(2,-2)}</mark>
                  : <React.Fragment key={j}>{part}</React.Fragment>
              )}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function EmailChainSection({ account }: { account: Account }) {
  const [threads, setThreads] = useState<GmailThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [chatThread, setChatThread] = useState<GmailThread | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [generatingOnePager, setGeneratingOnePager] = useState(false);

  const domain = account.website
    ? account.website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]
    : "";

  async function load(q?: string) {
    setLoading(true);
    setError(null);
    try {
      const { data } = await integrationsApi.getGmailThreads({
        account_domain: domain || undefined,
        account_name: account.company_name,
        q: q || undefined,
      });
      setThreads(data.threads);
      setLoaded(true);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? "Failed to load Gmail threads.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  function handleSearch(term: string) {
    setSearchTerm(term);
  }

  const filtered = searchTerm.trim()
    ? threads.filter(t =>
        t.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.summary?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.messages.some(m => m.body.toLowerCase().includes(searchTerm.toLowerCase()) || m.from.toLowerCase().includes(searchTerm.toLowerCase()))
      )
    : threads;

  async function generateOnePager() {
    if (!threads.length) return;
    setGeneratingOnePager(true);
    try {
      const lines: string[] = [
        `# Email Chain Status Report — ${account.company_name}`,
        `_Generated ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}_`,
        "",
        "## Summary",
        "",
      ];
      for (const t of threads) {
        const c = STATUS_COLORS[t.status_color] ?? STATUS_COLORS.gray;
        void c;
        lines.push(`### ${t.subject}`);
        lines.push(`**Status:** ${t.status}  `);
        lines.push(`**Participants:** ${t.participants.join(", ")}  `);
        lines.push(`**Messages:** ${t.message_count}  `);
        lines.push("");
        if (t.summary) lines.push(t.summary);
        if (t.next_action) lines.push(`**Next action:** ${t.next_action}`);
        lines.push("");
      }
      const md = lines.join("\n");
      const blob = new Blob([md], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${account.company_name.toLowerCase().replace(/\s+/g, "-")}-email-status-${new Date().toISOString().slice(0,10)}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setGeneratingOnePager(false);
    }
  }

  return (
    <div style={{ padding: "20px 24px", borderTop: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
      {/* Section header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-primary, #111)" }}>
            Email Chain Summary &amp; Status
          </h3>
          <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "var(--text-secondary, #888)" }}>
            Gmail threads related to {account.company_name}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {loaded && (
            <div style={{ position: "relative" }}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"
                style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--text-secondary, #aaa)", pointerEvents: "none" }}>
                <circle cx="6.5" cy="6.5" r="4.5"/><path d="M10.5 10.5L14 14" strokeLinecap="round"/>
              </svg>
              <input
                value={searchTerm}
                onChange={e => handleSearch(e.target.value)}
                placeholder="Search threads…"
                style={{
                  paddingLeft: 28, paddingRight: 10, paddingTop: 5, paddingBottom: 5,
                  borderRadius: 6, fontSize: "0.8125rem", border: "1px solid var(--border, rgba(0,0,0,0.12))",
                  background: "var(--surface, #fff)", outline: "none", width: 180,
                  color: "var(--text-primary, #111)",
                }}
              />
            </div>
          )}
          {!loaded ? (
            <button
              onClick={() => void load()}
              disabled={loading}
              style={{
                padding: "6px 14px", borderRadius: 7, fontSize: "0.8125rem", fontWeight: 600,
                background: "var(--twilio-red, #e22)", color: "#fff", border: "none",
                cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1,
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              {loading ? (
                <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: "spin 1s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Loading…</>
              ) : (
                <><svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M0 4a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H2a2 2 0 01-2-2V4zm2 0v.217l6 3.6 6-3.6V4H2zm12 1.383l-5.646 3.388a.5.5 0 01-.708 0L2 5.383V12h12V5.383z"/></svg>Load Gmail Threads</>
              )}
            </button>
          ) : (
            <button
              onClick={() => void load(searchTerm || undefined)}
              disabled={loading}
              style={{
                padding: "6px 12px", borderRadius: 7, fontSize: "0.8125rem", fontWeight: 600,
                background: "transparent", color: "var(--text-secondary, #666)", border: "1px solid var(--border, rgba(0,0,0,0.15))",
                cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? "↻ Refreshing…" : "↻ Refresh"}
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(239,68,68,0.08)", color: "#dc2626",
          border: "1px solid rgba(239,68,68,0.2)", fontSize: "0.875rem", marginBottom: 14 }}>
          {error}
        </div>
      )}

      {/* Empty / not loaded state */}
      {!loaded && !loading && !error && (
        <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-secondary, #aaa)", fontSize: "0.875rem" }}>
          Click <strong>Load Gmail Threads</strong> to fetch and summarise email chains for this account.
        </div>
      )}

      {loaded && !loading && filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text-secondary, #aaa)", fontSize: "0.875rem" }}>
          {searchTerm ? `No threads match "${searchTerm}"` : "No email threads found for this account."}
        </div>
      )}

      {/* Horizontal card scroll */}
      {filtered.length > 0 && (
        <div style={{ overflowX: "auto", paddingBottom: 8 }}>
          <div style={{ display: "flex", gap: 12, minWidth: "max-content", paddingBottom: 4 }}>
            {filtered.map(t => (
              <ThreadCard
                key={t.id}
                thread={t}
                isExpanded={expandedId === t.id}
                onToggle={() => setExpandedId(expandedId === t.id ? null : t.id)}
                onChat={() => setChatThread(t)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Expanded thread detail */}
      {expandedId && (() => {
        const t = filtered.find(th => th.id === expandedId);
        if (!t) return null;
        return (
          <div style={{ marginTop: 14 }}>
            <ThreadExpanded thread={t} searchTerm={searchTerm} />
          </div>
        );
      })()}

      {/* One-pager button */}
      {loaded && threads.length > 0 && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border, rgba(0,0,0,0.07))", display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={() => void generateOnePager()}
            disabled={generatingOnePager}
            style={{
              padding: "8px 18px", borderRadius: 7, fontSize: "0.875rem", fontWeight: 600,
              background: "var(--twilio-navy, #121c2d)", color: "#fff", border: "none",
              cursor: generatingOnePager ? "not-allowed" : "pointer", opacity: generatingOnePager ? 0.7 : 1,
              display: "flex", alignItems: "center", gap: 7,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 14a1 1 0 001 1h10a1 1 0 001-1V5l-4-4H3a1 1 0 00-1 1v12zm9-9h2.5L11 2.5V5zM8 7v4m0 0l-1.5-1.5M8 11l1.5-1.5"/>
            </svg>
            {generatingOnePager ? "Generating…" : "Download Status One-Pager"}
          </button>
        </div>
      )}

      {/* Thread chat modal */}
      {chatThread && <ThreadChatPanel thread={chatThread} onClose={() => setChatThread(null)} />}
    </div>
  );
}

function MeetingTimelineBtn({
  m,
  isPast,
  onSelectMeeting,
}: {
  m: AirtableMeeting;
  isPast: boolean;
  onSelectMeeting: (m: AirtableMeeting) => void;
}) {
  const { onContextMenu } = useRightClickComment("meeting", m.id, m.name);
  return (
    <button
      onClick={() => onSelectMeeting(m)}
      onContextMenu={onContextMenu}
      title={m.name || "Meeting"}
      style={{
        background: isPast ? "rgba(226,34,34,0.07)" : "rgba(226,34,34,0.12)",
        border: "1px solid rgba(226,34,34,0.2)",
        borderRadius: "4px",
        padding: "3px 5px",
        fontSize: "0.625rem",
        fontWeight: 500,
        color: "var(--twilio-red, #e22)",
        textAlign: "left",
        cursor: "pointer",
        opacity: isPast ? 0.65 : 1,
        overflow: "hidden",
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
        maxWidth: "100%",
      }}
    >
      {m.name || "Meeting"}
      {/* A badge, not a button — the chip itself is the button, and right-click on it
          opens the thread. */}
      <CommentCountBadge resourceType="meeting" resourceId={m.id} className="ml-1 align-middle" />
    </button>
  );
}

function CalEventTimelineBtn({
  ev,
  isPast,
  onSelectCalEvent,
}: {
  ev: CalendarEvent;
  isPast: boolean;
  onSelectCalEvent: (ev: CalendarEvent) => void;
}) {
  const { onContextMenu } = useRightClickComment("calendar_event", ev.id, ev.title);
  return (
    <button
      className="card-btn"
      onClick={() => onSelectCalEvent(ev)}
      onContextMenu={onContextMenu}
      title={ev.title}
      style={{
        background: isPast ? "rgba(14,165,233,0.06)" : "rgba(14,165,233,0.12)",
        border: "1px solid rgba(14,165,233,0.2)",
        borderRadius: "4px",
        padding: "3px 5px",
        fontSize: "0.625rem",
        fontWeight: 500,
        color: "#0ea5e9",
        textAlign: "left",
        cursor: "pointer",
        opacity: isPast ? 0.65 : 1,
        overflow: "hidden",
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
        maxWidth: "100%",
      }}
    >
      {ev.title}
      <CommentCountBadge resourceType="calendar_event" resourceId={ev.id} className="ml-1 align-middle" />
    </button>
  );
}

function renderInline(text: string): React.ReactNode {
  // Handle **bold** markers inline
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part
  );
}
