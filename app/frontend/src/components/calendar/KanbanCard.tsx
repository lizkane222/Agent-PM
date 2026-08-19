import { useState } from "react";
import type { AirtableActionItem } from "../../types";
import { airtableApi } from "../../lib/api";
import { logActionItemUpdate } from "../../lib/actionItemLog";
import CorporateIcon from "../../assets/icons/Corporate.svg?react";
import { useActionItemFieldOptions } from "../../hooks/useActionItemFieldOptions";
import { useExportTray } from "../../hooks/useExportTray";
import { ContextMenu, FocusPinBadge, focusPinMenuItem, type ContextMenuItem } from "../action-items/ContextMenu";
import CommentPreviewList from "../comments/CommentPreviewList";
import { useCommentMenuItem } from "../comments/commentMenuItem";
import { useFocusPins } from "../../hooks/useFocusPins";
import { sanitizeHtml, plainToHtml } from "../../lib/noteHelpers";

interface Props {
  item: AirtableActionItem;
  onStatusChange: (id: string, newStatus: AirtableActionItem["status"]) => void;
  onDoubleClick?: (item: AirtableActionItem) => void;
}

const PRIORITY_COLORS: Record<string, string> = {
  Critical: "bg-red-100 text-red-700",
  High: "bg-orange-100 text-orange-700",
  Medium: "bg-yellow-100 text-yellow-700",
  Low: "bg-gray-100 text-[var(--twilio-gray-80)]",
};

