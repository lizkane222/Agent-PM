import React, { useState } from "react";
import type { AirtableActionItem, AirtableMeeting, TeamMember } from "../../types";
import { airtableApi } from "../../lib/api";
import { ActionItemCardOccurrences } from "./ActionItemCardOccurrences";
import { ActionItemModal } from "./ActionItemModal";
import { ContextMenu, FocusPinBadge, focusPinMenuItem, type ContextMenuItem } from "../action-items/ContextMenu";
import CommentPreviewList from "../comments/CommentPreviewList";
import { useCommentMenuItem } from "../comments/commentMenuItem";
import { useExportTray } from "../../hooks/useExportTray";
import { useFocusPins } from "../../hooks/useFocusPins";

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

export function ActionItemCard({
  item,
  accountId,
  onDragStart,
  teamMembers = [],
  meetings = [],
  onUpdated,
  onDeleted,
  projectName,
  onMeetingClick,
  contextMenuItems,
}: {
  item: AirtableActionItem;
  accountId?: number;
  onDragStart?: (e: React.DragEvent) => void;
  teamMembers?: TeamMember[];
  meetings?: AirtableMeeting[];
  onUpdated?: (updated: AirtableActionItem) => void;
  onDeleted?: (id: number) => void;
  projectName?: string;
  onMeetingClick?: () => void;
  contextMenuItems?: ContextMenuItem[];
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [dropFlash, setDropFlash] = useState(false);
  const [assignFlash, setAssignFlash] = useState(false);
  const [ctxPos, setCtxPos] = useState<{ x: number; y: number } | null>(null);
  const { addToTray } = useExportTray();
  const { isPinned, toggle: toggleFocusPin } = useFocusPins();
  const accent = PRIORITY_ACCENT[item.priority] ?? "#9ca3af";

  // Never pin a local-* blank: promoteBlankItem discards that id for a real recXXX,
  // which would orphan the pin permanently.
  const canPin = !item.airtable_id.startsWith("local-");
  const isPinnedToFocus = canPin && isPinned(item.airtable_id);
  const commentMenuEntry = useCommentMenuItem("action_item", canPin ? item.id : null, item.task || "", ctxPos);

  const builtInCtxItems: ContextMenuItem[] = [
    ...(contextMenuItems?.length ? [
      ...contextMenuItems,
      { separator: true, label: "", onClick: () => {} } as ContextMenuItem,
    ] : []),
    ...(canPin ? [
      focusPinMenuItem(isPinnedToFocus, () => toggleFocusPin(item.airtable_id)),
      { separator: true, label: "", onClick: () => {} } as ContextMenuItem,
    ] : []),
    {
      label: "Open details",
      icon: <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M9 2H12v3"/><path d="M7 7l5-5"/><path d="M12 9v3H2V2h4"/></svg>,
      onClick: () => setModalOpen(true),
    },
    {
      label: item.status === "Done" ? "Reopen" : "Mark as Done",
      icon: item.status === "Done"
        ? <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><circle cx="7" cy="7" r="6"/><path d="M4.5 7.5 6 9l3.5-4"/></svg>
        : <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M2 7l3.5 3.5L12 3.5"/></svg>,
      onClick: () => {
        const newStatus = item.status === "Done" ? "Open" : "Done";
        void airtableApi.updateActionItemFields(item.airtable_id, { status: newStatus })
          .then(({ data }) => onUpdated?.(data))
          .catch(() => {});
      },
    },
    {
      label: "Copy task name",
      icon: <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><rect x="5" y="4" width="8" height="9" rx="1"/><path d="M9 4V2H1v9h3"/></svg>,
      onClick: () => { void navigator.clipboard.writeText(item.task || "").catch(() => {}); },
    },
    commentMenuEntry,
    { separator: true, label: "", onClick: () => {} },
    { label: "→ Export tray", icon: <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M1 9v4h12V9"/><path d="M4.5 5.5 7 3l2.5 2.5"/><path d="M7 3v7"/></svg>, onClick: () => addToTray(item) },
    ...(onDeleted ? [
      { separator: true, label: "", onClick: () => {} } as ContextMenuItem,
      { label: "Delete", danger: true, icon: <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M2 4h10M5 4V2h4v2M6 7v3M8 7v3M3 4l1 8h6l1-8"/></svg>, onClick: () => onDeleted(item.id) } as ContextMenuItem,
    ] : []),
  ];

  async function handleDrop(e: React.DragEvent) {
    setDragOver(false);

    const memberRaw = e.dataTransfer.getData("assignmemberdrop");
    if (memberRaw) {
      e.preventDefault();
      e.stopPropagation();
      try {
        const { name, id } = JSON.parse(memberRaw) as { name: string; id: number };
        const { data: updated } = await airtableApi.updateActionItemFields(item.airtable_id, {
          assignee_name: name,
          assignee_airtable_id: String(id),
        });
        onUpdated?.(updated);
        setAssignFlash(true);
        setTimeout(() => setAssignFlash(false), 1500);
      } catch { /* silent */ }
      return;
    }

    const artifactRaw = e.dataTransfer.getData("artifactDrop");
    if (artifactRaw) {
      e.preventDefault();
      e.stopPropagation();
      try {
        const art = JSON.parse(artifactRaw) as { id: number; name: string; url: string; iconKey: string };
        await airtableApi.addAttachmentLink(item.id, art.name || art.url, art.url);
        setDropFlash(true);
        setTimeout(() => setDropFlash(false), 1500);
      } catch { /* silent */ }
      return;
    }
    // Kanban drops fall through — event bubbles to the parent column's onDrop.
  }

  return (
    <>
      <div
        draggable={!!onDragStart}
        onDragStart={onDragStart}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("artifactdrop") || e.dataTransfer.types.includes("assignmemberdrop")) {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
        }}
        onDrop={(e) => { void handleDrop(e); }}
        onClick={() => setModalOpen(true)}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxPos({ x: e.clientX, y: e.clientY }); }}
        className="rounded-lg select-none flex flex-col gap-1.5 cursor-pointer hover:shadow-md transition-shadow shrink-0"
        style={{
          position: "relative",
          background: dropFlash || assignFlash ? "#f0fdf4" : dragOver ? "#eef2ff" : "#F4F4F6",
          borderLeft: `3px solid ${accent}`,
          outline: dragOver ? "2px solid #6366f1" : "none",
          outlineOffset: "-1px",
          padding: "8px 10px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          width: "100%",
        }}
      >
        <p className="text-sm font-semibold text-[var(--twilio-navy)] leading-snug truncate">
          {item.task || <span className="italic opacity-50">Untitled</span>}
        </p>
        {item.task_details && (
          <p className="text-[11px] text-[var(--twilio-navy)] opacity-60 leading-snug"
            style={{ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
            {item.task_details}
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
          {projectName && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full truncate max-w-[120px]"
              style={{ background: "rgba(226,34,34,0.08)", color: "var(--twilio-red, #e22)" }}>
              <svg viewBox="0 0 12 12" fill="currentColor" className="w-2 h-2 shrink-0"><path d="M1 2.5A1.5 1.5 0 012.5 1h7A1.5 1.5 0 0111 2.5v7A1.5 1.5 0 019.5 11h-7A1.5 1.5 0 011 9.5v-7zM2.5 2a.5.5 0 00-.5.5v7a.5.5 0 00.5.5h7a.5.5 0 00.5-.5v-7a.5.5 0 00-.5-.5h-7z"/><path d="M3 4h6v1H3V4zm0 2h6v1H3V6zm0 2h4v1H3V8z"/></svg>
              {projectName}
            </span>
          )}
        </div>
        {isPinnedToFocus && <FocusPinBadge />}
        {dropFlash && <span className="text-[10px] font-semibold text-emerald-600">✓ Attached</span>}
        {assignFlash && <span className="text-[10px] font-semibold text-emerald-600">✓ Assigned</span>}
        {item.linked_meeting_name && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMeetingClick?.(); }}
            className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 hover:bg-violet-100 transition-colors w-fit max-w-full"
            title={`From meeting: ${item.linked_meeting_name}`}
          >
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-2.5 h-2.5 shrink-0" strokeLinecap="round"><rect x="1" y="2" width="10" height="9" rx="1"/><path d="M4 1v2M8 1v2M1 5h10"/></svg>
            <span className="truncate max-w-[100px]">{item.linked_meeting_name}</span>
          </button>
        )}
        <ActionItemCardOccurrences airtableId={item.airtable_id} />
        <CommentPreviewList
          resourceType="action_item"
          resourceId={canPin ? item.id : null}
          resourceLabel={item.task || ""}
        />
      </div>
      {modalOpen && (
        <ActionItemModal
          item={item}
          accountId={accountId}
          teamMembers={teamMembers}
          meetings={meetings}
          onClose={() => setModalOpen(false)}
          onUpdated={(updated) => { onUpdated?.(updated); setModalOpen(false); }}
          onConverted={() => { onUpdated?.({ ...item, status: "Done" } as AirtableActionItem); setModalOpen(false); }}
          onDeleted={(id) => { onDeleted?.(id); setModalOpen(false); }}
        />
      )}
      {ctxPos && (
        <ContextMenu
          x={ctxPos.x}
          y={ctxPos.y}
          items={builtInCtxItems}
          onClose={() => setCtxPos(null)}
        />
      )}
    </>
  );
}
