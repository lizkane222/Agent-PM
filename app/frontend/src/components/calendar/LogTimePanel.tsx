import { useEffect, useMemo, useRef, useState } from "react";
import { schedulerApi, airtableApi, accountsApi, salesforceApi } from "../../lib/api";
import type { CalendarEvent, AirtableActionItem, SalesforceProject, LogTimeDayAssignment } from "../../types";
import type { ScheduledItem, EventAccountLink } from "../../types/calendar";

const CALENDAR_DRAG_KEY = "calendarDragActionItemId";
const LOGGED_DATES_EVENT = "loggedDatesUpdated";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(secs: number): string {
  if (secs <= 0) return "0m";
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function fmtDecimalHours(secs: number): string {
  return (secs / 3600).toFixed(2);
}

function roundUpToQuarterHour(mins: number): number {
  return Math.ceil(mins / 15) * 15;
}

// ── CopyButton ────────────────────────────────────────────────────────────────

function CopyButton({ buildText }: { buildText: () => string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(buildText()).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }).catch(() => {});
      }}
      className={[
        "shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold border transition-colors",
        copied ? "bg-emerald-50 border-emerald-300 text-emerald-700" : "bg-white border-gray-200 text-gray-400 hover:border-indigo-300 hover:text-indigo-600",
      ].join(" ")}
    >
      {copied ? "✓" : "Copy"}
    </button>
  );
}

// ── LogTimeDayColumn ──────────────────────────────────────────────────────────

interface LogTimeDayColumnProps {
  date: string;
  dayCalEvents: CalendarEvent[];
  dayItems: AirtableActionItem[];
  scheduledItems: ScheduledItem[];
  syncedItemDurations: Map<string, number>;
  projects: SalesforceProject[];
  assignments: LogTimeDayAssignment[];
  timeOverrides: Record<string, number>;
  itemAssignments: Record<string, number>;
  onOverrideChange: (key: string, secs: number) => void;
  onAddProject: (date: string, project: SalesforceProject) => void;
  onRemoveProject: (date: string, assignment: LogTimeDayAssignment) => void;
  onPinItem: (date: string, airtableId: string) => void;
  onAssignItem: (itemKey: string, assignmentId: number | null) => void;
  onLogDay: (date: string, projectSfId: string, minutes: number, description: string) => Promise<void>;
  loggedDays: Set<string>;
  manuallyLogged: boolean;
  onMarkManuallyLogged: (date: string) => void;
}

