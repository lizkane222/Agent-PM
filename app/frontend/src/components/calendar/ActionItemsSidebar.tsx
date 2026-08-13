import { useState, useEffect, useRef } from "react";
import { useCurrentUser } from "../../context/CurrentUserContext";
import { useActionItemFieldOptions } from "../../hooks/useActionItemFieldOptions";
import { useScheduledOccurrences } from "../../hooks/useScheduledOccurrences";
import { airtableApi, teamApi } from "../../lib/api";
import { addLog } from "../../lib/appLog";
import type { AirtableActionItem, AirtableAccount } from "../../types";
import { ContextMenu, FocusPinBadge, type ContextMenuItem } from "../action-items/ContextMenu";
import { useCommentContext } from "../comments/CommentContext";
import { useExportTray } from "../../hooks/useExportTray";
import {
  CALENDAR_DRAG_KEY,
  CALENDAR_DRAG_ACCOUNT_KEY,
  ACTION_ITEM_ZONES_KEY,
  SCHEDULED_ITEMS_KEY,
  WORK_TRACKING_COLOR,
  PRIORITY_COLORS_CAL,
  STATUS_COLORS_CAL,
  CalCreateForm,
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

function ActionItemCard_Cal({ item, onDragStart, onDelete, onReminderToggle, onUpdate, onAccountDrop, accounts, teamMembers, forceExpand, isPinned, onTogglePin }: {
  item: AirtableActionItem;
  onDragStart: (e: React.DragEvent) => void;
  onDelete: () => void;
  onReminderToggle: () => void;
  onUpdate: (patch: Partial<AirtableActionItem>) => void;
  onAccountDrop: (accountId: number, accountName: string) => void;
  accounts: AirtableAccount[];
  teamMembers: { id: number; full_name: string }[];
  forceExpand?: boolean;
  isPinned?: boolean;
  onTogglePin?: () => void;
}) {
  const { status: statusOptions } = useActionItemFieldOptions();
  const [expanded, setExpanded] = useState(forceExpand ?? false);
  const [ctxPos, setCtxPos] = useState<{ x: number; y: number } | null>(null);
  const { openComments } = useCommentContext();
  const { addToTray } = useExportTray();

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

  const ctxItems: ContextMenuItem[] = [
    ...(onTogglePin ? [{
      label: isPinned ? "Unpin from Focus" : "Pin to Focus",
      icon: <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M9.828.722a.5.5 0 01.354.146l4.95 4.95a.5.5 0 010 .707c-.48.48-1.072.588-1.503.588-.177 0-.335-.018-.46-.039l-3.134 3.134a5.927 5.927 0 01.16 1.013c.046.702-.032 1.687-.72 2.375a.5.5 0 01-.707 0l-2.829-2.828-3.182 3.182c-.195.195-1.219.902-1.414.707-.195-.195.512-1.22.707-1.414l3.182-3.182-2.828-2.829a.5.5 0 010-.707c.688-.688 1.673-.767 2.375-.72a5.922 5.922 0 011.013.16l3.134-3.133a2.772 2.772 0 01-.04-.461c0-.43.108-1.022.589-1.503a.5.5 0 01.353-.146z"/></svg>,
      onClick: onTogglePin,
    } as ContextMenuItem] : []),
    ...(onTogglePin ? [{ separator: true, label: "", onClick: () => {} } as ContextMenuItem] : []),
    {
      label: "Expand",
      icon: <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M9 2H12v3"/><path d="M7 7l5-5"/><path d="M12 9v3H2V2h4"/></svg>,
      onClick: () => setExpanded(true),
    },
    {
      label: editForm.status === "Done" ? "Reopen" : "Mark as Done",
      icon: editForm.status === "Done"
        ? <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><circle cx="7" cy="7" r="6"/><path d="M4.5 7.5 6 9l3.5-4"/></svg>
        : <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M2 7l3.5 3.5L12 3.5"/></svg>,
      onClick: () => onUpdate({ status: editForm.status === "Done" ? "Open" : "Done" }),
    },
    {
      label: "Copy task name",
      icon: <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><rect x="5" y="4" width="8" height="9" rx="1"/><path d="M9 4V2H1v9h3"/></svg>,
      onClick: () => { void navigator.clipboard.writeText(item.task || "").catch(() => {}); },
    },
    {
      label: "Add comment",
      icon: <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M12 2H2v8h3l2 2 2-2h3V2z"/></svg>,
      onClick: () => {
        if (item.id && ctxPos) openComments({ resourceType: "action_item", resourceId: item.id, resourceLabel: item.task || "", x: ctxPos.x, y: ctxPos.y });
      },
    },
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
      onClick={() => setExpanded(true)}
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
      {isPinned && <FocusPinBadge className="bottom-1.5 right-1.5 z-10" />}
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
  const [focusPinnedIds, setFocusPinnedIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("actionFocusPins") ?? "[]")); } catch { return new Set(); }
  });
  function toggleFocusPin(airtableId: string) {
    setFocusPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(airtableId)) { next.delete(airtableId); } else { next.add(airtableId); }
      localStorage.setItem("actionFocusPins", JSON.stringify([...next]));
      return next;
    });
  }

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
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    function onStorage(e: StorageEvent) {
      if (e.key === "actionItemsUpdated") {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => { void fetchItems(); }, 500);
        return;
      }
      if (e.key !== ACTION_ITEM_ZONES_KEY) return;
      try {
        const zones: Record<string, string> = JSON.parse(e.newValue ?? "{}");
        setStagedIds(new Set(Object.entries(zones).filter(([, v]) => v === "today").map(([k]) => k)));
      } catch { /* ignore */ }
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
                  isPinned={focusPinnedIds.has(item.airtable_id)}
                  onTogglePin={() => toggleFocusPin(item.airtable_id)}
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
