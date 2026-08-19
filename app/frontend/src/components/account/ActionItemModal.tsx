import React, { useEffect, useRef, useState } from "react";
import CorporateIcon from "../../assets/icons/Corporate.svg?react";
import { airtableApi } from "../../lib/api";
import type { ActionItemAttachment, AirtableActionItem, AirtableMeeting, TeamMember } from "../../types";
import { useActionItemFieldOptions } from "../../hooks/useActionItemFieldOptions";
import CommentTrigger from "../comments/CommentTrigger";
import CommentPreviewList from "../comments/CommentPreviewList";
import { AccPillSelect, AccPillDate, AccPillNumber, AccPillUrl } from "../shared/PillInputs";
import { ActionItemCardOccurrences } from "./ActionItemCardOccurrences";
import StepsPanel from "../action-items/StepsPanel";
import { convertActionItemToEvent, restoreConversion } from "../../hooks/useConvert";
import ActivityLogSection from "../ActivityLogSection";
import { ArtifactIconImg, CATALOG_BY_KEY, getAutoIconKey } from "./ArtifactIcon";
import ArtifactPicker from "../action-items/ArtifactPicker";

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
  onConverted,
  onDeleted,
}: {
  item: AirtableActionItem;
  accountId?: number;
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ActionItemAttachment[]>(item.attachments ?? []);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const attachFileRef = useRef<HTMLInputElement>(null);
  const memberNames = ["Unassigned", ...teamMembers.map((m) => m.full_name)] as string[];

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

          {/* Description. Steps have their own Checklist section below, so the placeholder
              no longer invites writing them here as prose. */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)] mb-1.5">
              Description
            </p>
            <textarea
              value={form.task_details ?? ""}
              onChange={(e) => set({ task_details: e.target.value })}
              rows={3}
              placeholder="Additional context or notes…"
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-[var(--twilio-navy)] placeholder:text-[var(--twilio-gray-60)] focus:bg-white focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-100 transition-colors resize-none"
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
                  <button
                    onClick={() => { setLinkFormOpen((v) => !v); }}
                    className="text-[11px] px-2 py-0.5 rounded border border-gray-200 text-[var(--twilio-navy)] hover:bg-gray-50 transition-colors"
                  >+ Link</button>
                  <ArtifactPicker
                    actionItemId={item.id}
                    accountName={item.account_name}
                    accountId={accountId}
                    onAttached={(a) => { setAttachments((prev) => [a, ...prev]); setLinkFormOpen(false); }}
                    onError={setAttachError}
                  />
                  <input ref={attachFileRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && void handleAttachFiles(e.target.files)} />
                </div>
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
            </div>
          )}

          <ActionItemCardOccurrences airtableId={item.airtable_id} />

          {/* Comments — the latest few, in place. The panel behind the header icon is
              still where you read the full thread and reply; this exists so an item
              with a conversation on it doesn't look identical to one without. */}
          {!item.airtable_id.startsWith("local-") && (
            <CommentPreviewList
              resourceType="action_item"
              resourceId={item.id}
              resourceLabel={item.task ?? ""}
              variant="panel"
            />
          )}

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
    </div>
  );
}
