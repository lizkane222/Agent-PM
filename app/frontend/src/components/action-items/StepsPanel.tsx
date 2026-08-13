import { useState, useRef, useEffect } from "react";
import type { ActionItemStep, StepStatus } from "../../types";
import { useActionItemSteps } from "../../hooks/useActionItemSteps";
import InlineCommentThread from "../comments/InlineCommentThread";

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<StepStatus, {
  label: string;
  badge: string;
  checkbox: "checked" | "blocked" | "unchecked";
  titleClass: string;
}> = {
  Open:     { label: "Open",     badge: "bg-gray-100 text-gray-600",                    checkbox: "unchecked", titleClass: "" },
  Done:     { label: "Done",     badge: "bg-emerald-50 text-emerald-700",               checkbox: "checked",   titleClass: "line-through text-gray-400" },
  Blocked:  { label: "Blocked",  badge: "bg-red-50 text-red-700",                       checkbox: "blocked",   titleClass: "text-red-700" },
  Archived: { label: "Archived", badge: "bg-gray-100 text-gray-400",                    checkbox: "unchecked", titleClass: "line-through text-gray-400 italic" },
};

const STATUS_CYCLE: StepStatus[] = ["Open", "Done", "Blocked", "Archived"];

// ── Checkbox ──────────────────────────────────────────────────────────────────

function StepCheckbox({ status, onChange }: { status: StepStatus; onChange: (s: StepStatus) => void }) {
  const cfg = STATUS_CONFIG[status];
  if (cfg.checkbox === "checked") {
    return (
      <button
        type="button"
        onClick={() => onChange("Open")}
        title="Mark Open"
        className="shrink-0 w-4 h-4 rounded border-2 border-emerald-500 bg-emerald-500 flex items-center justify-center hover:opacity-80 transition-opacity"
      >
        <svg viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5">
          <path d="M1.5 5l2.5 2.5 4-4" />
        </svg>
      </button>
    );
  }
  if (cfg.checkbox === "blocked") {
    return (
      <button
        type="button"
        onClick={() => onChange("Open")}
        title="Mark Open"
        className="shrink-0 w-4 h-4 rounded border-2 border-red-500 bg-red-50 flex items-center justify-center hover:opacity-80 transition-opacity"
      >
        <svg viewBox="0 0 10 10" fill="none" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" className="w-2.5 h-2.5">
          <path d="M2 2l6 6M8 2l-6 6" />
        </svg>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onChange("Done")}
      title="Mark Done"
      className="shrink-0 w-4 h-4 rounded border-2 border-gray-300 hover:border-emerald-400 transition-colors flex items-center justify-center"
    />
  );
}

// ── Status picker ─────────────────────────────────────────────────────────────

