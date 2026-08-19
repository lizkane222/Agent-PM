import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fileIcon, fmtBytes, dueDateGroup } from "twilio-agent-pm-shared";
import { airtableApi, accountsApi, schedulerApi, teamApi, searchApi } from "../lib/api";
import type { SearchResult } from "../lib/api";
import CommentTrigger from "../components/comments/CommentTrigger";
import CommentPreviewList from "../components/comments/CommentPreviewList";
import { useCommentMenuItem } from "../components/comments/commentMenuItem";
import type { ActionItemAttachment, ActionItemDependency, AirtableActionItem, AirtableAccount, CalendarEvent, TeamMember, UserProfile } from "../types";
import { addLog } from "../lib/appLog";
import { logActionItemUpdate } from "../lib/actionItemLog";
import { convertActionItemToEvent, restoreConversion } from "../hooks/useConvert";
import { useLogGlow } from "../hooks/useLogGlow";
import { useScheduledOccurrences } from "../hooks/useScheduledOccurrences";
import { useActionItemFieldOptions } from "../hooks/useActionItemFieldOptions";
import ChecklistIcon from "../assets/icons/Checklist.svg?react";
import CorporateIcon from "../assets/icons/Corporate.svg?react";

// Google's favicon API returns the generic G for all google.com subdomains.
// Use stable gstatic CDN URLs for Google products; generic favicon API for everything else.
function getLinkFaviconSrc(href: string): string | null {
  try {
    const parsed = new URL(href);
    const h = parsed.hostname.replace(/^www\./, "");
    const p = parsed.pathname;
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
    return `https://www.google.com/s2/favicons?sz=32&domain=${h}`;
  } catch { return null; }
}
import { useExport } from "../context/ExportContext";
import { useExportTray } from "../hooks/useExportTray";
import { useAppError } from "../context/AppErrorContext";
import { ContextMenu, FocusPinBadge, focusPinMenuItem, type ContextMenuItem } from "../components/action-items/ContextMenu";
import StepsPanel from "../components/action-items/StepsPanel";
import ArtifactPicker from "../components/action-items/ArtifactPicker";
import { useFocusPins } from "../hooks/useFocusPins";
import {
  useAccountGroupCollapse,
  accountGroupKey,
  NO_ACCOUNT_GROUP_KEY,
  UNMATCHED_GROUP_KEY,
} from "../hooks/useAccountGroupCollapse";
import { useCardCollapse } from "../hooks/useCardCollapse";
import ActivityLogSection from "../components/ActivityLogSection";
import RichTextMentionEditor from "../components/shared/RichTextMentionEditor";
import UrlPillInput from "../components/shared/UrlPillInput";
import { useSlackLinkAutosave } from "../hooks/useSlackLinkAutosave";

// Unified account shape used in the kanban accounts zone.
// Airtable accounts get prefix "at-", app accounts get prefix "app-".
interface KanbanAccount {
  key: string;       // unique key across both sources
  id: number;        // original numeric id
  name: string;
  source: "airtable" | "app";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<AirtableActionItem["priority"], string> = {
  Critical: "bg-red-50 text-red-700 ring-1 ring-red-200",
  High: "bg-orange-50 text-orange-700 ring-1 ring-orange-200",
  Medium: "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
  Low: "bg-gray-100 text-[var(--twilio-navy)] ring-1 ring-gray-200",
};

const PRIORITY_ACCENT: Record<AirtableActionItem["priority"], string> = {
  Critical: "#ef4444",
  High: "#f97316",
  Medium: "#0ea5e9",
  Low: "#9ca3af",
};

const STATUS_COLORS: Record<string, string> = {
  "Open": "bg-gray-100 text-[var(--twilio-navy)]",
  "In Progress": "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
  "Done": "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  "Blocked": "bg-red-50 text-red-700 ring-1 ring-red-200",
  "Backlogged": "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
};

// Blank cards carry a throwaway `local-N` id that promoteBlankItem replaces with a real
// recXXX, so a pin recorded against one would be orphaned forever. Never offer to pin them.
function canPinItem(item: AirtableActionItem): boolean {
  return !item.airtable_id.startsWith("local-");
}

/**
 * How long to wait before a background refresh triggered by an `actionItemsUpdated`
 * broadcast actually runs, so a burst from one user action collapses into a single reload.
 */
const SILENT_RELOAD_DEBOUNCE_MS = 250;

/**
 * Compare two action-item field values, treating `null` / `undefined` / `""` as the same.
 *
 * Airtable hands back `""` where the app writes `null`, so a strict compare reports every
 * already-cleared field as changed — which would fire a redundant PATCH on every drop onto
 * the account a card is already filed under.
 */
function sameFieldValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v === null || v === undefined || v === "" ? null : v);
  return norm(a) === norm(b);
}

/**
 * Clear a row's drag highlight only when the pointer has really left it.
 *
 * `dragleave` bubbles from every child, so a bare handler fires as the cursor crosses from
 * the account label into the card strip and back — flipping the shared `dragOverZone` to
 * null and re-rendering the whole page on each crossing. That reads as an unresponsive drop
 * target and, with a tree this size, can cost the `drop` event itself.
 */
function leftElement(e: React.DragEvent): boolean {
  return !e.currentTarget.contains(e.relatedTarget as Node | null);
}

function fmtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ── Zones ─────────────────────────────────────────────────────────────────────

type Zone = "unstaged" | "today" | "active" | "complete" | "accounts" | "done-accounts" | `done-accounts-${string}`;

// Human-readable zone names, used in activity-log messages and the Pinned In Progress
// section's "where does this card live" pill.
const ZONE_LABELS: Partial<Record<Zone, string>> = {
  unstaged: "Unstaged",
  today: "Staged Today",
  active: "In Progress",
  complete: "Completed Today",
  accounts: "Views",
};

// Zones that actually render a panel. A stored zone outside this set would orphan the
// item — see load(), which re-defaults anything unrenderable.
const RENDERABLE_ZONES: Zone[] = ["unstaged", "today", "active", "accounts"];

// The two zones whose cards the user can hand-order by dragging.
type ReorderableZone = "today" | "active";
type ZoneOrderMap = Partial<Record<ReorderableZone, string[]>>;
const ACTION_ITEM_ORDER_KEY = "actionItemOrder";

function isReorderableZone(zone: Zone): zone is ReorderableZone {
  return zone === "today" || zone === "active";
}

/** Where a dragged card should land: above `beforeId`, or at the end when null. */
interface DropHint { zone: ReorderableZone; beforeId: string | null }

// Standard action-item card width, matching the `w-44` wrappers in the Views grid. Used by
// the Pinned In Progress row so pinned cards are card-sized rather than container-width.
const PINNED_CARD_WIDTH = "w-44";

interface TimerState {
  running: boolean;
  elapsed: number; // seconds accumulated this session
  startedAt: number | null; // Date.now() when last started
}

// ── Shared field form ─────────────────────────────────────────────────────────

const FIELD_INPUT = "w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-[var(--twilio-navy)] placeholder:text-[var(--twilio-gray-60)] focus:bg-white focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-100 transition-colors";

// ── Inline interactive pill components ────────────────────────────────────────

function PillSelect<T extends string>({
  value, options, colorMap, placeholder, onChange,
}: {
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
      <select
        ref={ref}
        value={value ?? ""}
        onChange={(e) => { onChange(e.target.value as T); setOpen(false); }}
        onBlur={() => setOpen(false)}
        onClick={(e) => e.stopPropagation()}
        className="rounded-full border border-indigo-400 bg-white px-2.5 py-0.5 text-[12px] font-semibold focus:outline-none cursor-pointer"
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold cursor-pointer hover:opacity-75 transition-opacity ${cls}`}
    >
      {value ?? placeholder}
      <svg viewBox="0 0 8 5" fill="currentColor" className="w-1.5 h-1.5 opacity-50"><path d="M0 0l4 5 4-5z"/></svg>
    </button>
  );
}

function PillNumber({ value, label, onChange }: {
  value: number | null | undefined;
  label: string;
  onChange: (v: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { ref.current?.focus(); ref.current?.select(); } }, [open]);
  const mins = value != null && value > 0 ? Math.round(value / 60) : null;
  if (open) {
    return (
      <input
        ref={ref}
        type="number" min={0}
        defaultValue={mins ?? ""}
        onBlur={(e) => { onChange(e.target.value !== "" ? Number(e.target.value) * 60 : null); setOpen(false); }}
        onClick={(e) => e.stopPropagation()}
        className="w-16 rounded-full border border-indigo-400 bg-white px-2.5 py-0.5 text-[12px] font-semibold focus:outline-none"
        placeholder="0"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold bg-gray-100 text-[var(--twilio-navy)] hover:opacity-75 transition-opacity cursor-pointer"
    >
      {mins != null ? `${mins}m` : label}
    </button>
  );
}

function PillDate({ value, onChange }: {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  const label = value
    ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "Due date";
  if (open) {
    return (
      <input
        ref={ref}
        type="date"
        defaultValue={value ? value.slice(0, 10) : ""}
        onBlur={(e) => { onChange(e.target.value || null); setOpen(false); }}
        onClick={(e) => e.stopPropagation()}
        className="rounded-full border border-indigo-400 bg-white px-2.5 py-0.5 text-[12px] font-semibold focus:outline-none"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold hover:opacity-75 transition-opacity cursor-pointer ${value ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200" : "bg-gray-100 text-[var(--twilio-gray-60)]"}`}
    >
      {value && <svg viewBox="0 0 12 12" fill="currentColor" className="w-2.5 h-2.5 opacity-70"><path d="M4 0a1 1 0 011 1h2a1 1 0 112 0h1a2 2 0 012 2v7a2 2 0 01-2 2H2a2 2 0 01-2-2V3a2 2 0 012-2h1a1 1 0 011-1zM2 5v5h8V5H2z"/></svg>}
      {label}
    </button>
  );
}

function PillUrl({ value, onChange }: {
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (open) {
    return <UrlPillInput value={value} onCommit={(v) => { onChange(v); setOpen(false); }} onCancel={() => setOpen(false)} />;
  }
  if (value) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 px-2.5 py-0.5 text-[12px] font-semibold">
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 hover:underline"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-2.5 h-2.5 shrink-0"><path d="M6 2a2 2 0 00-2 2v5a2 2 0 002 2h1v2l2.5-2.5A1 1 0 0110 10h2a2 2 0 002-2V4a2 2 0 00-2-2H6z"/></svg>
          Slack ↗
        </a>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen(true); }}
          className="ml-0.5 text-indigo-400 hover:text-indigo-700 leading-none"
          title="Edit URL"
        >✎</button>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold hover:opacity-75 transition-opacity cursor-pointer bg-gray-100 text-[var(--twilio-gray-60)]"
    >
      <svg viewBox="0 0 16 16" fill="currentColor" className="w-2.5 h-2.5"><path d="M6 2a2 2 0 00-2 2v5a2 2 0 002 2h1v2l2.5-2.5A1 1 0 0110 10h2a2 2 0 002-2V4a2 2 0 00-2-2H6z"/></svg>
      Slack
    </button>
  );
}

