import React, { useEffect, useId, useRef, useState } from "react";
import { useStatusLabels } from "../../hooks/useStatusLabels";
import { createPortal } from "react-dom";
import CorporateIcon from "../../assets/icons/Corporate.svg?react";
import { airtableApi } from "../../lib/api";
import type { ActionItemAttachment, AirtableActionItem, AirtableMeeting, TeamMember } from "../../types";
import { useActionItemFieldOptions } from "../../hooks/useActionItemFieldOptions";
import { useSlackLinkAutosave } from "../../hooks/useSlackLinkAutosave";
import CommentTrigger from "../comments/CommentTrigger";
import CommentPreviewList from "../comments/CommentPreviewList";
import { AccPillSelect, AccPillDate, AccPillNumber, AccPillUrl } from "../shared/PillInputs";
import { ActionItemCardOccurrences } from "./ActionItemCardOccurrences";
import StepsPanel from "../action-items/StepsPanel";
import { convertActionItemToEvent, restoreConversion } from "../../hooks/useConvert";
import { logActionItemUpdate, changedActionItemFields } from "../../lib/actionItemLog";
import ActivityLogSection from "../ActivityLogSection";
import ActionItemCalendarNotes from "./ActionItemCalendarNotes";
import { ArtifactIconImg, CATALOG_BY_KEY, getAutoIconKey } from "./ArtifactIcon";
import ArtifactPicker from "../action-items/ArtifactPicker";
import RichTextMentionEditor from "../shared/RichTextMentionEditor";

/** A visible field label. `htmlFor` ties it to a control; `id` lets a group be named by it. */
function FieldLabel({ htmlFor, id, children }: { htmlFor?: string; id?: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      id={id}
      className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)] mb-1"
    >
      {children}
    </label>
  );
}

const fmtStamp = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
    : "—";

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

const PRIORITY_ACCENT: Record<string, string> = {
  Critical: "#ef4444",
  High: "#f97316",
  Medium: "#0ea5e9",
  Low: "#9ca3af",
};

// ── Action Item display card (Stage Today style) ───────────────────────────────