function LogTimeDayColumn({
  date, dayCalEvents: allDayCalEvents, dayItems: allDayItems, scheduledItems, syncedItemDurations, projects, assignments,
  timeOverrides, itemAssignments, onOverrideChange, onAddProject, onRemoveProject, onPinItem, onAssignItem, onLogDay, loggedDays,
  manuallyLogged, onMarkManuallyLogged,
}: LogTimeDayColumnProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isDragOverProject, setIsDragOverProject] = useState<number | null>(null);
  const [loggingKey, setLoggingKey] = useState<string | null>(null);
  const [removedEventIds, setRemovedEventIds] = useState<Set<number>>(new Set());
  const [removedItemIds, setRemovedItemIds] = useState<Set<string>>(new Set());

  const dayCalEvents = allDayCalEvents.filter((e) => !removedEventIds.has(e.id));
  const dayItems = allDayItems.filter((i) => !removedItemIds.has(i.airtable_id));

  function secsForEvent(e: CalendarEvent) {
    const key = `${date}::e::${e.id}`;
    if (timeOverrides[key] !== undefined) return timeOverrides[key];
    return Math.max(0, (new Date(e.end_datetime).getTime() - new Date(e.start_datetime).getTime()) / 1000);
  }

  function secsForItem(item: AirtableActionItem) {
    const key = `${date}::i::${item.airtable_id}`;
    if (timeOverrides[key] !== undefined) return timeOverrides[key];
    const slot = scheduledItems.find((s) => s.airtableId === item.airtable_id && s.start.slice(0, 10) === date);
    if (slot) {
      const slotSecs = (new Date(slot.end).getTime() - new Date(slot.start).getTime()) / 1000;
      if (slotSecs > 0) return slotSecs;
    }
    const syncedSecs = syncedItemDurations.get(`${date}::${item.airtable_id}`);
    if (syncedSecs !== undefined && syncedSecs > 0) return syncedSecs;
    const actual = (item.time_spent ?? 0) + (item.prep_time ?? 0);
    return actual > 0 ? actual : (item.estimated_time ?? 0);
  }

  const multiProject = assignments.length > 1;

  function eventItemKey(e: CalendarEvent) { return `${date}::e::${e.id}`; }
  function actionItemKey(i: AirtableActionItem) { return `${date}::i::${i.airtable_id}`; }

  const totalSecs = multiProject
    ? 0
    : dayCalEvents.reduce((s, e) => s + secsForEvent(e), 0)
      + dayItems.reduce((s, i) => s + secsForItem(i), 0);

  const [d, mo, dy] = date.split("-").map(Number) as [number, number, number];
  const dayLabel = new Date(d, mo - 1, dy).toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.getData("logTimeRemoveAssignmentId")) return;
    const projectId = e.dataTransfer.getData("logTimeProjectId");
    if (projectId) {
      const project = projects.find((p) => String(p.id) === projectId);
      if (project) onAddProject(date, project);
      return;
    }
    const airtableId = e.dataTransfer.getData("text/plain") || (window as unknown as Record<string, string>)[CALENDAR_DRAG_KEY];
    if (airtableId) onPinItem(date, airtableId);
  }

  function handleProjectDrop(e: React.DragEvent, assignmentId: number) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOverProject(null);
    const itemKey = e.dataTransfer.getData("logTimeItemKey");
    if (itemKey) {
      onAssignItem(itemKey, assignmentId);
    }
  }

  function TimeInput({ valueKey, defaultSecs }: { valueKey: string; defaultSecs: number }) {
    const currentSecs = timeOverrides[valueKey] !== undefined ? timeOverrides[valueKey] : defaultSecs;
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");

    if (!editing) {
      return (
        <button
          onClick={() => { setDraft(String((currentSecs / 3600).toFixed(2))); setEditing(true); }}
          className="text-xs text-gray-400 hover:text-indigo-600 transition-colors shrink-0 tabular-nums"
          title="Click to edit"
        >
          {fmtDuration(currentSecs)}
        </button>
      );
    }
    return (
      <input
        autoFocus
        type="number"
        min="0"
        step="0.25"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const hrs = parseFloat(draft);
          if (!isNaN(hrs) && hrs >= 0) onOverrideChange(valueKey, Math.round(hrs * 3600));
          setEditing(false);
        }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
        className="w-14 text-xs border border-indigo-400 rounded px-1 py-0.5 text-right focus:outline-none"
        title="Hours (e.g. 0.5)"
      />
    );
  }

  const hasProjects = assignments.length > 0;
  const hasActivity = dayCalEvents.length > 0 || dayItems.length > 0;
  const noProjectsConfigured = projects.length === 0;

  const BLANK_SF_ID = "admin-pseudo-general";
  const blankKey = `${date}::${BLANK_SF_ID}`;
  const blankLogged = loggedDays.has(blankKey);
  const blankSecs = (noProjectsConfigured && !hasProjects)
    ? dayCalEvents.reduce((s, e) => s + secsForEvent(e), 0) + dayItems.reduce((s, i) => s + secsForItem(i), 0)
    : 0;
  const blankMinsRaw = Math.round(blankSecs / 60);
  const blankMins = roundUpToQuarterHour(blankMinsRaw);
  function buildBlankDescription() {
    const lines: string[] = [];
    for (const e of dayCalEvents) lines.push(`${e.title} (${fmtDuration(secsForEvent(e))})`);
    for (const i of dayItems) lines.push(`${i.task}${i.task_details ? `: ${i.task_details}` : ""} (${fmtDuration(secsForItem(i))})`);
    lines.push(`Total: ${fmtDecimalHours(blankSecs)} hrs`);
    return lines.join("\n");
  }

  const validAssignmentIds = new Set(assignments.map((a) => a.id));

  function isAssigned(key: string): boolean {
    const id = itemAssignments[key];
    return id !== undefined && validAssignmentIds.has(id);
  }

  const unassignedEvents = multiProject ? dayCalEvents.filter((e) => !isAssigned(eventItemKey(e))) : dayCalEvents;
  const unassignedItems = multiProject ? dayItems.filter((i) => !isAssigned(actionItemKey(i))) : dayItems;

  function renderEventRow(e: CalendarEvent, compact: boolean, draggable?: boolean) {
    const key = eventItemKey(e);
    const defaultSecs = Math.max(0, (new Date(e.end_datetime).getTime() - new Date(e.start_datetime).getTime()) / 1000);
    return (
      <div
        key={e.id}
        draggable={draggable}
        onDragStart={draggable ? (ev) => { ev.dataTransfer.setData("logTimeItemKey", key); ev.dataTransfer.effectAllowed = "move"; } : undefined}
        className={[
          "flex items-center gap-2 rounded px-2 py-1 group",
          compact ? "mx-2 mb-1" : "mb-1",
          manuallyLogged ? (compact ? "bg-white/60 opacity-60" : "bg-emerald-50 opacity-60") : (compact ? "bg-white/80" : "bg-blue-50"),
          draggable ? "cursor-grab active:cursor-grabbing" : "",
        ].join(" ")}
      >
        <div className={["rounded-full shrink-0", compact ? "h-1.5 w-1.5" : "h-2 w-2", e.event_category === "task" ? "bg-pink-400" : e.event_category === "focus_time" ? "bg-amber-400" : e.event_category === "appointment" ? "bg-indigo-400" : e.event_category === "out_of_office" ? "bg-rose-400" : e.event_category === "working_location" ? "bg-emerald-400" : "bg-blue-400"].join(" ")} />
        <p className={[compact ? "text-[11px]" : "text-xs", "text-[var(--twilio-navy)] truncate flex-1", manuallyLogged ? "line-through text-gray-400" : ""].join(" ")}>{e.title}</p>
        <TimeInput valueKey={key} defaultSecs={defaultSecs} />
        <button onClick={() => setRemovedEventIds((prev) => new Set([...prev, e.id]))} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 text-xs leading-none shrink-0 transition-opacity ml-1" title="Remove from log">×</button>
      </div>
    );
  }

  function renderItemRow(item: AirtableActionItem, compact: boolean, draggable?: boolean) {
    const key = actionItemKey(item);
    const defaultSecs = secsForItem(item);
    return (
      <div
        key={item.airtable_id}
        draggable={draggable}
        onDragStart={draggable ? (ev) => { ev.dataTransfer.setData("logTimeItemKey", key); ev.dataTransfer.effectAllowed = "move"; } : undefined}
        className={[
          "flex items-start gap-2 rounded px-2 py-1 group",
          compact ? "mx-2 mb-1" : "mb-1",
          manuallyLogged ? (compact ? "bg-white/60 opacity-60" : "bg-emerald-50 opacity-60") : (compact ? "bg-white/80" : "bg-violet-50"),
          draggable ? "cursor-grab active:cursor-grabbing" : "",
        ].join(" ")}
      >
        <div className={["rounded-full bg-violet-400 shrink-0 mt-1", compact ? "h-1.5 w-1.5" : "h-2 w-2"].join(" ")} />
        <div className="flex-1 min-w-0">
          <p className={[compact ? "text-[11px] font-medium" : "text-xs font-medium", "truncate", manuallyLogged ? "line-through text-gray-400" : "text-[var(--twilio-navy)]"].join(" ")}>{item.task}</p>
          {!compact && item.task_details && <p className="text-[10px] text-gray-400 truncate">{item.task_details}</p>}
        </div>
        <TimeInput valueKey={key} defaultSecs={defaultSecs} />
        <button onClick={() => setRemovedItemIds((prev) => new Set([...prev, item.airtable_id]))} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 text-xs leading-none shrink-0 transition-opacity ml-1" title="Remove from log">×</button>
      </div>
    );
  }

  return (
    <div
      className={[
        "flex flex-col rounded-xl border transition-colors min-w-0",
        isDragOver ? "border-indigo-400 bg-indigo-50 shadow-md" : "border-gray-200 bg-white",
      ].join(" ")}
      style={{ flex: "1 1 0", minWidth: 0 }}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className={["px-3 pt-3 pb-2 border-b flex items-start justify-between gap-1", manuallyLogged ? "border-emerald-200 bg-emerald-50/60" : "border-gray-100"].join(" ")}>
        <div>
          <p className="text-xs font-semibold text-[var(--twilio-navy)]">{dayLabel}</p>
          <p className={["text-lg font-bold leading-tight", manuallyLogged ? "text-emerald-700" : "text-[var(--twilio-navy)]"].join(" ")}>
            {fmtDecimalHours(totalSecs)}<span className="text-sm font-normal text-gray-400 ml-1">/ {fmtDuration(totalSecs)}</span>
          </p>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-2 px-3 py-2 flex-1">
        {!hasProjects && noProjectsConfigured && (
          <div className={["rounded-lg border transition-colors", manuallyLogged ? "border-emerald-200 bg-emerald-50/40" : "border-emerald-200 bg-emerald-50/60"].join(" ")}>
            {!hasActivity && (
              <p className="mx-2 mt-2 mb-1 text-[11px] text-gray-400 italic">{isDragOver ? "Drop here to add" : "No calendar activity for this day"}</p>
            )}
            {dayCalEvents.map((e) => renderEventRow(e, true))}
            {dayItems.map((item) => renderItemRow(item, true))}
            <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2 pt-1 border-t border-emerald-100 mt-1 min-w-0">
              <span className="text-[10px] font-semibold text-emerald-800 mr-auto tabular-nums whitespace-nowrap">
                {fmtDecimalHours(blankSecs)} / {fmtDuration(blankSecs)}
                {blankMins !== blankMinsRaw && <span className="text-emerald-600 ml-1">(→ {blankMins}m)</span>}
              </span>
              <CopyButton buildText={buildBlankDescription} />
              <button
                onClick={() => onMarkManuallyLogged(date)}
                className={["shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold border transition-colors", manuallyLogged ? "bg-emerald-600 border-emerald-600 text-white" : "bg-white border-gray-200 text-gray-400 hover:border-emerald-400 hover:text-emerald-700"].join(" ")}
              >
                {manuallyLogged ? "✓" : "Mark"}
              </button>
              <button
                onClick={async () => { setLoggingKey(blankKey); try { await onLogDay(date, BLANK_SF_ID, blankMins, buildBlankDescription()); } finally { setLoggingKey(null); } }}
                disabled={loggingKey === blankKey || blankMins === 0}
                className={["shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold transition-colors border", blankLogged ? "bg-emerald-600 border-emerald-600 text-white" : "bg-white border-emerald-400 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed"].join(" ")}
              >
                {loggingKey === blankKey ? "…" : blankLogged ? "✓ Logged" : "Log"}
              </button>
            </div>
          </div>
        )}

        {!hasProjects && !noProjectsConfigured && (
          <>
            {dayCalEvents.map((e) => renderEventRow(e, false))}
            {dayItems.map((item) => renderItemRow(item, false))}
            {!hasActivity && (
              <p className="text-xs text-gray-400 italic">{isDragOver ? "Drop here to add" : "No activity"}</p>
            )}
          </>
        )}

        {hasProjects && multiProject && (unassignedEvents.length > 0 || unassignedItems.length > 0) && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-1 pt-1 pb-0.5 mb-1">
            <p className="text-[10px] text-gray-400 px-1 pb-0.5">Unassigned — drag into a project</p>
            {unassignedEvents.map((e) => renderEventRow(e, true, true))}
            {unassignedItems.map((item) => renderItemRow(item, true, true))}
          </div>
        )}

        {assignments.map((a) => {
          const key = `${date}::${a.project_sf_id}`;
          const logged = loggedDays.has(key);

          const projEvents = multiProject
            ? dayCalEvents.filter((e) => itemAssignments[eventItemKey(e)] === a.id && validAssignmentIds.has(a.id))
            : dayCalEvents;
          const projItems = multiProject
            ? dayItems.filter((i) => itemAssignments[actionItemKey(i)] === a.id && validAssignmentIds.has(a.id))
            : dayItems;

          const projSecs = projEvents.reduce((s, e) => s + secsForEvent(e), 0)
            + projItems.reduce((s, i) => s + secsForItem(i), 0);
          const projMinsRaw = Math.round(projSecs / 60);
          const projMins = roundUpToQuarterHour(projMinsRaw);
          const projHasContent = projEvents.length > 0 || projItems.length > 0;

          function buildProjectDescription() {
            const lines: string[] = [];
            for (const e of projEvents) lines.push(`${e.title} (${fmtDuration(secsForEvent(e))})`);
            for (const i of projItems) lines.push(`${i.task}${i.task_details ? `: ${i.task_details}` : ""} (${fmtDuration(secsForItem(i))})`);
            lines.push(`Total: ${fmtDecimalHours(projSecs)} hrs`);
            return lines.join("\n");
          }

          const isDropTarget = isDragOverProject === a.id;

          return (
            <div
              key={a.id}
              className={[
                "rounded-lg border transition-colors",
                isDropTarget ? "border-indigo-400 bg-indigo-50/60" : (manuallyLogged ? "border-emerald-200 bg-emerald-50/40" : "border-emerald-200 bg-emerald-50/60"),
              ].join(" ")}
              onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer.types.includes("logtimeitemkey")) setIsDragOverProject(a.id); }}
              onDragLeave={() => setIsDragOverProject(null)}
              onDrop={(e) => handleProjectDrop(e, a.id)}
            >
              <div className="flex items-center gap-1.5 px-2 pt-2 pb-1">
                <div
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("logTimeRemoveAssignmentId", String(a.id));
                    e.dataTransfer.setData("logTimeRemoveDate", date);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={(e) => {
                    if (e.dataTransfer.dropEffect === "none") onRemoveProject(date, a);
                  }}
                  className="flex-1 flex items-center gap-1.5 min-w-0 cursor-grab active:cursor-grabbing active:opacity-50"
                  title="Drag off to remove"
                >
                  <div className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                  <p className="text-[11px] font-semibold text-emerald-900 break-words min-w-0">{a.project_name}</p>
                </div>
                <button onClick={() => onRemoveProject(date, a)} className="shrink-0 text-gray-300 hover:text-red-400 transition-colors text-sm leading-none" title="Remove">×</button>
              </div>

              {projEvents.map((e) => {
                const ikey = eventItemKey(e);
                return (
                  <div key={e.id} className={["flex items-center gap-2 mx-2 mb-1 rounded px-2 py-1 group", manuallyLogged ? "bg-white/60 opacity-60" : "bg-white/80"].join(" ")}>
                    <div className="h-1.5 w-1.5 rounded-full bg-blue-400 shrink-0" />
                    <p className={["text-[11px] text-[var(--twilio-navy)] truncate flex-1", manuallyLogged ? "line-through text-gray-400" : ""].join(" ")}>{e.title}</p>
                    <TimeInput valueKey={ikey} defaultSecs={Math.max(0, (new Date(e.end_datetime).getTime() - new Date(e.start_datetime).getTime()) / 1000)} />
                    {multiProject && <button onClick={() => onAssignItem(ikey, null)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-indigo-400 text-xs leading-none shrink-0 transition-opacity" title="Unassign from project">↩</button>}
                    <button onClick={() => setRemovedEventIds((prev) => new Set([...prev, e.id]))} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 text-xs leading-none shrink-0 transition-opacity" title="Remove from log">×</button>
                  </div>
                );
              })}

              {projItems.map((item) => {
                const ikey = actionItemKey(item);
                return (
                  <div key={item.airtable_id} className={["flex items-start gap-2 mx-2 mb-1 rounded px-2 py-1 group", manuallyLogged ? "bg-white/60 opacity-60" : "bg-white/80"].join(" ")}>
                    <div className="h-1.5 w-1.5 rounded-full bg-violet-400 shrink-0 mt-1" />
                    <div className="flex-1 min-w-0">
                      <p className={["text-[11px] font-medium truncate", manuallyLogged ? "line-through text-gray-400" : "text-[var(--twilio-navy)]"].join(" ")}>{item.task}</p>
                    </div>
                    <TimeInput valueKey={ikey} defaultSecs={secsForItem(item)} />
                    {multiProject && <button onClick={() => onAssignItem(ikey, null)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-indigo-400 text-xs leading-none shrink-0 transition-opacity" title="Unassign from project">↩</button>}
                    <button onClick={() => setRemovedItemIds((prev) => new Set([...prev, item.airtable_id]))} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 text-xs leading-none shrink-0 transition-opacity" title="Remove from log">×</button>
                  </div>
                );
              })}

              {multiProject && !projHasContent && (
                <p className="mx-2 mb-1 text-[11px] text-gray-400 italic">{isDropTarget ? "Drop here" : "Drag items here"}</p>
              )}
              {!multiProject && !hasActivity && (
                <p className="mx-2 mb-1 text-[11px] text-gray-400 italic">No calendar activity for this day</p>
              )}

              <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2 pt-1 border-t border-emerald-100 mt-1 min-w-0">
                <span className="text-[10px] font-semibold text-emerald-800 mr-auto tabular-nums whitespace-nowrap">
                  {fmtDecimalHours(projSecs)} / {fmtDuration(projSecs)}
                  {projMins !== projMinsRaw && (
                    <span className="text-emerald-600 ml-1">(→ {projMins}m)</span>
                  )}
                </span>
                <CopyButton buildText={buildProjectDescription} />
                <button
                  onClick={() => onMarkManuallyLogged(date)}
                  className={[
                    "shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold border transition-colors",
                    manuallyLogged ? "bg-emerald-600 border-emerald-600 text-white" : "bg-white border-gray-200 text-gray-400 hover:border-emerald-400 hover:text-emerald-700",
                  ].join(" ")}
                >
                  {manuallyLogged ? "✓" : "Mark"}
                </button>
                <button
                  onClick={async () => { setLoggingKey(key); try { await onLogDay(date, a.project_sf_id, projMins, buildProjectDescription()); } finally { setLoggingKey(null); } }}
                  disabled={loggingKey === key || projMins === 0}
                  className={[
                    "shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold transition-colors border",
                    logged ? "bg-emerald-600 border-emerald-600 text-white"
                    : "bg-white border-emerald-400 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed",
                  ].join(" ")}
                >
                  {loggingKey === key ? "…" : logged ? "✓ Logged" : "Log"}
                </button>
              </div>
            </div>
          );
        })}

        {isDragOver && (
          <div className="rounded-lg border-2 border-dashed border-indigo-400 bg-indigo-50 py-1.5 text-center text-xs text-indigo-600 font-medium">
            Drop project or action item
          </div>
        )}
        {!hasProjects && !noProjectsConfigured && !isDragOver && (
          <p className="text-[10px] text-gray-400 text-center pb-1">Drop a project to log time</p>
        )}
      </div>
    </div>
  );
}