function ActionItemFields({
  form,
  onChange,
  compact = false,
  hideTask = false,
  teamMembers = [],
  accounts = [],
  afterDetails,
  autosaveTarget,
  onAutosaved,
}: {
  form: Partial<AirtableActionItem>;
  onChange: (updated: Partial<AirtableActionItem>) => void;
  compact?: boolean;
  hideTask?: boolean;
  teamMembers?: TeamMember[];
  accounts?: KanbanAccount[];
  /** Rendered as its own section directly below the description. The expanded modal puts
   *  the checklist here; inline cards leave it empty. */
  afterDetails?: React.ReactNode;
  /** The saved item these fields edit, when there is one. Only the Slack pill uses it, to
   *  persist a pasted link without waiting for Save — see hooks/useSlackLinkAutosave.ts.
   *  Omitted by create forms, which have no record to patch yet. */
  autosaveTarget?: AirtableActionItem;
  onAutosaved?: (updated: AirtableActionItem) => void;
}) {
  const { status: statusOptions } = useActionItemFieldOptions();
  const autosaveSlackLink = useSlackLinkAutosave();
  const assigneeName = form.assignee_name || (form.assignee_airtable_id ? form.assignee_airtable_id : "");
  const memberNames = ["Unassigned", ...teamMembers.map((m) => m.full_name)] as string[];

  return (
    <div className="flex flex-col gap-2.5">
      {!hideTask && (
        <textarea
          value={form.task ?? ""}
          onChange={(e) => onChange({ task: e.target.value })}
          rows={compact ? 2 : 3}
          placeholder="Name or short description"
          className={`${FIELD_INPUT} resize-none`}
          onClick={(e) => e.stopPropagation()}
        />
      )}

      {/* Description — no label. Steps live in their own Checklist section below, so the
          placeholder no longer invites writing them here as prose. */}
      <div onClick={(e) => e.stopPropagation()}>
        <RichTextMentionEditor
          value={form.task_details ?? ""}
          onChange={(html) => onChange({ task_details: html })}
          placeholder="Additional context or notes…"
          minHeightClassName={compact ? "min-h-[48px]" : "min-h-[72px]"}
        />
      </div>

      {/* Its own section, directly below the description */}
      {afterDetails}

      {/* Pill row 1: Status · Priority · Due date */}
      <div className="flex flex-wrap gap-1.5 items-center">
        <PillSelect
          value={form.status}
          options={statusOptions as AirtableActionItem["status"][]}
          colorMap={STATUS_COLORS}
          placeholder="Status"
          onChange={(v) => onChange({ status: v })}
        />
        <PillSelect
          value={form.priority}
          options={["Critical", "High", "Medium", "Low"] as const}
          colorMap={PRIORITY_COLORS}
          placeholder="Priority"
          onChange={(v) => onChange({ priority: v })}
        />
        <PillDate value={form.due_date} onChange={(v) => onChange({ due_date: v })} />
      </div>

      {/* Pill row 2: Est · Spent · Prep · Slack */}
      <div className="flex flex-wrap gap-1.5 items-center">
        <PillNumber value={form.estimated_time} label="Est." onChange={(v) => onChange({ estimated_time: v ?? 0 })} />
        <PillNumber value={form.time_spent} label="Spent" onChange={(v) => onChange({ time_spent: v ?? 0 })} />
        <PillNumber value={form.prep_time} label="Prep" onChange={(v) => onChange({ prep_time: v ?? 0 })} />
        <PillUrl
          value={form.slack_thread_url}
          onChange={(v) => {
            onChange({ slack_thread_url: v });
            if (autosaveTarget) autosaveSlackLink(autosaveTarget, v, onAutosaved);
          }}
        />
      </div>

      {/* Assignee */}
      {teamMembers.length > 0 && (
        <div className="flex flex-wrap gap-1.5 items-center">
          <PillSelect
            value={(assigneeName || "Unassigned") as string}
            options={memberNames as string[]}
            colorMap={{}}
            placeholder="Unassigned"
            onChange={(v) => {
              const member = teamMembers.find((m) => m.full_name === v);
              onChange({
                assignee_airtable_id: member ? String(member.id) : "",
                assignee_name: member?.full_name ?? "",
              });
            }}
          />
        </div>
      )}

      {/* Account picker — shown when accounts list is provided */}
      {accounts.length > 0 && (
        <div className="flex flex-wrap gap-1.5 items-center">
          <PillSelect
            value={form.account_name ?? "No Account"}
            options={["No Account", ...accounts.map((a) => a.name)] as string[]}
            colorMap={{}}
            placeholder="No Account"
            onChange={(v) => {
              if (v === "No Account") {
                onChange({ account_name: null, account: null });
              } else {
                const acc = accounts.find((a) => a.name === v);
                // Only send account PK for Airtable-source accounts; app-source accounts
                // are resolved by name on the backend.
                onChange({
                  account_name: acc?.name ?? v,
                  account: acc?.source === "airtable" ? (acc.id ?? null) : null,
                });
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

// ── Editable live timer display ───────────────────────────────────────────────

function EditableTimer({
  elapsed,
  onCommit,
}: {
  elapsed: number;
  onCommit: (seconds: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation();
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    setDraft(`${m}:${String(s).padStart(2, "0")}`);
    setEditing(true);
  }

  function commit() {
    const parts = draft.split(":").map((p) => parseInt(p, 10) || 0);
    const seconds = parts.length === 3
      ? parts[0] * 3600 + parts[1] * 60 + parts[2]
      : parts.length === 2
        ? parts[0] * 60 + parts[1]
        : parts[0] * 60;
    onCommit(Math.max(0, seconds));
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        onClick={(e) => e.stopPropagation()}
        className="font-mono text-xs text-[var(--twilio-navy)] tabular-nums w-16 border-b border-indigo-400 bg-transparent focus:outline-none text-center"
        placeholder="m:ss"
      />
    );
  }

  return (
    <span
      onDoubleClick={startEdit}
      title="Double-click to edit"
      className="font-mono text-xs text-[var(--twilio-navy)] tabular-nums cursor-text select-none hover:text-indigo-600 transition-colors"
    >
      {fmtTime(elapsed)}
    </span>
  );
}

// ── Shared calendar occurrences display ──────────────────────────────────────

function ModalOccurrences({ airtableId }: { airtableId: string }) {
  const occurrences = useScheduledOccurrences(airtableId);
  if (occurrences.length === 0) return null;
  return (
    <div className="mt-4 pt-3 border-t border-gray-100">
      <p className="text-xs font-semibold text-indigo-500 uppercase tracking-wide mb-1.5">Scheduled on calendar</p>
      <div className="flex flex-col gap-1">
        {occurrences.map((o) => (
          <div key={o.start} className="flex items-center gap-2 text-xs text-indigo-700 bg-indigo-50 rounded-lg px-3 py-1.5">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0 text-indigo-400"><path fillRule="evenodd" d="M4 2a1 1 0 00-1 1v1H2a1 1 0 000 2h1v6a2 2 0 002 2h6a2 2 0 002-2V6h1a1 1 0 000-2h-1V3a1 1 0 00-1-1H4zm1 2h6v1H5V4zm-1 3h8v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7z" clipRule="evenodd"/></svg>
            {new Date(o.start).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Attachments section ───────────────────────────────────────────────────────

function AttachmentsSection({ item }: { item: AirtableActionItem }) {
  const [attachments, setAttachments] = useState<ActionItemAttachment[]>(item.attachments ?? []);
  const [dragOver, setDragOver] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch fresh list once on mount (item.attachments may be stale from list endpoint)
  useEffect(() => {
    airtableApi.listAttachments(item.id)
      .then(({ data }) => setAttachments(data))
      .catch(() => {});
  }, [item.id]);

  async function handleFiles(files: FileList | File[]) {
    setUploading(true);
    setUploadError(null);
    const failed: string[] = [];
    let lastError: unknown = null;
    for (const f of Array.from(files)) {
      try {
        const { data } = await airtableApi.uploadAttachmentFile(item.id, f);
        setAttachments((prev) => [data, ...prev]);
      } catch (err: unknown) {
        // Surface it — a swallowed rejection here reads as "nothing happened".
        failed.push(f.name);
        lastError = err;
      }
    }
    if (failed.length) {
      const data = (lastError as { response?: { data?: { detail?: string; error?: string } } })?.response?.data;
      setUploadError(`${data?.detail ?? data?.error ?? "Upload failed."} (${failed.join(", ")})`);
    }
    setUploading(false);
  }

  async function handleDelete(id: number) {
    await airtableApi.deleteAttachment(item.id, id);
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div className="mt-5 pt-4 border-t border-gray-100">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)]">
          Attachments {attachments.length > 0 && <span className="font-normal normal-case tracking-normal">({attachments.length})</span>}
        </p>
        <div className="flex items-center gap-1.5">
          {uploading && <span className="text-xs text-gray-400 animate-pulse">Uploading…</span>}
          <button
            onClick={() => setShowLinkModal(true)}
            className="text-xs px-2 py-0.5 rounded border border-gray-200 text-[var(--twilio-navy)] hover:bg-gray-50"
            title="Add link"
          >+ Link</button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-xs px-2 py-0.5 rounded border border-gray-200 text-[var(--twilio-navy)] hover:bg-gray-50"
            title="Upload file"
          >+ File</button>
          <ArtifactPicker
            actionItemId={item.id}
            accountName={item.account_name}
            onAttached={(a) => setAttachments((prev) => [a, ...prev])}
            onError={setUploadError}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && void handleFiles(e.target.files)}
          />
        </div>
      </div>

      {uploadError && (
        <p role="alert" className="text-xs text-red-600 mb-2 bg-red-50 border border-red-200 rounded px-2 py-1">
          {uploadError}
        </p>
      )}

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
        }}
        className={`rounded-lg border-2 border-dashed transition-colors ${
          dragOver ? "border-indigo-400 bg-indigo-50" : "border-gray-200 bg-transparent"
        } ${attachments.length === 0 ? "py-4 flex items-center justify-center" : "py-1"}`}
      >
        {attachments.length === 0 && !dragOver && (
          <p className="text-xs text-gray-400">Drop files here, or use + Link / + File above</p>
        )}
        {dragOver && attachments.length === 0 && (
          <p className="text-xs text-indigo-500 font-medium">Drop to attach</p>
        )}
        {attachments.map((a) => {
          const href = a.file_url ?? a.url ?? "";
          const fileEmoji = a.artifact_type === "file" ? fileIcon(a.mime_type, a.name) : null;
          const faviconSrc = a.artifact_type !== "file" && href ? getLinkFaviconSrc(href) : null;
          return (
            <div key={a.id} className="group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50">
              {fileEmoji
                ? <span className="text-base leading-none shrink-0">{fileEmoji}</span>
                : faviconSrc
                  ? <img src={faviconSrc} alt="" className="w-4 h-4 shrink-0 rounded-sm" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                  : <span className="text-base leading-none shrink-0">🔗</span>
              }
              <div className="flex-1 min-w-0">
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-[var(--twilio-navy)] hover:underline truncate block"
                >
                  {a.name}
                </a>
                {a.file_size && (
                  <span className="text-[10px] text-gray-400">{fmtBytes(a.file_size)}</span>
                )}
              </div>
              <button
                onClick={() => void handleDelete(a.id)}
                className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-opacity shrink-0 p-0.5"
                title="Remove attachment"
              >
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3 h-3">
                  <path d="M2 2l8 8M10 2l-8 8" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          );
        })}
      </div>

      {showLinkModal && (
        <AddAttachmentLinkModal
          onClose={() => setShowLinkModal(false)}
          onAdded={(a) => { setAttachments((prev) => [a, ...prev]); setShowLinkModal(false); }}
          actionItemId={item.id}
        />
      )}
    </div>
  );
}

function AddAttachmentLinkModal({
  actionItemId,
  onClose,
  onAdded,
}: {
  actionItemId: number;
  onClose: () => void;
  onAdded: (a: ActionItemAttachment) => void;
}) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

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
    setSearchQ("");
    setSearchResults([]);
  }

  async function handleAdd() {
    if (!url.trim()) return;
    setSaving(true);
    try {
      const displayName = name.trim() || url.trim();
      const { data } = await airtableApi.addAttachmentLink(actionItemId, displayName, url.trim());
      onAdded(data);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-[var(--twilio-navy)] mb-3">Add link</h3>

        {/* Search existing artifacts */}
        <div className="relative mb-3">
          <input
            autoFocus
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search existing artifacts…"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-400"
          />
          {(searchResults.length > 0 || searchLoading) && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
              {searchLoading && <p className="text-xs text-gray-400 px-3 py-2">Searching…</p>}
              {searchResults.map((r) => {
                const href = r.url && !r.url.startsWith("/") ? r.url : (r.detail ?? "");
                const faviconSrc = href ? getLinkFaviconSrc(href) : null;
                return (
                  <button
                    key={r.id}
                    onClick={() => applyExistingArtifact(r)}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-sm"
                  >
                    {faviconSrc
                      ? <img src={faviconSrc} alt="" className="w-4 h-4 shrink-0 rounded-sm" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                      : <span className="text-base leading-none shrink-0">🔗</span>
                    }
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate text-[var(--twilio-navy)]">{r.title}</p>
                      {r.account && <p className="text-[10px] text-gray-400 truncate">{r.account}</p>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 h-px bg-gray-100" />
          <span className="text-[11px] text-gray-400">or enter a URL</span>
          <div className="flex-1 h-px bg-gray-100" />
        </div>

        <div className="space-y-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-400"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display name (optional)"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-400"
          />
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50">Cancel</button>
          <button
            onClick={() => void handleAdd()}
            disabled={saving || !url.trim()}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {saving ? "Adding…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Waiting On badge (card-level indicator) ───────────────────────────────────

function WaitingOnBadge({ item, className }: { item: AirtableActionItem; className?: string }) {
  const deps = item.waiting_on ?? [];
  if (deps.length === 0) return null;
  const pending = deps.filter((d) => d.status !== "Done");
  const allDone = pending.length === 0;
  return (
    <div className={className}>
      <span
        className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
          allDone ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-700"
        }`}
        title={deps.map((d) => `${d.status === "Done" ? "✓" : "⏳"} ${d.task}`).join("\n")}
      >
        {allDone ? "✓" : "⏳"} Waiting on {deps.length}
      </span>
    </div>
  );
}

// ── Waiting On section (dependency chaining) ─────────────────────────────────

const WAITING_STATUS_COLORS: Record<string, string> = {
  "Open": "bg-gray-100 text-gray-600",
  "In Progress": "bg-indigo-50 text-indigo-600",
  "Done": "bg-emerald-50 text-emerald-700",
  "Blocked": "bg-red-50 text-red-600",
  "Backlogged": "bg-slate-100 text-slate-600",
};

function WaitingOnSection({
  item,
  allItems,
  onUpdated,
}: {
  item: AirtableActionItem;
  allItems: AirtableActionItem[];
  onUpdated: (updated: AirtableActionItem) => void;
}) {
  const deps: ActionItemDependency[] = item.waiting_on ?? [];
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const depIds = new Set(deps.map((d) => d.id));
  const candidates = allItems.filter(
    (a) =>
      a.id !== item.id &&
      !depIds.has(a.id) &&
      !a.airtable_id.startsWith("local-") &&
      a.task.toLowerCase().includes(query.toLowerCase())
  );

  async function handleAdd(candidate: AirtableActionItem) {
    setAdding(true);
    setQuery("");
    setOpen(false);
    try {
      const { data } = await airtableApi.addDependency(item.id, candidate.id);
      onUpdated(data);
    } catch {
      // silently ignore — user can retry
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(depId: number) {
    try {
      const { data } = await airtableApi.removeDependency(item.id, depId);
      onUpdated(data);
    } catch {
      // silently ignore
    }
  }

  const unresolvedCount = deps.filter((d) => d.status !== "Done").length;

  return (
    <div style={{ marginTop: "20px" }}>
      <p className="text-xs font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide mb-2">
        Waiting On
        {unresolvedCount > 0 && (
          <span className="ml-2 inline-flex items-center gap-1 text-amber-600 font-semibold normal-case tracking-normal">
            <span>⏳</span> {unresolvedCount} pending
          </span>
        )}
      </p>

      {deps.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-3">
          {deps.map((dep) => (
            <div key={dep.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-50 border border-gray-100">
              <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded shrink-0 ${WAITING_STATUS_COLORS[dep.status] ?? WAITING_STATUS_COLORS["Open"]}`}>
                {dep.status}
              </span>
              {dep.status === "Done" && (
                <span className="text-emerald-500 shrink-0 text-xs">✓</span>
              )}
              <span className="text-xs text-[var(--twilio-navy)] flex-1 min-w-0 truncate">{dep.task}</span>
              <button
                onClick={() => void handleRemove(dep.id)}
                className="shrink-0 text-gray-300 hover:text-red-400 transition-colors text-sm leading-none"
                title="Remove dependency"
              >×</button>
            </div>
          ))}
        </div>
      )}

      <div className="relative">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="+ Add: search for an action item…"
          disabled={adding}
          className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white focus:border-indigo-300 focus:outline-none placeholder:text-gray-400 disabled:opacity-50"
        />
        {open && query.length > 0 && candidates.length > 0 && (
          <div className="absolute z-30 left-0 right-0 mt-1 rounded-lg border border-gray-200 bg-white shadow-lg max-h-48 overflow-y-auto">
            {candidates.slice(0, 8).map((c) => (
              <button
                key={c.id}
                onMouseDown={() => void handleAdd(c)}
                className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-indigo-50 transition-colors"
              >
                <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded shrink-0 ${WAITING_STATUS_COLORS[c.status] ?? WAITING_STATUS_COLORS["Open"]}`}>
                  {c.status}
                </span>
                <span className="text-xs text-[var(--twilio-navy)] truncate">{c.task}</span>
                {c.account_name && (
                  <span className="text-[10px] text-gray-400 shrink-0 ml-auto">{c.account_name}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Expand modal ──────────────────────────────────────────────────────────────

function CardModal({
  item,
  onClose,
  onSave,
  onDelete,
  onUpdated,
  onConverted,
  teamMembers = [],
  allItems = [],
  accounts = [],
}: {
  item: AirtableActionItem;
  onClose: () => void;
  onSave: (updated: Partial<AirtableActionItem>) => Promise<void>;
  onDelete?: () => void;
  onUpdated?: (updated: AirtableActionItem) => void;
  onConverted?: () => void;
  teamMembers?: TeamMember[];
  allItems?: AirtableActionItem[];
  accounts?: KanbanAccount[];
}) {
  const [form, setForm] = useState<Partial<AirtableActionItem>>({ ...item });
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    await onSave(form);
    setSaving(false);
    onClose();
  }, [saving, onSave, form, onClose]);

  async function handleConvertToEvent() {
    if (converting || item.airtable_id.startsWith("local-")) return;
    setConverting(true);
    try {
      await convertActionItemToEvent(item);
      onConverted?.();
      onClose();
    } catch { /* best effort */ } finally {
      setConverting(false);
    }
  }

  // Cmd+Enter / Ctrl+Enter → Save
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void handleSave();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [handleSave]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--twilio-navy)]">Edit Action Item</h2>
          <div className="flex items-center gap-2">
            <CommentTrigger
              resourceType="action_item"
              resourceId={item.id}
              resourceLabel={item.task ?? ""}
              disabled={item.airtable_id.startsWith("local-")}
            />
            <button onClick={onClose} className="text-[var(--twilio-navy)] hover:text-[var(--twilio-gray-80)] text-xl leading-none">✕</button>
          </div>
        </div>

        {item.account_name && (
          <div className="mb-3 flex items-center gap-1.5">
            <span className="text-xs text-[var(--twilio-gray-60)]">Account:</span>
            <span className="text-xs font-medium text-[var(--twilio-navy)] bg-gray-100 px-2 py-0.5 rounded-full">{item.account_name}</span>
          </div>
        )}

        {/* Existing comments, in place — the header icon opens the full thread. */}
        {!item.airtable_id.startsWith("local-") && (
          <CommentPreviewList
            resourceType="action_item"
            resourceId={item.id}
            resourceLabel={item.task ?? ""}
            variant="panel"
            className="mb-3"
          />
        )}

        <ActionItemFields
          form={form}
          onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
          autosaveTarget={item}
          onAutosaved={onUpdated}
          teamMembers={teamMembers}
          accounts={accounts}
          // Its own section immediately below the description. Real Airtable items only —
          // steps key off the numeric PK, which a local-* draft has not been assigned yet.
          afterDetails={!item.airtable_id.startsWith("local-") && (
            <div className="pt-2 border-t border-gray-100">
              <StepsPanel actionItemId={item.id} />
            </div>
          )}
        />

        <ModalOccurrences airtableId={item.airtable_id} />

        {!item.airtable_id.startsWith("local-") && <AttachmentsSection item={item} />}

        {!item.airtable_id.startsWith("local-") && onUpdated && (
          <WaitingOnSection item={item} allItems={allItems} onUpdated={onUpdated} />
        )}

        {!item.airtable_id.startsWith("local-") && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--twilio-gray-60)" }}>Activity Log</p>
            <ActivityLogSection
              resourceType="action_item"
              resourceId={item.airtable_id}
              variant="inline"
              onRestore={async (rd) => { await restoreConversion(rd); onConverted?.(); onClose(); }}
            />
          </div>
        )}

        {/* Timestamps */}
        {!item.airtable_id.startsWith("local-") && (
          <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap gap-x-5 gap-y-1">
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

        <div className="flex items-center justify-between mt-5 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {!item.airtable_id.startsWith("local-") && onUpdated && (
              <ReminderButton item={item} onUpdated={onUpdated} size="modal" />
            )}
            {!item.airtable_id.startsWith("local-") && (
              <button
                disabled={converting}
                onClick={() => void handleConvertToEvent()}
                title="Convert this action item into a calendar event"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-50 transition-colors"
              >
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-3 h-3 shrink-0">
                  <rect x="1" y="2" width="12" height="11" rx="1.5"/>
                  <path d="M4 1v2M10 1v2M1 6h12" strokeLinecap="round"/>
                </svg>
                {converting ? "Converting…" : "Convert to Event"}
              </button>
            )}
            {onDelete ? (
              <DeleteButton onDelete={() => { onDelete(); onClose(); }} />
            ) : null}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-[var(--twilio-navy)] hover:bg-gray-50">
              Cancel
            </button>
            <button
              disabled={saving}
              onClick={() => void handleSave()}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              title="Save (⌘↵)"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Reminder button ───────────────────────────────────────────────────────────

type ReminderMode = "datetime" | "before_meeting" | "tomorrow";

function ReminderButton({
  item,
  onUpdated,
  size = "small",
}: {
  item: AirtableActionItem;
  onUpdated: (updated: AirtableActionItem) => void;
  size?: "small" | "modal";
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ReminderMode>("datetime");
  const [dateVal, setDateVal] = useState("");
  const [timeVal, setTimeVal] = useState("09:00");
  const [beforeMins, setBeforeMins] = useState(30);
  const [tomorrowTime, setTomorrowTime] = useState("09:00");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState({ top: 0, right: 0 });

  const hasReminder = !!item.reminder_id;

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node) &&
          btnRef.current && !btnRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function handleOpen(e: React.MouseEvent) {
    e.stopPropagation();
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPanelPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    setOpen((v) => !v);
  }

  async function handleSave(e: React.MouseEvent) {
    e.stopPropagation();
    setSaving(true);
    try {
      let due_at = "";
      if (mode === "datetime") {
        due_at = new Date(`${dateVal}T${timeVal}`).toISOString();
      } else if (mode === "before_meeting") {
        const { data } = await airtableApi.nextMeetingAt();
        if (!data.next_meeting_at) { alert("No upcoming meeting found."); setSaving(false); return; }
        const meetingMs = new Date(data.next_meeting_at).getTime();
        due_at = new Date(meetingMs - beforeMins * 60 * 1000).toISOString();
      } else {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const [h, m] = tomorrowTime.split(":").map(Number);
        tomorrow.setHours(h, m, 0, 0);
        due_at = tomorrow.toISOString();
      }
      const { data } = await airtableApi.setActionItemReminder(item.id, { due_at });
      setSuccess(true);
      onUpdated(data);
      window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated", newValue: "1" }));
      if (!item.airtable_id.startsWith("local-")) {
        const reminderLabel = new Date(due_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
        addLog({
          category: "action_item",
          message: `Reminder set for "${item.task || "Untitled"}" — ${reminderLabel}`,
          links: [{ label: "View action items", path: "/action-items" }],
          resource: { type: "action_item", id: item.airtable_id },
        });
      }
      setTimeout(() => { setSuccess(false); setOpen(false); }, 1400);
    } catch { /* best effort */ } finally {
      setSaving(false);
    }
  }

  async function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    setSaving(true);
    try {
      const { data } = await airtableApi.clearActionItemReminder(item.id);
      onUpdated(data);
      window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated", newValue: "1" }));
      if (!item.airtable_id.startsWith("local-")) {
        addLog({
          category: "action_item",
          message: `Reminder cleared for "${item.task || "Untitled"}"`,
          links: [{ label: "View action items", path: "/action-items" }],
          resource: { type: "action_item", id: item.airtable_id },
        });
      }
      setOpen(false);
    } catch { /* best effort */ } finally {
      setSaving(false);
    }
  }

  const bellColor = hasReminder ? "#f59e0b" : "#9ca3af";
  const reminderLabel = hasReminder && item.reminder_due_at
    ? new Date(item.reminder_due_at).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;

  const iconSize = size === "modal" ? 15 : 11;

  return (
    <div style={{ display: "inline-flex", position: "relative" }}>
      <button
        ref={btnRef}
        title={reminderLabel ? `Reminder: ${reminderLabel}` : "Set reminder"}
        onClick={handleOpen}
        className="shrink-0 transition-colors hover:opacity-80 flex items-center gap-1"
        style={{ color: bellColor }}
      >
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill={hasReminder ? bellColor : "none"} stroke={bellColor} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {size === "modal" && (
          <span style={{ fontSize: "0.75rem", fontWeight: 500 }}>
            {reminderLabel ? reminderLabel : "Remind me"}
          </span>
        )}
      </button>
      {open && (
        <div
          ref={panelRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: panelPos.top,
            right: panelPos.right,
            zIndex: 9999,
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 10,
            padding: "12px 14px",
            width: 236,
            boxShadow: "0 4px 20px rgba(0,0,0,0.13)",
          }}
        >
          <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "#111", marginBottom: 8 }}>Set Reminder</p>

          {/* Mode tabs */}
          <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
            {([
              { id: "datetime", label: "Date/Time" },
              { id: "before_meeting", label: "Before meeting" },
              { id: "tomorrow", label: "Tomorrow" },
            ] as { id: ReminderMode; label: string }[]).map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setMode(id)}
                style={{
                  flex: 1, padding: "3px 0", fontSize: "0.6875rem", fontWeight: 600,
                  borderRadius: 5, border: "1px solid",
                  borderColor: mode === id ? "#6366f1" : "#e5e7eb",
                  background: mode === id ? "#eef2ff" : "#f9fafb",
                  color: mode === id ? "#4338ca" : "#6b7280",
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "datetime" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <input type="date" value={dateVal} onChange={(e) => setDateVal(e.target.value)}
                style={{ width: "100%", padding: "4px 8px", fontSize: "0.75rem", border: "1px solid #e5e7eb", borderRadius: 5 }} />
              <input type="time" value={timeVal} onChange={(e) => setTimeVal(e.target.value)}
                style={{ width: "100%", padding: "4px 8px", fontSize: "0.75rem", border: "1px solid #e5e7eb", borderRadius: 5 }} />
            </div>
          )}

          {mode === "before_meeting" && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input type="number" min={1} max={480} value={beforeMins} onChange={(e) => setBeforeMins(Number(e.target.value))}
                style={{ width: 60, padding: "4px 8px", fontSize: "0.75rem", border: "1px solid #e5e7eb", borderRadius: 5 }} />
              <span style={{ fontSize: "0.75rem", color: "#374151" }}>min before next meeting</span>
            </div>
          )}

          {mode === "tomorrow" && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: "0.75rem", color: "#374151" }}>Tomorrow at</span>
              <input type="time" value={tomorrowTime} onChange={(e) => setTomorrowTime(e.target.value)}
                style={{ flex: 1, padding: "4px 8px", fontSize: "0.75rem", border: "1px solid #e5e7eb", borderRadius: 5 }} />
            </div>
          )}

          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <button
              disabled={saving || success}
              onClick={handleSave}
              style={{
                flex: 1, padding: "5px 0", fontSize: "0.75rem", fontWeight: 700,
                background: success ? "#10b981" : "#6366f1", color: "#fff",
                border: "none", borderRadius: 5, cursor: saving ? "wait" : "pointer",
                opacity: saving ? 0.7 : 1,
              }}
            >
              {success ? "✓ Set!" : saving ? "…" : "Set"}
            </button>
            {hasReminder && (
              <button
                disabled={saving}
                onClick={handleClear}
                style={{
                  padding: "5px 8px", fontSize: "0.75rem", fontWeight: 600,
                  background: "transparent", color: "#ef4444",
                  border: "1px solid #fca5a5", borderRadius: 5, cursor: "pointer",
                }}
              >
                Clear
              </button>
            )}
            <button
              onClick={() => setOpen(false)}
              style={{
                padding: "5px 8px", fontSize: "0.75rem", fontWeight: 600,
                background: "transparent", color: "#6b7280",
                border: "1px solid #e5e7eb", borderRadius: 5, cursor: "pointer",
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Kanban card ───────────────────────────────────────────────────────────────

function DeleteButton({ onDelete }: { onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Close tooltip on outside click
  useEffect(() => {
    if (!confirm) return;
    function handleClick(e: MouseEvent) {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node) &&
          btnRef.current && !btnRef.current.contains(e.target as Node)) {
        setConfirm(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [confirm]);

  function handleOpen(e: React.MouseEvent) {
    e.stopPropagation();
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setTooltipPos({ top: r.top - 6, right: window.innerWidth - r.right });
    }
    setConfirm(true);
  }

  return (
    <div style={{ display: "inline-flex" }}>
      <button
        ref={btnRef}
        title="Delete action item"
        onClick={handleOpen}
        className="shrink-0 text-gray-400 hover:text-red-500 transition-colors"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6M14 11v6"/>
          <path d="M9 6V4h6v2"/>
        </svg>
      </button>
      {confirm && (
        <div
          ref={tooltipRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            bottom: "auto",
            top: tooltipPos.top - 88,
            right: tooltipPos.right,
            zIndex: 9999,
            background: "#fff", border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 8, padding: "10px 12px", width: 200,
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          }}
        >
          <p style={{ fontSize: "0.75rem", color: "#111", fontWeight: 500, margin: "0 0 8px", lineHeight: 1.4 }}>
            Are you sure you want to DELETE this action item?
          </p>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => { setConfirm(false); onDelete(); }}
              style={{
                flex: 1, padding: "4px 0", fontSize: "0.75rem", fontWeight: 700,
                background: "#ef4444", color: "#fff", border: "none",
                borderRadius: 5, cursor: "pointer",
              }}
            >
              Delete
            </button>
            <button
              onClick={() => setConfirm(false)}
              style={{
                flex: 1, padding: "4px 0", fontSize: "0.75rem", fontWeight: 600,
                background: "transparent", color: "#6b7280",
                border: "1px solid #e5e7eb", borderRadius: 5, cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function KanbanCardOccurrences({ airtableId }: { airtableId: string }) {
  const occurrences = useScheduledOccurrences(airtableId);
  if (occurrences.length === 0) return null;
  return (
    <div className="mt-0.5 pt-1 border-t border-gray-200/70">
      <p className="text-[9px] font-semibold text-indigo-500 uppercase tracking-wide mb-0.5">On calendar</p>
      {occurrences.map((o) => (
        <p key={o.start} className="text-[9px] text-indigo-600 leading-tight">
          {new Date(o.start).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </p>
      ))}
    </div>
  );
}

// Inline grid-row variant for Stage Today / In Progress cards
function KanbanCardOccurrencesInline({ airtableId, colSpan }: { airtableId: string; colSpan: number }) {
  const occurrences = useScheduledOccurrences(airtableId);
  if (occurrences.length === 0) return null;
  return (
    <div style={{ gridColumn: `1 / span ${colSpan}`, gridRow: 3, borderTop: "1px solid rgba(0,0,0,0.07)", paddingTop: "3px", marginTop: "1px" }}>
      <span className="text-[9px] font-semibold text-indigo-500 uppercase tracking-wide mr-1.5">On calendar</span>
      {occurrences.map((o, i) => (
        <span key={o.start} className="text-[9px] text-indigo-600">
          {i > 0 && <span className="mx-1 opacity-40">·</span>}
          {new Date(o.start).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </span>
      ))}
    </div>
  );
}

function KanbanCard({
  item,
  zone,
  timer,
  onDragStart,
  onSave,
  onSaveAndStage,
  onExpandClick,
  onDelete,
  onUpdated,
  onTimerToggle,
  onTimerEdit,
  teamMembers = [],
  accounts = [],
  collapsible,
}: {
  item: AirtableActionItem;
  zone: Zone;
  timer?: TimerState;
  onDragStart: (e: React.DragEvent) => void;
  onSave: (updated: Partial<AirtableActionItem>) => Promise<void>;
  onSaveAndStage?: (form: Partial<AirtableActionItem>) => Promise<void>;
  onExpandClick: () => void;
  onDelete?: () => void;
  onUpdated?: (updated: AirtableActionItem) => void;
  onTimerToggle?: () => void;
  onTimerEdit?: (seconds: number) => void;
  teamMembers?: TeamMember[];
  accounts?: KanbanAccount[];
  /** Show a collapse toggle in the top-left corner. Used by Stage Today, Currently
   *  Tracking and Pinned In Progress; the Views grid leaves its cards always-expanded. */
  collapsible?: boolean;
}) {
  const [form, setForm] = useState<Partial<AirtableActionItem>>({ ...item });
  const [saving, setSaving] = useState(false);
  const { addToTray } = useExportTray();
  const { isPinned, toggle: toggleFocusPin } = useFocusPins();
  const { isCollapsed: isCardCollapsed, toggle: toggleCardCollapse } = useCardCollapse();
  // A pasted Slack link saves on its own — see hooks/useSlackLinkAutosave.ts.
  const autosaveSlackLink = useSlackLinkAutosave();
  const [ctxPos, setCtxPos] = useState<{ x: number; y: number } | null>(null);

  // Never pin a local-* blank — promoteBlankItem discards that id for a real recXXX.
  const canPin = !item.airtable_id.startsWith("local-");
  const isPinnedToFocus = canPin && isPinned(item.airtable_id);
  const collapsed = !!collapsible && isCardCollapsed(item.airtable_id);
  // `canPin` is also the "exists server-side" test — a local-* draft has no PK to
  // hang a comment off, and promoteBlankItem would discard the id anyway.
  const commentMenuEntry = useCommentMenuItem("action_item", canPin ? item.id : null, item.task ?? "", ctxPos);

  // Keep form in sync when item changes from outside (e.g. after a save or promotion),
  // but preserve unsaved user edits when only the account assignment changed (star action).
  const prevItemRef = useRef(item);
  useEffect(() => {
    const prev = prevItemRef.current;
    prevItemRef.current = item;
    const contentChanged =
      prev.task !== item.task ||
      prev.task_details !== item.task_details ||
      prev.status !== item.status ||
      prev.priority !== item.priority ||
      prev.due_date !== item.due_date ||
      prev.estimated_time !== item.estimated_time ||
      prev.time_spent !== item.time_spent ||
      prev.prep_time !== item.prep_time ||
      prev.slack_thread_url !== item.slack_thread_url ||
      prev.assignee_airtable_id !== item.assignee_airtable_id;
    if (contentChanged) {
      // External content update (save, promotion) — full sync
      setForm({ ...item });
    } else if (prev.account !== item.account || prev.account_name !== item.account_name) {
      // Only account assignment changed (star) — merge without discarding user edits
      setForm((f) => ({ ...f, account: item.account, account_name: item.account_name }));
    }
  }, [item]);

  const elapsed = timer
    ? timer.elapsed + (timer.running && timer.startedAt ? Math.floor((Date.now() - timer.startedAt) / 1000) : 0)
    : 0;

  const { status: statusOptions } = useActionItemFieldOptions();
  const isUnstaged = zone === "unstaged";
  const isFullForm = zone === "unstaged" || zone === "today" || zone === "active";
  const accentColor = form.priority ? PRIORITY_ACCENT[form.priority] : "#e5e7eb";
  const statusKey = form.status ?? "Open";

  function buildDragGhost(e: React.DragEvent) {
    const ghost = document.createElement("div");
    ghost.style.cssText = [
      "position:fixed", "top:-9999px", "left:-9999px",
      "width:176px", "background:#F4F4F6",
      "border-radius:8px", "padding:10px 12px",
      "box-shadow:0 2px 8px rgba(0,0,0,0.12)",
      `border-left:3px solid ${accentColor}`,
      "font-family:inherit", "display:flex", "flex-direction:column", "gap:6px",
    ].join(";");
    const badges = document.createElement("div");
    badges.style.cssText = "display:flex;gap:4px;flex-wrap:wrap";
    if (form.priority) {
      const p = document.createElement("span");
      p.textContent = form.priority;
      p.style.cssText = "font-size:11px;font-weight:600;padding:1px 6px;border-radius:4px;background:#e0e7ff;color:#3730a3";
      badges.appendChild(p);
    }
    const s = document.createElement("span");
    s.textContent = statusKey;
    s.style.cssText = "font-size:11px;font-weight:600;padding:1px 6px;border-radius:4px;background:#f3f4f6;color:#1f2937";
    badges.appendChild(s);
    ghost.appendChild(badges);
    const title = document.createElement("p");
    title.textContent = form.task || "Untitled";
    title.style.cssText = "font-size:13px;font-weight:500;color:#1a1a2e;margin:0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical";
    ghost.appendChild(title);
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 20, 20);
    setTimeout(() => ghost.remove(), 0);
  }

  function handleUnstagedDragStart(e: React.DragEvent) {
    onSave(form);
    buildDragGhost(e);
    onDragStart(e);
  }

  function handleDragStartWithGhost(e: React.DragEvent) {
    buildDragGhost(e);
    onDragStart(e);
  }

  // Right-click menu, shared by all three card layouts below. Defined before the
  // branch returns so every layout offers the same actions.
  const kanbanCtxItems: ContextMenuItem[] = [
    ...(canPin ? [
      focusPinMenuItem(isPinnedToFocus, () => toggleFocusPin(item.airtable_id)),
      { separator: true, label: "", onClick: () => {} } as ContextMenuItem,
    ] : []),
    { label: "Open details", onClick: () => onExpandClick() },
    { label: "Mark as Done", onClick: () => void onSave({ status: "Done" }) },
    { label: "Copy task name", onClick: () => { try { navigator.clipboard.writeText(item.task ?? ""); } catch { /* best effort */ } } },
    commentMenuEntry,
    { separator: true, label: "", onClick: () => {} },
    { label: "→ Export tray", icon: <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M1 9v4h12V9"/><path d="M4.5 5.5 7 3l2.5 2.5"/><path d="M7 3v7"/></svg>, onClick: () => addToTray(item) },
  ];

  // The compact and unstaged layouts are full of inputs and a rich-text editor. Let the
  // browser's own menu win there so paste/spellcheck still work.
  function handleCardContextMenu(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("input, textarea, [contenteditable='true']")) return;
    e.preventDefault();
    setCtxPos({ x: e.clientX, y: e.clientY });
  }

  // ── Collapsed card ───────────────────────────────────────────────────────────
  // One shared layout for every collapsible section, so a folded card reads the same in
  // Stage Today, Currently Tracking and Pinned In Progress. Title, status and account stay
  // visible; everything else is hidden. Still draggable and still right-clickable.
  if (collapsed) {
    return (
      <>
      <div
        draggable
        onDragStart={handleDragStartWithGhost}
        onContextMenu={handleCardContextMenu}
        className="rounded-lg shadow-blue-md cursor-grab active:cursor-grabbing select-none hover:shadow-blue-lg transition-all flex items-center gap-2 px-2.5 py-2 overflow-hidden"
        style={{ position: "relative", background: "#F4F4F6" }}
      >
        {isPinnedToFocus && <FocusPinBadge />}
        <button
          onClick={(e) => { e.stopPropagation(); toggleCardCollapse(item.airtable_id); }}
          title="Expand card"
          className="shrink-0"
        >
          <CollapseChevron collapsed />
        </button>
        <p className="flex-1 min-w-0 truncate text-xs font-semibold text-[var(--twilio-navy)]">
          {item.task || <span className="italic opacity-50">Untitled</span>}
        </p>
        <span className={`shrink-0 text-[10px] font-semibold uppercase px-1 py-0.5 rounded whitespace-nowrap ${STATUS_COLORS[statusKey] ?? STATUS_COLORS["Open"]}`}>
          {statusKey}
        </span>
        {(item.account_name || form.account_name) && (
          <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded-full max-w-[110px] truncate">
            <CorporateIcon width={10} height={10} className="shrink-0 opacity-70" />
            <span className="truncate">{item.account_name || form.account_name}</span>
          </span>
        )}
        {/* Icon + count only — a collapsed row has no space for a preview, but it
            should still say whether there is a conversation on the item. */}
        <CommentTrigger
          resourceType="action_item"
          resourceId={item.id}
          resourceLabel={item.task ?? ""}
          size="sm"
          disabled={!canPin}
        />
      </div>
      {ctxPos && (
        <ContextMenu x={ctxPos.x} y={ctxPos.y} items={kanbanCtxItems} onClose={() => setCtxPos(null)} />
      )}
      </>
    );
  }

  // ── Compact 2-row horizontal card for Stage Today / In Progress ──────────────
  if (isFullForm && !isUnstaged) {
    const assigneeName = form.assignee_name || (form.assignee_airtable_id ? form.assignee_airtable_id : "");
    const memberNames = ["Unassigned", ...teamMembers.map((m) => m.full_name)] as string[];

    const isActive = zone === "active";
    // Stage Today: [content | details | actions]
    // In Progress: [content | details | timer | actions]
    const gridCols = isActive
      ? "minmax(0, 1fr) minmax(0, 1fr) auto auto"
      : "minmax(0, 1fr) minmax(0, 1fr) auto";
    const actionsCol = isActive ? 4 : 3;

    return (
      <>
      <div
        draggable
        onDragStart={handleDragStartWithGhost}
        onContextMenu={handleCardContextMenu}
        className="rounded-lg shadow-blue-md cursor-grab active:cursor-grabbing select-none hover:shadow-blue-lg transition-all overflow-hidden"
        style={{ position: "relative", background: "#F4F4F6", display: "grid", gridTemplateColumns: gridCols, gridTemplateRows: "auto auto auto", padding: "10px 12px", gap: "4px 10px", width: "100%", alignItems: "center" }}
      >
        {isPinnedToFocus && <FocusPinBadge />}
        {/* Row 1 col 1: task name + account badge */}
        <div className="flex flex-col gap-0.5" style={{ gridColumn: 1, gridRow: 1 }}>
          <div className="flex items-center gap-1.5 min-w-0">
            {collapsible && (
              <button
                onClick={(e) => { e.stopPropagation(); toggleCardCollapse(item.airtable_id); }}
                title="Collapse card"
                className="shrink-0"
              >
                <CollapseChevron collapsed={false} />
              </button>
            )}
            <input
              value={form.task ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, task: e.target.value }))}
              placeholder="Name or short description"
              onClick={(e) => e.stopPropagation()}
              className="flex-1 min-w-0 text-sm font-semibold text-[var(--twilio-navy)] bg-transparent border-b border-gray-200 focus:border-indigo-400 focus:outline-none pb-0.5 placeholder:text-[var(--twilio-gray-60)] placeholder:font-normal"
            />
          </div>
          {(item.account_name || form.account_name) && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded-full w-fit max-w-full truncate">
              <CorporateIcon width={10} height={10} className="shrink-0 opacity-70" />
              <span className="truncate">{item.account_name || form.account_name}</span>
            </span>
          )}
          {(form.assignee_name || item.assignee_name) && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded-full w-fit max-w-full truncate">
              <svg viewBox="0 0 12 12" fill="currentColor" className="w-2.5 h-2.5 shrink-0 opacity-70"><circle cx="6" cy="4" r="2.5"/><path d="M1 10.5c0-2.2 2.2-4 5-4s5 1.8 5 4"/></svg>
              <span className="truncate">{form.assignee_name || item.assignee_name}</span>
            </span>
          )}
          {(item.attachments?.length ?? 0) > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-[var(--twilio-gray-60)]">
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-2.5 h-2.5 shrink-0"><path d="M4.5 3a2.5 2.5 0 015 0v9a1.5 1.5 0 01-3 0V5a.5.5 0 011 0v7a.5.5 0 001 0V3a1.5 1.5 0 00-3 0v9a2.5 2.5 0 005 0V5a.5.5 0 011 0v7a3.5 3.5 0 11-7 0V3z"/></svg>
              {item.attachments!.length}
            </span>
          )}
        </div>

        {/* Row 2 col 1: pills */}
        <div className="flex flex-wrap items-center gap-1.5" style={{ gridColumn: 1, gridRow: 2 }}>
          <PillSelect
            value={form.status}
            options={statusOptions as AirtableActionItem["status"][]}
            colorMap={STATUS_COLORS}
            placeholder="Status"
            onChange={(v) => setForm((f) => ({ ...f, status: v }))}
          />
          <PillSelect
            value={form.priority}
            options={["Critical", "High", "Medium", "Low"] as const}
            colorMap={PRIORITY_COLORS}
            placeholder="Priority"
            onChange={(v) => setForm((f) => ({ ...f, priority: v }))}
          />
          <PillDate value={form.due_date} onChange={(v) => setForm((f) => ({ ...f, due_date: v }))} />
          <PillNumber value={form.estimated_time} label="Est." onChange={(v) => setForm((f) => ({ ...f, estimated_time: v ?? 0 }))} />
          <PillNumber value={form.time_spent} label="Spent" onChange={(v) => setForm((f) => ({ ...f, time_spent: v ?? 0 }))} />
          <PillNumber value={form.prep_time} label="Prep" onChange={(v) => setForm((f) => ({ ...f, prep_time: v ?? 0 }))} />
          <PillUrl
            value={form.slack_thread_url}
            onChange={(v) => { setForm((f) => ({ ...f, slack_thread_url: v })); autosaveSlackLink(item, v, onUpdated); }}
          />
          {teamMembers.length > 0 && (
            <PillSelect
              value={(assigneeName || "Unassigned") as string}
              options={memberNames as string[]}
              colorMap={{}}
              placeholder="Unassigned"
              onChange={(v) => {
                const member = teamMembers.find((m) => m.full_name === v);
                setForm((f) => ({
                  ...f,
                  assignee_airtable_id: member ? String(member.id) : "",
                  assignee_name: member?.full_name ?? "",
                }));
              }}
            />
          )}
        </div>

        {/* Col 2 spanning both rows: task details */}
        <div
          style={{ gridColumn: 2, gridRow: "1 / 3" }}
          className="h-full overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <RichTextMentionEditor
            value={form.task_details ?? ""}
            onChange={(html) => setForm((f) => ({ ...f, task_details: html }))}
            placeholder="Task details…"
            minHeightClassName="min-h-[60px]"
          />
        </div>

        {/* Col 3 (In Progress only) spanning both rows: timer + track/stop */}
        {isActive && onTimerToggle && (
          <div className="flex flex-col items-center justify-between gap-2 self-stretch" style={{ gridColumn: 3, gridRow: "1 / 3" }}>
            <EditableTimer
              elapsed={elapsed}
              onCommit={(s) => {
                onTimerEdit?.(s);
              }}
            />
            <button
              onClick={(e) => { e.stopPropagation(); onTimerToggle(); }}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wide transition-colors ${
                timer?.running ? "bg-red-50 text-red-700 hover:bg-red-100" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              }`}
            >
              {timer?.running ? "Stop" : "Track"}
            </button>
          </div>
        )}

        {/* Last col spanning both rows: expand + save + reminder + delete */}
        <div className="flex flex-col items-center justify-between gap-2 self-stretch" style={{ gridColumn: actionsCol, gridRow: "1 / 3" }}>
          <button
            onClick={(e) => { e.stopPropagation(); onExpandClick(); }}
            title="Expand to full editor"
            className="shrink-0 text-[var(--twilio-navy)] hover:text-indigo-500 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9"/>
              <polyline points="9 21 3 21 3 15"/>
              <line x1="21" y1="3" x2="14" y2="10"/>
              <line x1="3" y1="21" x2="10" y2="14"/>
            </svg>
          </button>
          <button
            disabled={saving}
            onClick={async (e) => {
              e.stopPropagation();
              setSaving(true);
              await onSave(form);
              setSaving(false);
            }}
            className="shrink-0 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
          >
            {saving ? "…" : "Save"}
          </button>
          {!item.airtable_id.startsWith("local-") && onUpdated && (
            <ReminderButton item={item} onUpdated={onUpdated} />
          )}
          {onDelete && <DeleteButton onDelete={onDelete} />}
        </div>

        {/* Row 3: calendar occurrences spanning content columns */}
        <KanbanCardOccurrencesInline airtableId={item.airtable_id} colSpan={isActive ? 2 : 2} />

        <CommentPreviewList
          resourceType="action_item"
          resourceId={canPin ? item.id : null}
          resourceLabel={item.task ?? ""}
          className="col-span-2"
        />
      </div>
      {ctxPos && (
        <ContextMenu x={ctxPos.x} y={ctxPos.y} items={kanbanCtxItems} onClose={() => setCtxPos(null)} />
      )}
      </>
    );
  }

  // ── Full tall card for Unstaged ───────────────────────────────────────────────
  if (isUnstaged) {
    return (
      <>
      <div
        draggable
        onDragStart={handleUnstagedDragStart}
        onContextMenu={handleCardContextMenu}
        className="rounded-xl shadow-blue-md cursor-grab active:cursor-grabbing select-none hover:shadow-blue-lg transition-all flex flex-col overflow-hidden"
        style={{ position: "relative", background: "#F4F4F6" }}
      >
        {isPinnedToFocus && <FocusPinBadge />}
        {/* Task title — above badges */}
        <div className="px-4 pt-3 pb-2">
          <input
            value={form.task ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, task: e.target.value }))}
            placeholder="Name or short description"
            onClick={(e) => e.stopPropagation()}
            className="w-full text-xs font-semibold text-[var(--twilio-navy)] bg-transparent border-b border-gray-200 focus:border-indigo-400 focus:outline-none pb-1 placeholder:text-[var(--twilio-gray-60)] placeholder:font-normal"
          />
        </div>

        {/* Card header — badges */}
        <div className="px-4 pb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-nowrap overflow-hidden min-w-0">
            {form.priority && (
              <span className={`text-[10px] font-semibold uppercase px-1 py-0.5 rounded whitespace-nowrap shrink ${PRIORITY_COLORS[form.priority]}`}>
                {form.priority}
              </span>
            )}
            <span className={`text-[10px] font-semibold uppercase px-1 py-0.5 rounded whitespace-nowrap shrink ${STATUS_COLORS[statusKey] ?? STATUS_COLORS["Open"]}`}>
              {statusKey}
            </span>
            {form.account_name && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded-full min-w-0 max-w-[120px] truncate">
                <CorporateIcon width={10} height={10} className="shrink-0 opacity-70" />
                <span className="truncate">{form.account_name}</span>
              </span>
            )}
            {(item.attachments?.length ?? 0) > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-[var(--twilio-gray-60)] shrink-0">
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-2.5 h-2.5"><path d="M4.5 3a2.5 2.5 0 015 0v9a1.5 1.5 0 01-3 0V5a.5.5 0 011 0v7a.5.5 0 001 0V3a1.5 1.5 0 00-3 0v9a2.5 2.5 0 005 0V5a.5.5 0 011 0v7a3.5 3.5 0 11-7 0V3z"/></svg>
                {item.attachments!.length}
              </span>
            )}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onExpandClick(); }}
            title="Expand to full editor"
            className="shrink-0 text-[var(--twilio-navy)] hover:text-indigo-500 transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9"/>
              <polyline points="9 21 3 21 3 15"/>
              <line x1="21" y1="3" x2="14" y2="10"/>
              <line x1="3" y1="21" x2="10" y2="14"/>
            </svg>
          </button>
        </div>

        {/* Inline fields */}
        <div className="px-4 py-3 flex-1">
          <ActionItemFields
            form={form}
            onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
            autosaveTarget={item}
            onAutosaved={onUpdated}
            teamMembers={teamMembers}
            accounts={accounts}
            hideTask
            compact
          />
        </div>

        <WaitingOnBadge item={item} className="px-4 pb-2" />

        {/* Footer */}
        <div className="px-4 py-3 flex items-center justify-between rounded-b-xl">
          <div className="flex items-center gap-2">
            {form.last_synced ? (
              <span className="text-[11px] text-[var(--twilio-navy)] tabular-nums">
                Synced {new Date(form.last_synced).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </span>
            ) : <span />}
            {(item.time_spent ?? 0) > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full">
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-2.5 h-2.5 shrink-0"><circle cx="6" cy="6" r="5"/><path d="M6 3v3l2 1.5" strokeLinecap="round"/></svg>
                {fmtTime(item.time_spent)}
              </span>
            )}
            {!item.airtable_id.startsWith("local-") && onUpdated && (
              <ReminderButton item={item} onUpdated={onUpdated} />
            )}
            {onDelete && <DeleteButton onDelete={onDelete} />}
          </div>
          <button
            disabled={saving}
            onClick={async (e) => {
              e.stopPropagation();
              setSaving(true);
              if (onSaveAndStage) {
                await onSaveAndStage(form);
              } else {
                await onSave(form);
              }
              setSaving(false);
            }}
            className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      {ctxPos && (
        <ContextMenu x={ctxPos.x} y={ctxPos.y} items={kanbanCtxItems} onClose={() => setCtxPos(null)} />
      )}
      </>
    );
  }

  return (
    <>
    <div
      draggable
      onDragStart={handleDragStartWithGhost}
      onClick={(e) => { e.stopPropagation(); onExpandClick(); }}
      onContextMenu={(e) => { e.preventDefault(); setCtxPos({ x: e.clientX, y: e.clientY }); }}
      className="rounded-lg shadow-blue-md cursor-grab active:cursor-grabbing select-none hover:shadow-blue-lg transition-all flex flex-col overflow-hidden"
      style={{ position: "relative", background: "#F4F4F6" }}
    >
      {isPinnedToFocus && <FocusPinBadge />}
      <div className="px-3 pt-3 pb-2 flex-1 flex flex-col gap-1.5">
        <div className="flex items-start justify-between gap-1">
          <div className="flex items-center gap-1 min-w-0 overflow-hidden">
            {collapsible && (
              <button
                onClick={(e) => { e.stopPropagation(); toggleCardCollapse(item.airtable_id); }}
                title="Collapse card"
                className="shrink-0"
              >
                <CollapseChevron collapsed={false} />
              </button>
            )}
            {form.priority && (
              <span className={`text-[10px] font-semibold uppercase px-1 py-0.5 rounded whitespace-nowrap min-w-0 shrink ${PRIORITY_COLORS[form.priority]}`}>
                {form.priority}
              </span>
            )}
            <span className={`text-[10px] font-semibold uppercase px-1 py-0.5 rounded whitespace-nowrap min-w-0 shrink ${STATUS_COLORS[statusKey] ?? STATUS_COLORS["Open"]}`}>
              {statusKey}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!item.airtable_id.startsWith("local-") && onUpdated && (
              <ReminderButton item={item} onUpdated={onUpdated} />
            )}
            {onDelete && <DeleteButton onDelete={onDelete} />}
          </div>
        </div>
        <p className="text-xs font-medium text-[var(--twilio-navy)] leading-snug line-clamp-2">
          {item.task || <span className="italic opacity-50">Untitled — click to edit</span>}
        </p>
        {item.account_name && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded-full w-fit max-w-full truncate">
            <CorporateIcon width={10} height={10} className="shrink-0 opacity-70" />
            <span className="truncate">{item.account_name}</span>
          </span>
        )}
        {item.due_date && (
          <p className="text-xs text-[var(--twilio-navy)]">
            Due {new Date(item.due_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </p>
        )}
        {(item.time_spent ?? 0) > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full w-fit">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-2.5 h-2.5 shrink-0"><circle cx="6" cy="6" r="5"/><path d="M6 3v3l2 1.5" strokeLinecap="round"/></svg>
            {fmtTime(item.time_spent)}
          </span>
        )}
        <WaitingOnBadge item={item} />
        {(item.attachments?.length ?? 0) > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-[var(--twilio-gray-60)]">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-2.5 h-2.5 shrink-0"><path d="M4.5 3a2.5 2.5 0 015 0v9a1.5 1.5 0 01-3 0V5a.5.5 0 011 0v7a.5.5 0 001 0V3a1.5 1.5 0 00-3 0v9a2.5 2.5 0 005 0V5a.5.5 0 011 0v7a3.5 3.5 0 11-7 0V3z"/></svg>
            {item.attachments!.length}
          </span>
        )}
        <KanbanCardOccurrences airtableId={item.airtable_id} />
        <CommentPreviewList
          resourceType="action_item"
          resourceId={canPin ? item.id : null}
          resourceLabel={item.task ?? ""}
        />
      </div>
    </div>
    {ctxPos && (
      <ContextMenu
        x={ctxPos.x}
        y={ctxPos.y}
        items={kanbanCtxItems}
        onClose={() => setCtxPos(null)}
      />
    )}
    </>
  );
}

// ── Completed-stack deck per account ─────────────────────────────────────────

function CompletedDeckTrigger({
  items,
  open,
  onToggle,
}: {
  items: AirtableActionItem[];
  open: boolean;
  onToggle: () => void;
}) {
  if (items.length === 0) return null;
  const top = items[0];
  const ghostCount = Math.min(items.length - 1, 2);
  const accent = PRIORITY_ACCENT[top.priority] ?? "#9ca3af";
  // card is 160px wide × 80px tall; ghosts offset 8px right + 4px down each
  const cardW = 160;
  const cardH = 80;
  const offsetX = 8;
  const offsetY = 4;
  const totalW = cardW + ghostCount * offsetX;
  const totalH = cardH + ghostCount * offsetY;

  return (
    <button
      onClick={onToggle}
      title={open ? "Collapse" : `${items.length} completed`}
      style={{ position: "relative", width: totalW, height: totalH + 8, cursor: "pointer", background: "none", border: "none", padding: 0, flexShrink: 0, alignSelf: "center" }}
    >
      {/* Ghost cards behind — rendered first (lowest z) */}
      {Array.from({ length: ghostCount }).map((_, gi) => (
        <div
          key={gi}
          style={{
            position: "absolute",
            top: (ghostCount - gi) * offsetY,
            left: (ghostCount - gi) * offsetX,
            width: cardW,
            height: cardH,
            background: "#d1fae5",
            borderRadius: 6,
            border: "1px solid #6ee7b7",
            boxShadow: "0 1px 3px rgba(0,0,0,0.07)",
            zIndex: gi + 1,
          }}
        />
      ))}
      {/* Front card with real content */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: cardW,
          height: cardH,
          background: "#fff",
          borderRadius: 6,
          border: "1px solid #e5e7eb",
          borderLeft: `3px solid ${accent}`,
          boxShadow: "0 1px 4px rgba(0,0,0,0.10)",
          zIndex: ghostCount + 2,
          padding: "6px 8px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ${PRIORITY_COLORS[top.priority]}`}>{top.priority}</span>
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ${STATUS_COLORS[top.status] ?? "bg-gray-100 text-gray-700"}`}>{top.status}</span>
        </div>
        <p style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--twilio-navy)", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, lineHeight: 1.3 }}>
          {top.task || "Untitled"}
        </p>
        {top.account_name && (
          <p style={{ fontSize: "0.625rem", color: "var(--twilio-navy)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{top.account_name}</p>
        )}
        {top.assignee_name && (
          <p style={{ fontSize: "0.625rem", color: "#9ca3af", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{top.assignee_name}</p>
        )}
      </div>
      {/* Count badge */}
      <span style={{
        position: "absolute", bottom: 0, right: 0,
        fontSize: 10, fontWeight: 700, background: "#059669", color: "#fff",
        borderRadius: "50%", width: 16, height: 16,
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: ghostCount + 3,
      }}>{items.length}</span>
    </button>
  );
}

// Chevron for an account group header. Points down when expanded, right when collapsed.
function CollapseChevron({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={`w-3 h-3 shrink-0 text-[var(--twilio-gray-60)] transition-transform ${collapsed ? "-rotate-90" : ""}`}
    >
      <path d="M2 4l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Open/Done counts shown on an account row header, so a collapsed row still says how much
// it is hiding.
function GroupCounts({ items }: { items: AirtableActionItem[] }) {
  const done = items.filter((i) => i.status === "Done").length;
  const open = items.length - done;
  if (items.length === 0) return null;
  return (
    <span className="flex items-center gap-1 shrink-0">
      {open > 0 && (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-[var(--twilio-navy)]">{open} open</span>
      )}
      {done > 0 && (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">{done} done</span>
      )}
    </span>
  );
}

/**
 * "Drop here" affordance filling the body of a collapsed account row.
 *
 * A collapsed row has always accepted drops — it just gave no sign of it, so filing a card
 * under an account you had folded away meant aiming at a 40px strip on faith. Rendered only
 * while a card is actually in the air, so the resting grid is unchanged.
 */
function CollapsedRowDropHint({ active, dragInFlight, name }: { active: boolean; dragInFlight: boolean; name: string }) {
  if (!dragInFlight) return <div className="flex-1" />;
  return (
    <div data-testid="collapsed-drop-hint" className="flex-1 flex items-center px-3 py-2 min-w-0">
      <span
        className={`text-[11px] font-semibold rounded-md border border-dashed px-2 py-1 truncate transition-colors ${
          active ? "border-indigo-400 text-indigo-600 bg-indigo-50" : "border-gray-300 text-[var(--twilio-gray-60)]"
        }`}
      >
        {active ? `Drop to file under ${name}` : "Drop here"}
      </span>
    </div>
  );
}

// Insertion marker shown between cards while dragging inside a hand-ordered zone.
// Sits in the container's existing gap, so showing it reflows nothing.
function DropIndicator() {
  return <div data-testid="drop-indicator" className="h-0.5 -my-1 rounded-full bg-indigo-500 shrink-0" />;
}

// ── Drop zone ─────────────────────────────────────────────────────────────────

function DropZone({
  zone,
  label,
  description,
  items,
  timers,
  accounts,
  teamMembers,
  dragOverZone,
  onDragOver,
  onDragLeave,
  onDrop,
  onSave,
  onSaveAndStage,
  onExpand,
  onDelete,
  onUpdated,
  onDragStart,
  onTimerToggle,
  onTimerEdit,
  autoTrack,
  onAutoTrackToggle,
  starredAccountKey,
  onStarAccount,
  completedItems,
  pinnedIds,
  onPin,
  myCollabId,
  className,
  style,
  pageView,
  onPageViewChange,
  search,
  onSearchChange,
  allRealItems,
  onSaveFieldsOnly,
  itemZones,
  onRestoreToViews,
  externalDragId,
  onExternalDropWithStatus,
  onAccountDrop,
  focusMode,
  reorderable,
  dragId,
  dropHint,
  onDropHint,
  collapsible,
}: {
  zone: Zone;
  label: string;
  description: string;
  items: AirtableActionItem[];
  timers?: Record<string, TimerState>;
  accounts?: KanbanAccount[];
  teamMembers?: TeamMember[];
  dragOverZone: Zone | null;
  onDragOver: (e: React.DragEvent, zone: Zone) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, zone: Zone, accountKey?: string) => void;
  onSave: (item: AirtableActionItem, fields: Partial<AirtableActionItem>) => Promise<void>;
  onSaveAndStage?: (item: AirtableActionItem, form: Partial<AirtableActionItem>) => Promise<void>;
  onExpand: (item: AirtableActionItem) => void;
  onDelete?: (item: AirtableActionItem) => void;
  onUpdated?: (item: AirtableActionItem) => void;
  onDragStart: (e: React.DragEvent, item: AirtableActionItem) => void;
  onTimerToggle?: (airtableId: string) => void;
  onTimerEdit?: (airtableId: string, seconds: number) => void;
  autoTrack?: boolean;
  onAutoTrackToggle?: () => void;
  starredAccountKey?: string | null;
  onStarAccount?: (key: string | null) => void;
  completedItems?: AirtableActionItem[];
  pinnedIds?: Set<string>;
  onPin?: (item: AirtableActionItem) => void;
  myCollabId?: string | null;
  className?: string;
  style?: React.CSSProperties;
  // accounts-zone view controls
  pageView?: PageView;
  onPageViewChange?: (v: PageView) => void;
  search?: string;
  onSearchChange?: (v: string) => void;
  allRealItems?: AirtableActionItem[];
  onSaveFieldsOnly?: (item: AirtableActionItem, fields: Partial<AirtableActionItem>) => Promise<void>;
  itemZones?: Record<string, Zone>;
  onRestoreToViews?: (item: AirtableActionItem) => void;
  // The airtable_id being dragged from outside this zone (so status columns can accept external drops)
  externalDragId?: string | null;
  onExternalDropWithStatus?: (airtableId: string, status: AirtableActionItem["status"]) => void;
  /** File the dragged card under an account without touching its zone. Used by the Projects
   *  view's per-group drop targets; `"none"` clears the account. */
  onAccountDrop?: (e: React.DragEvent, accountKey: string) => void;
  /** Focus mode is on. Pinned items are hoisted into the Pinned In Progress section, so
   *  the accounts grid shows them as ghosts instead of full cards. */
  focusMode?: boolean;
  // ── Hand-ordering (today / active only) ──────────────────────────────────────
  /** Cards in this zone can be reordered by dragging. */
  reorderable?: boolean;
  /** The airtable_id currently being dragged, used to hide the indicator next to itself. */
  dragId?: string | null;
  /** Where the dragged card would land. */
  dropHint?: DropHint | null;
  /** Report a candidate insertion point. Cards never handle the drop itself — the event
   *  bubbles to the zone container so handleDrop stays the single mutation site. */
  onDropHint?: (zone: ReorderableZone, beforeId: string | null) => void;
  /** Give each card a collapse toggle in its top-left corner. */
  collapsible?: boolean;
}) {
  const isOver = dragOverZone === zone;
  const [accountView, setAccountView] = useState<"mine" | "team">("mine");
  const [openDeckKey, setOpenDeckKey] = useState<string | null>(null);
  const { pinnedIds: focusPinnedIds } = useFocusPins();
  const { isCollapsed, toggle: toggleCollapse, setAll: setAllCollapsed, allCollapsed } = useAccountGroupCollapse();
  const { exportMode, toggleItem, isSelected } = useExport();

  if (zone === "accounts") {
    // Exclude Done items from the active list — they live in the completed deck
    const activeItems = items.filter((i) => i.status !== "Done");
    // Filter active items by mine/team
    const filteredItems = accountView === "mine" && myCollabId
      ? activeItems.filter((i) => !i.assignee_airtable_id || i.assignee_airtable_id === myCollabId)
      : activeItems;

    // Build filtered items for Status/Due views
    const q = (search ?? "").trim().toLowerCase();
    const matchesSearch = (i: AirtableActionItem) => {
      if (!q) return true;
      if (i.task?.toLowerCase().includes(q)) return true;
      if (i.task_details?.toLowerCase().includes(q)) return true;
      if (i.account_name?.toLowerCase().includes(q)) return true;
      if (i.assignee_name?.toLowerCase().includes(q)) return true;
      if (i.due_date) {
        const ds = new Date(i.due_date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }).toLowerCase();
        if (ds.includes(q)) return true;
        if (dueDateGroup(i).toLowerCase().includes(q)) return true;
      }
      return false;
    };
    const viewItems = (allRealItems ?? []).filter(matchesSearch);

    const currentView = pageView ?? "kanban";

    // Every group key the Collapse all button should act on. The Views grid and the
    // Projects view share one canonical key space (lowercased account name), so the union
    // of both lists is correct and lets one button cover whichever view is on screen.
    const hasUnmatched = (() => {
      const known = new Set((accounts ?? []).map((a) => a.name.toLowerCase()));
      return filteredItems.some((i) => i.account_name && !known.has(i.account_name.toLowerCase()));
    })();
    const visibleGroupKeys = [...new Set([
      NO_ACCOUNT_GROUP_KEY,
      ...(accounts ?? []).map((a) => accountGroupKey(a.name)),
      ...viewItems.map((i) => accountGroupKey(i.account_name)),
      ...(hasUnmatched ? [UNMATCHED_GROUP_KEY] : []),
    ])];
    const allGroupsCollapsed = allCollapsed(visibleGroupKeys);

    return (
      <div className={`flex flex-col bg-white rounded-lg shadow-blue-md ${className ?? ""}`} style={style}>
        {/* Header: title left, controls right */}
        <div className="px-5 py-3 shrink-0 flex items-center gap-3 flex-wrap border-b border-gray-100">
          <p className="text-sm font-semibold text-[var(--twilio-navy)] shrink-0">{label}</p>
          {/* View switcher */}
          <div style={{ display: "flex", background: "#f3f4f6", borderRadius: 8, padding: 2, gap: 2, flexShrink: 0 }}>
            {([
              { id: "kanban",   label: "Accounts" },
              { id: "status",   label: "By Status" },
              { id: "due",      label: "By Due Date" },
              { id: "projects", label: "Projects" },
            ] as { id: PageView; label: string }[]).map(({ id, label: btnLabel }) => (
              <button
                key={id}
                onClick={() => onPageViewChange?.(id)}
                style={{
                  padding: "3px 10px", fontSize: "0.6875rem", fontWeight: 600,
                  borderRadius: 6, border: "none", cursor: "pointer",
                  background: currentView === id ? "#fff" : "transparent",
                  color: currentView === id ? "var(--twilio-navy)" : "#9ca3af",
                  boxShadow: currentView === id ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                  whiteSpace: "nowrap",
                }}
              >
                {btnLabel}
              </button>
            ))}
          </div>
          {/* Mine / Team toggle — only in accounts view */}
          {(currentView === "kanban") && (
            <div style={{ display: "flex", background: "#f3f4f6", borderRadius: 8, padding: 2, gap: 2, flexShrink: 0 }}>
              {(["mine", "team"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setAccountView(v)}
                  style={{
                    padding: "3px 10px", fontSize: "0.6875rem", fontWeight: 600,
                    borderRadius: 6, border: "none", cursor: "pointer",
                    background: accountView === v ? "#fff" : "transparent",
                    color: accountView === v ? "var(--twilio-navy)" : "#9ca3af",
                    boxShadow: accountView === v ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                    textTransform: "uppercase", letterSpacing: "0.04em",
                  }}
                >
                  {v}
                </button>
              ))}
            </div>
          )}
          {/* Collapse all / Expand all — one button covering both grouped views. The label
              is derived from the store, so it flips to "Expand all" as soon as the last
              expanded group is collapsed by hand. */}
          {(currentView === "kanban" || currentView === "projects") && (
            <button
              onClick={() => setAllCollapsed(visibleGroupKeys, !allGroupsCollapsed)}
              className="shrink-0 px-2 py-1 rounded-lg text-[11px] font-semibold uppercase tracking-wide border border-gray-300 bg-gray-50 text-[var(--twilio-gray-80)] hover:bg-gray-100 transition-colors"
            >
              {allGroupsCollapsed ? "Expand all" : "Collapse all"}
            </button>
          )}
          {/* Search — shown in all views */}
          <div className="relative flex-1" style={{ minWidth: 160, maxWidth: 300 }}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-[var(--twilio-gray-60)] pointer-events-none">
              <circle cx="6.5" cy="6.5" r="4.5"/><path d="M10.5 10.5l3 3" strokeLinecap="round"/>
            </svg>
            <input
              type="text"
              value={search ?? ""}
              onChange={(e) => onSearchChange?.(e.target.value)}
              placeholder="Search…"
              className="w-full pl-7 pr-6 py-1 text-xs rounded-lg border border-gray-200 bg-gray-50 text-[var(--twilio-navy)] placeholder:text-[var(--twilio-gray-60)] focus:outline-none focus:border-indigo-400 focus:bg-white"
            />
            {search && (
              <button onClick={() => onSearchChange?.("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-base leading-none">×</button>
            )}
          </div>
        </div>

        {/* Body: switch between accounts kanban, status board, and due date */}
        {currentView === "status" && (
          <div className="flex-1 p-4 overflow-auto">
            <StatusBoardView
              items={viewItems}
              onExpand={onExpand}
              onSave={onSaveFieldsOnly ?? onSave}
              onDelete={onDelete ?? (() => {})}
              onUpdated={onUpdated ?? (() => {})}
              teamMembers={[]}
              externalDragId={externalDragId}
              onExternalDrop={onExternalDropWithStatus}
              onDragStart={onDragStart}
              onDragEnd={onDragLeave}
            />
          </div>
        )}
        {currentView === "due" && (
          <div className="flex-1 p-4 overflow-auto">
            <DueDateView items={viewItems} onExpand={onExpand} onSave={onSaveFieldsOnly ?? onSave} onDragStart={onDragStart} onDragEnd={onDragLeave} />
          </div>
        )}
        {currentView === "projects" && (
          <div className="flex-1 p-4 overflow-auto">
            <ProjectsView
              items={viewItems}
              accounts={accounts ?? []}
              onExpand={onExpand}
              onSave={onSaveFieldsOnly ?? onSave}
              externalDragId={externalDragId}
              onExternalDrop={onExternalDropWithStatus}
              onAccountDrop={onAccountDrop}
              onDragStart={onDragStart}
              onDragEnd={onDragLeave}
            />
          </div>
        )}
        {currentView === "kanban" && <div className="flex-1 overflow-y-auto">
          {(accounts ?? []).length === 0 && (
            <p className="text-sm text-[var(--twilio-navy)] p-3">No accounts loaded</p>
          )}
          {/* No Account row — listed first */}
          {(() => {
            const noAccItems = filteredItems.filter((i) => !i.account_name);
            const noAccCompleted = (completedItems ?? []).filter((i) => !i.account_name && !(pinnedIds ?? new Set()).has(i.airtable_id));
            const zoneKey = "account-none" as Zone;
            const isAccOver = dragOverZone === zoneKey;
            const groupKey = NO_ACCOUNT_GROUP_KEY;
            const rowCollapsed = isCollapsed(groupKey);
            return (
              <div
                className={`flex flex-col border-b border-gray-100 transition-colors ${isAccOver ? "bg-indigo-50" : "hover:bg-gray-50"}`}
                onDragOver={(e) => onDragOver(e, zoneKey)}
                onDragLeave={(e) => { if (leftElement(e)) onDragLeave(); }}
                onDrop={(e) => onDrop(e, "accounts", "none")}
              >
                <div className="flex items-stretch">
                  <div className="w-36 shrink-0 px-3 py-2 border-r border-gray-100 flex flex-col justify-center">
                    <button
                      onClick={() => toggleCollapse(groupKey)}
                      title={rowCollapsed ? "Expand No Account" : "Collapse No Account"}
                      className="flex items-center gap-1.5 text-left min-w-0"
                    >
                      <CollapseChevron collapsed={rowCollapsed} />
                      <p className="text-sm font-medium text-[var(--twilio-gray-60)] leading-tight italic truncate">No Account</p>
                    </button>
                    {rowCollapsed && <div className="mt-1 pl-4"><GroupCounts items={[...noAccItems, ...noAccCompleted]} /></div>}
                  </div>
                  {rowCollapsed && <CollapsedRowDropHint active={isAccOver} dragInFlight={!!externalDragId} name="No Account" />}
                  {!rowCollapsed && <>
                  <div className="flex-1 overflow-x-auto">
                    <div className="flex flex-row gap-2 p-2 min-w-0">
                      {noAccItems.map((item) => (
                        <div key={item.airtable_id} className="w-44 shrink-0">
                          <KanbanCard item={item} zone="accounts" onDragStart={(e) => onDragStart(e, item)} onSave={(fields) => onSave(item, fields)} onExpandClick={() => onExpand(item)} onDelete={onDelete ? () => onDelete(item) : undefined} onUpdated={onUpdated} />
                        </div>
                      ))}
                      {noAccItems.length === 0 && (
                        <div className={`w-36 shrink-0 flex items-center justify-center h-16 rounded-lg border-2 border-dashed text-sm ${isAccOver ? "border-indigo-400 text-indigo-600" : "border-gray-300 text-[var(--twilio-gray-60)]"}`}>Drop here</div>
                      )}
                    </div>
                  </div>
                  {/* Done drop target + completed deck trigger */}
                  <div className="flex items-center shrink-0">
                    <div
                      className={`flex flex-col items-center justify-center w-14 self-stretch transition-colors cursor-default ${dragOverZone === "done-accounts-none" ? "bg-emerald-100" : "hover:bg-emerald-50"}`}
                      style={{ borderLeft: "1px solid #e5e7eb" }}
                      onDragOver={(e) => onDragOver(e, "done-accounts-none" as Zone)}
                      onDragLeave={onDragLeave}
                      onDrop={(e) => onDrop(e, "done-accounts", "none")}
                      title="Drop here to mark Done"
                    >
                      <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" className={`w-3.5 h-3.5 transition-colors ${dragOverZone === "done-accounts-none" ? "text-emerald-600" : "text-emerald-400"}`}>
                        <path d="M2 7l3.5 3.5L12 3.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <span className={`text-[9px] font-semibold uppercase tracking-wide mt-0.5 transition-colors ${dragOverZone === "done-accounts-none" ? "text-emerald-700" : "text-emerald-400"}`}>Done</span>
                    </div>
                    {noAccCompleted.length > 0 && onPin && (
                      <div className="px-2 flex items-center">
                        <CompletedDeckTrigger
                          items={noAccCompleted}
                          open={openDeckKey === "none"}
                          onToggle={() => setOpenDeckKey(openDeckKey === "none" ? null : "none")}
                        />
                      </div>
                    )}
                  </div>
                  </>}
                </div>
                {/* Expanded completed row */}
                {!rowCollapsed && openDeckKey === "none" && noAccCompleted.length > 0 && onPin && (
                  <div
                    className="flex gap-2 px-3 pb-2 overflow-x-auto transition-colors"
                    style={{ borderTop: "1px solid #f0fdf4", background: dragOverZone === "done-accounts-none" ? "#dcfce7" : "#f0fdf4", scrollbarWidth: "thin" }}
                    onDragOver={(e) => onDragOver(e, "done-accounts-none" as Zone)}
                    onDragLeave={onDragLeave}
                    onDrop={(e) => onDrop(e, "done-accounts", "none")}
                  >
                    <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wide self-center shrink-0 mr-1">
                      {dragOverZone === "done-accounts-none" ? "Drop to mark Done" : "Completed"}
                    </p>
                    {noAccCompleted.map((item) => (
                      <div key={item.airtable_id} className="shrink-0 w-44 py-2 flex flex-col gap-1 group">
                        <div className="relative">
                          <KanbanCard item={item} zone="accounts" onDragStart={(e) => onDragStart(e, item)} onSave={(fields) => onSave(item, fields)} onExpandClick={() => onExpand(item)} onDelete={onDelete ? () => onDelete(item) : undefined} onUpdated={onUpdated} />
                          <button
                            onClick={() => onPin(item)}
                            title="Pin to active list"
                            className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{ background: "rgba(255,255,255,0.9)", border: "none", borderRadius: 4, cursor: "pointer", padding: 2, color: "#9ca3af" }}
                          >
                            <svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor"><path d="M9.828.722a.5.5 0 01.354.146l4.95 4.95a.5.5 0 010 .707c-.48.48-1.072.588-1.503.588-.177 0-.335-.018-.46-.039l-3.134 3.134a5.927 5.927 0 01.16 1.013c.046.702-.032 1.687-.72 2.375a.5.5 0 01-.707 0l-2.829-2.828-3.182 3.182c-.195.195-1.219.902-1.414.707-.195-.195.512-1.22.707-1.414l3.182-3.182-2.828-2.829a.5.5 0 010-.707c.688-.688 1.673-.767 2.375-.72a5.922 5.922 0 011.013.16l3.134-3.133a2.772 2.772 0 01-.04-.461c0-.43.108-1.022.589-1.503a.5.5 0 01.353-.146z"/></svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
          {(accounts ?? []).map((acc) => {
            const accItems = filteredItems.filter((i) => i.account_name?.toLowerCase() === acc.name.toLowerCase());
            const accCompleted = (completedItems ?? []).filter((i) => i.account_name?.toLowerCase() === acc.name.toLowerCase() && !(pinnedIds ?? new Set()).has(i.airtable_id));
            // Items that belong to this account but are rendered elsewhere — shown as
            // ghosts so the row never looks emptier than it is. Either staged in
            // today/active, or hoisted into Pinned In Progress by focus mode.
            const stagedItems = (allRealItems ?? []).filter((i) => {
              const z = itemZones?.[i.airtable_id];
              const pinnedAway = !!focusMode && focusPinnedIds.has(i.airtable_id);
              return (z === "today" || z === "active" || pinnedAway)
                && i.account_name?.toLowerCase() === acc.name.toLowerCase();
            });
            const zoneKey = `account-${acc.key}` as Zone;
            const isAccOver = dragOverZone === zoneKey;
            const groupKey = accountGroupKey(acc.name);
            const rowCollapsed = isCollapsed(groupKey);
            return (
              <div
                key={acc.key}
                className={`flex flex-col border-b border-gray-100 transition-colors ${isAccOver ? "bg-indigo-50" : "hover:bg-gray-50"}`}
                onDragOver={(e) => onDragOver(e, zoneKey)}
                onDragLeave={(e) => { if (leftElement(e)) onDragLeave(); }}
                onDrop={(e) => onDrop(e, "accounts", acc.key)}
              >
                <div className="flex items-stretch">
                  {/* Account label column. The star and the collapse toggle are siblings —
                      nesting one button inside the other would be invalid. */}
                  <div className="w-36 shrink-0 px-3 py-2 border-r border-gray-100 flex flex-col justify-center">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <button title={starredAccountKey === acc.key ? "Remove auto-assign" : "Auto-assign blank cards to this account"} onClick={() => onStarAccount?.(starredAccountKey === acc.key ? null : acc.key)} className="shrink-0 leading-none transition-transform hover:scale-110">
                        <svg viewBox="0 0 20 20" fill={starredAccountKey === acc.key ? "#f59e0b" : "none"} stroke={starredAccountKey === acc.key ? "#f59e0b" : "#9ca3af"} strokeWidth="1.5" className="w-4 h-4">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                        </svg>
                      </button>
                      <button
                        onClick={() => toggleCollapse(groupKey)}
                        title={rowCollapsed ? `Expand ${acc.name}` : `Collapse ${acc.name}`}
                        className="flex items-center gap-1 min-w-0 text-left"
                      >
                        <CollapseChevron collapsed={rowCollapsed} />
                        <p className="text-sm font-medium text-[var(--twilio-navy)] leading-tight truncate">{acc.name}</p>
                      </button>
                    </div>
                    {rowCollapsed
                      ? <div className="mt-1 pl-5"><GroupCounts items={[...accItems, ...accCompleted]} /></div>
                      : acc.source === "airtable" && <span className="text-[10px] text-[var(--twilio-gray-60)] mt-0.5 pl-5">Airtable</span>}
                  </div>
                  {rowCollapsed && <CollapsedRowDropHint active={isAccOver} dragInFlight={!!externalDragId} name={acc.name} />}
                  {!rowCollapsed && <>
                  {/* Cards scrolling horizontally */}
                  <div className="flex-1 overflow-x-auto">
                    <div className="flex flex-row gap-2 p-2 min-w-0">
                      {accItems.map((item) => (
                        <div key={item.airtable_id} className="w-44 shrink-0">
                          <KanbanCard item={item} zone="accounts" onDragStart={(e) => onDragStart(e, item)} onSave={(fields) => onSave(item, fields)} onExpandClick={() => onExpand(item)} onDelete={onDelete ? () => onDelete(item) : undefined} onUpdated={onUpdated} />
                        </div>
                      ))}
                      {/* Ghost cards for items rendered in another panel */}
                      {stagedItems.map((item) => {
                        const z = itemZones?.[item.airtable_id];
                        const pinnedAway = !!focusMode && focusPinnedIds.has(item.airtable_id);
                        const label = pinnedAway ? "Pinned to Focus" : z === "active" ? "In Progress" : "Stage Today";
                        const pillClass = pinnedAway
                          ? "bg-violet-100 text-violet-700"
                          : z === "active" ? "bg-yellow-100 text-yellow-700" : "bg-indigo-50 text-indigo-600";
                        return (
                          <div key={item.airtable_id} className="w-44 shrink-0 relative group/ghost">
                            <div className="rounded-lg border border-dashed border-gray-300 bg-white opacity-50 px-3 py-2.5 flex flex-col gap-1 select-none pointer-events-none"
                              style={{ borderStyle: "dashed" }}>
                              <p className="text-xs font-medium text-[var(--twilio-navy)] italic leading-snug line-clamp-2">
                                {item.task || "Untitled"}
                              </p>
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full w-fit ${pillClass}`}>
                                {label}
                              </span>
                            </div>
                            {/* Restore button — visible on hover. Pinned-away cards are
                                unpinned from the Pinned In Progress section instead. */}
                            {!pinnedAway && (
                              <button
                                onClick={() => onRestoreToViews?.(item)}
                                title={`Remove from ${label} and restore to Views`}
                                className="absolute top-1.5 right-1.5 opacity-0 group-hover/ghost:opacity-100 transition-opacity flex items-center gap-0.5 text-[10px] font-semibold text-indigo-600 bg-white border border-indigo-200 rounded-full px-1.5 py-0.5 shadow-sm hover:bg-indigo-50 pointer-events-auto"
                              >
                                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-2.5 h-2.5 shrink-0"><path d="M9 3L3 9M3 3l6 6" strokeLinecap="round"/></svg>
                                Restore
                              </button>
                            )}
                          </div>
                        );
                      })}
                      {accItems.length === 0 && stagedItems.length === 0 && (
                        <div className={`w-36 shrink-0 flex items-center justify-center h-16 rounded-lg border-2 border-dashed text-sm ${isAccOver ? "border-indigo-400 text-indigo-600" : "border-gray-300 text-[var(--twilio-gray-60)]"}`}>Drop here</div>
                      )}
                      {accItems.length === 0 && stagedItems.length > 0 && (
                        <div className={`w-36 shrink-0 flex items-center justify-center h-16 rounded-lg border-2 border-dashed text-sm ${isAccOver ? "border-indigo-400 text-indigo-600" : "border-gray-200 text-gray-300"}`}>Drop here</div>
                      )}
                    </div>
                  </div>
                  {/* Done drop target + completed deck trigger */}
                  <div className="flex items-center shrink-0">
                    <div
                      className={`flex flex-col items-center justify-center w-14 self-stretch transition-colors cursor-default ${dragOverZone === `done-accounts-${acc.key}` ? "bg-emerald-100" : "hover:bg-emerald-50"}`}
                      style={{ borderLeft: "1px solid #e5e7eb" }}
                      onDragOver={(e) => onDragOver(e, `done-accounts-${acc.key}` as Zone)}
                      onDragLeave={onDragLeave}
                      onDrop={(e) => onDrop(e, "done-accounts", acc.key)}
                      title="Drop here to mark Done"
                    >
                      <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" className={`w-3.5 h-3.5 transition-colors ${dragOverZone === `done-accounts-${acc.key}` ? "text-emerald-600" : "text-emerald-400"}`}>
                        <path d="M2 7l3.5 3.5L12 3.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <span className={`text-[9px] font-semibold uppercase tracking-wide mt-0.5 transition-colors ${dragOverZone === `done-accounts-${acc.key}` ? "text-emerald-700" : "text-emerald-400"}`}>Done</span>
                    </div>
                    {accCompleted.length > 0 && onPin && (
                      <div className="px-2 flex items-center">
                        <CompletedDeckTrigger
                          items={accCompleted}
                          open={openDeckKey === acc.key}
                          onToggle={() => setOpenDeckKey(openDeckKey === acc.key ? null : acc.key)}
                        />
                      </div>
                    )}
                  </div>
                  </>}
                </div>
                {/* Expanded completed row */}
                {!rowCollapsed && openDeckKey === acc.key && accCompleted.length > 0 && onPin && (
                  <div
                    className="flex gap-2 px-3 pb-2 overflow-x-auto transition-colors"
                    style={{ borderTop: "1px solid #f0fdf4", background: dragOverZone === `done-accounts-${acc.key}` ? "#dcfce7" : "#f0fdf4", scrollbarWidth: "thin" }}
                    onDragOver={(e) => onDragOver(e, `done-accounts-${acc.key}` as Zone)}
                    onDragLeave={onDragLeave}
                    onDrop={(e) => onDrop(e, "done-accounts", acc.key)}
                  >
                    <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wide self-center shrink-0 mr-1">
                      {dragOverZone === `done-accounts-${acc.key}` ? "Drop to mark Done" : "Completed"}
                    </p>
                    {accCompleted.map((item) => (
                      <div key={item.airtable_id} className="shrink-0 w-44 py-2 flex flex-col gap-1 group">
                        <div className="relative">
                          <KanbanCard item={item} zone="accounts" onDragStart={(e) => onDragStart(e, item)} onSave={(fields) => onSave(item, fields)} onExpandClick={() => onExpand(item)} onDelete={onDelete ? () => onDelete(item) : undefined} onUpdated={onUpdated} />
                          <button
                            onClick={() => onPin(item)}
                            title="Pin to active list"
                            className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{ background: "rgba(255,255,255,0.9)", border: "none", borderRadius: 4, cursor: "pointer", padding: 2, color: "#9ca3af" }}
                          >
                            <svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor"><path d="M9.828.722a.5.5 0 01.354.146l4.95 4.95a.5.5 0 010 .707c-.48.48-1.072.588-1.503.588-.177 0-.335-.018-.46-.039l-3.134 3.134a5.927 5.927 0 01.16 1.013c.046.702-.032 1.687-.72 2.375a.5.5 0 01-.707 0l-2.829-2.828-3.182 3.182c-.195.195-1.219.902-1.414.707-.195-.195.512-1.22.707-1.414l3.182-3.182-2.828-2.829a.5.5 0 010-.707c.688-.688 1.673-.767 2.375-.72a5.922 5.922 0 011.013.16l3.134-3.133a2.772 2.772 0 01-.04-.461c0-.43.108-1.022.589-1.503a.5.5 0 01.353-.146z"/></svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {/* Unmatched account — catch-all so an item whose account_name matches no known
              account is never silently rendered nowhere. One row for all of them, so a bad
              sync can't explode the grid into hundreds of rows. Deliberately not a drop
              target and with no Done column: filing into an unresolvable bucket has no
              meaning. Each card shows its own account_name badge. */}
          {(() => {
            const known = new Set((accounts ?? []).map((a) => a.name.toLowerCase()));
            const orphans = filteredItems.filter(
              (i) => i.account_name && !known.has(i.account_name.toLowerCase())
            );
            if (orphans.length === 0) return null;
            const rowCollapsed = isCollapsed(UNMATCHED_GROUP_KEY);
            return (
              <div className="flex flex-col border-b border-gray-100 transition-colors hover:bg-gray-50">
                <div className="flex items-stretch">
                  <div className="w-36 shrink-0 px-3 py-2 border-r border-gray-100 flex flex-col justify-center">
                    <button
                      onClick={() => toggleCollapse(UNMATCHED_GROUP_KEY)}
                      title={rowCollapsed ? "Expand unmatched" : "Collapse unmatched"}
                      className="flex items-center gap-1.5 min-w-0 text-left"
                    >
                      <CollapseChevron collapsed={rowCollapsed} />
                      <p className="text-sm font-medium text-amber-700 leading-tight italic truncate">Unmatched account</p>
                    </button>
                    {rowCollapsed
                      ? <div className="mt-1 pl-4"><GroupCounts items={orphans} /></div>
                      : <span className="text-[10px] text-amber-600 mt-0.5 pl-4">No matching account</span>}
                  </div>
                  {!rowCollapsed && (
                    <div className="flex-1 overflow-x-auto">
                      <div className="flex flex-row gap-2 p-2 min-w-0">
                        {orphans.map((item) => (
                          <div key={item.airtable_id} className="w-44 shrink-0">
                            <KanbanCard item={item} zone="accounts" onDragStart={(e) => onDragStart(e, item)} onSave={(fields) => onSave(item, fields)} onExpandClick={() => onExpand(item)} onDelete={onDelete ? () => onDelete(item) : undefined} onUpdated={onUpdated} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>}
      </div>
    );
  }

  const isUnstagedZone = zone === "unstaged";
  const isFullFormZone = zone === "unstaged" || zone === "today" || zone === "active";

  return (
    <div
      className={`flex flex-col bg-white rounded-lg shadow-blue-md transition-colors ${isOver ? "bg-indigo-50" : ""} ${className ?? ""}`}
      style={style}
      onDragOver={(e) => onDragOver(e, zone)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, zone)}
    >
      <div className="px-5 py-3 shrink-0 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--twilio-navy)]">{label}</p>
          <p className="text-xs text-[var(--twilio-gray-60)] mt-0.5">{description}</p>
        </div>
        {zone === "active" && onAutoTrackToggle && (
          <button
            onClick={onAutoTrackToggle}
            className={[
              "flex items-center gap-1.5 shrink-0 px-2 py-1 rounded-lg text-[11px] font-semibold uppercase tracking-wide border transition-colors",
              autoTrack
                ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                : "bg-gray-50 border-gray-300 text-[var(--twilio-gray-80)] hover:bg-gray-100",
            ].join(" ")}
            title={autoTrack ? "Auto Track is ON — drag-in starts timer, drag-out stops and logs to Calendar" : "Enable Auto Track"}
          >
            <span
              className={[
                "inline-block w-2.5 h-2.5 rounded-full",
                autoTrack ? "bg-emerald-500" : "bg-gray-400",
              ].join(" ")}
            />
            Auto Track
          </button>
        )}
      </div>
      <div className={isUnstagedZone ? "p-4" : "flex-1 p-3 overflow-y-auto"}>
        <div className={isUnstagedZone ? "flex flex-row gap-2" : isFullFormZone ? "flex flex-col gap-3" : "flex flex-col gap-2 justify-center h-full"}>
          {items.map((item, i) => {
            const exportKey = `action_item:${item.airtable_id}`;
            const sel = exportMode && isSelected(exportKey);
            const showIndicatorBefore = reorderable && !!dragId
              && dragId !== item.airtable_id
              && dropHint?.zone === zone && dropHint.beforeId === item.airtable_id;
            return (
            <Fragment key={item.airtable_id}>
            {showIndicatorBefore && <DropIndicator />}
            <div
              className={isUnstagedZone ? "w-80 shrink-0" : undefined}
              style={{ position: "relative" }}
              onDragOver={reorderable ? (e) => {
                // Stop the zone container's handler from resetting the hint to "append",
                // but keep its highlight in sync.
                e.stopPropagation();
                onDragOver(e, zone);
                const r = e.currentTarget.getBoundingClientRect();
                const dropAbove = e.clientY < r.top + r.height / 2;
                onDropHint?.(
                  zone as ReorderableZone,
                  dropAbove ? item.airtable_id : (items[i + 1]?.airtable_id ?? null),
                );
              } : undefined}
            >
              {exportMode && (
                <button
                  onClick={() => toggleItem({
                    id: exportKey,
                    type: "action_item",
                    label: item.task || "Untitled",
                    summary: `${item.status} · ${item.priority} · ${item.account_name ?? "No account"}`,
                    content: `Action Item: ${item.task || "Untitled"}\nStatus: ${item.status}\nPriority: ${item.priority}\nAccount: ${item.account_name ?? "N/A"}\nAssignee: ${item.assignee_name ?? "Unassigned"}\nDue: ${item.due_date ?? "No date"}\nDetails: ${item.task_details ?? ""}`,
                    accountName: item.account_name ?? undefined,
                  })}
                  style={{
                    position: "absolute", inset: 0, zIndex: 10, cursor: "pointer",
                    background: sel ? "rgba(226,35,26,0.08)" : "transparent",
                    border: sel ? "2px solid var(--twilio-red, #e22)" : "2px solid transparent",
                    borderRadius: "8px",
                    display: "flex", alignItems: "flex-start", justifyContent: "flex-end",
                    padding: "4px",
                  }}
                >
                  <span style={{
                    width: "18px", height: "18px", borderRadius: "50%",
                    background: sel ? "var(--twilio-red, #e22)" : "rgba(255,255,255,0.9)",
                    border: sel ? "none" : "1.5px solid rgba(0,0,0,0.2)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "11px", color: "#fff", flexShrink: 0,
                  }}>
                    {sel ? "✓" : ""}
                  </span>
                </button>
              )}
              <KanbanCard
                item={item}
                zone={zone}
                timer={timers?.[item.airtable_id]}
                onDragStart={(e) => onDragStart(e, item)}
                onSave={(fields) => onSave(item, fields)}
                onSaveAndStage={onSaveAndStage ? (fields) => onSaveAndStage(item, fields) : undefined}
                onExpandClick={() => onExpand(item)}
                onDelete={onDelete ? () => onDelete(item) : undefined}
                onUpdated={onUpdated}
                onTimerToggle={onTimerToggle ? () => onTimerToggle(item.airtable_id) : undefined}
                onTimerEdit={onTimerEdit ? (s) => onTimerEdit(item.airtable_id, s) : undefined}
                teamMembers={teamMembers}
                accounts={accounts}
                collapsible={collapsible}
              />
            </div>
            </Fragment>
            );
          })}
          {/* End-of-list insertion point */}
          {reorderable && !!dragId && dropHint?.zone === zone && dropHint.beforeId === null
            && items[items.length - 1]?.airtable_id !== dragId && <DropIndicator />}
          {items.length === 0 && (
            <div className={`flex items-center justify-center rounded-lg border-2 border-dashed text-sm h-20 ${isUnstagedZone ? "w-80" : "w-full"} ${isOver ? "border-indigo-400 text-indigo-600" : "border-gray-300 text-[var(--twilio-gray-60)]"}`}>
              Drop here
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Time log panel ────────────────────────────────────────────────────────────

interface TimeLogEntry {
  airtable_id: string;
  account_name: string;
  task: string;
  seconds: number;
  loggedAt: string;
}

// ── Status board view ─────────────────────────────────────────────────────────

const STATUS_COLUMNS: AirtableActionItem["status"][] = ["Open", "In Progress", "Done"];

// Priority pill colors matching the meeting detail view (amber for Medium, etc.)
const STATUS_PILL_COLORS: Record<string, string> = {
  Critical: "bg-red-100 text-red-700",
  High:     "bg-orange-100 text-orange-700",
  Medium:   "bg-amber-100 text-amber-700",
  Low:      "bg-gray-100 text-gray-600",
};

function StatusBoardView({
  items,
  onExpand,
  onSave,
  externalDragId,
  onExternalDrop,
  accountKey,
  onAccountDrop,
  onDragStart: onOuterDragStart,
  onDragEnd: onOuterDragEnd,
}: {
  items: AirtableActionItem[];
  onExpand: (item: AirtableActionItem) => void;
  onSave: (item: AirtableActionItem, fields: Partial<AirtableActionItem>) => Promise<void>;
  onDelete: (item: AirtableActionItem) => void;
  onUpdated: (item: AirtableActionItem) => void;
  teamMembers: TeamMember[];
  externalDragId?: string | null;
  onExternalDrop?: (airtableId: string, status: AirtableActionItem["status"]) => void;
  /**
   * The account this board belongs to, when it is one group of the Projects view. A column
   * drop then means "this status **and** this account", so a card dragged in from another
   * group lands where it was dropped. Omitted by the ungrouped Status view, which leaves
   * account assignment alone.
   */
  accountKey?: string;
  onAccountDrop?: (e: React.DragEvent, accountKey: string) => void;
  onDragStart?: (e: React.DragEvent, item: AirtableActionItem) => void;
  onDragEnd?: () => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<AirtableActionItem["status"] | null>(null);
  // Optimistic local status overrides so the move feels instant
  const [localStatus, setLocalStatus] = useState<Record<string, AirtableActionItem["status"]>>({});
  const [ctxState, setCtxState] = useState<{ x: number; y: number; item: AirtableActionItem } | null>(null);
  const { isPinned, toggle: toggleFocusPin } = useFocusPins();
  const { exportMode, toggleItem, isSelected } = useExport();
  const { addToTray } = useExportTray();
  // Menu entry for whichever card was right-clicked. `ctxState` is the same snapshot
  // the ContextMenu is positioned from, so the panel opens where the menu was.
  const commentMenuEntry = useCommentMenuItem(
    "action_item",
    ctxState && canPinItem(ctxState.item) ? ctxState.item.id : null,
    ctxState?.item.task ?? "",
    ctxState,
  );

  function effectiveStatus(item: AirtableActionItem): AirtableActionItem["status"] {
    return localStatus[item.airtable_id] ?? item.status;
  }

  async function handleDrop(col: AirtableActionItem["status"], e?: React.DragEvent) {
    setOverCol(null);

    // A local `dragId` means the drag started on this board, so the card is already filed
    // under this account. Anything else came from outside — another account's group, Stage
    // Today, Currently Tracking — and a grouped board files it under its own account as well
    // as setting the status. Without this the card's status changed but its account did not,
    // so it snapped straight back to the group it was dragged out of.
    if (accountKey && !dragId && e) onAccountDrop?.(e, accountKey);

    // External drag (from Stage Today / In Progress) takes priority
    if (externalDragId && !dragId) {
      onExternalDrop?.(externalDragId, col);
      return;
    }

    if (!dragId) return;
    const item = items.find((i) => i.airtable_id === dragId);
    if (!item || effectiveStatus(item) === col) { setDragId(null); return; }
    setLocalStatus((prev) => ({ ...prev, [dragId]: col }));
    setDragId(null);
    try {
      await onSave(item, { status: col });
    } catch {
      // revert on error
      setLocalStatus((prev) => { const next = { ...prev }; delete next[item.airtable_id]; return next; });
    }
  }

  return (
  <>
    <div className="flex gap-4 overflow-x-auto pb-2 flex-1" style={{ scrollbarWidth: "thin", alignItems: "stretch" }}>
      {STATUS_COLUMNS.map((col) => {
        const colItems = items.filter((i) => effectiveStatus(i) === col);
        const isOver = overCol === col;
        return (
          <div
            key={col}
            className={`flex flex-col rounded-lg shrink-0 flex-1 transition-colors ${isOver ? "bg-indigo-50" : "bg-white"}`}
            style={{ minWidth: 280, border: isOver ? "1.5px solid #818cf8" : "1px solid #e5e7eb", maxHeight: "calc(100vh - 200px)" }}
            onDragOver={(e) => { e.preventDefault(); setOverCol(col); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverCol(null); }}
            onDrop={(e) => { e.stopPropagation(); void handleDrop(col, e); }}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 shrink-0">
              <span className="text-sm font-semibold text-[var(--twilio-navy)]">{col}</span>
              <span className="text-sm text-[var(--twilio-gray-60)] font-normal">{colItems.length}</span>
            </div>
            <div className="flex flex-col overflow-y-auto flex-1 px-2 py-2 gap-0" style={{ scrollbarWidth: "thin" }}>
              {colItems.map((item) => (
                <div
                  key={item.airtable_id}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setDragId(item.airtable_id); onOuterDragStart?.(e, item); }}
                  onDragEnd={() => { setDragId(null); setOverCol(null); onOuterDragEnd?.(); }}
                  onClick={() => onExpand(item)}
                  onContextMenu={(e) => { e.preventDefault(); setCtxState({ x: e.clientX, y: e.clientY, item }); }}
                  className={`group flex items-start gap-2 px-2 py-3 cursor-grab active:cursor-grabbing hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0 select-none ${dragId === item.airtable_id ? "opacity-40" : ""}`}
                  style={{ position: "relative" }}
                >
                  {isPinned(item.airtable_id) && <FocusPinBadge />}
                  {exportMode && (
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleItem({ id: `action_item:${item.airtable_id}`, type: "action_item", label: item.task || "Untitled", summary: `${item.status} · ${item.priority}`, content: `Action Item: ${item.task}`, accountName: item.account_name ?? undefined }); }}
                      style={{ position: "absolute", inset: 0, zIndex: 10, background: isSelected(`action_item:${item.airtable_id}`) ? "rgba(99,102,241,0.15)" : "rgba(99,102,241,0.07)", border: "2px solid " + (isSelected(`action_item:${item.airtable_id}`) ? "#6366f1" : "transparent"), borderRadius: "inherit", cursor: "pointer" }}
                    />
                  )}
                  <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                    <p className="text-sm text-[var(--twilio-navy)] leading-snug">
                      {item.task || <span className="italic opacity-40">Untitled</span>}
                    </p>
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${STATUS_PILL_COLORS[item.priority] ?? "bg-gray-100 text-gray-600"}`}>
                        {item.priority}
                      </span>
                      {item.due_date && (
                        <span className="text-[11px] text-[var(--twilio-gray-60)]">
                          Due {new Date(item.due_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </span>
                      )}
                      {item.account_name && (
                        <span className="text-[11px] text-[var(--twilio-gray-60)]">{item.account_name}</span>
                      )}
                      {(item.time_spent ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[11px] text-[var(--twilio-gray-60)]">
                          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-2.5 h-2.5 shrink-0"><circle cx="6" cy="6" r="5"/><path d="M6 3v3l2 1.5" strokeLinecap="round"/></svg>
                          {fmtTime(item.time_spent)}
                        </span>
                      )}
                    </div>
                    <CommentPreviewList
                      resourceType="action_item"
                      resourceId={canPinItem(item) ? item.id : null}
                      resourceLabel={item.task ?? ""}
                    />
                  </div>
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 shrink-0 mt-1 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">
                    <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              ))}
              {colItems.length === 0 && (
                <div className={`flex items-center justify-center py-8 rounded-lg border-2 border-dashed text-xs transition-colors ${isOver ? "border-indigo-400 text-indigo-500" : "border-gray-200 text-[var(--twilio-gray-60)]"}`}>
                  {isOver ? "Drop to move here" : "—"}
                </div>
              )}
            </div>
          </div>
        );
      })}
      {/* Blocked + Backlogged share one column, stacked in rows */}
      <div className="flex flex-col shrink-0 flex-1 gap-0" style={{ minWidth: 280, maxHeight: "calc(100vh - 200px)" }}>
        {(["Blocked", "Backlogged"] as const).map((col, i) => {
          const colItems = items.filter((item) => effectiveStatus(item) === col);
          const isOver = overCol === col;
          return (
            <div
              key={col}
              className={`flex flex-col flex-1 transition-colors overflow-hidden ${isOver ? (col === "Blocked" ? "bg-red-50" : "bg-slate-50") : "bg-white"}`}
              style={{
                border: isOver ? `1.5px solid ${col === "Blocked" ? "#f87171" : "#94a3b8"}` : "1px solid #e5e7eb",
                borderRadius: i === 0 ? "8px 8px 0 0" : "0 0 8px 8px",
                marginTop: i === 1 ? "-1px" : 0,
              }}
              onDragOver={(e) => { e.preventDefault(); setOverCol(col); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverCol(null); }}
              onDrop={(e) => { e.stopPropagation(); void handleDrop(col, e); }}
            >
              <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 shrink-0">
                <span className={`text-sm font-semibold ${col === "Blocked" ? "text-red-700" : "text-slate-600"}`}>{col}</span>
                <span className="text-sm text-[var(--twilio-gray-60)] font-normal">{colItems.length}</span>
              </div>
              <div className="flex flex-col overflow-y-auto flex-1 px-2 py-2 gap-0" style={{ scrollbarWidth: "thin" }}>
                {colItems.map((item) => (
                  <div
                    key={item.airtable_id}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setDragId(item.airtable_id); onOuterDragStart?.(e, item); }}
                    onDragEnd={() => { setDragId(null); setOverCol(null); onOuterDragEnd?.(); }}
                    onClick={() => onExpand(item)}
                    onContextMenu={(e) => { e.preventDefault(); setCtxState({ x: e.clientX, y: e.clientY, item }); }}
                    className={`group flex items-start gap-2 px-2 py-3 cursor-grab active:cursor-grabbing hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0 select-none ${dragId === item.airtable_id ? "opacity-40" : ""}`}
                    style={{ position: "relative" }}
                  >
                    {isPinned(item.airtable_id) && <FocusPinBadge />}
                    {exportMode && (
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleItem({ id: `action_item:${item.airtable_id}`, type: "action_item", label: item.task || "Untitled", summary: `${item.status} · ${item.priority}`, content: `Action Item: ${item.task}`, accountName: item.account_name ?? undefined }); }}
                        style={{ position: "absolute", inset: 0, zIndex: 10, background: isSelected(`action_item:${item.airtable_id}`) ? "rgba(99,102,241,0.15)" : "rgba(99,102,241,0.07)", border: "2px solid " + (isSelected(`action_item:${item.airtable_id}`) ? "#6366f1" : "transparent"), borderRadius: "inherit", cursor: "pointer" }}
                      />
                    )}
                    <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                      <p className="text-sm text-[var(--twilio-navy)] leading-snug">
                        {item.task || <span className="italic opacity-40">Untitled</span>}
                      </p>
                      <div className="flex flex-wrap gap-1.5 items-center">
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${STATUS_PILL_COLORS[item.priority] ?? "bg-gray-100 text-gray-600"}`}>
                          {item.priority}
                        </span>
                        {item.due_date && (
                          <span className="text-[11px] text-[var(--twilio-gray-60)]">
                            Due {new Date(item.due_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                          </span>
                        )}
                        {item.account_name && (
                          <span className="text-[11px] text-[var(--twilio-gray-60)]">{item.account_name}</span>
                        )}
                      </div>
                      <CommentPreviewList
                        resourceType="action_item"
                        resourceId={canPinItem(item) ? item.id : null}
                        resourceLabel={item.task ?? ""}
                      />
                    </div>
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 shrink-0 mt-1 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">
                      <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                ))}
                {colItems.length === 0 && (
                  <div className={`flex items-center justify-center py-6 rounded-lg border-2 border-dashed text-xs transition-colors ${isOver ? (col === "Blocked" ? "border-red-300 text-red-500" : "border-slate-300 text-slate-500") : "border-gray-200 text-[var(--twilio-gray-60)]"}`}>
                    {isOver ? "Drop to move here" : "—"}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
    {ctxState && (
      <ContextMenu
        x={ctxState.x}
        y={ctxState.y}
        items={[
          ...(canPinItem(ctxState.item) ? [
            focusPinMenuItem(isPinned(ctxState.item.airtable_id), () => toggleFocusPin(ctxState.item.airtable_id)),
            { separator: true, label: "", onClick: () => {} } as ContextMenuItem,
          ] : []),
          { label: "Open details", onClick: () => onExpand(ctxState.item) },
          { label: "Mark as Done", onClick: () => void onSave(ctxState.item, { status: "Done" }) },
          { label: "Copy task name", onClick: () => { try { navigator.clipboard.writeText(ctxState.item.task ?? ""); } catch { /* best effort */ } } },
          commentMenuEntry,
          { separator: true, label: "", onClick: () => {} },
          { label: "→ Export tray", icon: <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M1 9v4h12V9"/><path d="M4.5 5.5 7 3l2.5 2.5"/><path d="M7 3v7"/></svg>, onClick: () => addToTray(ctxState.item) },
        ]}
        onClose={() => setCtxState(null)}
      />
    )}
  </>
  );
}

// ── Due date view ─────────────────────────────────────────────────────────────

const DUE_GROUP_ORDER = ["Overdue", "Today", "This Week", "Later", "No Date"];

const DUE_GROUP_STYLES: Record<string, { badge: string; label: string }> = {
  "Overdue":    { badge: "bg-red-100 text-red-700",     label: "text-red-700" },
  "Today":      { badge: "bg-amber-100 text-amber-700", label: "text-amber-700" },
  "This Week":  { badge: "bg-indigo-50 text-indigo-700",label: "text-indigo-700" },
  "Later":      { badge: "bg-gray-100 text-gray-600",   label: "text-gray-600" },
  "No Date":    { badge: "bg-gray-100 text-gray-400",   label: "text-gray-400" },
};

function DueDateView({
  items,
  onExpand,
  onSave,
  onDragStart,
  onDragEnd,
}: {
  items: AirtableActionItem[];
  onExpand: (item: AirtableActionItem) => void;
  onSave?: (item: AirtableActionItem, fields: Partial<AirtableActionItem>) => Promise<void>;
  onDragStart?: (e: React.DragEvent, item: AirtableActionItem) => void;
  onDragEnd?: () => void;
}) {
  const [ctxState, setCtxState] = useState<{ x: number; y: number; item: AirtableActionItem } | null>(null);
  const { isPinned, toggle: toggleFocusPin } = useFocusPins();
  const { exportMode, toggleItem, isSelected } = useExport();
  const { addToTray } = useExportTray();
  // Menu entry for whichever card was right-clicked. `ctxState` is the same snapshot
  // the ContextMenu is positioned from, so the panel opens where the menu was.
  const commentMenuEntry = useCommentMenuItem(
    "action_item",
    ctxState && canPinItem(ctxState.item) ? ctxState.item.id : null,
    ctxState?.item.task ?? "",
    ctxState,
  );
  const groups: Record<string, AirtableActionItem[]> = {};
  for (const g of DUE_GROUP_ORDER) groups[g] = [];
  for (const item of items) {
    const g = dueDateGroup(item);
    groups[g].push(item);
  }
  // Sort each group by due_date asc (No Date: by task name)
  for (const g of DUE_GROUP_ORDER) {
    groups[g].sort((a, b) => {
      if (!a.due_date && !b.due_date) return a.task.localeCompare(b.task);
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
    });
  }

  return (
    <>
    <div className="flex flex-col gap-4">
      {DUE_GROUP_ORDER.filter((g) => groups[g].length > 0).map((group) => {
        const style = DUE_GROUP_STYLES[group];
        return (
          <div key={group} className="bg-white rounded-lg shadow-blue-md overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100">
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${style.badge}`}>{group}</span>
              <span className={`text-xs font-medium ${style.label}`}>{groups[group].length} item{groups[group].length !== 1 ? "s" : ""}</span>
            </div>
            <div className="flex flex-wrap gap-2 p-3">
              {groups[group].map((item) => (
                <div
                  key={item.airtable_id}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart?.(e, item); }}
                  onDragEnd={onDragEnd}
                  onClick={() => onExpand(item)}
                  onContextMenu={(e) => { e.preventDefault(); setCtxState({ x: e.clientX, y: e.clientY, item }); }}
                  className="rounded-lg bg-[#F4F4F6] px-3 py-2.5 flex flex-col gap-1.5 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow shrink-0 select-none"
                  style={{ width: 260, borderLeft: `3px solid ${PRIORITY_ACCENT[item.priority] ?? "#e5e7eb"}`, position: "relative" }}
                >
                  {isPinned(item.airtable_id) && <FocusPinBadge />}
                  {exportMode && (
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleItem({ id: `action_item:${item.airtable_id}`, type: "action_item", label: item.task || "Untitled", summary: `${item.status} · ${item.priority}`, content: `Action Item: ${item.task}`, accountName: item.account_name ?? undefined }); }}
                      style={{ position: "absolute", inset: 0, zIndex: 10, background: isSelected(`action_item:${item.airtable_id}`) ? "rgba(99,102,241,0.15)" : "rgba(99,102,241,0.07)", border: "2px solid " + (isSelected(`action_item:${item.airtable_id}`) ? "#6366f1" : "transparent"), borderRadius: "inherit", cursor: "pointer" }}
                    />
                  )}
                  <p className="text-sm font-semibold text-[var(--twilio-navy)] leading-snug line-clamp-2">
                    {item.task || <span className="italic opacity-40">Untitled</span>}
                  </p>
                  {item.account_name && (
                    <p className="text-[11px] font-medium text-[var(--twilio-navy)] opacity-60 truncate">{item.account_name}</p>
                  )}
                  <div className="flex flex-wrap gap-1 items-center">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${STATUS_COLORS[item.status] ?? "bg-gray-100"}`}>{item.status}</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${PRIORITY_COLORS[item.priority]}`}>{item.priority}</span>
                    {item.due_date && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">
                        {new Date(item.due_date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                      </span>
                    )}
                    {item.assignee_name && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-200 text-[var(--twilio-navy)] truncate max-w-[90px]">{item.assignee_name}</span>
                    )}
                  </div>
                  <CommentPreviewList
                    resourceType="action_item"
                    resourceId={canPinItem(item) ? item.id : null}
                    resourceLabel={item.task ?? ""}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {items.length === 0 && (
        <p className="text-sm text-[var(--twilio-gray-60)] text-center py-12">No items match</p>
      )}
    </div>
    {ctxState && (
      <ContextMenu
        x={ctxState.x}
        y={ctxState.y}
        items={[
          ...(canPinItem(ctxState.item) ? [
            focusPinMenuItem(isPinned(ctxState.item.airtable_id), () => toggleFocusPin(ctxState.item.airtable_id)),
            { separator: true, label: "", onClick: () => {} } as ContextMenuItem,
          ] : []),
          { label: "Open details", onClick: () => onExpand(ctxState.item) },
          { label: "Mark as Done", onClick: () => void onSave?.(ctxState.item, { status: "Done" }) },
          { label: "Copy task name", onClick: () => { try { navigator.clipboard.writeText(ctxState.item.task ?? ""); } catch { /* best effort */ } } },
          commentMenuEntry,
          { separator: true, label: "", onClick: () => {} },
          { label: "→ Export tray", icon: <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M1 9v4h12V9"/><path d="M4.5 5.5 7 3l2.5 2.5"/><path d="M7 3v7"/></svg>, onClick: () => addToTray(ctxState.item) },
        ]}
        onClose={() => setCtxState(null)}
      />
    )}
    </>
  );
}

// ── Projects view ─────────────────────────────────────────────────────────────

/** One account group in the Projects view. */
interface ProjectGroup {
  /** React key. */
  key: string;
  displayName: string;
  /** Key into the shared collapse store. */
  groupKey: string;
  /** Account key to file a dropped card under, or `null` if the group is not a drop target. */
  accountKey: string | null;
  items: AirtableActionItem[];
  /** The group's name matches no known account, so cards can't be filed into it. */
  unmatched?: boolean;
}

function ProjectsView({
  items,
  accounts,
  onExpand,
  onSave,
  externalDragId,
  onExternalDrop,
  onAccountDrop,
  onDragStart,
  onDragEnd,
}: {
  items: AirtableActionItem[];
  accounts: KanbanAccount[];
  onExpand: (item: AirtableActionItem) => void;
  onSave: (item: AirtableActionItem, fields: Partial<AirtableActionItem>) => Promise<void>;
  externalDragId?: string | null;
  onExternalDrop?: (airtableId: string, status: AirtableActionItem["status"]) => void;
  /** File the dragged card under an account. `"none"` clears the account. */
  onAccountDrop?: (e: React.DragEvent, accountKey: string) => void;
  onDragStart?: (e: React.DragEvent, item: AirtableActionItem) => void;
  onDragEnd?: () => void;
}) {
  /**
   * One group per known account — including accounts with no items — so every account is a
   * drop target. Without the empty ones a card could only ever be moved to an account that
   * already had work on it, which is backwards: filing the first item under an account is
   * exactly when you need the target.
   *
   * `accounts` arrives alphabetised from the page, so groups keep their previous order and
   * stay in step with the Views grid. "No Account" is last, as before.
   */
  const accountGroups = useMemo<ProjectGroup[]>(() => {
    const byName = new Map<string, AirtableActionItem[]>();
    const noAccount: AirtableActionItem[] = [];
    for (const item of items) {
      const name = item.account_name?.trim();
      if (!name) { noAccount.push(item); continue; }
      const k = name.toLowerCase();
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k)!.push(item);
    }

    const groups: ProjectGroup[] = accounts.map((acc) => {
      const k = acc.name.trim().toLowerCase();
      const groupItems = byName.get(k) ?? [];
      byName.delete(k);
      return {
        key: acc.key,
        displayName: acc.name,
        groupKey: accountGroupKey(acc.name),
        accountKey: acc.key,
        items: groupItems,
      };
    });

    // Names left over match no known account. Kept so an item is never rendered nowhere,
    // but deliberately not drop targets — filing into an unresolvable bucket has no meaning,
    // exactly as in the Views grid's "Unmatched account" row.
    for (const [, groupItems] of [...byName.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const name = groupItems[0].account_name!.trim();
      groups.push({
        key: `unmatched-${name}`,
        displayName: name,
        groupKey: accountGroupKey(name),
        accountKey: null,
        items: groupItems,
        unmatched: true,
      });
    }

    groups.push({
      key: "__none__",
      displayName: "No Account",
      groupKey: NO_ACCOUNT_GROUP_KEY,
      accountKey: "none",
      items: noAccount,
    });
    return groups;
  }, [items, accounts]);

  // Which group the cursor is currently over. Local rather than lifted to the page: the
  // highlight is purely presentational here, and a page-level state write on every dragover
  // would re-render every group in the list.
  const [overGroupKey, setOverGroupKey] = useState<string | null>(null);
  const dragInFlight = !!externalDragId;

  // Collapse state is shared with the Views grid (and persisted), so the Collapse all
  // button and the user's per-group choices carry across views and navigation.
  const { isCollapsed: isGroupCollapsed, toggle: toggleGroup } = useAccountGroupCollapse();

  if (items.length === 0) {
    return <p className="text-sm text-[var(--twilio-gray-60)] text-center py-12">No items match</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {accountGroups.map((group) => {
        const { key, displayName, groupKey, accountKey, items: groupItems } = group;
        const isCollapsed = isGroupCollapsed(groupKey);
        const openCount = groupItems.filter((i) => i.status !== "Done").length;
        const doneCount = groupItems.filter((i) => i.status === "Done").length;
        const isDropTarget = !!accountKey && !!onAccountDrop;
        // Gated on the drag still being in flight so a stale hover key left behind by a
        // cancelled drag can't keep a group highlighted — no dragend listener needed.
        const isOver = isDropTarget && dragInFlight && overGroupKey === key;
        // A group with nothing in it has no board worth expanding — the header alone is the
        // whole group, and the drop target. Showing five empty status columns for every
        // account the user has never filed work under would bury the populated groups.
        const isEmpty = groupItems.length === 0;
        return (
          <div
            key={key}
            data-testid={`project-group-${groupKey}`}
            className={`bg-white rounded-lg overflow-hidden transition-colors ${isOver ? "bg-indigo-50 shadow-blue-lg" : "shadow-blue-md"}`}
            style={isOver ? { outline: "2px solid #818cf8", outlineOffset: -1 } : undefined}
            onDragOver={isDropTarget ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOverGroupKey(key); } : undefined}
            onDragLeave={isDropTarget ? (e) => { if (leftElement(e)) setOverGroupKey(null); } : undefined}
            onDrop={isDropTarget ? (e) => { setOverGroupKey(null); void onAccountDrop!(e, accountKey!); } : undefined}
          >
            {/* Group header. Doubles as the drop target for a collapsed group, which is the
                only part of it on screen. */}
            <button
              onClick={() => { if (!isEmpty) toggleGroup(groupKey); }}
              title={isDropTarget && dragInFlight ? `Drop to file under ${displayName}` : undefined}
              // Left enabled when empty even though the click is a no-op: a disabled button
              // does not reliably receive drop events, and the header IS the drop target for
              // an empty group. The hover style is dropped instead, so it doesn't advertise
              // a toggle that has nothing to toggle.
              className={`w-full flex items-center gap-3 px-4 py-3 border-b border-gray-100 transition-colors text-left ${isOver ? "bg-indigo-50" : isEmpty ? "cursor-default" : "hover:bg-gray-50"}`}
            >
              {isEmpty ? (
                <span className="w-3 shrink-0" aria-hidden="true" />
              ) : (
                <svg
                  viewBox="0 0 12 12"
                  fill="currentColor"
                  className={`w-3 h-3 shrink-0 text-[var(--twilio-gray-60)] transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                >
                  <path d="M6 8L1 3h10z"/>
                </svg>
              )}
              <CorporateIcon width={12} height={12} className="shrink-0 text-indigo-400 opacity-70" />
              <span className={`text-sm font-semibold flex-1 min-w-0 truncate ${group.unmatched ? "text-amber-700 italic" : "text-[var(--twilio-navy)]"} ${isEmpty ? "opacity-60" : ""}`}>
                {displayName}
              </span>
              <span className="text-xs text-[var(--twilio-gray-60)] shrink-0 flex items-center gap-2">
                {/* Only while a card is in the air, so the resting layout is unchanged. */}
                {isDropTarget && dragInFlight && (
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border border-dashed ${isOver ? "border-indigo-400 text-indigo-600 bg-indigo-50" : "border-gray-300 text-[var(--twilio-gray-60)]"}`}>
                    {isOver ? "Drop to file here" : "Drop here"}
                  </span>
                )}
                {openCount > 0 && (
                  <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full text-[11px] font-semibold">
                    {openCount} open
                  </span>
                )}
                {doneCount > 0 && (
                  <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full text-[11px] font-semibold">
                    {doneCount} done
                  </span>
                )}
              </span>
            </button>
            {/* Status board for this account */}
            {!isCollapsed && !isEmpty && (
              <div className="p-4">
                <StatusBoardView
                  items={groupItems}
                  accountKey={accountKey ?? undefined}
                  onAccountDrop={onAccountDrop}
                  onExpand={onExpand}
                  onSave={onSave}
                  onDelete={() => {}}
                  onUpdated={() => {}}
                  teamMembers={[]}
                  externalDragId={externalDragId}
                  onExternalDrop={onExternalDrop}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type PageView = "kanban" | "status" | "due" | "projects";

export default function ActionItemsPage() {
  const { reportError } = useAppError();
  const [allItems, setAllItems] = useState<AirtableActionItem[]>([]);
  const [accounts, setAccounts] = useState<KanbanAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pageView, setPageView] = useState<PageView>(() => (localStorage.getItem("actionItemsView") as PageView) ?? "kanban");
  const [search, setSearch] = useState("");

  // Focus mode. Pins live in the shared useFocusPins store so cards on the Calendar and
  // Account Detail pages stay in sync with this page. Only the pinned *set* is needed here
  // — each card toggles its own pin through the hook, via its right-click menu.
  const [focusMode, setFocusMode] = useState(() => localStorage.getItem("actionFocusMode") === "true");
  const { pinnedIds: focusPinnedIds } = useFocusPins();

  // Zone assignment: airtable_id → zone — persisted to localStorage
  const [zones, setZonesRaw] = useState<Record<string, Zone>>(() => {
    try { return JSON.parse(localStorage.getItem("actionItemZones") ?? "{}"); } catch { return {}; }
  });
  function setZones(updater: ((prev: Record<string, Zone>) => Record<string, Zone>) | Record<string, Zone>) {
    setZonesRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      localStorage.setItem("actionItemZones", JSON.stringify(next));
      return next;
    });
  }

  // Manual card order within Stage Today / Currently Tracking — persisted to localStorage
  // alongside actionItemZones. An ordered id array per zone rather than an index map:
  // inserting into an array is one atomic write, whereas renumbering indices races badly
  // between tabs. Ids absent from the array sort to the bottom, so an empty map reproduces
  // the pre-existing (API) order exactly and needs no migration.
  const [order, setOrderRaw] = useState<ZoneOrderMap>(() => {
    try { return JSON.parse(localStorage.getItem(ACTION_ITEM_ORDER_KEY) ?? "{}"); } catch { return {}; }
  });
  function setOrder(updater: ((prev: ZoneOrderMap) => ZoneOrderMap) | ZoneOrderMap) {
    setOrderRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      localStorage.setItem(ACTION_ITEM_ORDER_KEY, JSON.stringify(next));
      return next;
    });
  }

  // Account assignment: airtable_id → account key (namespaced "at-N"/"app-N") — persisted to localStorage
  const [accountAssign, setAccountAssignRaw] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("actionItemAccountAssign") ?? "{}"); } catch { return {}; }
  });
  function setAccountAssign(updater: ((prev: Record<string, string>) => Record<string, string>) | Record<string, string>) {
    setAccountAssignRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      localStorage.setItem("actionItemAccountAssign", JSON.stringify(next));
      return next;
    });
  }

  const [myProfile, setMyProfile] = useState<UserProfile | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [timers, setTimersRaw] = useState<Record<string, TimerState>>(() => {
    try { return JSON.parse(localStorage.getItem("actionItemTimers") ?? "{}"); } catch { return {}; }
  });
  function setTimers(updater: ((prev: Record<string, TimerState>) => Record<string, TimerState>) | Record<string, TimerState>) {
    setTimersRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      localStorage.setItem("actionItemTimers", JSON.stringify(next));
      return next;
    });
  }
  const [timeLogs, setTimeLogs] = useState<TimeLogEntry[]>([]);
  const [editItem, setEditItem] = useState<AirtableActionItem | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverZone, setDragOverZone] = useState<Zone | null>(null);
  // Insertion point for a reorder drop. Mirrored into a ref because handleDrop is async
  // and must read the hint that was current at drop time, not a re-rendered value.
  const [dropHint, setDropHintState] = useState<DropHint | null>(null);
  const dropHintRef = useRef<DropHint | null>(null);
  const setDropHint = useCallback((hint: DropHint | null) => {
    dropHintRef.current = hint;
    setDropHintState(hint);
  }, []);
  const [showLogs, setShowLogs] = useState(false);
  const [autoTrack, setAutoTrack] = useState(false);

  // Pinned completed items — persist across sessions
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("actionItemPinned") ?? "[]")); } catch { return new Set(); }
  });

  function handlePin(item: AirtableActionItem) {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.airtable_id)) {
        next.delete(item.airtable_id);
      } else {
        next.add(item.airtable_id);
      }
      localStorage.setItem("actionItemPinned", JSON.stringify([...next]));
      return next;
    });
  }
  const pageRef = useRef<HTMLDivElement>(null);
  useLogGlow(pageRef);
  const unstagedWrapRef = useRef<HTMLDivElement>(null);
  const [row1Height, setRow1Height] = useState<number | null>(null);
  // Re-measure whenever items change so the height is always current
  useLayoutEffect(() => {
    const measure = () => {
      const h = unstagedWrapRef.current?.getBoundingClientRect().height ?? 0;
      if (h > 0) setRow1Height(h);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (unstagedWrapRef.current) ro.observe(unstagedWrapRef.current);
    return () => ro.disconnect();
  }, [allItems]);

  // How many blank cards to show — 1 on narrow viewports, 2 on wide
  const [blankCount, setBlankCount] = useState(() => window.innerWidth >= 1100 ? 2 : 1);
  useLayoutEffect(() => {
    const update = () => setBlankCount(window.innerWidth >= 1100 ? 2 : 1);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Starred account: when set, blank cards are pre-assigned to that account
  const [starredAccountKey, setStarredAccountKey] = useState<string | null>(() =>
    localStorage.getItem("actionItemStarredAccount")
  );
  function setStarred(key: string | null) {
    setStarredAccountKey(key);
    if (key) localStorage.setItem("actionItemStarredAccount", key);
    else localStorage.removeItem("actionItemStarredAccount");
    // Re-stamp existing unstaged blank cards with the new account
    const acc = key ? accounts.find((a) => a.key === key) ?? null : null;
    setAllItems((prev) => prev.map((i) => {
      if (!i.airtable_id.startsWith("local-")) return i;
      if ((zones[i.airtable_id] ?? "unstaged") !== "unstaged") return i;
      return { ...i, account: acc?.id ?? null, account_name: acc?.name ?? null };
    }));
  }

  const blankCounter = useRef(
    (() => { try { return parseInt(localStorage.getItem("actionItemBlankCounter") ?? "0", 10); } catch { return 0; } })()
  );
  function nextBlankId(): string {
    blankCounter.current += 1;
    localStorage.setItem("actionItemBlankCounter", String(blankCounter.current));
    return `local-${blankCounter.current}`;
  }

  function makeBlankItem(accountKey: string | null, allAccounts: KanbanAccount[], profile: UserProfile | null): AirtableActionItem {
    const acc = accountKey ? allAccounts.find((a) => a.key === accountKey) ?? null : null;
    const id = nextBlankId();
    return {
      id: 0,
      airtable_id: id,
      account: acc?.id ?? null,
      account_name: acc?.name ?? null,
      task: "",
      task_details: "",
      status: "Open",
      priority: "Medium",
      due_date: null,
      estimated_time: 0,
      time_spent: 0,
      prep_time: 0,
      slack_thread_url: "",
      salesforce_task_id: "",
      assignee_airtable_id: profile?.airtable_collaborator_id ?? "",
      assignee_name: profile?.display_name || profile?.email || "",
      reminder: null,
      reminder_id: null,
      reminder_due_at: null,
      reminder_status: null,
      linked_meeting: null,
      linked_meeting_name: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      marked_done_at: null,
      last_synced: "",
    };
  }

  // Ensure exactly `target` blank items exist in Unstaged (default 2, reduced to 1 on narrow viewports)
  function topUpBlanks(
    currentItems: AirtableActionItem[],
    currentZones: Record<string, Zone>,
    accountKey: string | null,
    allAccounts: KanbanAccount[],
    profile: UserProfile | null = null,
    target = 2,
  ) {
    const unstagedBlanks = currentItems.filter(
      (i) => i.airtable_id.startsWith("local-") && (currentZones[i.airtable_id] ?? "unstaged") === "unstaged"
    );
    const needed = target - unstagedBlanks.length;
    if (needed < 0) {
      // Too many blanks (viewport shrank) — trim the excess empty ones
      let toRemove = -needed;
      const trimmedItems = currentItems.filter((i) => {
        if (toRemove > 0 && i.airtable_id.startsWith("local-") && (currentZones[i.airtable_id] ?? "unstaged") === "unstaged" && !i.task.trim()) {
          toRemove--;
          return false;
        }
        return true;
      });
      return { newItems: trimmedItems, newZones: currentZones };
    }
    if (needed === 0) return { newItems: currentItems, newZones: currentZones };
    const additions: AirtableActionItem[] = Array.from({ length: needed }, () => makeBlankItem(accountKey, allAccounts, profile));
    const addedZones: Record<string, Zone> = {};
    additions.forEach((i) => { addedZones[i.airtable_id] = "unstaged"; });
    return {
      newItems: [...currentItems, ...additions],
      newZones: { ...currentZones, ...addedZones },
    };
  }

  // When the blank count target changes (viewport resize), trim or add blanks
  useEffect(() => {
    const starKey = localStorage.getItem("actionItemStarredAccount");
    setAllItems((prev) => {
      setZonesRaw((prevZones) => {
        const { newItems, newZones } = topUpBlanks(prev, prevZones, starKey, accounts, myProfile, blankCount);
        localStorage.setItem("actionItemZones", JSON.stringify(newZones));
        // setAllItems can't be called here (we're inside it), schedule it
        setTimeout(() => setAllItems(newItems), 0);
        return newZones;
      });
      return prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blankCount]);

  // Stores the ISO timestamp when auto-track started for each item (by airtable_id).
  const trackStartTimes = useRef<Record<string, string>>({});
  // Maps airtable_id → live calendar event id for the current (in-progress) session.
  const liveEventIds = useRef<Record<string, number>>({});
  // Tick counter for throttling live event updates (update every 30 ticks = 30s).
  const liveTickCount = useRef(0);

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function clearActiveTimer(airtableId: string) {
    try {
      const payload = JSON.parse(localStorage.getItem("activeTimers") ?? "{}");
      delete payload[airtableId];
      localStorage.setItem("activeTimers", JSON.stringify(payload));
      window.dispatchEvent(new StorageEvent("storage", { key: "activeTimers", newValue: JSON.stringify(payload) }));
    } catch { /* best effort */ }
  }

  // Tick running timers every second and broadcast to calendar
  useEffect(() => {
    tickRef.current = setInterval(() => {
      liveTickCount.current += 1;
      const shouldUpdateLiveEvent = liveTickCount.current % 30 === 0;

      setTimers((prev) => {
        const hasRunning = Object.values(prev).some((t) => t.running);
        if (!hasRunning) return prev;
        // Broadcast active timers so CalendarPage can render live events
        const payload: Record<string, { startedAt: number; elapsed: number; task: string; accountName: string | null }> = {};
        for (const [id, t] of Object.entries(prev)) {
          if (!t.running || !t.startedAt) continue;
          const item = allItems.find((i) => i.airtable_id === id);
          payload[id] = { startedAt: t.startedAt, elapsed: t.elapsed, task: item?.task ?? id, accountName: item?.account_name ?? null };
        }
        localStorage.setItem("activeTimers", JSON.stringify(payload));
        window.dispatchEvent(new StorageEvent("storage", { key: "activeTimers", newValue: JSON.stringify(payload) }));

        // Every 30s, push updated end_datetime to the live calendar event
        if (shouldUpdateLiveEvent) {
          const nowIso = new Date().toISOString();
          for (const [id, t] of Object.entries(prev)) {
            if (!t.running) continue;
            const eventId = liveEventIds.current[id];
            if (eventId) {
              schedulerApi.updateEvent(eventId, { end_datetime: nowIso }).catch(() => {});
            }
          }
        }

        return { ...prev }; // shallow clone triggers re-render
      });
    }, 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allItems]);

  /**
   * Fetch items, accounts and profile.
   *
   * `silent` skips the `isLoading` flip, so the grid keeps rendering while the refresh runs.
   * Every reload that is *not* the first mount is silent: there is already data on screen,
   * and replacing a populated board with a full-page "Loading…" for the length of four
   * parallel requests reads as a glitch rather than as progress.
   */
  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setIsLoading(true);
    try {
      const [itemsRes, atAccountsRes, appAccountsRes, profileRes] = await Promise.all([
        airtableApi.listActionItems(),
        // Both account endpoints are paginated (PAGE_SIZE 50). The Views grid renders one
        // row per fetched account, so a truncated list would hide every item belonging to
        // account 51+. ClientPageSizePagination makes page_size honoured on both.
        airtableApi.listAccounts({ page_size: "500" }),
        accountsApi.listAccounts({ page_size: "500" }),
        teamApi.getMyProfile().catch(() => null),
      ]);
      setAllItems(itemsRes.data);
      // Prune stale activeTimers for items that no longer exist
      try {
        const liveIds = new Set((itemsRes.data as AirtableActionItem[]).map((i) => i.airtable_id));
        const timers: Record<string, unknown> = JSON.parse(localStorage.getItem("activeTimers") ?? "{}");
        const pruned = Object.fromEntries(Object.entries(timers).filter(([id]) => liveIds.has(id)));
        if (Object.keys(pruned).length !== Object.keys(timers).length) {
          localStorage.setItem("activeTimers", JSON.stringify(pruned));
          window.dispatchEvent(new StorageEvent("storage", { key: "activeTimers", newValue: JSON.stringify(pruned) }));
        }
      } catch { /* best effort */ }
      const loadedProfile: UserProfile | null = profileRes?.data ?? null;
      if (loadedProfile) setMyProfile(loadedProfile);

      // Merge Airtable accounts + app accounts, deduped by name (case-insensitive).
      const atAccounts: KanbanAccount[] = atAccountsRes.data.results.filter((a: AirtableAccount) => a.name?.trim()).map((a: AirtableAccount) => ({
        key: `at-${a.id}`,
        id: a.id,
        name: a.name,
        source: "airtable" as const,
      }));
      const atNames = new Set(atAccounts.map((a) => a.name.toLowerCase()));
      const appAccounts: KanbanAccount[] = appAccountsRes.data.results
        .filter((a: { company_name: string }) => !atNames.has(a.company_name.toLowerCase()))
        .map((a: { id: number; company_name: string }) => ({
          key: `app-${a.id}`,
          id: a.id,
          name: a.company_name,
          source: "app" as const,
        }));
      const mergedAccounts = [...atAccounts, ...appAccounts].sort((a, b) => a.name.localeCompare(b.name));
      setAccounts(mergedAccounts);

      // Real items default to "today" if not previously placed; create exactly 2 fresh blanks
      const base = itemsRes.data as AirtableActionItem[];
      const stored: Record<string, Zone> = (() => {
        try { return JSON.parse(localStorage.getItem("actionItemZones") ?? "{}"); } catch { return {}; }
      })();
      const currentZones: Record<string, Zone> = { ...stored };
      for (const item of base) {
        const stored_zone = currentZones[item.airtable_id];
        // Assign a default when there is no prior zone, and rescue any item whose stored
        // zone no longer renders a panel — "unstaged" is blanks-only, and older builds
        // could leave "complete" / "done-accounts-*" behind, which would strand the item
        // in no panel at all. Explicit "today" / "active" / "accounts" placements the user
        // made on any page are preserved.
        if (!stored_zone || stored_zone === "unstaged" || !RENDERABLE_ZONES.includes(stored_zone)) {
          currentZones[item.airtable_id] = item.account_name ? "accounts" : "today";
        }
      }
      // Strip any stale blanks from zones so topUpBlanks starts from 0
      for (const key of Object.keys(currentZones)) {
        if (key.startsWith("local-")) delete currentZones[key];
      }
      const starKey = localStorage.getItem("actionItemStarredAccount");
      const targetBlanks = window.innerWidth >= 1100 ? 2 : 1;
      const { newItems, newZones } = topUpBlanks(base, currentZones, starKey, mergedAccounts, loadedProfile, targetBlanks);
      localStorage.setItem("actionItemZones", JSON.stringify(newZones));
      setZonesRaw(newZones);
      setAllItems(newItems);
    } catch (err) {
      console.error("[ActionItemsPage] load failed:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /**
   * Refresh in the background, coalescing bursts.
   *
   * `lib/api.ts` broadcasts `actionItemsUpdated` from a response interceptor after **every**
   * action-item mutation, and this page listens to that broadcast — including its own. So a
   * single drag fired a full reload, and a drag that changes two fields (a cross-account drop
   * onto a status column sends an account PATCH and a status PATCH) fired two, overlapping.
   * Two concurrent `load()`s can apply their `setAllItems` in either order, so coalescing is
   * a correctness fix as much as a request-volume one.
   *
   * The window is short enough to be imperceptible; the optimistic update has already put the
   * card where the user dropped it, so this reload only has to confirm it.
   */
  const reloadTimer = useRef<number | null>(null);
  const scheduleSilentReload = useCallback(() => {
    if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current);
    reloadTimer.current = window.setTimeout(() => {
      reloadTimer.current = null;
      void load({ silent: true });
    }, SILENT_RELOAD_DEBOUNCE_MS);
  }, [load]);

  useEffect(() => () => {
    if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current);
  }, []);

  const fetchTeamMembers = () => teamApi.listMembers().then(({ data }) => setTeamMembers(data.results)).catch(() => {});

  useEffect(() => { void fetchTeamMembers(); }, []);

  // Clear drag state whenever any drag ends (cancel or drop) so stale dragId never blocks next drag
  useEffect(() => {
    const onDragEnd = () => { setDragId(null); setDragOverZone(null); setDropHint(null); };
    window.addEventListener("dragend", onDragEnd);
    return () => window.removeEventListener("dragend", onDragEnd);
  }, [setDropHint]);

  // Pick up zone changes made on the Calendar page (drag-to-stage)
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === "teamUpdated") { void fetchTeamMembers(); return; }
      if (e.key === "accountsUpdated" || e.key === "actionItemsUpdated") { scheduleSilentReload(); return; }

      // Manual card order changed in another tab. Adopt it wholesale rather than merging:
      // an ordering is a total order, so last-write-wins is the only coherent policy.
      if (e.key === ACTION_ITEM_ORDER_KEY) {
        try { setOrderRaw(JSON.parse(e.newValue ?? "{}")); } catch { /* ignore */ }
        return;
      }

      // Calendar removed a work-tracking event — stop timer and subtract that duration
      if (e.key === "actionItemCancelTimer" && e.newValue) {
        let parsed: { airtableId: string; seconds?: number } | null = null;
        try { parsed = JSON.parse(e.newValue); } catch { return; }
        if (!parsed?.airtableId) return;
        const { airtableId, seconds: removedSecs } = parsed;
        setTimers((prev) => {
          const t = prev[airtableId];
          if (!t) return prev;
          // If the timer is still running, stop it first without committing the time
          if (t.running) {
            clearActiveTimer(airtableId);
            delete trackStartTimes.current[airtableId];
          }
          // Subtract the removed session duration from elapsed (clamp to 0)
          const newElapsed = removedSecs != null ? Math.max(0, t.elapsed - removedSecs) : 0;
          return { ...prev, [airtableId]: { running: false, elapsed: newElapsed, startedAt: null } };
        });
        return;
      }

      // Calendar dropped an item onto today's date — move to In Progress and start timer
      if (e.key === "actionItemStartTimer" && e.newValue) {
        const airtableId = e.newValue;
        setZonesRaw((prev) => {
          const next = { ...prev, [airtableId]: "active" as Zone };
          localStorage.setItem("actionItemZones", JSON.stringify(next));
          return next;
        });
        // Update status to In Progress on the backend
        airtableApi.updateActionItemStatus(airtableId, "In Progress").catch(() => {});
        setAllItems((prev) => {
          const item = prev.find((i) => i.airtable_id === airtableId);
          if (item) {
            addLog({
              category: "action_item",
              message: `"${item.task || "Untitled"}" moved to In Progress from calendar`,
              links: [{ label: "View action items", path: "/action-items" }],
              resource: { type: "action_item", id: airtableId },
            });
          }
          return prev.map((i) => i.airtable_id === airtableId ? { ...i, status: "In Progress" } : i);
        });
        // Start the timer
        setTimers((prev) => ({
          ...prev,
          [airtableId]: { running: true, elapsed: prev[airtableId]?.elapsed ?? 0, startedAt: Date.now() },
        }));
        return;
      }

      if (e.key !== "actionItemZones") return;
      try {
        const incoming: Record<string, Zone> = JSON.parse(e.newValue ?? "{}");
        setZonesRaw((prev) => {
          const merged = { ...prev };
          for (const [id, zone] of Object.entries(incoming)) {
            if ((zone === "today" || zone === "active") && merged[id] !== zone) {
              merged[id] = zone;
            }
          }
          return merged;
        });
      } catch { /* ignore */ }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // scheduleSilentReload is stable, so listing it cannot cause a re-subscribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleSilentReload]);

  function itemsInZone(zone: Zone): AirtableActionItem[] {
    return allItems.filter((i) => {
      const defaultZone: Zone = i.airtable_id.startsWith("local-")
        ? "unstaged"
        : i.account_name ? "accounts" : "today";
      return (zones[i.airtable_id] ?? defaultZone) === zone;
    });
  }

  /** Apply the user's manual order to a zone's cards. Ids with no recorded position sort
   *  to the bottom, and Array.sort is stable, so they keep their relative API order. */
  function orderForZone(zone: Zone, items: AirtableActionItem[]): AirtableActionItem[] {
    if (!isReorderableZone(zone)) return items;
    const positions = new Map((order[zone] ?? []).map((id, i) => [id, i]));
    return [...items].sort(
      (a, b) => (positions.get(a.airtable_id) ?? Infinity) - (positions.get(b.airtable_id) ?? Infinity)
    );
  }

  // ── Drag handlers ──────────────────────────────────────────────────────────

  function handleDragStart(e: React.DragEvent, item: AirtableActionItem) {
    setDragId(item.airtable_id);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent, zone: Zone) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverZone(zone);
    // Hovering the zone's own padding (not a card) means "append to the end".
    if (isReorderableZone(zone)) setDropHint({ zone, beforeId: null });
  }

  /** A card reports where the dragged item would land if dropped now. */
  function handleDropHint(zone: ReorderableZone, beforeId: string | null) {
    const prev = dropHintRef.current;
    if (prev?.zone === zone && prev.beforeId === beforeId) return;
    setDropHint({ zone, beforeId });
  }

  function handleDragLeave() {
    setDragOverZone(null);
    setDropHint(null);
  }

  /**
   * File an item under an account, or clear its account when `accountKey === "none"`.
   *
   * The single mutation site for account reassignment: the Views grid's row drops and the
   * Projects view's per-group drops both route through it, so the optimistic update, the
   * Airtable write and the activity-log entry can't drift between the two views.
   *
   * Deliberately does **not** touch `zones` — which account a card is filed under and which
   * panel it sits in are separate decisions. The Views grid sets the zone itself, because
   * dropping there literally means "put it in the Views grid"; the Projects view renders
   * every real item regardless of zone, so a drop there must not yank a card out of Stage
   * Today as a side effect.
   *
   * The PATCH is skipped when nothing would change, so dropping a card on the account it is
   * already filed under is free rather than a redundant write plus a misleading log line.
   */
  async function assignItemToAccount(resolvedId: string, item: AirtableActionItem, accountKey: string) {
    const acc = accountKey === "none" ? null : accounts.find((a) => a.key === accountKey);
    // An unresolvable key would otherwise silently clear the account.
    if (accountKey !== "none" && !acc) return;

    if (acc) {
      setAccountAssign((prev) => ({ ...prev, [resolvedId]: accountKey }));
    } else {
      setAccountAssign((prev) => { const next = { ...prev }; delete next[resolvedId]; return next; });
    }

    const updates: Partial<AirtableActionItem> = acc
      ? { account_name: acc.name, account: acc.id }
      : { account_name: null, account: null };
    // The per-user Admin workspace is private to its assignee, so filing a card there has
    // to name one — an unassigned Admin item is shared with everyone.
    if (acc && acc.name.toLowerCase() === "admin" && myProfile?.airtable_collaborator_id) {
      updates.assignee_airtable_id = myProfile.airtable_collaborator_id;
      updates.assignee_name = myProfile.display_name || myProfile.email || "";
    }

    const changed = (Object.keys(updates) as (keyof AirtableActionItem)[])
      .some((k) => !sameFieldValue(item[k], updates[k]));
    if (!changed) return;

    setAllItems((prev) => prev.map((i) => i.airtable_id === resolvedId ? { ...i, ...updates } : i));
    if (resolvedId.startsWith("local-")) return;

    try { await airtableApi.updateActionItemFields(resolvedId, updates); } catch { /* best effort */ }
    addLog({
      category: "action_item",
      message: acc
        ? `Moved "${item.task || "Untitled"}" to Views under "${acc.name}"`
        : `Moved "${item.task || "Untitled"}" to Views (no account)`,
      links: [{ label: "View action items", path: "/action-items" }],
      resource: { type: "action_item", id: resolvedId },
    });
  }

  /**
   * A card was dropped on an account group in the Projects view.
   *
   * Blanks are skipped rather than promoted: `promoteBlankItem` throws away the `local-*` id
   * for a real recXXX, and the Projects view never renders blanks in the first place — the
   * only way one reaches here is a drag out of Unstaged, where the Views grid is the path
   * that owns promotion.
   */
  async function handleAccountGroupDrop(e: React.DragEvent, accountKey: string) {
    e.preventDefault();
    if (!dragId) return;
    const item = allItems.find((i) => i.airtable_id === dragId);
    setDragId(null);
    if (!item || item.airtable_id.startsWith("local-")) return;
    await assignItemToAccount(item.airtable_id, item, accountKey);
  }

  async function handleDrop(e: React.DragEvent, targetZoneArg: Zone, accountKey?: string) {
    e.preventDefault();
    setDragOverZone(null);
    if (!dragId) return;
    let targetZone = targetZoneArg;

    // Promote blank to a real Airtable record when leaving Unstaged
    const prevZoneGlobal = zones[dragId] ?? (dragId.startsWith("local-") ? "unstaged" : "today");
    const dragSnapshot = allItems.find((i) => i.airtable_id === dragId);
    if (!dragSnapshot) return;

    let activeId = dragId;
    let activeItem = dragSnapshot;

    if (dragId.startsWith("local-") && prevZoneGlobal === "unstaged" && targetZone !== "unstaged") {
      const created = await promoteBlankItem(dragId, dragSnapshot);
      if (!created) return; // no task name or API error — abort drop
      activeId = created.airtable_id;
      activeItem = created;
      // Swap item in state — zone will be set below by the drop handler
      setAllItems((prev) => prev.map((i) => i.airtable_id === dragId ? created : i));
      // Remove old local key AND pre-write the target zone in one atomic update so
      // localStorage is never in a state where realId has no zone entry.
      setZonesRaw((prev) => {
        const next = { ...prev, [created.airtable_id]: targetZone };
        delete next[dragId];
        localStorage.setItem("actionItemZones", JSON.stringify(next));
        return next;
      });
    }

    const item = activeItem;

    // Use activeId from here on
    const resolvedId = activeId;

    if (targetZone === "accounts" && accountKey != null) {
      const prevZoneAccounts = prevZoneGlobal;
      // Zone already set atomically above for the promote path; this is a no-op for
      // non-promote drops (setZones is idempotent).
      setZones((prev) => ({ ...prev, [resolvedId]: "accounts" }));

      // Always update account assignment when dropped into a specific bucket.
      await assignItemToAccount(resolvedId, item, accountKey);

      // Top up blanks if the item came from Unstaged
      if (prevZoneAccounts === "unstaged") {
        setAllItems((prev) => {
          const base: Record<string, Zone> = (() => { try { return JSON.parse(localStorage.getItem("actionItemZones") ?? "{}"); } catch { return {}; } })();
          const { newItems, newZones } = topUpBlanks(prev, base, starredAccountKey, accounts, myProfile);
          localStorage.setItem("actionItemZones", JSON.stringify(newZones));
          setZonesRaw(newZones);
          return newItems;
        });
      }
      setDragId(null);
      return;
    }

    if (targetZone === "done-accounts" && accountKey != null) {
      // Dropped onto an account's Done deck — mark Done, assign account, move to accounts zone
      setZones((prev) => ({ ...prev, [resolvedId]: "accounts" }));
      const acc = accountKey !== "none" ? accounts.find((a) => a.key === accountKey) : null;
      const updates: Partial<AirtableActionItem> = {
        status: "Done",
        ...(acc ? { account_name: acc.name, account: acc.source === "airtable" ? acc.id : null } : {}),
      };
      setAllItems((prev) => prev.map((i) => i.airtable_id === resolvedId ? { ...i, ...updates } : i));
      if (!resolvedId.startsWith("local-")) {
        try { await airtableApi.updateActionItemFields(resolvedId, updates); } catch { /* best effort */ }
        addLog({
          category: "action_item",
          message: `Marked "${item.task || "Untitled"}" as Done${acc ? ` under "${acc.name}"` : ""}`,
          links: [{ label: "View action items", path: "/action-items" }],
          resource: { type: "action_item", id: resolvedId },
        });
      }
      setDragId(null);
      return;
    }

    const prevZone = prevZoneGlobal;
    setZones((prev) => ({ ...prev, [resolvedId]: targetZone }));

    // Record the manual position. Runs after resolvedId is known so a promoted blank is
    // stored under its real recXXX and its throwaway local-* id is dropped.
    const hint = dropHintRef.current;
    if (isReorderableZone(targetZone)) {
      // Materialise the full unfiltered order, so reordering while a search is active
      // cannot drop the hidden cards out of the array.
      const rendered = orderForZone(targetZone, itemsInZone(targetZone)).map((i) => i.airtable_id);
      const beforeId = hint?.zone === targetZone ? hint.beforeId : null;
      setOrder((prev) => {
        const others = rendered.filter((id) => id !== resolvedId && id !== dragId);
        const at = beforeId ? others.indexOf(beforeId) : -1;
        others.splice(at < 0 ? others.length : at, 0, resolvedId);
        const otherZone: ReorderableZone = targetZone === "today" ? "active" : "today";
        return {
          ...prev,
          [targetZone]: others,
          [otherZone]: (prev[otherZone] ?? []).filter((id) => id !== resolvedId && id !== dragId),
        };
      });
    } else {
      // Left the hand-ordered zones entirely — forget its position in both.
      setOrder((prev) => ({
        today: (prev.today ?? []).filter((id) => id !== resolvedId && id !== dragId),
        active: (prev.active ?? []).filter((id) => id !== resolvedId && id !== dragId),
      }));
    }
    setDropHint(null);

    // Top up blanks whenever an item leaves Unstaged
    if (prevZone === "unstaged" && targetZone !== "unstaged") {
      setAllItems((prev) => {
        const base: Record<string, Zone> = (() => { try { return JSON.parse(localStorage.getItem("actionItemZones") ?? "{}"); } catch { return {}; } })();
        const { newItems, newZones } = topUpBlanks(prev, base, starredAccountKey, accounts, myProfile);
        localStorage.setItem("actionItemZones", JSON.stringify(newZones));
        setZonesRaw(newZones);
        return newItems;
      });
    }

    // Stop timer if leaving active zone
    if (prevZone === "active" && targetZone !== "active") {
      const t = timers[resolvedId];
      const sessionStartedAt = trackStartTimes.current[resolvedId];
      const endedAt = new Date().toISOString();
      if (t?.running) {
        const elapsed = t.elapsed + Math.floor((Date.now() - (t.startedAt ?? Date.now())) / 1000);
        setTimers((prev) => ({ ...prev, [resolvedId]: { running: false, elapsed, startedAt: null } }));
        clearActiveTimer(resolvedId);
        if (elapsed > 0) {
          const acc = accounts.find((a) => a.key === accountAssign[resolvedId]);
          const entry: TimeLogEntry = {
            airtable_id: resolvedId,
            account_name: acc?.name ?? item.account_name ?? "Unknown",
            task: item.task,
            seconds: elapsed,
            loggedAt: new Date().toISOString(),
          };
          setTimeLogs((prev) => [entry, ...prev]);
          try { await airtableApi.logTime({ airtable_id: resolvedId, account_name: entry.account_name, task: item.task, seconds: elapsed }); } catch { /* best effort */ }
        }
      }
      // Finalize or create the session calendar event
      const liveId = liveEventIds.current[resolvedId];
      if (liveId) {
        delete liveEventIds.current[resolvedId];
        schedulerApi.updateEvent(liveId, { end_datetime: endedAt }).catch(() => {});
      } else if (sessionStartedAt) {
        schedulerApi.createEvent({
          title: item.task,
          description: `Work session — ${item.account_name ?? ""}`,
          start_datetime: sessionStartedAt,
          end_datetime: endedAt,
          all_day: false,
          status: "confirmed",
          calendar_id: "work_tracking",
          is_synced: false,
          agentpm_airtable_id: resolvedId,
        } as Partial<CalendarEvent>).catch(() => {});
      }
      if (sessionStartedAt) delete trackStartTimes.current[resolvedId];
    }

    // Status changes on drop
    const fromLabel = ZONE_LABELS[prevZone as Zone] ?? prevZone;
    const toLabel = ZONE_LABELS[targetZone] ?? targetZone;

    if (targetZone === "complete") {
      // "Completed Today" column is removed — remap to accounts zone and mark Done
      targetZone = "accounts";
      try { await airtableApi.updateActionItemStatus(resolvedId, "Done"); } catch { /* best effort */ }
      setAllItems((prev) => prev.map((i) => i.airtable_id === resolvedId ? { ...i, status: "Done" } : i));
    } else if (targetZone === "today") {
      // No status change — just staged for today
    } else if (targetZone === "active" && prevZone !== "active") {
      // Guarded on an actual zone change: a same-zone drop is now a reorder, and must not
      // re-PATCH the status, restart the timer, or create a second work_tracking event.
      try { await airtableApi.updateActionItemStatus(resolvedId, "In Progress"); } catch { /* best effort */ }
      setAllItems((prev) => prev.map((i) => i.airtable_id === resolvedId ? { ...i, status: "In Progress" } : i));
      // Only auto-start the timer if Auto Track is enabled; otherwise wait for the Track button
      if (autoTrack) {
        const sessionNow = new Date().toISOString();
        trackStartTimes.current[resolvedId] = sessionNow;
        setTimers((prev) => ({
          ...prev,
          [resolvedId]: { running: true, elapsed: prev[resolvedId]?.elapsed ?? 0, startedAt: Date.now() },
        }));
        // Create live calendar event immediately
        const resolvedItem = allItems.find((i) => i.airtable_id === resolvedId);
        schedulerApi.createEvent({
          title: resolvedItem?.task ?? resolvedId,
          description: `Work session — ${resolvedItem?.account_name ?? ""}`,
          start_datetime: sessionNow,
          end_datetime: sessionNow,
          all_day: false,
          status: "confirmed",
          calendar_id: "work_tracking",
          is_synced: false,
          agentpm_airtable_id: resolvedId,
        } as Partial<CalendarEvent>).then(({ data }) => {
          liveEventIds.current[resolvedId] = data.id;
        }).catch(() => {});
      }
    } else if (targetZone === "unstaged" && prevZone !== "unstaged") {
      try { await airtableApi.updateActionItemStatus(resolvedId, "Open"); } catch { /* best effort */ }
      setAllItems((prev) => prev.map((i) => i.airtable_id === resolvedId ? { ...i, status: "Open" } : i));
    }

    if (prevZone !== targetZone && !resolvedId.startsWith("local-")) {
      addLog({
        category: "action_item",
        message: `Moved "${item.task || "Untitled"}" from ${fromLabel} to ${toLabel}`,
        links: [{ label: "View action items", path: "/action-items" }],
        resource: { type: "action_item", id: resolvedId },
      });
    }

    setDragId(null);
  }

  // ── Promote blank to real Airtable record ─────────────────────────────────
  // Pure API call — no state mutations. Returns the created item data, or null
  // on failure. All state updates are done atomically by the caller.
  const promotingRef = useRef<Set<string>>(new Set());
  async function promoteBlankItem(
    localId: string,
    snapshot: AirtableActionItem,
  ): Promise<AirtableActionItem | null> {
    if (!snapshot.task?.trim()) return null;
    if (promotingRef.current.has(localId)) return null; // prevent double-fire
    promotingRef.current.add(localId);
    try {
      const { data } = await airtableApi.createActionItem({
        task: snapshot.task,
        task_details: snapshot.task_details,
        status: snapshot.status,
        priority: snapshot.priority,
        due_date: snapshot.due_date,
        estimated_time: snapshot.estimated_time,
        time_spent: snapshot.time_spent,
        prep_time: snapshot.prep_time,
        slack_thread_url: snapshot.slack_thread_url,
        account_name: snapshot.account_name,
        assignee_airtable_id: snapshot.assignee_airtable_id,
        assignee_name: snapshot.assignee_name,
      });
      addLog({
        category: "action_item",
        message: `Action item "${snapshot.task}" created`,
        links: [{ label: "View action items", path: "/action-items?glow=1" }],
        resource: { type: "action_item", id: data.airtable_id },
      });
      return data;
    } catch {
      reportError("Failed to save action item");
      return null;
    } finally {
      promotingRef.current.delete(localId);
    }
  }

  // ── Timer ──────────────────────────────────────────────────────────────────

  async function handleTimerToggle(airtableId: string) {
    const item = allItems.find((i) => i.airtable_id === airtableId);
    if (!item) return;

    const t = timers[airtableId] ?? { running: false, elapsed: 0, startedAt: null };

    if (t.running) {
      // ── STOP ──────────────────────────────────────────────────────────────
      const sessionStart = trackStartTimes.current[airtableId];
      const endedAt = new Date().toISOString();
      const elapsed = t.elapsed + Math.floor((Date.now() - (t.startedAt ?? Date.now())) / 1000);
      const acc = accounts.find((a) => a.key === accountAssign[airtableId]);
      const sessionSeconds = elapsed - t.elapsed;
      const entry: TimeLogEntry = {
        airtable_id: airtableId,
        account_name: acc?.name ?? item.account_name ?? "Unknown",
        task: item.task,
        seconds: sessionSeconds,
        loggedAt: endedAt,
      };
      setTimeLogs((logs) => [entry, ...logs]);
      airtableApi.logTime({ airtable_id: airtableId, account_name: entry.account_name, task: item.task, seconds: sessionSeconds }).catch(() => {});

      // Finalize the live calendar event with exact stop time
      const liveId = liveEventIds.current[airtableId];
      if (liveId) {
        delete liveEventIds.current[airtableId];
        schedulerApi.updateEvent(liveId, { end_datetime: endedAt }).catch(() => {});
      } else if (sessionStart) {
        // Fallback: no live event was created yet (very short session)
        schedulerApi.createEvent({
          title: item.task,
          description: `Work session — ${entry.account_name}`,
          start_datetime: sessionStart,
          end_datetime: endedAt,
          all_day: false,
          status: "confirmed",
          calendar_id: "work_tracking",
          is_synced: false,
          agentpm_airtable_id: airtableId,
        } as Partial<CalendarEvent>).catch(() => {});
      }
      if (sessionStart) delete trackStartTimes.current[airtableId];
      clearActiveTimer(airtableId);
      setTimers((prev) => ({ ...prev, [airtableId]: { running: false, elapsed, startedAt: null } }));
    } else {
      // ── START ─────────────────────────────────────────────────────────────
      const sessionNow = new Date().toISOString();
      trackStartTimes.current[airtableId] = sessionNow;
      setTimers((prev) => ({ ...prev, [airtableId]: { ...t, running: true, startedAt: Date.now() } }));

      // Create a live calendar event immediately so it shows up on the calendar
      const acc = accounts.find((a) => a.key === accountAssign[airtableId]);
      schedulerApi.createEvent({
        title: item.task,
        description: `Work session — ${acc?.name ?? item.account_name ?? ""}`,
        start_datetime: sessionNow,
        end_datetime: sessionNow, // will be updated every 30s by the tick
        all_day: false,
        status: "confirmed",
        calendar_id: "work_tracking",
        is_synced: false,
        agentpm_airtable_id: airtableId,
      } as Partial<CalendarEvent>).then(({ data }) => {
        liveEventIds.current[airtableId] = data.id;
      }).catch(() => {});
    }
  }

  function handleTimerEdit(airtableId: string, seconds: number) {
    // Update the in-memory elapsed value; stop the running clock if it was running
    setTimers((prev) => {
      const t = prev[airtableId] ?? { running: false, elapsed: 0, startedAt: null };
      // If running, stop cleanly before overwriting elapsed
      if (t.running) {
        clearActiveTimer(airtableId);
        delete trackStartTimes.current[airtableId];
      }
      return { ...prev, [airtableId]: { running: false, elapsed: seconds, startedAt: null } };
    });
  }

  // ── Edit / save ────────────────────────────────────────────────────────────

  async function handleSaveItem(airtableId: string, updated: Partial<AirtableActionItem>) {
    const before = allItems.find((i) => i.airtable_id === airtableId);
    // Optimistic: update local state immediately so handleDrop sees the latest data
    setAllItems((prev) => prev.map((i) => i.airtable_id === airtableId ? { ...i, ...updated } : i));
    // Skip API for local-only blank items
    if (airtableId.startsWith("local-")) return;
    try {
      await airtableApi.updateActionItemFields(airtableId, updated);
      if (before) logActionItemUpdate(before, updated);
    } catch { reportError("Failed to save action item"); }
  }

  // ── Delete action item (log calendar + snapshot → remove from state → API) ───

  async function handleDeleteItem(item: AirtableActionItem) {
    const airtableId = item.airtable_id;
    const SCHEDULED_KEY = "scheduledActionItems";

    // 1. Read calendar occurrences before removing them so they can be reapplied if recreated
    let calendarOccurrences: { start: string; end: string }[] = [];
    try {
      const all: { airtableId: string; task: string; accountName: string | null; start: string; end: string }[] =
        JSON.parse(localStorage.getItem(SCHEDULED_KEY) ?? "[]");
      calendarOccurrences = all
        .filter((s) => s.airtableId === airtableId)
        .map((s) => ({ start: s.start, end: s.end }));
    } catch { /* best effort */ }

    // 2. Fetch backend calendar events for this action item (work-tracking sessions)
    type CalOccurrence = { id: number; start: string; end: string; title: string };
    let backendCalEvents: CalOccurrence[] = [];
    if (item.task) {
      try {
        const { data } = await schedulerApi.listEvents({ calendar_id: "work_tracking", title: item.task });
        backendCalEvents = (data ?? []).map((e) => ({
          id: e.id,
          start: e.start_datetime,
          end: e.end_datetime,
          title: e.title,
        }));
      } catch { /* best effort */ }
    }

    // Merge localStorage occurrences with backend records for a complete picture
    const allOccurrences = [
      ...calendarOccurrences.map((o) => ({ id: null as number | null, start: o.start, end: o.end })),
      ...backendCalEvents.filter((be) =>
        !calendarOccurrences.some((lo) => lo.start === be.start && lo.end === be.end)
      ).map((be) => ({ id: be.id as number | null, start: be.start, end: be.end })),
    ];

    // 3. Log calendar occurrences before deletion
    if (allOccurrences.length > 0) {
      addLog({
        category: "calendar",
        message: `Calendar sessions for "${item.task || "Untitled"}" before deletion (${allOccurrences.length} session${allOccurrences.length === 1 ? "" : "s"}): ${allOccurrences.map((o) => {
          const d = new Date(o.start);
          const dur = Math.round((new Date(o.end).getTime() - d.getTime()) / 60000);
          return `${d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} (${dur}m)`;
        }).join("; ")}`,
        links: [{ label: "View calendar", path: "/calendar" }],
        resource: { type: "action_item", id: airtableId },
      });
    }

    // 4. Snapshot all fields (including calendar occurrences) for full recoverability
    const snapshot = JSON.stringify({
      airtable_id: airtableId,
      task: item.task,
      task_details: item.task_details,
      status: item.status,
      priority: item.priority,
      due_date: item.due_date,
      estimated_time: item.estimated_time,
      time_spent: item.time_spent,
      prep_time: item.prep_time,
      slack_thread_url: item.slack_thread_url,
      account: item.account,
      account_name: item.account_name,
      assignee_airtable_id: item.assignee_airtable_id,
      assignee_name: item.assignee_name,
      salesforce_task_id: item.salesforce_task_id,
      calendar_occurrences: allOccurrences.map((o) => ({ start: o.start, end: o.end })),
    }, null, 2);

    addLog({
      category: "action_item",
      message: `Deleted action item "${item.task || "Untitled"}"${item.account_name ? ` (${item.account_name})` : ""}`,
      links: [{ label: "View activity log", path: "/logs?glow=1" }],
      resource: { type: "action_item", id: airtableId },
    });

    addLog({
      category: "action_item",
      message: `[SNAPSHOT] ${item.task || "Untitled"} — ${snapshot}`,
      resource: { type: "action_item", id: airtableId },
    });

    // 5. Delete matching backend CalendarEvent records
    await Promise.allSettled(
      backendCalEvents.map((e) => schedulerApi.deleteEvent(e.id))
    );

    // 6. Remove from calendar localStorage and notify CalendarPage immediately
    try {
      const all: { airtableId: string }[] = JSON.parse(localStorage.getItem(SCHEDULED_KEY) ?? "[]");
      const pruned = all.filter((s) => s.airtableId !== airtableId);
      localStorage.setItem(SCHEDULED_KEY, JSON.stringify(pruned));
      window.dispatchEvent(new StorageEvent("storage", { key: SCHEDULED_KEY, newValue: JSON.stringify(pruned) }));
    } catch { /* best effort */ }

    // 7. Optimistically remove from UI
    setAllItems((prev) => prev.filter((i) => i.airtable_id !== airtableId));
    setZonesRaw((prev) => {
      const next = { ...prev };
      delete next[airtableId];
      localStorage.setItem("actionItemZones", JSON.stringify(next));
      return next;
    });
    setAccountAssignRaw((prev) => {
      const next = { ...prev };
      delete next[airtableId];
      localStorage.setItem("actionItemAccountAssign", JSON.stringify(next));
      return next;
    });

    // 8. Close modal if it was open for this item
    setEditItem((prev) => prev?.airtable_id === airtableId ? null : prev);

    // 9. Delete from backend (Airtable + Django)
    if (!airtableId.startsWith("local-") && item.id) {
      try {
        await airtableApi.deleteActionItem(item.id);
      } catch { /* best effort — already removed from UI */ }
    }
  }

  // Called after reminder set/clear — merge the updated item into state
  function handleItemUpdated(updated: AirtableActionItem) {
    setAllItems((prev) => prev.map((i) => i.airtable_id === updated.airtable_id ? { ...i, ...updated } : i));
    setEditItem((prev) => prev?.airtable_id === updated.airtable_id ? { ...prev, ...updated } : prev);
  }

  // Save button on any card — saves fields and moves "today" items to accounts zone
  async function handleInlineSave(item: AirtableActionItem, fields: Partial<AirtableActionItem>) {
    if (!item.airtable_id.startsWith("local-")) {
      await handleSaveItem(item.airtable_id, fields);
      const currentZone = zones[item.airtable_id] ?? "today";
      if (currentZone === "today") {
        setZones((prev) => ({ ...prev, [item.airtable_id]: "accounts" }));
      }
      return;
    }
    // Local item — promote then keep in unstaged
    const merged = { ...item, ...fields };
    if (!merged.task?.trim()) return;
    const created = await promoteBlankItem(item.airtable_id, merged);
    if (!created) return;
    const realId = created.airtable_id;
    const localId = item.airtable_id;
    // One atomic state update: swap id, keep zone as unstaged, replenish blanks
    setZonesRaw((prevZ) => {
      const nextZ = { ...prevZ, [realId]: "unstaged" as Zone };
      delete nextZ[localId];
      localStorage.setItem("actionItemZones", JSON.stringify(nextZ));
      return nextZ;
    });
    setAllItems((prev) => prev.map((i) => i.airtable_id === localId ? { ...created } : i));
    window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated", newValue: realId }));
  }

  // Save + auto-stage: promote blank, move to accounts zone
  async function handleSaveAndStage(item: AirtableActionItem, fields: Partial<AirtableActionItem>) {
    const merged = { ...item, ...fields };
    const localId = item.airtable_id;

    let realData: AirtableActionItem;

    if (localId.startsWith("local-")) {
      const created = await promoteBlankItem(localId, merged);
      if (!created) return; // no task or API error
      realData = created;
    } else {
      // Already a real item — just save fields and move zone
      await handleSaveItem(localId, fields);
      realData = { ...item, ...fields } as AirtableActionItem;
    }

    const realId = realData.airtable_id;

    // Resolve account key
    let accountId = merged.account ?? null;
    let matchedKey: string | null = null;
    if (merged.account_name) {
      const match = accounts.find((a) => a.name.toLowerCase() === merged.account_name!.toLowerCase());
      if (match) { accountId = match.id; matchedKey = match.key; }
    } else if (accountId) {
      const match = accounts.find((a) => a.id === accountId);
      if (match) matchedKey = match.key;
    }

    // ── Single atomic state update ────────────────────────────────────────────
    // 1. Set zone to "accounts" for realId, remove localId entry
    const nextZones: Record<string, Zone> = { ...zones, [realId]: "accounts" };
    delete nextZones[localId];
    localStorage.setItem("actionItemZones", JSON.stringify(nextZones));
    setZonesRaw(nextZones);

    // 2. Account assignment
    if (matchedKey != null) {
      setAccountAssignRaw((prev) => {
        const next = { ...prev, [realId]: matchedKey! };
        delete next[localId];
        localStorage.setItem("actionItemAccountAssign", JSON.stringify(next));
        return next;
      });
    }

    // 3. Swap item in list and replenish blanks
    const updates: Partial<AirtableActionItem> = {};
    if (accountId != null) updates.account = accountId;
    setAllItems((prev) => {
      const swapped = prev.map((i) =>
        i.airtable_id === localId ? { ...realData, ...updates } :
        i.airtable_id === realId  ? { ...i, ...updates } : i
      );
      const { newItems, newZones } = topUpBlanks(swapped, nextZones, starredAccountKey, accounts, myProfile);
      localStorage.setItem("actionItemZones", JSON.stringify(newZones));
      setZonesRaw(newZones);
      return newItems;
    });

    window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated", newValue: realId }));

    // 4. Push account link to Airtable if needed
    if (Object.keys(updates).length > 0) {
      try { await airtableApi.updateActionItemFields(realId, updates); } catch { /* best effort */ }
    }
  }

  if (isLoading) {
    return <div className="flex items-center justify-center h-full text-sm text-[var(--twilio-navy)]">Loading…</div>;
  }

  return (
    <div ref={pageRef} className="flex flex-col h-full overflow-auto">
      {/* Page heading */}
      <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
        <div>
          <h1 className="text-3xl font-semibold text-[var(--twilio-navy)] flex items-center gap-2"><ChecklistIcon width={24} height={24} style={{ flexShrink: 0 }} />Action Items</h1>
          <p className="text-sm text-[var(--twilio-navy)] mt-1">{allItems.filter(i => !i.airtable_id.startsWith("local-")).length} items from Airtable</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setFocusMode(v => { const next = !v; localStorage.setItem("actionFocusMode", String(next)); return next; }); }}
            className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 bg-white text-[var(--twilio-navy)] hover:bg-gray-50 shadow-blue-sm"
          >
            {focusMode ? "Exit Focus" : "Focus"}
          </button>
          <button
            onClick={() => setShowLogs((v) => !v)}
            className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 bg-white text-[var(--twilio-navy)] hover:bg-gray-50 shadow-blue-sm"
          >
            Time logs ({timeLogs.length})
          </button>
          <button
            onClick={() => void load()}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 px-6 pb-6 flex flex-col gap-3 min-h-0">
        {(() => {
          // Always render; kanban search still filters the top three zones
          const q = search.trim().toLowerCase();
          const kanbanFilter = (item: AirtableActionItem) => {
            if (item.airtable_id.startsWith("local-")) return true;
            if (!q) return true;
            if (item.task?.toLowerCase().includes(q)) return true;
            if (item.task_details?.toLowerCase().includes(q)) return true;
            if (item.account_name?.toLowerCase().includes(q)) return true;
            if (item.assignee_name?.toLowerCase().includes(q)) return true;
            if (item.due_date) {
              const dueStr = new Date(item.due_date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }).toLowerCase();
              if (dueStr.includes(q)) return true;
              if (dueDateGroup(item).toLowerCase().includes(q)) return true;
            }
            return false;
          };
          // In focus mode a pinned card is hoisted into the Pinned In Progress section and
          // must not also render in its own zone panel — two mounted KanbanCards for one
          // item would each hold a rival copy of its unsaved form state.
          const hiddenByFocus = (item: AirtableActionItem) =>
            focusMode && focusPinnedIds.has(item.airtable_id);
          const filteredItemsInZone = (zone: Zone) =>
            orderForZone(zone, itemsInZone(zone).filter(kanbanFilter).filter((i) => !hiddenByFocus(i)));
          return (<>

        {/* Time log card */}
        {showLogs && (
          <div className="shrink-0 bg-amber-50 rounded-lg shadow-blue-sm px-5 py-3 max-h-48 overflow-y-auto">
            <p className="text-sm font-semibold text-amber-800 mb-2">Time Logs</p>
            {timeLogs.length === 0 ? (
              <p className="text-sm text-amber-600">No time logged yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-amber-700">
                    <th className="pr-4 font-medium">Account</th>
                    <th className="pr-4 font-medium">Task</th>
                    <th className="pr-4 font-medium">Time</th>
                    <th className="font-medium">Logged at</th>
                  </tr>
                </thead>
                <tbody>
                  {timeLogs.map((l, i) => (
                    <tr key={i} className="border-t border-amber-100">
                      <td className="pr-4 py-1 text-[var(--twilio-navy)]">{l.account_name}</td>
                      <td className="pr-4 py-1 text-[var(--twilio-navy)] max-w-xs truncate">{l.task}</td>
                      <td className="pr-4 py-1 font-mono text-[var(--twilio-navy)]">{fmtTime(l.seconds)}</td>
                      <td className="py-1 text-[var(--twilio-navy)]">{new Date(l.loggedAt).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Kanban layout: flex column with two rows */}
        <div className="flex-1 flex flex-col gap-3 px-1 pb-1">
        {/* Row 1: Unstaged | Stage Today | In Progress — horizontally scrollable when viewport is narrow */}
        <div className="flex gap-3 items-start overflow-x-auto pb-1" style={{ scrollbarWidth: "thin" }}>
        {/* Unstaged: width tracks blankCount so it never crushes the other columns */}
        <div ref={unstagedWrapRef} className="shrink-0" style={{ width: blankCount === 1 ? "340px" : "680px" }}>
          <DropZone
            zone="unstaged"
            label="Unstaged"
            description="Unassigned action items"
            items={filteredItemsInZone("unstaged")}
            accounts={accounts}
            teamMembers={teamMembers}
            dragOverZone={dragOverZone}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onSave={handleInlineSave}
            onSaveAndStage={handleSaveAndStage}
            onExpand={setEditItem}
            onDragStart={handleDragStart}
            onDelete={handleDeleteItem}
            onUpdated={handleItemUpdated}
          />
        </div>

        {/* Stage Today — min-width so it always has room; grows to fill remaining space */}
        <DropZone
          zone="today"
          label="Stage Today"
          description="Items you plan to work on today"
          items={filteredItemsInZone("today")}
          teamMembers={teamMembers}
          dragOverZone={dragOverZone}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onSave={handleInlineSave}
          onExpand={setEditItem}
          onDragStart={handleDragStart}
          onDelete={handleDeleteItem}
          onUpdated={handleItemUpdated}
          className="flex-1"
          style={{ minWidth: "300px", ...(row1Height ? { height: row1Height } : {}) }}
          focusMode={focusMode}
          reorderable
          collapsible
          dragId={dragId}
          dropHint={dropHint}
          onDropHint={handleDropHint}
        />

        {/* Currently Tracking — min-width so it always has room; grows to fill remaining space */}
        <DropZone
          zone="active"
          label="Currently Tracking"
          description="Drag here to start tracking time"
          items={filteredItemsInZone("active")}
          timers={timers}
          teamMembers={teamMembers}
          dragOverZone={dragOverZone}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onSave={handleInlineSave}
          onExpand={setEditItem}
          onDragStart={handleDragStart}
          onDelete={handleDeleteItem}
          onUpdated={handleItemUpdated}
          onTimerToggle={handleTimerToggle}
          onTimerEdit={handleTimerEdit}
          autoTrack={autoTrack}
          onAutoTrackToggle={() => setAutoTrack((v) => !v)}
          className="flex-1"
          style={{ minWidth: "300px", ...(row1Height ? { height: row1Height } : {}) }}
          focusMode={focusMode}
          reorderable
          collapsible
          dragId={dragId}
          dropHint={dropHint}
          onDropHint={handleDropHint}
        />
        </div>{/* end row 1 */}

        {/* Pinned In Progress — visible only in focus mode, and sits below the three
            staging columns. While focus mode is on a pinned card is rendered ONLY here
            (its zone panel shows nothing, the Views grid shows a ghost) so there is never
            a second KanbanCard holding a rival copy of the same unsaved form state.
            Cards stay draggable: dropping one on Stage Today or Currently Tracking moves
            its zone via the normal handleDrop path and keeps the pin. */}
        {focusMode && (
          <div className="shrink-0 bg-violet-50 rounded-lg border border-violet-200 px-4 py-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-semibold text-violet-800">Pinned In Progress</span>
              <span className="text-xs text-violet-600">{focusPinnedIds.size} pinned</span>
            </div>
            {focusPinnedIds.size === 0 ? (
              <p className="text-xs text-violet-500">Right-click any action item and choose “Pin to Focus” to track it here.</p>
            ) : (
              // A wrapping row of normal-width cards, not one full-width card per line.
              <div className="flex flex-row flex-wrap gap-3 items-start">
                {Array.from(focusPinnedIds).map((id) => {
                  const pinnedItem = allItems.find((i) => i.airtable_id === id);
                  if (!pinnedItem || pinnedItem.airtable_id.startsWith("local-")) return null;
                  const homeZone: Zone = zones[id] ?? (pinnedItem.account_name ? "accounts" : "today");
                  return (
                    // PINNED_CARD_WIDTH matches the Views grid, the app's standard card size.
                    <div key={id} className={`${PINNED_CARD_WIDTH} shrink-0 flex flex-col gap-1`}>
                      <span className="inline-flex items-center gap-1 self-start text-[10px] font-semibold uppercase tracking-wide text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded-full">
                        {ZONE_LABELS[homeZone] ?? homeZone}
                      </span>
                      {/* zone="accounts" selects the standard card body — task name, account
                          badge, status and priority pills — rather than the compact 2-row
                          grid, which is built to fill a full column. */}
                      <KanbanCard
                        item={pinnedItem}
                        zone="accounts"
                        onDragStart={(e) => handleDragStart(e, pinnedItem)}
                        onSave={(fields) => handleInlineSave(pinnedItem, fields)}
                        onExpandClick={() => setEditItem(pinnedItem)}
                        onDelete={() => handleDeleteItem(pinnedItem)}
                        onUpdated={handleItemUpdated}
                        teamMembers={teamMembers}
                        accounts={accounts}
                        collapsible
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Row 2: Views (full width) */}
        <div className="flex gap-3 items-start">
        <DropZone
          zone="accounts"
          label="Views"
          description="Drag a card here to file it under an account"
          items={filteredItemsInZone("accounts")}
          accounts={accounts}
          teamMembers={teamMembers}
          dragOverZone={dragOverZone}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onSave={handleInlineSave}
          onExpand={setEditItem}
          onDragStart={handleDragStart}
          onDelete={handleDeleteItem}
          onUpdated={handleItemUpdated}
          starredAccountKey={starredAccountKey}
          onStarAccount={setStarred}
          completedItems={allItems.filter((i) => i.status === "Done")}
          pinnedIds={pinnedIds}
          onPin={handlePin}
          myCollabId={myProfile?.airtable_collaborator_id ?? null}
          className="flex-1"
          pageView={pageView}
          onPageViewChange={(v) => { setPageView(v); localStorage.setItem("actionItemsView", v); }}
          search={search}
          onSearchChange={setSearch}
          allRealItems={allItems.filter((i) => !i.airtable_id.startsWith("local-"))}
          onSaveFieldsOnly={async (item, fields) => { await handleSaveItem(item.airtable_id, fields); }}
          itemZones={zones}
          focusMode={focusMode}
          onRestoreToViews={(item) => setZones((prev) => ({ ...prev, [item.airtable_id]: "accounts" }))}
          externalDragId={dragId}
          onAccountDrop={handleAccountGroupDrop}
          onExternalDropWithStatus={async (airtableId, status) => {
            const before = allItems.find((i) => i.airtable_id === airtableId);
            setZones((prev) => ({ ...prev, [airtableId]: "accounts" }));
            setAllItems((prev) => prev.map((i) => i.airtable_id === airtableId ? { ...i, status } : i));
            if (!airtableId.startsWith("local-")) {
              try {
                await airtableApi.updateActionItemStatus(airtableId, status);
                if (before) logActionItemUpdate(before, { status });
              } catch { /* best effort */ }
            }
          }}
        />
        </div>{/* end row 2 */}
        </div>{/* end kanban flex column */}
        </>);
        })(/* end view IIFE */)}
      </div>{/* end main content wrapper */}

      {/* Card edit modal */}
      {editItem && (
        <CardModal
          item={editItem}
          onClose={() => setEditItem(null)}
          onSave={(updated) => handleSaveItem(editItem.airtable_id, updated)}
          onDelete={() => handleDeleteItem(editItem)}
          onUpdated={handleItemUpdated}
          onConverted={() => { setAllItems((prev) => prev.filter((i) => i.airtable_id !== editItem.airtable_id)); setEditItem(null); }}
          teamMembers={teamMembers}
          allItems={allItems}
          accounts={accounts}
        />
      )}
    </div>
  );
}
