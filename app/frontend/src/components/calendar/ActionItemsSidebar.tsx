import { useState, useEffect, useRef } from "react";
import { useCurrentUser } from "../../context/CurrentUserContext";
import { useActionItemFieldOptions } from "../../hooks/useActionItemFieldOptions";
import { useScheduledOccurrences } from "../../hooks/useScheduledOccurrences";
import { airtableApi, teamApi } from "../../lib/api";
import { addLog } from "../../lib/appLog";
import { logActionItemUpdate } from "../../lib/actionItemLog";
import type { AirtableActionItem, AirtableAccount } from "../../types";
import type { TeamMember } from "../../types/team";
import { ContextMenu, FocusPinBadge, focusPinMenuItem, type ContextMenuItem } from "../action-items/ContextMenu";
import { ActionItemModal } from "../account/ActionItemModal";
import { useFocusPins } from "../../hooks/useFocusPins";
import { useActionItemZoneSets } from "../../hooks/useActionItemZoneSets";
import { groupActionItems, DONE_WINDOW_DAYS, isRecentlyDone, type SidebarGroupKey } from "../../lib/actionItemSidebarOrder";
import SidebarFilterFlags from "./SidebarFilterFlags";
import CommentPreviewList from "../comments/CommentPreviewList";
import { useCommentMenuItem } from "../comments/commentMenuItem";
import { useExportTray } from "../../hooks/useExportTray";
import {
  CALENDAR_DRAG_KEY,
  CALENDAR_DRAG_ACCOUNT_KEY,
  SCHEDULED_ITEMS_KEY,
  WORK_TRACKING_COLOR,
  PRIORITY_COLORS_CAL,
  STATUS_COLORS_CAL,
  BLANK_FORM,
  readScheduledItems,
  CalPillSelect,
  CalPillNumber,
  CalPillDate,
  CalPillUrl,
} from "./calendarHelpers";

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
function ActionItemCard_Cal({ item, onDragStart, onDelete, onReminderToggle, onUpdate, onOpenModal, onAccountDrop }: {
  item: AirtableActionItem;
  onDragStart: (e: React.DragEvent) => void;
  onDelete: () => void;
  onReminderToggle: () => void;
  onUpdate: (patch: Partial<AirtableActionItem>) => void;
  onOpenModal: (item: AirtableActionItem) => void;
  onAccountDrop: (accountId: number, accountName: string) => void;
}) {
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
      style={{
        position: "relative",
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
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ${PRIORITY_COLORS_CAL[item.priority] ?? "bg-gray-100 text-gray-600"}`}>{item.priority}</span>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ${STATUS_COLORS_CAL[item.status] ?? "bg-gray-100 text-gray-700"}`}>{item.status}</span>
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
        {item.task || <span className="italic opacity-40">Untitled</span>}
      </p>

      {/* Row 3: details + meta */}
      {(item.task_details || item.assignee_name || item.account_name || item.estimated_time) ? (
        <div className="flex flex-col gap-0.5">
          {item.task_details && (
            <p className="text-[11px] text-[var(--twilio-navy)] opacity-60 leading-snug" style={{ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>
              {item.task_details}
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

export default function ActionItemsSidebar({ expandItemId }: { onDropToast?: (msg: string, type: "success" | "warn") => void; expandItemId?: string | null }) {
  const currentUser = useCurrentUser();
  const { status: statusOptions } = useActionItemFieldOptions();
  const [items, setItems] = useState<AirtableActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  // `expandItemId` used to force a card into its inline expanded editor. Editing now happens
  // only in the shared ActionItemModal, so the same request opens that instead.
  const [modalItem, setModalItem] = useState<AirtableActionItem | null>(null);

  // When a new expandItemId is pushed in, adopt it
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

  const fetchItems = () =>
    airtableApi
      // Ask for exactly what the sidebar shows. The old filter listed Blocked/Backlogged
      // and then discarded them client-side, plus a "Complete" status that does not exist
      // in the model (Open / In Progress / Done / Blocked / Backlogged) and so matched
      // nothing. Done joined the list for the Done section — rendering is bounded to the
      // last DONE_WINDOW_DAYS, the fetch is not (the endpoint is unpaginated).
      // `fresh` because this also runs on an actionItemsUpdated broadcast, which
      // can originate in another tab and leave this tab's GET cache warm.
      .listActionItems({ status: "Open,In Progress,Done" }, { fresh: true })
      .then(({ data }) => {
        const all = data ?? [];
        // Computed before the keep-filter, so pruning below sees every live record.
        const liveIds = new Set(all.map((i: AirtableActionItem) => i.airtable_id));
        setItems(all.filter((i: AirtableActionItem) =>
          i.status === "Open" || i.status === "In Progress" || (i.status === "Done" && isRecentlyDone(i))
        ));
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
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    function onStorage(e: StorageEvent) {
      // Zone changes are handled by useActionItemZoneSets, which owns that key's listener.
      if (e.key !== "actionItemsUpdated") return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { void fetchItems(); }, 500);
    }
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
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

  const [filterTerm, setFilterTerm] = useState("");
  const textMatched = filterTerm.trim()
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

  // Text box and flag chips compose: a card must satisfy both.
  const groups = groupActionItems(textMatched, { trackingIds, stagedIds, pinnedIds, selectedFlags });
  const visibleCount = groups.reduce((n, g) => n + g.items.length, 0);
  const isNarrowed = !!filterTerm.trim() || selectedFlags.size > 0;

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
            accent={WORK_TRACKING_COLOR}
          />
        </div>
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
              <span>{group.key === "done" ? `${group.label} · last ${DONE_WINDOW_DAYS} days` : group.label}</span>
              <span className="opacity-60">{group.items.length}</span>
            </p>
            {group.items.map((item) => {
            const isStaged = stagedIds.has(item.airtable_id);
            return (
              <div key={item.airtable_id} className="relative">
                {isStaged && (
                  <span className="absolute -top-1 -right-1 z-10 text-[9px] font-bold bg-blue-500 text-white px-1.5 py-0.5 rounded-full">Staged</span>
                )}
                <ActionItemCard_Cal
                  item={item}
                  onDragStart={(e) => handleDragStart(e, item)}
                  onDelete={() => handleDelete(item)}
                  onUpdate={(patch) => void handleUpdate(item, patch)}
                  onOpenModal={(it) => setModalItem(it)}
                  onAccountDrop={(accountId, accountName) => {
                    setItems((prev) => prev.map((i) => i.airtable_id === item.airtable_id ? { ...i, account: accountId, account_name: accountName } : i));
                    airtableApi.updateActionItemFields(item.airtable_id, { account: accountId, account_name: accountName }).catch(() => {
                      setItems((prev) => prev.map((i) => i.airtable_id === item.airtable_id ? item : i));
                    });
                    window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated", newValue: "1" }));
                  }}
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
            })}
          </div>
          ))
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
                placeholder="Additional context or notes…"
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

      {/* The one place an action item's fields are edited. */}
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