function StatusPicker({ current, onSelect }: { current: StepStatus; onSelect: (s: StepStatus) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);
  const cfg = STATUS_CONFIG[current];
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${cfg.badge} hover:opacity-80 transition-opacity`}
      >
        {cfg.label}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[100px]">
          {STATUS_CYCLE.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { onSelect(s); setOpen(false); }}
              className={`w-full text-left px-3 py-1 text-xs hover:bg-gray-50 ${s === current ? "font-semibold text-indigo-600" : ""}`}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Single step row ───────────────────────────────────────────────────────────

function StepRow({
  step,
  onUpdate,
  onDelete,
  onConvertToActionItem,
  onAddToCalendar,
}: {
  step: ActionItemStep;
  onUpdate: (id: number, data: Partial<Pick<ActionItemStep, "title" | "status" | "order">>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onConvertToActionItem?: (step: ActionItemStep) => Promise<void>;
  onAddToCalendar?: (step: ActionItemStep) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(step.title);
  const [showComments, setShowComments] = useState(false);
  const [converting, setConverting] = useState(false);
  const [addingToCal, setAddingToCal] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cfg = STATUS_CONFIG[step.status];

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  useEffect(() => { setEditTitle(step.title); }, [step.title]);

  function commitEdit() {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== step.title) onUpdate(step.id, { title: trimmed });
    setEditing(false);
  }

  async function handleConvert() {
    if (!onConvertToActionItem || converting) return;
    setConverting(true);
    try {
      await onConvertToActionItem(step);
      // Archive the step once successfully promoted
      await onUpdate(step.id, { status: "Archived" });
    } finally {
      setConverting(false);
    }
  }

  async function handleAddToCal() {
    if (!onAddToCalendar || addingToCal) return;
    setAddingToCal(true);
    try { await onAddToCalendar(step); } finally { setAddingToCal(false); }
  }

  return (
    <div className="group">
      <div className="flex items-start gap-2 py-1.5">
        <StepCheckbox
          status={step.status}
          onChange={(s) => onUpdate(step.id, { status: s })}
        />

        {/* Title */}
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              ref={inputRef}
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
                if (e.key === "Escape") { setEditTitle(step.title); setEditing(false); }
              }}
              className="w-full text-sm border-b border-indigo-400 focus:outline-none bg-transparent pb-0.5"
            />
          ) : (
            <span
              className={`text-sm cursor-text ${cfg.titleClass}`}
              onDoubleClick={() => setEditing(true)}
              title="Double-click to edit"
            >
              {step.title || <span className="italic opacity-40">Untitled step</span>}
            </span>
          )}
        </div>

        {/* Status badge */}
        <StatusPicker
          current={step.status}
          onSelect={(s) => onUpdate(step.id, { status: s })}
        />

        {/* Action buttons — visible on hover */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {/* Comment */}
          <button
            type="button"
            onClick={() => setShowComments((v) => !v)}
            title="Comments"
            className={`p-0.5 rounded hover:bg-gray-100 transition-colors ${showComments ? "text-indigo-600" : "text-gray-400"}`}
          >
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
              <path d="M1 2a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4L1 11V2z" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {/* Convert to action item */}
          {onConvertToActionItem && (
            <button
              type="button"
              disabled={converting}
              onClick={() => void handleConvert()}
              title="Convert to action item"
              className="p-0.5 rounded hover:bg-gray-100 transition-colors text-gray-400 hover:text-indigo-600 disabled:opacity-40"
            >
              {converting ? (
                <svg viewBox="0 0 12 12" className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6" cy="6" r="4" strokeDasharray="6 6"/></svg>
              ) : (
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1" y="3" width="10" height="8" rx="1"/>
                  <path d="M4 1v4M8 1v4"/>
                  <path d="M1 7h10"/>
                  <path d="M4 9.5L5.5 11 8 8.5" strokeWidth="1.3"/>
                </svg>
              )}
            </button>
          )}

          {/* Add to calendar */}
          {onAddToCalendar && (
            <button
              type="button"
              disabled={addingToCal}
              onClick={() => void handleAddToCal()}
              title="Add to calendar"
              className="p-0.5 rounded hover:bg-gray-100 transition-colors text-gray-400 hover:text-amber-600 disabled:opacity-40"
            >
              {addingToCal ? (
                <svg viewBox="0 0 12 12" className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6" cy="6" r="4" strokeDasharray="6 6"/></svg>
              ) : (
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1" y="2" width="10" height="9" rx="1"/>
                  <path d="M4 1v2M8 1v2M1 5h10"/>
                  <path d="M6 7v2M5 8h2"/>
                </svg>
              )}
            </button>
          )}

          {/* Delete */}
          <button
            type="button"
            onClick={() => onDelete(step.id)}
            title="Delete step"
            className="p-0.5 rounded hover:bg-gray-100 transition-colors text-gray-400 hover:text-red-500"
          >
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3" strokeLinecap="round">
              <path d="M2 2l8 8M10 2l-8 8"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Inline comments */}
      {showComments && (
        <div className="ml-6 mt-1 mb-2">
          <InlineCommentThread
            resourceType="action_item_step"
            resourceId={step.id}
            resourceLabel={step.title}
            compact
          />
        </div>
      )}
    </div>
  );
}

// ── Steps panel ───────────────────────────────────────────────────────────────

interface Props {
  actionItemId: number;
  actionItemTitle?: string;
  onConvertToActionItem?: (step: ActionItemStep) => Promise<void>;
  onAddToCalendar?: (step: ActionItemStep) => Promise<void>;
}

export default function StepsPanel({ actionItemId, actionItemTitle, onConvertToActionItem, onAddToCalendar }: Props) {
  const { steps, loading, addStep, updateStep, deleteStep } = useActionItemSteps(actionItemId);
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (adding) inputRef.current?.focus(); }, [adding]);

  async function handleAddStep() {
    const t = newTitle.trim();
    if (!t) return;
    await addStep(t);
    setNewTitle("");
    setAdding(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)]">
          Steps
          {steps.length > 0 && (
            <span className="ml-1.5 text-gray-400 font-normal normal-case tracking-normal">
              {steps.filter((s) => s.status === "Done").length}/{steps.length}
            </span>
          )}
        </h3>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
        >
          + Add step
        </button>
      </div>

      {/* Progress bar */}
      {steps.length > 0 && (
        <div className="w-full h-1 bg-gray-100 rounded-full mb-3 overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all"
            style={{ width: `${(steps.filter((s) => s.status === "Done").length / steps.length) * 100}%` }}
          />
        </div>
      )}

      {loading && <p className="text-xs text-gray-400 py-2 text-center italic">Loading…</p>}

      {!loading && steps.length === 0 && !adding && (
        <p className="text-xs text-gray-400 italic text-center py-2">
          No steps yet.{" "}
          <button type="button" onClick={() => setAdding(true)} className="text-indigo-500 hover:underline">Add one</button>
        </p>
      )}

      {/* Step list */}
      <div className="divide-y divide-gray-50">
        {steps.map((step) => (
          <StepRow
            key={step.id}
            step={step}
            onUpdate={updateStep}
            onDelete={deleteStep}
            onConvertToActionItem={onConvertToActionItem}
            onAddToCalendar={onAddToCalendar}
          />
        ))}
      </div>

      {/* Add step input */}
      {adding && (
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-100">
          <div className="shrink-0 w-4 h-4 rounded border-2 border-gray-300" />
          <input
            ref={inputRef}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); void handleAddStep(); }
              if (e.key === "Escape") { setAdding(false); setNewTitle(""); }
            }}
            placeholder="New step…"
            className="flex-1 text-sm border-b border-indigo-400 focus:outline-none bg-transparent pb-0.5"
          />
          <button
            type="button"
            onClick={() => void handleAddStep()}
            disabled={!newTitle.trim()}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-40"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => { setAdding(false); setNewTitle(""); }}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Cancel
          </button>
        </div>
      )}

      {actionItemTitle && (
        <p className="text-[10px] text-gray-400 mt-3 italic">
          Steps on "{actionItemTitle}" · not synced to Airtable
        </p>
      )}
    </div>
  );
}
