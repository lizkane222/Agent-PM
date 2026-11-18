import { useState, useEffect, useMemo, useRef } from "react";
import { useStatusLabels } from "../../hooks/useStatusLabels";
import { useCurrentUser } from "../../context/CurrentUserContext";
import { useActionItemFieldOptions } from "../../hooks/useActionItemFieldOptions";
import { useScheduledOccurrences } from "../../hooks/useScheduledOccurrences";
import { useActionItemList } from "../../hooks/useActionItemList";
import { airtableApi, schedulerApi, teamApi } from "../../lib/api";
import { addLog } from "../../lib/appLog";
import { logActionItemUpdate } from "../../lib/actionItemLog";
import { htmlToPreviewText } from "../../lib/noteHelpers";
import { DEFAULT_CATEGORY_COLORS, darken, readableTextColor, tint, type ColorableEventType } from "../../lib/eventColors";
import type { AirtableActionItem, AirtableAccount } from "../../types";
import type { TeamMember } from "../../types/team";
import { ContextMenu, FocusPinBadge, focusPinMenuItem, type ContextMenuItem } from "../action-items/ContextMenu";
import { ActionItemModal } from "../account/ActionItemModal";
import { useFocusPins } from "../../hooks/useFocusPins";
import { useActionItemZoneSets } from "../../hooks/useActionItemZoneSets";
import { SIDEBAR_SECTION_STATUS, groupActionItems, sidebarGroupLabel, DONE_WINDOW_DAYS, isRecentlyDone, type SidebarGroupKey } from "../../lib/actionItemSidebarOrder";
import { useColumnSort } from "../../hooks/useStatusArrivalOrder";
import ColumnSortButton from "../account/ColumnSortButton";
import SidebarFilterFlags from "./SidebarFilterFlags";
import RichTextMentionEditor from "../shared/RichTextMentionEditor";
import CommentPreviewList from "../comments/CommentPreviewList";
import { useCommentMenuItem } from "../comments/commentMenuItem";
import { useExportTray } from "../../hooks/useExportTray";
import {
  CALENDAR_DRAG_KEY,
  CALENDAR_DRAG_ACCOUNT_KEY,
  SCHEDULED_ITEMS_KEY,
  PRIORITY_COLORS_CAL,
  STATUS_COLORS_CAL,
  BLANK_FORM,
  readScheduledItems,
  CalPillSelect,
  CalPillNumber,
  CalPillDate,
  CalPillUrl,
} from "./calendarHelpers";
import { instantDayKey, localDateKey } from "../../lib/timelineDay";
import { fromLocalDatetimeValue } from "../../lib/datetimeLocal";
import SensitiveText from "../../components/shared/SensitiveText";
import { actionItemMarkId } from "../../hooks/useSensitiveMarks";

/** How much white is mixed into an accent to get a card surface behind text. */
const SURFACE_TINT = 0.9;

/** The subset of useCalendarColors this sidebar needs. */
export type ColorResolver = {
  colorFor: (type: ColorableEventType) => string;
};

const DEFAULT_COLORS: ColorResolver = { colorFor: (t) => DEFAULT_CATEGORY_COLORS[t] };

/** The statuses the sidebar shows. Done is fetched for the Done section and bounded on render. */
const SIDEBAR_STATUS_PARAMS = { status: "Open,In Progress,Done" };

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

/**
 * A card in the calendar's action-items sidebar.
 *
 * **Collapsed is the only view.** Editing any field opens the shared `ActionItemModal`, so the
 * sidebar and the modal cannot disagree about what a field means or how it is saved. The card
 * used to carry its own inline expanded editor with a click-outside commit — a second,
 * diverging copy of the modal's form.
 *
 * `onUpdate` survives for the one-click "Mark as Done" / "Reopen" context-menu entry, which is a
 * single known field rather than field editing.
 */