function formatDuration(seconds: number): string {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function KanbanCard({ item, onStatusChange, onDoubleClick }: Props) {
  const { status: statusOptions } = useActionItemFieldOptions();
  const { addToTray } = useExportTray();
  const { isPinned, toggle: toggleFocusPin } = useFocusPins();
  const [expanded, setExpanded] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [ctxPos, setCtxPos] = useState<{ x: number; y: number } | null>(null);

  // Never pin a local-* blank — promoteBlankItem discards that id for a real recXXX.
  const canPin = !item.airtable_id.startsWith("local-");
  const isPinnedToFocus = canPin && isPinned(item.airtable_id);
  const commentMenuEntry = useCommentMenuItem("action_item", canPin ? item.id : null, item.task || "", ctxPos);

  const ctxItems: ContextMenuItem[] = [
    ...(canPin ? [
      focusPinMenuItem(isPinnedToFocus, () => toggleFocusPin(item.airtable_id)),
      { separator: true, label: "", onClick: () => {} } as ContextMenuItem,
    ] : []),
    { label: "Open details", onClick: () => { setExpanded(true); onDoubleClick?.(item); } },
    { label: "Mark as Done", onClick: () => void handleStatusChange("Done") },
    { label: "Copy task name", onClick: () => { void navigator.clipboard.writeText(item.task || "").catch(() => {}); } },
    commentMenuEntry,
    { separator: true, label: "", onClick: () => {} },
    { label: "→ Export tray", icon: <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M1 9v4h12V9"/><path d="M4.5 5.5 7 3l2.5 2.5"/><path d="M7 3v7"/></svg>, onClick: () => addToTray(item) },
  ];

  async function handleStatusChange(newStatus: AirtableActionItem["status"]) {
    setUpdating(true);
    try {
      await airtableApi.updateActionItemStatus(item.airtable_id, newStatus);
      logActionItemUpdate(item, { status: newStatus });
      onStatusChange(item.airtable_id, newStatus);
    } finally {
      setUpdating(false);
    }
  }

  return (
    <>
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("kanbanCardId", item.airtable_id);
        e.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      className={["relative bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden cursor-grab active:cursor-grabbing select-none transition-opacity", dragging ? "opacity-40" : ""].join(" ")}
      onClick={() => setExpanded((v) => !v)}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(item); }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxPos({ x: e.clientX, y: e.clientY }); }}
    >
      {isPinnedToFocus && <FocusPinBadge />}
      {/* Collapsed header */}
      <div className="flex items-start gap-2 px-3 py-2.5">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--twilio-navy)] leading-tight">{item.task}</p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className={`text-sm font-medium px-1.5 py-0.5 rounded-full ${PRIORITY_COLORS[item.priority] ?? "bg-gray-100 text-[var(--twilio-gray-80)]"}`}>
              {item.priority}
            </span>
            {item.due_date && (
              <span className="text-sm text-[var(--twilio-gray-60)]">
                Due {new Date(item.due_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </span>
            )}
            {item.account_name && (
              <span className="inline-flex items-center gap-1 text-[11px] text-[var(--twilio-gray-60)] font-medium truncate">
                <CorporateIcon width={10} height={10} className="shrink-0 opacity-60" />
                {item.account_name}
              </span>
            )}
            {(item.attachments?.length ?? 0) > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-[var(--twilio-gray-60)]">
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-2.5 h-2.5 shrink-0">
                  <path d="M4.5 3a2.5 2.5 0 015 0v9a1.5 1.5 0 01-3 0V5a.5.5 0 011 0v7a.5.5 0 001 0V3a1.5 1.5 0 00-3 0v9a2.5 2.5 0 005 0V5a.5.5 0 011 0v7a3.5 3.5 0 11-7 0V3z"/>
                </svg>
                {item.attachments!.length}
              </span>
            )}
          </div>
        </div>
        <span className="text-[var(--twilio-gray-40)] text-sm mt-0.5">{expanded ? "▲" : "▼"}</span>
      </div>

      <CommentPreviewList
        resourceType="action_item"
        resourceId={canPin ? item.id : null}
        resourceLabel={item.task || ""}
        className="px-3 pb-2"
      />

      {/* Expanded details */}
      {expanded && (
        <div
          className="border-t border-gray-100 px-3 py-2.5 space-y-2 text-sm text-[var(--twilio-gray-80)]"
          onClick={(e) => e.stopPropagation()}
        >
          {item.task_details && (
            <div
              className="text-[13px] text-[var(--twilio-navy)] opacity-70 leading-relaxed prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(plainToHtml(item.task_details)) }}
            />
          )}
          {item.account_name && (
            <div className="flex justify-between">
              <span className="text-[var(--twilio-gray-60)]">Account</span>
              <span className="inline-flex items-center gap-1 font-medium">
                <CorporateIcon width={10} height={10} className="shrink-0 opacity-60" />
                {item.account_name}
              </span>
            </div>
          )}
          {item.assignee_name && (
            <div className="flex justify-between">
              <span className="text-[var(--twilio-gray-60)]">Assignee</span>
              <span>{item.assignee_name}</span>
            </div>
          )}
          {item.estimated_time > 0 && (
            <div className="flex justify-between">
              <span className="text-[var(--twilio-gray-60)]">Estimated</span>
              <span>{formatDuration(item.estimated_time)}</span>
            </div>
          )}
          {item.time_spent > 0 && (
            <div className="flex justify-between">
              <span className="text-[var(--twilio-gray-60)]">Time spent</span>
              <span>{formatDuration(item.time_spent)}</span>
            </div>
          )}
          {item.slack_thread_url && (
            <a
              href={item.slack_thread_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-indigo-600 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              Slack thread →
            </a>
          )}
          {(item.attachments?.length ?? 0) > 0 && (
            <div>
              <p className="text-[var(--twilio-gray-60)] mb-1">Attachments ({item.attachments!.length})</p>
              <div className="flex flex-col gap-1">
                {item.attachments!.map((a) => {
                  const href = a.file_url ?? a.url ?? "";
                  return (
                    <div key={a.id} className="flex items-center gap-1.5 text-[11px] bg-gray-50 rounded px-2 py-1">
                      <span className="shrink-0">📎</span>
                      {href ? (
                        <a href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="flex-1 truncate text-indigo-600 hover:underline">{a.name || href}</a>
                      ) : (
                        <span className="flex-1 truncate">{a.name}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="flex gap-1.5 pt-1 flex-wrap">
            {(statusOptions as AirtableActionItem["status"][]).map((s) => (
              <button
                key={s}
                disabled={updating || item.status === s}
                onClick={() => void handleStatusChange(s)}
                className="px-2 py-0.5 rounded-full border text-sm font-medium transition-colors disabled:opacity-40"
                style={{
                  background: item.status === s ? "#0263E0" : "transparent",
                  borderColor: item.status === s ? "#0263E0" : "#d1d5db",
                  color: item.status === s ? "#fff" : "#6b7280",
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
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