export function ActionItemModal({
  item,
  accountId,
  teamMembers = [],
  meetings = [],
  onClose,
  onUpdated,
  onAutosaved,
  onConverted,
  onDeleted,
}: {
  item: AirtableActionItem;
  accountId?: number;
  teamMembers?: TeamMember[];
  meetings?: AirtableMeeting[];
  onClose: () => void;
  onUpdated?: (updated: AirtableActionItem) => void;
  /** Fires for a pasted Slack link, which saves itself without waiting for Save — see
   *  hooks/useSlackLinkAutosave.ts. Distinct from `onUpdated`: callers close the modal in
   *  response to `onUpdated` (the explicit Save button), and a paste must not trigger that. */
  onAutosaved?: (updated: AirtableActionItem) => void;
  onConverted?: () => void;
  onDeleted?: (id: number) => void;
}) {
  const uid = useId();
  const ids = {
    task: `${uid}-task`, priority: `${uid}-priority`, status: `${uid}-status`, due: `${uid}-due`,
    prep: `${uid}-prep`, assignee: `${uid}-assignee`, account: `${uid}-account`, meeting: `${uid}-meeting`,
    est: `${uid}-est`, spent: `${uid}-spent`, detailsLabel: `${uid}-details`, activityLabel: `${uid}-activity`,
    created: `${uid}-created`, updated: `${uid}-updated`,
  };
  const isLocal = item.airtable_id.startsWith("local-");
  const { status: statusOptions } = useActionItemFieldOptions();
  const { label: statusLabel } = useStatusLabels();
  const [form, setForm] = useState<Partial<AirtableActionItem>>({ ...item });
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ActionItemAttachment[]>(item.attachments ?? []);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const attachFileRef = useRef<HTMLInputElement>(null);
  const memberNames = ["Unassigned", ...teamMembers.map((m) => m.full_name)] as string[];

  // Dragging OS files anywhere onto the modal attaches them, same as the + File button.
  // A local-* draft has no PK for an attachment to hang off, same guard the Attachments
  // section itself uses.
  const [fileDragOver, setFileDragOver] = useState(false);
  const fileDragCounterRef = useRef(0);
  const canAttachFiles = !item.airtable_id.startsWith("local-");

  // Link form
  const [linkFormOpen, setLinkFormOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkName, setLinkName] = useState("");
  const [savingLink, setSavingLink] = useState(false);

  // Artifact dropdown

  useEffect(() => {
    if (item.airtable_id.startsWith("local-")) return;
    airtableApi.listAttachments(item.id).then(({ data }) => setAttachments(data)).catch(() => {});
  }, [item.id, item.airtable_id]);

  const accent = PRIORITY_ACCENT[form.priority ?? item.priority] ?? "#9ca3af";
  const set = (patch: Partial<AirtableActionItem>) => setForm((f) => ({ ...f, ...patch }));
  // A pasted Slack link saves on its own — see hooks/useSlackLinkAutosave.ts.
  const autosaveSlackLink = useSlackLinkAutosave();

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await airtableApi.deleteActionItem(item.id);
      onDeleted?.(item.id);
      onClose();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string; error?: string } } })?.response?.data?.detail ??
        (err as { response?: { data?: { detail?: string; error?: string } } })?.response?.data?.error ??
        "Delete failed. Please try again.";
      setDeleteError(msg);
    } finally {
      setDeleting(false);
    }
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const changes = changedActionItemFields(item, form);
      const { data } = await airtableApi.updateActionItemFields(item.airtable_id, changes);
      logActionItemUpdate(item, changes);
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

  /** Pull a human-readable message off an axios error, whatever shape the API used. */
  function attachErrorMessage(err: unknown, fallback: string): string {
    const data = (err as { response?: { data?: { detail?: string; error?: string } } })?.response?.data;
    return data?.detail ?? data?.error ?? fallback;
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
        // Never swallow this: a silent failure here looks exactly like "I picked a file and
        // nothing happened", which is precisely how this bug went unnoticed.
        failed.push(f.name);
        lastError = err;
      }
    }
    if (failed.length) {
      setAttachError(
        `${attachErrorMessage(lastError, "Upload failed.")} (${failed.join(", ")})`
      );
    }
    setUploadingAttachment(false);
  }

  async function handleDeleteAttachment(attachId: number) {
    setAttachError(null);
    try {
      await airtableApi.deleteAttachment(item.id, attachId);
      setAttachments((prev) => prev.filter((a) => a.id !== attachId));
    } catch (err: unknown) {
      setAttachError(attachErrorMessage(err, "Could not remove that attachment."));
    }
  }

  async function handleAddLink() {
    const url = linkUrl.trim();
    if (!url) return;
    setSavingLink(true);
    setAttachError(null);
    try {
      const { data } = await airtableApi.addAttachmentLink(item.id, linkName.trim() || url, url);
      setAttachments((prev) => [data, ...prev]);
      setLinkUrl("");
      setLinkName("");
      setLinkFormOpen(false);
    } catch (err: unknown) {
      setAttachError(attachErrorMessage(err, "Could not add that link."));
    } finally {
      setSavingLink(false);
    }
  }

  // Portalled to <body>: a `transform` on any ancestor (e.g. CalendarPage's sliding
  // items sidebar) makes `position: fixed` resolve against that ancestor, which
  // squeezed the modal into the sidebar's width instead of centring it on the page.
  return createPortal(
    <div
      className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        data-testid="action-item-modal-panel"
        className="relative rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ background: "var(--surface-card)", width: "760px", maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 48px)", borderLeft: `4px solid ${accent}` }}
        onClick={(e) => e.stopPropagation()}
        // The modal isn't a portal, so a drag/drop over it would otherwise bubble to the
        // kanban board's own drop zones underneath (handleKanbanDrop, handleNoteDropOnActions
        // etc.), which assume a real DataTransfer carrying their own custom keys.
        onDragEnter={(e) => {
          e.stopPropagation();
          if (!canAttachFiles || !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          fileDragCounterRef.current += 1;
          if (fileDragCounterRef.current === 1) setFileDragOver(true);
        }}
        onDragOver={(e) => {
          e.stopPropagation();
          if (!canAttachFiles || !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
        }}
        onDragLeave={(e) => {
          e.stopPropagation();
          if (fileDragCounterRef.current === 0) return;
          fileDragCounterRef.current -= 1;
          if (fileDragCounterRef.current <= 0) { fileDragCounterRef.current = 0; setFileDragOver(false); }
        }}
        onDrop={(e) => {
          e.stopPropagation();
          if (!canAttachFiles) return;
          e.preventDefault();
          fileDragCounterRef.current = 0;
          setFileDragOver(false);
          if (e.dataTransfer.files.length) void handleAttachFiles(e.dataTransfer.files);
        }}
      >
        {fileDragOver && (
          <div className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-indigo-400 bg-indigo-50/70 pointer-events-none">
            <p className="text-sm font-bold text-indigo-600">Drop files to attach</p>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: "1px solid rgba(0,0,0,0.07)" }}>
          <h2 className="text-sm font-semibold text-[var(--twilio-navy)]">Action item</h2>
          <div className="flex items-center gap-1.5 shrink-0">
            <CommentTrigger
              resourceType="action_item"
              resourceId={item.id}
              resourceLabel={item.task ?? ""}
              disabled={isLocal}
            />
            <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 text-xl leading-none transition-colors">×</button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Row 1 — Task */}
          <div data-row="task">
            <FieldLabel htmlFor={ids.task}>Task</FieldLabel>
            <textarea
              id={ids.task}
              autoFocus
              value={form.task ?? ""}
              onChange={(e) => set({ task: e.target.value })}
              placeholder="Task name…"
              rows={2}
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-[var(--twilio-navy)] placeholder:text-[var(--twilio-gray-60)] focus:bg-white focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-100 resize-none leading-snug"
              style={{ overflow: "hidden", fieldSizing: "content" } as React.CSSProperties}
            />
          </div>

          {/* Rows 2-4 — one 3 x 3 grid:
              Priority | Status | Due Date
              Prep     | Assignee | Account
              Est. Time (min) | Time Spent | Slack */}
          <div data-row="fields" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <FieldLabel htmlFor={ids.priority}>Priority</FieldLabel>
              <AccPillSelect
                id={ids.priority}
                value={form.priority}
                options={["Critical", "High", "Medium", "Low"] as const}
                colorMap={NEW_AI_PRIORITY_COLORS}
                placeholder="Priority"
                onChange={(v) => set({ priority: v })}
              />
            </div>
            <div>
              <FieldLabel htmlFor={ids.status}>Status</FieldLabel>
              <AccPillSelect
                id={ids.status}
                value={form.status}
                options={statusOptions as AirtableActionItem["status"][]}
                format={statusLabel}
                colorMap={NEW_AI_STATUS_COLORS}
                placeholder="Status"
                onChange={(v) => set({ status: v })}
              />
            </div>
            <div>
              <FieldLabel htmlFor={ids.due}>Due Date</FieldLabel>
              <AccPillDate id={ids.due} value={form.due_date} onChange={(v) => set({ due_date: v })} />
            </div>
            <div>
              <FieldLabel htmlFor={ids.prep}>Prep</FieldLabel>
              <AccPillNumber id={ids.prep} value={form.prep_time} label="Set" onChange={(v) => set({ prep_time: v ?? 0 })} />
            </div>
            <div>
              <FieldLabel htmlFor={ids.assignee}>Assignee</FieldLabel>
              {teamMembers.length > 0 ? (
                <AccPillSelect
                  id={ids.assignee}
                  value={(form.assignee_name || "Unassigned") as string}
                  options={memberNames as string[]}
                  colorMap={{}}
                  placeholder="Unassigned"
                  onChange={(v) => {
                    const member = teamMembers.find((m) => m.full_name === v);
                    set({ assignee_airtable_id: member ? String(member.id) : "", assignee_name: member?.full_name ?? "" });
                  }}
                />
              ) : (
                <output id={ids.assignee} className="text-xs text-[var(--twilio-navy)]">{item.assignee_name || "Unassigned"}</output>
              )}
            </div>
            <div>
              <FieldLabel htmlFor={ids.account}>Account</FieldLabel>
              <output id={ids.account} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--twilio-navy)] bg-gray-100 px-2 py-0.5 rounded-full">
                {item.account_name && <CorporateIcon width={10} height={10} className="shrink-0 opacity-60" />}
                {item.account_name || "—"}
              </output>
            </div>

            <div>
              <FieldLabel htmlFor={ids.est}>Est. Time (min)</FieldLabel>
              <AccPillNumber id={ids.est} value={form.estimated_time} label="Set" onChange={(v) => set({ estimated_time: v ?? 0 })} />
            </div>
            <div>
              <FieldLabel htmlFor={ids.spent}>Time Spent</FieldLabel>
              <AccPillNumber id={ids.spent} value={form.time_spent} label="Set" onChange={(v) => set({ time_spent: v ?? 0 })} />
            </div>
            <div>
              <FieldLabel>Slack</FieldLabel>
              {/* A pasted link saves on its own (hooks/useSlackLinkAutosave.ts), not with Save. */}
              <AccPillUrl
                value={form.slack_thread_url}
                onChange={(v) => { set({ slack_thread_url: v }); autosaveSlackLink(item, v, onAutosaved); }}
              />
            </div>
          </div>

          {/* Pin to meeting — an extra for Done items, kept with the people/time fields */}
          {(form.status === "Done" || item.status === "Done") && meetings.length > 0 && (
              <div>
                <FieldLabel htmlFor={ids.meeting}>Pin to meeting</FieldLabel>
                <select
                  id={ids.meeting}
                  value={form.linked_meeting ?? ""}
                  onChange={(e) => set({ linked_meeting: e.target.value ? Number(e.target.value) : null })}
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-[var(--twilio-navy)] focus:bg-white focus:border-indigo-400 focus:outline-none"
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


          {/* Row 5 — Details (rich text). Steps have their own Checklist section below. */}
          <div data-row="details">
            <FieldLabel id={ids.detailsLabel}>Details</FieldLabel>
            <div role="group" aria-labelledby={ids.detailsLabel}>
              <RichTextMentionEditor
                value={form.task_details ?? ""}
                onChange={(html) => set({ task_details: html })}
                placeholder="Additional context or notes…"
                minHeightClassName="min-h-[72px]"
              />
            </div>
          </div>

          {/* Row 6 — Checklist. Real Airtable items only: steps key off the numeric PK,
              which a local-* draft lacks until promoted. */}
          {!isLocal && (
            <div data-row="checklist" className="pt-3 border-t border-gray-100">
              <StepsPanel actionItemId={item.id} />
            </div>
          )}

          {/* Extras that have no slot in the row layout: calendar blocks, notes added under
              them, and the latest comments. */}
          <ActionItemCardOccurrences airtableId={item.airtable_id} />
          <ActionItemCalendarNotes airtableId={item.airtable_id} />
          {!isLocal && (
            <CommentPreviewList
              resourceType="action_item"
              resourceId={item.id}
              resourceLabel={item.task ?? ""}
              variant="panel"
            />
          )}

          {/* Row 7 — Attachments, with Activity stacked below it */}
          <div data-row="attachments-activity" className="grid grid-cols-1 gap-4">
            <div>
              {!isLocal ? (
                <>
                  <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                    <span className="text-xs font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)]">
                      Attachments{attachments.length > 0 && ` (${attachments.length})`}
                    </span>
                    {uploadingAttachment && <span className="text-[11px] text-gray-400 animate-pulse">Uploading…</span>}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap mb-2">
                    <button
                      type="button"
                      onClick={() => attachFileRef.current?.click()}
                      title="Click to pick a file, or drag a file from your computer anywhere onto this window"
                      className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-gray-200 text-[var(--twilio-navy)] hover:bg-gray-50 transition-colors"
                    >
                      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 shrink-0"><path d="M8 2v8M5 5l3-3 3 3" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 12h12" strokeLinecap="round"/></svg>
                      Upload
                    </button>
                    <button
                      type="button"
                      onClick={() => { setLinkFormOpen((v) => !v); }}
                      className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-gray-200 text-[var(--twilio-navy)] hover:bg-gray-50 transition-colors"
                    >
                      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 shrink-0"><path d="M6 9a3 3 0 0 0 4.5.4l1.5-1.5a3 3 0 0 0-4.2-4.2L6.5 5" strokeLinecap="round"/><path d="M10 7a3 3 0 0 0-4.5-.4L4 8.1a3 3 0 0 0 4.2 4.2l1.3-1.3" strokeLinecap="round"/></svg>
                      Add Link
                    </button>
                    <ArtifactPicker
                      actionItemId={item.id}
                      accountName={item.account_name}
                      accountId={accountId}
                      onAttached={(a) => { setAttachments((prev) => [a, ...prev]); setLinkFormOpen(false); }}
                      onError={setAttachError}
                    />
                    <input ref={attachFileRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && void handleAttachFiles(e.target.files)} />
                  </div>
              {/* Inline link form */}
              {linkFormOpen && (
                <div className="mb-2 flex flex-col gap-1.5">
                  <input
                    autoFocus
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://…"
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-[var(--twilio-navy)] focus:bg-white focus:border-indigo-400 focus:outline-none"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleAddLink();
                      if (e.key === "Escape") { setLinkFormOpen(false); setLinkUrl(""); setLinkName(""); }
                    }}
                  />
                  <input
                    value={linkName}
                    onChange={(e) => setLinkName(e.target.value)}
                    placeholder="Display name (optional)"
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-[var(--twilio-navy)] focus:bg-white focus:border-indigo-400 focus:outline-none"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleAddLink();
                      if (e.key === "Escape") { setLinkFormOpen(false); setLinkUrl(""); setLinkName(""); }
                    }}
                  />
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => void handleAddLink()}
                      disabled={savingLink || !linkUrl.trim()}
                      className="flex-1 text-xs font-semibold py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                    >Add</button>
                    <button
                      onClick={() => { setLinkFormOpen(false); setLinkUrl(""); setLinkName(""); }}
                      className="flex-1 text-xs font-semibold py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
                    >Cancel</button>
                  </div>
                </div>
              )}

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
                    const iconEntry = a.artifact_type === "link" && href
                      ? (CATALOG_BY_KEY[getAutoIconKey(href)] ?? CATALOG_BY_KEY["link"])
                      : null;
                    return (
                      <div key={a.id} className="flex items-center gap-2 text-xs bg-gray-50 rounded-lg px-3 py-1.5">
                        {iconEntry ? (
                          <span className="shrink-0 flex items-center"><ArtifactIconImg entry={iconEntry} size={14} /></span>
                        ) : (
                          <span className="shrink-0">📎</span>
                        )}
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
                </>
              ) : (
                <>
                  <FieldLabel>Attachments</FieldLabel>
                  <p className="text-xs text-gray-400 italic">Save the item to add attachments.</p>
                </>
              )}
            </div>

            {/* Activity */}
            <div>
              <FieldLabel id={ids.activityLabel}>Activity</FieldLabel>
              <div role="group" aria-labelledby={ids.activityLabel}>
                <ActivityLogSection
                  resourceType="action_item"
                  resourceId={item.airtable_id}
                  variant="inline"
                  onRestore={async (rd) => { await restoreConversion(rd); onConverted?.(); onClose(); }}
                />
              </div>
            </div>
          </div>

          {/* Row 8 — Created, Updated (read-only) */}
          {!isLocal && (
            <div data-row="timestamps" className="pt-3 border-t border-gray-100 grid grid-cols-2 gap-3">
              <div>
                <FieldLabel htmlFor={ids.created}>Created</FieldLabel>
                <output id={ids.created} className="text-[11px] text-[var(--twilio-gray-60)]">{fmtStamp(item.created_at)}</output>
              </div>
              <div>
                <FieldLabel htmlFor={ids.updated}>Updated</FieldLabel>
                <output id={ids.updated} className="text-[11px] text-[var(--twilio-gray-60)]">{fmtStamp(item.updated_at)}</output>
              </div>
              {item.marked_done_at && (
                <div className="col-span-2 text-[11px] text-emerald-600">
                  <span className="font-semibold uppercase tracking-wide">Completed</span> {fmtStamp(item.marked_done_at)}
                </div>
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
          <div className={`flex justify-between ${confirmDelete ? "items-start" : "items-center"}`}>
            <div className="flex items-center gap-3">
              {confirmDelete ? (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-red-600 font-medium">Delete this item?</span>
                    <button
                      onClick={() => void handleDelete()}
                      disabled={deleting}
                      className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 transition-colors"
                    >
                      {deleting ? "Deleting…" : "Yes, delete"}
                    </button>
                    <button
                      onClick={() => { setConfirmDelete(false); setDeleteError(null); }}
                      className="text-xs font-medium px-2.5 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                  {deleteError && <span className="text-xs text-red-600">{deleteError}</span>}
                </div>
              ) : (
                <>
                  <button
                    onClick={() => setConfirmDelete(true)}
                    title="Delete action item"
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
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
                </>
              )}
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
    </div>,
    document.body,
  );
}