function ActionItemCard_Cal({ item, onDragStart, onDelete, onReminderToggle, onUpdate, onOpenModal, onAccountDrop, accent }: {
  item: AirtableActionItem;
  onDragStart: (e: React.DragEvent) => void;
  onDelete: () => void;
  onReminderToggle: () => void;
  onUpdate: (patch: Partial<AirtableActionItem>) => void;
  onOpenModal: (item: AirtableActionItem) => void;
  onAccountDrop: (accountId: number, accountName: string) => void;
  /** The user's action-item color — the same one the grid paints scheduled items with. */
  accent: string;
}) {
  const { label: statusLabel } = useStatusLabels();
  const [ctxPos, setCtxPos] = useState<{ x: number; y: number } | null>(null);
  const { addToTray } = useExportTray();
  const { isPinned, toggle: toggleFocusPin } = useFocusPins();

  // Never pin a local-* blank — promoteBlankItem discards that id for a real recXXX.
  const canPin = !item.airtable_id.startsWith("local-");
  const isPinnedToFocus = canPin && isPinned(item.airtable_id);
  const commentMenuEntry = useCommentMenuItem("action_item", canPin ? item.id : null, item.task || "", ctxPos);

  const cardRef = useRef<HTMLDivElement>(null);
  const hasReminder = !!item.reminder_due_at;
  const [isAccountDropTarget, setIsAccountDropTarget] = useState(false);

  const ctxItems: ContextMenuItem[] = [
    ...(canPin ? [
      focusPinMenuItem(isPinnedToFocus, () => toggleFocusPin(item.airtable_id)),
      { separator: true, label: "", onClick: () => {} } as ContextMenuItem,
    ] : []),
    {
      label: "Edit details",
      icon: <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M9 2H12v3"/><path d="M7 7l5-5"/><path d="M12 9v3H2V2h4"/></svg>,
      onClick: () => onOpenModal(item),
    },
    {
      label: item.status === "Done" ? "Reopen" : "Mark as Done",
      icon: item.status === "Done"
        ? <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><circle cx="7" cy="7" r="6"/><path d="M4.5 7.5 6 9l3.5-4"/></svg>
        : <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M2 7l3.5 3.5L12 3.5"/></svg>,
      onClick: () => onUpdate({ status: item.status === "Done" ? "Open" : "Done" }),
    },
    {
      label: "Copy task name",
      icon: <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><rect x="5" y="4" width="8" height="9" rx="1"/><path d="M9 4V2H1v9h3"/></svg>,
      onClick: () => { void navigator.clipboard.writeText(item.task || "").catch(() => {}); },
    },
    commentMenuEntry,
    { label: "→ Export tray", icon: <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M1 9v4h12V9"/><path d="M4.5 5.5 7 3l2.5 2.5"/><path d="M7 3v7"/></svg>, onClick: () => addToTray(item) },
    { separator: true, label: "", onClick: () => {} },
    {
      label: "Delete",
      danger: true,
      icon: <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M2 4h10M5 4V2h4v2M6 7v3M8 7v3M3 4l1 8h6l1-8"/></svg>,
      onClick: onDelete,
    },
  ];

  // ── Collapsed view ────────────────────────────────────────────────────────────
  return (
    <>
    <div
      ref={cardRef}
      draggable
      onDragStart={onDragStart}
      onClick={() => onOpenModal(item)}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxPos({ x: e.clientX, y: e.clientY }); }}
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
      data-accent={accent}
      style={{
        position: "relative",
        background: tint(accent, SURFACE_TINT),
        borderLeft: `3px solid ${accent}`,
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
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ${PRIORITY_COLORS_CAL[item.priority] ?? "bg-gray-100 text-gray-600"}`}>{item.priority}</span>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ${STATUS_COLORS_CAL[item.status] ?? "bg-gray-100 text-gray-700"}`}>{statusLabel(item.status)}</span>
        {item.due_date && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap bg-amber-50 text-amber-700">
            {new Date(item.due_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onReminderToggle(); }}
            title={hasReminder ? `Reminder: ${new Date(item.reminder_due_at!).toLocaleString()}` : "Set reminder"}
            className="rounded p-0.5 hover:bg-gray-200 transition-colors"
            style={{ color: hasReminder ? "#f59e0b" : "var(--text-gray-400)" }}
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
        {item.task ? <SensitiveText resourceType="action_item" resourceId={actionItemMarkId(item)} field="task" text={item.task} /> : <span className="italic opacity-40">Untitled</span>}
      </p>

      {/* Row 3: details + meta */}
      {(item.task_details || item.assignee_name || item.account_name || item.estimated_time) ? (
        <div className="flex flex-col gap-0.5">
          {item.task_details && (
            <p className="text-[11px] text-[var(--twilio-navy)] opacity-60 leading-snug" style={{ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>
              {htmlToPreviewText(item.task_details)}
            </p>
          )}
          <div className="flex gap-2 flex-wrap">
            {item.account_name && <span className="text-[10px] text-[var(--twilio-gray-60)]">{item.account_name}</span>}
            {item.assignee_name && <span className="text-[10px] text-[var(--twilio-gray-60)]">{item.assignee_name}</span>}
            {item.estimated_time ? <span className="text-[10px] text-[var(--twilio-gray-60)]">{item.estimated_time}m est.</span> : null}
          </div>
        </div>
      ) : null}

      <OccurrencesList airtableId={item.airtable_id} />
      <CommentPreviewList
        resourceType="action_item"
        resourceId={canPin ? item.id : null}
        resourceLabel={item.task || ""}
      />
      {isPinnedToFocus && <FocusPinBadge />}
    </div>
    {ctxPos && (
      <ContextMenu
        x={ctxPos.x}
        y={ctxPos.y}
        items={ctxItems}
        onClose={() => setCtxPos(null)}
      />
    )}
    </>
  );
}

export default function ActionItemsSidebar({ expandItemId, colors = DEFAULT_COLORS, accountFilter = null }: {
  onDropToast?: (msg: string, type: "success" | "warn") => void;
  expandItemId?: string | null;
  /** Colors the grid paints with, so a card and the block it becomes always match. */
  colors?: ColorResolver;
  /** Account selected in the open Accounts sidebar — narrows the list to its items. */
  accountFilter?: string | null;
}) {
  const accent = colors.colorFor("action_item");
  const reminderAccent = colors.colorFor("reminder");
  const currentUser = useCurrentUser();
  const { status: statusOptions } = useActionItemFieldOptions();
  const { label: statusLabel } = useStatusLabels();

  // Server data comes from the hook. Exactly what the sidebar shows is asked for (no Blocked /
  // Backlogged discarded client-side, no "Complete" status that is not in the model); Done joins for
  // the Done section — rendering is bounded to DONE_WINDOW_DAYS, the fetch is not (unpaginated).
  // The hook reloads silently on an `actionItemsUpdated` broadcast, so the list never blanks itself.
  const { items: fetched, loading, updateFields, remove: removeItem, create: createItem } =
    useActionItemList(SIDEBAR_STATUS_PARAMS);
  const visible = useMemo(
    () => fetched.filter((i) => i.status === "Open" || i.status === "In Progress" || (i.status === "Done" && isRecentlyDone(i))),
    [fetched],
  );

  // Optimistic edits (remove on delete, patch on drop, prepend on create) live here, on top of the
  // hook's data. They are tied to the `visible` array they were made against, so the moment fresh
  // server data arrives they fall away and the server's answer wins.
  const [local, setLocal] = useState<{ base: AirtableActionItem[]; items: AirtableActionItem[] } | null>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const items = local && local.base === visible ? local.items : visible;
  function setItems(update: (prev: AirtableActionItem[]) => AirtableActionItem[]) {
    setLocal((cur) => {
      const base = visibleRef.current;
      const prev = cur && cur.base === base ? cur.items : base;
      return { base, items: update(prev) };
    });
  }

  const [modalItem, setModalItem] = useState<AirtableActionItem | null>(null);

  // A pushed-in expandItemId opens the shared modal for that item, once it has loaded.
  useEffect(() => {
    if (!expandItemId) return;
    const match = items.find((i) => i.airtable_id === expandItemId);
    if (match) setModalItem(match);
  }, [expandItemId, items]);
  // Where each card sits — the first three sections are positional state, not status.
  const { trackingIds, stagedIds } = useActionItemZoneSets();
  const { pinnedIds } = useFocusPins();
  const [selectedFlags, setSelectedFlags] = useState<Set<SidebarGroupKey>>(() => new Set());

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
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  useEffect(() => {
    airtableApi.listAccounts({ page_size: "500" }).then(({ data }) => setAccounts(data.results)).catch(() => {});
    teamApi.listMembers().then(({ data }) => setTeamMembers(data.results)).catch(() => {});
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
        backgroundColor: accent,
        borderColor: accent,
        extendedProps: { airtableId: item.airtable_id, accountName: item.account_name ?? "" },
      })
    );
  }

  async function handleDelete(item: AirtableActionItem) {
    setItems((prev) => prev.filter((i) => i.airtable_id !== item.airtable_id));
    // Remove any legacy localStorage occurrences for this item.
    const pruned = readScheduledItems().filter((s) => s.airtableId !== item.airtable_id);
    localStorage.setItem(SCHEDULED_ITEMS_KEY, JSON.stringify(pruned));
    window.dispatchEvent(new StorageEvent("storage", { key: SCHEDULED_ITEMS_KEY, newValue: JSON.stringify(pruned) }));
    try {
      await removeItem(item.airtable_id);
      // Also delete the calendar rows for it. `agentpm_airtable_id` is a CharField, not a
      // foreign key, so nothing cascades server-side — without this, deleting an action item
      // leaves its scheduled blocks on the calendar pointing at a record that is gone.
      //
      // Deliberately only on an explicit delete: a *status* change (including Done) must never
      // remove the record of when the work was scheduled. Conflating the two is what erased
      // blocks before.
      try {
        const { data: rows } = await schedulerApi.listEvents({ agentpm_airtable_id: item.airtable_id });
        await Promise.all(
          rows
            .filter((e) => e.calendar_id === "work_tracking")
            .map((e) => schedulerApi.deleteEvent(e.id).catch(() => {})),
        );
      } catch { /* best effort — the action item is already gone */ }
      window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated", newValue: "1" }));
      window.dispatchEvent(new StorageEvent("storage", { key: "calendarUpdated", newValue: "1" }));
    } catch {
      setItems((prev) => [...prev, item]);
    }
  }

  async function handleSetReminder(item: AirtableActionItem) {
    if (!reminderDate) return;
    setReminderSaving(true);
    try {
      const due_at = fromLocalDatetimeValue(`${reminderDate}T${reminderTime}`);
      const { data } = await airtableApi.setActionItemReminder(item.id, { due_at });
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

  /** One-click "Mark as Done" / "Reopen" from the card's context menu. */
  async function handleUpdate(item: AirtableActionItem, patch: Partial<AirtableActionItem>) {
    // Optimistic update
    setItems((prev) => prev.map((i) => i.airtable_id === item.airtable_id ? { ...i, ...patch } : i));
    try {
      await updateFields(item.airtable_id, patch);
      logActionItemUpdate(item, patch);
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
      const data = await createItem({
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

  const [filterTerm, setFilterTerm] = useState("");
  // Same case-insensitive match the backend's ?account_name= uses ("Admin" vs "ADMIN").
  const accountKey = accountFilter?.trim().toLowerCase() || null;
  const accountScoped = accountKey
    ? items.filter((i) => (i.account_name ?? "").trim().toLowerCase() === accountKey)
    : items;
  const textMatched = filterTerm.trim()
    ? accountScoped.filter((i) => {
        const q = filterTerm.toLowerCase();
        return (
          i.task?.toLowerCase().includes(q) ||
          i.task_details?.toLowerCase().includes(q) ||
          i.account_name?.toLowerCase().includes(q) ||
          i.assignee_name?.toLowerCase().includes(q)
        );
      })
    : accountScoped;

  // Text box and flag chips compose: a card must satisfy both.
  const { prefs: statusPrefs } = useStatusLabels();
  const { sortDirection: colSortDirection, toggleSort: toggleColSort, applySort: applyColSort } = useColumnSort();
  const groups = groupActionItems(textMatched, { trackingIds, stagedIds, pinnedIds, selectedFlags });
  const visibleCount = groups.reduce((n, g) => n + g.items.length, 0);
  const isNarrowed = !!filterTerm.trim() || selectedFlags.size > 0 || !!accountKey;

  function toggleFlag(key: SidebarGroupKey) {
    setSelectedFlags((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

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
        <div className="pt-1.5">
          <SidebarFilterFlags
            selected={selectedFlags}
            onToggle={toggleFlag}
            onClear={() => setSelectedFlags(new Set())}
            accent={accent}
          />
        </div>
        {accountKey && (
          <p data-testid="sidebar-account-filter" className="pt-1.5 text-[11px] text-[var(--twilio-gray-60)] truncate">
            Showing <span className="font-semibold text-[var(--twilio-navy)]">{accountFilter}</span> only
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {loading ? (
          <p className="text-sm text-[var(--twilio-gray-60)] py-2">Loading…</p>
        ) : visibleCount === 0 && !creating ? (
          <p className="text-sm text-[var(--twilio-gray-60)] py-2">
            {isNarrowed ? "No matches." : "No open action items."}
          </p>
        ) : (
          groups.map((group) => (
          <div key={group.key} className="space-y-2">
            {/* Section header — the same micro-header vocabulary the card's "On calendar"
                label uses, so it reads as part of the sidebar rather than a new surface. */}
            <p data-section={group.key} className="text-[9px] font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)] flex items-center gap-1">
              <span>{group.key === "done" ? `${sidebarGroupLabel(group.key, group.label, statusPrefs)} · last ${DONE_WINDOW_DAYS} days` : sidebarGroupLabel(group.key, group.label, statusPrefs)}</span>
              <span className="opacity-60">{group.items.length}</span>
              {SIDEBAR_SECTION_STATUS[group.key] && (
                <ColumnSortButton status={SIDEBAR_SECTION_STATUS[group.key]!} direction={colSortDirection(SIDEBAR_SECTION_STATUS[group.key]!)} onToggle={toggleColSort} className="ml-auto" />
              )}
            </p>
            {(SIDEBAR_SECTION_STATUS[group.key] ? applyColSort(group.items, SIDEBAR_SECTION_STATUS[group.key]!) : group.items).map((item) => {
            const isStaged = stagedIds.has(item.airtable_id);
            return (
              <div key={item.airtable_id} className="relative">
                {isStaged && (
                  <span className="absolute -top-1 -right-1 z-10 text-[9px] font-bold bg-blue-500 text-white px-1.5 py-0.5 rounded-full">Staged</span>
                )}
                <ActionItemCard_Cal
                  item={item}
                  accent={accent}
                  onDragStart={(e) => handleDragStart(e, item)}
                  onDelete={() => handleDelete(item)}
                  onUpdate={(patch) => void handleUpdate(item, patch)}
                  onOpenModal={(item) => setModalItem(item)}
                  onAccountDrop={(accountId, accountName) => {
                    setItems((prev) => prev.map((i) => i.airtable_id === item.airtable_id ? { ...i, account: accountId, account_name: accountName } : i));
                    updateFields(item.airtable_id, { account: accountId, account_name: accountName }).catch(() => {
                      setItems((prev) => prev.map((i) => i.airtable_id === item.airtable_id ? item : i));
                    });
                    window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated", newValue: "1" }));
                  }}
                  onReminderToggle={() => {
                    if (reminderItemId === item.airtable_id) {
                      setReminderItemId(null);
                    } else {
                      setReminderItemId(item.airtable_id);
                      setReminderDate(item.reminder_due_at ? instantDayKey(item.reminder_due_at) : localDateKey(new Date()));
                      setReminderTime(item.reminder_due_at ? item.reminder_due_at.slice(11, 16) : "09:00");
                    }
                  }}
                />
                {/* Reminder popover */}
                {reminderItemId === item.airtable_id && (
                  <div
                    className="mt-1 rounded-lg p-2.5 flex flex-col gap-2"
                    style={{ background: tint(reminderAccent, SURFACE_TINT), border: `1px solid ${tint(reminderAccent, 0.55)}` }}
                  >
                    <p className="text-[11px] font-semibold" style={{ color: darken(reminderAccent, 0.45) }}>{item.reminder_due_at ? "Edit Reminder" : "Set Reminder"}</p>
                    <div className="flex gap-1.5">
                      <input type="date" value={reminderDate} onChange={(e) => setReminderDate(e.target.value)}
                        className="flex-1 text-[11px] rounded px-1.5 py-1 focus:outline-none"
                        style={{ background: "var(--surface-card)", border: `1px solid ${tint(reminderAccent, 0.55)}` }}
                      />
                      <input type="time" value={reminderTime} onChange={(e) => setReminderTime(e.target.value)}
                        className="w-20 text-[11px] rounded px-1.5 py-1 focus:outline-none"
                        style={{ background: "var(--surface-card)", border: `1px solid ${tint(reminderAccent, 0.55)}` }}
                      />
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => void handleSetReminder(item)}
                        disabled={reminderSaving || !reminderDate}
                        className="flex-1 text-[11px] font-semibold py-1 rounded-md transition-colors disabled:opacity-40"
                        style={{ background: reminderAccent, color: readableTextColor(reminderAccent) }}
                      >{reminderSaving ? "…" : "Set"}</button>
                      <button
                        onClick={() => void handleClearReminder(item)}
                        className="text-[11px] font-semibold px-2 py-1 rounded-md transition-colors disabled:opacity-30"
                        style={{ border: `1px solid ${tint(reminderAccent, 0.55)}`, color: darken(reminderAccent, 0.35) }}
                        disabled={!item.reminder_due_at}
                      >Clear</button>
                      <button onClick={() => setReminderItemId(null)} className="text-[11px] px-2 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors">✕</button>
                    </div>
                  </div>
                )}
              </div>
            );
            })}
          </div>
          ))
        )}
      </div>

      {/* Create card — pinned at bottom */}
      {creating && (
        <div className="shrink-0 border-t border-gray-100">
          <div className="rounded-xl flex flex-col overflow-hidden m-3" style={{ background: tint(accent, SURFACE_TINT), border: `1px solid ${tint(accent, 0.55)}` }}>
            {/* Task title */}
            <div className="px-4 pt-3 pb-2">
              <input
                autoFocus
                value={form.task}
                onChange={(e) => setForm((f) => ({ ...f, task: e.target.value }))}
                placeholder="Name or short description"
                className="w-full text-xs font-semibold text-[var(--twilio-navy)] bg-transparent border-b focus:outline-none pb-1 placeholder:text-[var(--twilio-gray-60)] placeholder:font-normal"
                style={{ borderBottomColor: tint(accent, 0.45) }}
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
                format={statusLabel}
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
              <RichTextMentionEditor
                value={form.task_details}
                onChange={(html) => setForm((f) => ({ ...f, task_details: html }))}
                placeholder="Additional context or notes…"
                minHeightClassName="min-h-[40px]"
              />

              {/* Status · Priority · Due date */}
              <div className="flex flex-wrap gap-1.5 items-center">
                <CalPillSelect
                  value={form.status}
                  options={statusOptions as AirtableActionItem["status"][]}
                  format={statusLabel}
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
                className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide rounded-md disabled:opacity-40 transition-colors"
                style={{ background: accent, color: readableTextColor(accent) }}
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
            className="w-full text-[11px] font-semibold py-1.5 rounded-lg transition-colors"
            style={{ background: accent, color: readableTextColor(accent) }}
          >+ New Action Item</button>
        </div>
      )}

      {modalItem && (
        <ActionItemModal
          item={modalItem}
          accountId={accounts.find((a) => a.name === modalItem.account_name)?.id}
          teamMembers={teamMembers}
          onClose={() => setModalItem(null)}
          onUpdated={(updated: AirtableActionItem) => {
            setItems((prev) => prev.map((i) => i.airtable_id === updated.airtable_id ? updated : i));
            window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated", newValue: "1" }));
            setModalItem(null);
          }}
          onAutosaved={(updated: AirtableActionItem) => {
            setItems((prev) => prev.map((i) => i.airtable_id === updated.airtable_id ? updated : i));
          }}
          onConverted={() => {
            setItems((prev) => prev.map((i) => i.airtable_id === modalItem.airtable_id ? { ...i, status: "Done" } as AirtableActionItem : i));
            window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated", newValue: "1" }));
            setModalItem(null);
          }}
          onDeleted={(id: number) => {
            setItems((prev) => prev.filter((i) => i.id !== id));
            window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated", newValue: "1" }));
            setModalItem(null);
          }}
        />
      )}
    </div>
  );
}