// ── LogTimePanel ──────────────────────────────────────────────────────────────

export interface LogTimePanelProps {
  accountName: string;
  visibleDays: string[];
  events: CalendarEvent[];
  eventAccountLinks: Map<string, EventAccountLink>;
  scheduledItems: ScheduledItem[];
  weekStart: string;
  onExit: () => void;
}

export default function LogTimePanel({
  accountName,
  visibleDays,
  events,
  eventAccountLinks,
  scheduledItems,
  weekStart,
  onExit,
}: LogTimePanelProps) {
  const lsKey = (suffix: string) => `logtime::${accountName}::${suffix}`;
  function lsGet<T>(suffix: string, fallback: T): T {
    try { const v = localStorage.getItem(lsKey(suffix)); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; }
  }
  function lsSet(suffix: string, value: unknown) {
    try { localStorage.setItem(lsKey(suffix), JSON.stringify(value)); } catch { /* quota */ }
  }

  const [projects, setProjects] = useState<SalesforceProject[]>([]);
  const [assignments, setAssignments] = useState<LogTimeDayAssignment[]>(() => lsGet<LogTimeDayAssignment[]>("pseudoAssignments", []));
  const [allActionItems, setAllActionItems] = useState<AirtableActionItem[]>([]);
  const [weekEvents, setWeekEvents] = useState<CalendarEvent[]>(events);

  const syncedItemDurations = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of weekEvents) {
      if (e.calendar_id === "work_tracking" && e.agentpm_airtable_id) {
        const secs = Math.max(0, (new Date(e.end_datetime).getTime() - new Date(e.start_datetime).getTime()) / 1000);
        if (secs > 0) m.set(`${e.start_datetime.slice(0, 10)}::${e.agentpm_airtable_id}`, secs);
      }
    }
    return m;
  }, [weekEvents]);

  const [loggedDays, setLoggedDays] = useState<Set<string>>(() => new Set(lsGet<string[]>("loggedDays", [])));
  const [dragProjectId, setDragProjectId] = useState<string | null>(null);
  const [weekLogState, setWeekLogState] = useState<"idle" | "logging" | "done">("idle");
  const [manuallyLoggedDays, setManuallyLoggedDays] = useState<Set<string>>(() => new Set(lsGet<string[]>("manuallyLoggedDays", [])));
  const [timeOverrides, setTimeOverrides] = useState<Record<string, number>>(() => lsGet("timeOverrides", {}));
  const [pinnedItems, setPinnedItems] = useState<Record<string, string[]>>(() => lsGet("pinnedItems", {}));
  const [itemAssignments, setItemAssignments] = useState<Record<string, number>>(() => lsGet("itemAssignments", {}));

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

  const ADMIN_DEFAULT_PROJECTS: SalesforceProject[] = [
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
  ].map((name, i) => ({
    id: -(i + 1),
    sf_id: `admin-pseudo-${i}`,
    name,
    description: ADMIN_PROJECT_DESCRIPTIONS[name] ?? "",
    status: "",
    account_name: "Admin",
    owner_sf_id: "",
    members: [],
    tasks: [],
  } as unknown as SalesforceProject));

  useEffect(() => {
    if (accountName.toLowerCase() === "admin") {
      setProjects(ADMIN_DEFAULT_PROJECTS);
      airtableApi.listActionItems()
        .then(({ data }) => setAllActionItems(data))
        .catch(() => {});
      return;
    }
    const sfPromise = salesforceApi.listProjects({ account_name: accountName })
      .then(({ data }) => data.results)
      .catch((): SalesforceProject[] => []);
    const localPromise = accountsApi.listProjectsByAccount(accountName)
      .then(({ data }) => data.results.map((p) => ({
        id: -(p.id + 10000),
        sf_id: `local-${p.id}`,
        name: p.name,
        description: p.description,
        status: "active",
        account: null,
        account_name: accountName,
        owner_name: "",
        start_date: null,
        end_date: null,
        owner_sf_id: "",
        members: [],
        tasks: [],
      } as SalesforceProject)))
      .catch((): SalesforceProject[] => []);
    Promise.all([sfPromise, localPromise]).then(([sfProjects, localProjects]) => {
      setProjects([...sfProjects, ...localProjects]);
    });
    airtableApi.listActionItems()
      .then(({ data }) => setAllActionItems(data))
      .catch(() => {});
  }, [accountName]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!weekStart) return;
    const pseudo = lsGet<LogTimeDayAssignment[]>("pseudoAssignments", []);
    salesforceApi.listDayAssignments(weekStart)
      .then(({ data }) => setAssignments([...data, ...pseudo.filter((p) => p.id < 0)]))
      .catch(() => { setAssignments(pseudo.filter((p) => p.id < 0)); });
  }, [weekStart, accountName]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!weekStart) return;
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const weekEndStr = weekEnd.toISOString();
    const refresh = () => {
      schedulerApi.listEvents({ start: weekStart, end: weekEndStr })
        .then(({ data }) => setWeekEvents(data))
        .catch(() => {});
    };
    refresh();
    const interval = setInterval(refresh, 30_000);
    const handleStorage = (ev: StorageEvent) => {
      if (ev.key === "activeTimers" || ev.key === "actionItemCancelTimer") refresh();
    };
    window.addEventListener("storage", handleStorage);
    return () => { clearInterval(interval); window.removeEventListener("storage", handleStorage); };
  }, [weekStart]);

  const days = visibleDays.slice(0, 5);
  const isAdmin = accountName.toLowerCase() === "admin";

  function dayCalEvents(date: string): CalendarEvent[] {
    return weekEvents.filter((e) => {
      if (e.start_datetime.slice(0, 10) !== date) return false;
      if (e.calendar_id === "work_tracking") return false;
      const link = (e.google_event_id ? eventAccountLinks.get(e.google_event_id) : undefined)
        ?? eventAccountLinks.get(String(e.id));
      if (link) return link.accountName === accountName;
      return e.account_name === accountName;
    });
  }

  function dayActionItems(date: string): AirtableActionItem[] {
    const scheduledIds = new Set(
      scheduledItems
        .filter((s) => s.start.slice(0, 10) === date && (isAdmin || s.accountName === accountName))
        .map((s) => s.airtableId)
    );
    const pinned = new Set(pinnedItems[date] ?? []);
    const syncedIds = new Set(
      weekEvents
        .filter((e) =>
          e.calendar_id === "work_tracking" &&
          !!e.agentpm_airtable_id &&
          e.start_datetime.slice(0, 10) === date
        )
        .map((e) => e.agentpm_airtable_id as string)
    );
    const allIds = new Set([...scheduledIds, ...pinned, ...syncedIds]);
    return allActionItems.filter((i) =>
      allIds.has(i.airtable_id) && (isAdmin || syncedIds.has(i.airtable_id) || i.account_name === accountName)
    );
  }

  function itemSecs(date: string, i: AirtableActionItem): number {
    const key = `${date}::i::${i.airtable_id}`;
    if (timeOverrides[key] !== undefined) return timeOverrides[key];
    const slot = scheduledItems.find((s) => s.airtableId === i.airtable_id && s.start.slice(0, 10) === date);
    if (slot) {
      const slotSecs = (new Date(slot.end).getTime() - new Date(slot.start).getTime()) / 1000;
      if (slotSecs > 0) return slotSecs;
    }
    const synced = syncedItemDurations.get(`${date}::${i.airtable_id}`);
    if (synced !== undefined && synced > 0) return synced;
    const actual = (i.time_spent ?? 0) + (i.prep_time ?? 0);
    return actual > 0 ? actual : (i.estimated_time ?? 0);
  }

  function secsForDay(date: string): number {
    const evSecs = dayCalEvents(date).reduce((s, e) => {
      const key = `${date}::e::${e.id}`;
      return s + (timeOverrides[key] !== undefined ? timeOverrides[key] : Math.max(0, (new Date(e.end_datetime).getTime() - new Date(e.start_datetime).getTime()) / 1000));
    }, 0);
    return evSecs + dayActionItems(date).reduce((s, i) => s + itemSecs(date, i), 0);
  }

  function secsForProject(date: string, assignmentId: number): number {
    const dayAssignments = assignmentsForDay(date);
    const multiProject = dayAssignments.length > 1;
    const evts = multiProject
      ? dayCalEvents(date).filter((e) => itemAssignments[`${date}::e::${e.id}`] === assignmentId)
      : dayCalEvents(date);
    const items = multiProject
      ? dayActionItems(date).filter((i) => itemAssignments[`${date}::i::${i.airtable_id}`] === assignmentId)
      : dayActionItems(date);
    const evSecs = evts.reduce((s, e) => {
      const key = `${date}::e::${e.id}`;
      return s + (timeOverrides[key] !== undefined ? timeOverrides[key] : Math.max(0, (new Date(e.end_datetime).getTime() - new Date(e.start_datetime).getTime()) / 1000));
    }, 0);
    return evSecs + items.reduce((s, i) => s + itemSecs(date, i), 0);
  }

  function assignmentsForDay(date: string) {
    const projectIds = new Set(projects.map((p) => p.id));
    return assignments.filter((a) => a.date === date && projectIds.has(a.project));
  }

  function handleOverrideChange(key: string, secs: number) {
    setTimeOverrides((prev) => { const next = { ...prev, [key]: secs }; lsSet("timeOverrides", next); return next; });
  }

  function handlePinItem(date: string, airtableId: string) {
    setPinnedItems((prev) => {
      const existing = prev[date] ?? [];
      if (existing.includes(airtableId)) return prev;
      const next = { ...prev, [date]: [...existing, airtableId] };
      lsSet("pinnedItems", next);
      return next;
    });
  }

  function handleAssignItem(itemKey: string, assignmentId: number | null) {
    setItemAssignments((prev) => {
      const next = { ...prev };
      if (assignmentId === null) { delete next[itemKey]; } else { next[itemKey] = assignmentId; }
      lsSet("itemAssignments", next);
      return next;
    });
  }

  const pseudoAssignmentIdRef = useRef(
    Math.min(-1, ...lsGet<LogTimeDayAssignment[]>("pseudoAssignments", []).map((a) => a.id)) - 1
  );

  function savePseudoAssignments(next: LogTimeDayAssignment[]) {
    lsSet("pseudoAssignments", next.filter((a) => a.id < 0));
  }

  async function handleAddProject(date: string, project: SalesforceProject) {
    if (project.id < 0) {
      setAssignments((prev) => {
        if (prev.some((a) => a.date === date && a.project === project.id)) return prev;
        const synth: LogTimeDayAssignment = {
          id: pseudoAssignmentIdRef.current--,
          date,
          project: project.id,
          project_sf_id: project.sf_id,
          project_name: project.name,
          position: prev.length,
        };
        const next = [...prev, synth];
        savePseudoAssignments(next);
        return next;
      });
      return;
    }
    try {
      const { data } = await salesforceApi.addDayAssignment(date, project.id);
      setAssignments((prev) => prev.some((a) => a.date === date && a.project === project.id) ? prev : [...prev, data]);
    } catch { /* best effort */ }
  }

  async function handleRemoveProject(date: string, assignment: LogTimeDayAssignment) {
    if (assignment.id < 0) {
      setAssignments((prev) => {
        const next = prev.filter((a) => a.id !== assignment.id);
        savePseudoAssignments(next);
        return next;
      });
      return;
    }
    try {
      await salesforceApi.removeDayAssignment(date, assignment.project);
      setAssignments((prev) => prev.filter((a) => a.id !== assignment.id));
    } catch { /* best effort */ }
  }

  async function handleLogDay(date: string, projectSfId: string, minutes: number, description: string) {
    if (minutes <= 0) return;
    if (!projectSfId.startsWith("local-") && !projectSfId.startsWith("admin-pseudo-")) {
      await salesforceApi.logTime({ project_sf_id: projectSfId, date, duration_minutes: minutes, description });
    }
    setLoggedDays((prev) => { const next = new Set([...prev, `${date}::${projectSfId}`]); lsSet("loggedDays", [...next]); return next; });
  }

  async function handleLogWeek() {
    setWeekLogState("logging");
    try {
      const promises: Promise<void>[] = [];
      for (const date of days) {
        const dayAssignments = assignmentsForDay(date);
        const multi = dayAssignments.length > 1;
        for (const a of dayAssignments) {
          const key = `${date}::${a.project_sf_id}`;
          if (loggedDays.has(key)) continue;
          const projSecs = secsForProject(date, a.id);
          const totalMins = roundUpToQuarterHour(Math.round(projSecs / 60));
          if (totalMins <= 0) continue;
          const projEvents = multi
            ? dayCalEvents(date).filter((e) => itemAssignments[`${date}::e::${e.id}`] === a.id)
            : dayCalEvents(date);
          const projItems = multi
            ? dayActionItems(date).filter((i) => itemAssignments[`${date}::i::${i.airtable_id}`] === a.id)
            : dayActionItems(date);
          const lines: string[] = [
            ...projEvents.map((e) => e.title),
            ...projItems.map((i) => i.task),
            `Total: ${fmtDecimalHours(projSecs)} hrs`,
          ];
          promises.push(handleLogDay(date, a.project_sf_id, totalMins, lines.join("\n")));
        }
      }
      await Promise.all(promises);
      setWeekLogState("done");
      setTimeout(() => setWeekLogState("idle"), 3000);
    } catch {
      setWeekLogState("idle");
    }
  }

  const projectTotals: Record<string, { name: string; secs: number }> = {};
  for (const date of days) {
    for (const a of assignmentsForDay(date)) {
      if (!projectTotals[a.project_sf_id]) projectTotals[a.project_sf_id] = { name: a.project_name, secs: 0 };
      projectTotals[a.project_sf_id].secs += secsForProject(date, a.id);
    }
  }

  // Suppress unused-variable warning for secsForDay — it's defined for potential future use
  void secsForDay;

  return (
    <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 shadow-sm overflow-hidden">
      {/* Panel header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-white gap-4">
        <div className="min-w-0">
          <p className="text-sm font-bold text-[var(--twilio-navy)]">Log Time to Salesforce — {accountName}</p>
          <p className="text-xs text-gray-500">Drag a project onto a day, then log time</p>
          {accountName.toLowerCase() === "admin" && (
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <a
                href="https://docs.google.com/document/d/1875fhJatKUfZqcxkR91ao-D5bCmhHkoVOkLDWuCM2GE/edit?tab=t.0#heading=h.ootjszwuii3h"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:underline font-medium"
              >
                <img src="https://www.google.com/s2/favicons?sz=16&domain=docs.google.com" alt="" className="w-3 h-3" />
                Reference Guide: Project vs. Admin Time
              </a>
              <a
                href="https://docs.google.com/document/d/1X8P7KY_7DwJBvgk-JWgoa_KhwSKQzAdp5hc_O5UCbxI/edit?tab=t.0#heading=h.hyzdaoxe2nui"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:underline font-medium"
              >
                <img src="https://www.google.com/s2/favicons?sz=16&domain=docs.google.com" alt="" className="w-3 h-3" />
                Logging Project Time (Customer time, billable and non-billable)
              </a>
            </div>
          )}
        </div>
        <button
          onClick={onExit}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors shrink-0"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-3 h-3">
            <path d="M3 3l10 10M13 3L3 13"/>
          </svg>
          Exit Log Time
        </button>
      </div>

      {/* Available projects */}
      <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
        {projects.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No projects linked to this account — items are grouped automatically in each day column</p>
        ) : (
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
            {projects.map((p) => {
              const desc = ADMIN_PROJECT_DESCRIPTIONS[p.name];
              return (
                <div
                  key={p.id}
                  draggable
                  title={desc}
                  onDragStart={(e) => { e.dataTransfer.setData("logTimeProjectId", String(p.id)); setDragProjectId(String(p.id)); }}
                  onDragEnd={() => setDragProjectId(null)}
                  className={[
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold border cursor-grab select-none transition-all",
                    dragProjectId === String(p.id)
                      ? "opacity-40 scale-95 bg-emerald-100 border-emerald-400 text-emerald-800"
                      : "bg-white border-emerald-300 text-emerald-800 hover:bg-emerald-50 shadow-sm",
                  ].join(" ")}
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 text-emerald-500 shrink-0">
                    <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM14 11a1 1 0 011 1v1h1a1 1 0 110 2h-1v1a1 1 0 11-2 0v-1h-1a1 1 0 110-2h1v-1a1 1 0 011-1z"/>
                  </svg>
                  <span className="break-words min-w-0">{p.name}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 5 day columns */}
      <div className="flex gap-3 p-4">
        {days.map((date) => (
          <LogTimeDayColumn
            key={date}
            date={date}
            dayCalEvents={dayCalEvents(date)}
            dayItems={dayActionItems(date)}
            scheduledItems={scheduledItems}
            syncedItemDurations={syncedItemDurations}
            projects={projects}
            assignments={assignmentsForDay(date)}
            timeOverrides={timeOverrides}
            itemAssignments={itemAssignments}
            onOverrideChange={handleOverrideChange}
            onAddProject={handleAddProject}
            onRemoveProject={handleRemoveProject}
            onPinItem={handlePinItem}
            onAssignItem={handleAssignItem}
            onLogDay={handleLogDay}
            loggedDays={loggedDays}
            manuallyLogged={manuallyLoggedDays.has(date)}
            onMarkManuallyLogged={(d) => setManuallyLoggedDays((prev) => {
              const next = new Set(prev);
              if (next.has(d)) next.delete(d); else next.add(d);
              lsSet("manuallyLoggedDays", [...next]);
              window.dispatchEvent(new StorageEvent("storage", { key: LOGGED_DATES_EVENT }));
              return next;
            })}
          />
        ))}
        {days.length === 0 && (
          <p className="text-sm text-gray-400 px-2 py-6">Navigate the calendar to a week to see days here.</p>
        )}
      </div>

      {/* Week summary footer */}
      <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200 bg-white gap-4 flex-wrap">
        <div className="flex items-center gap-4 flex-wrap">
          {Object.entries(projectTotals).map(([sfId, { name, secs }]) => (
            <span key={sfId} className="text-xs text-gray-600">
              <span className="font-semibold text-[var(--twilio-navy)]">{name}</span>
              {" "}Total: {fmtDecimalHours(secs)} / {fmtDuration(secs)}
            </span>
          ))}
          {Object.keys(projectTotals).length === 0 && (
            <span className="text-xs text-gray-400">Assign projects to days to see totals</span>
          )}
        </div>
        <button
          onClick={() => void handleLogWeek()}
          disabled={weekLogState === "logging" || Object.keys(projectTotals).length === 0}
          className={[
            "shrink-0 rounded-xl px-5 py-2 text-sm font-semibold transition-colors",
            weekLogState === "done"
              ? "bg-emerald-600 text-white"
              : "bg-[var(--twilio-navy)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed",
          ].join(" ")}
        >
          {weekLogState === "logging" ? "Logging…" : weekLogState === "done" ? "✓ Week Logged" : "Log Week"}
        </button>
      </div>
    </div>
  );
}
