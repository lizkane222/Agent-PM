import { useState, useRef, useEffect } from "react";
import type { ActionItemStep } from "../../types";
import { useActionItemSteps } from "../../hooks/useActionItemSteps";
import InlineCommentThread from "../comments/InlineCommentThread";
import CommentIcon from "../CommentIcon";

/**
 * A numbered checklist on an action item, modelled on a Trello card checklist:
 * binary checkboxes, a completion percentage, and an option to hide finished items.
 *
 * The backing model also has Blocked/Archived statuses, but the UI is deliberately binary —
 * only "Done" reads as checked. Legacy rows in either of those states simply render
 * unchecked, so nothing is hidden or lost.
 */

/** A step counts as complete only when it is Done. */
function isDone(step: ActionItemStep): boolean {
  return step.status === "Done";
}

// ── Checkbox ──────────────────────────────────────────────────────────────────

function StepCheckbox({ done, onToggle }: { done: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      onClick={onToggle}
      title={done ? "Mark as not done" : "Mark as done"}
      className={`shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
        done
          ? "border-emerald-500 bg-emerald-500 hover:opacity-80"
          : "border-gray-300 hover:border-emerald-400"
      }`}
    >
      {done && (
        <svg viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5">
          <path d="M1.5 5l2.5 2.5 4-4" />
        </svg>
      )}
    </button>
  );
}

/** Insertion line shown between rows while dragging. */
function StepDropIndicator() {
  return <div data-testid="step-drop-indicator" className="h-0.5 -my-px rounded-full bg-indigo-500" />;
}

/** Anything interactive on a row — clicking one of these must not start editing the title. */
const ROW_CONTROLS = "button, [role='button'], [role='checkbox'], input, textarea, a, label";

/**
 * Character offset within `root` at viewport point (x, y), or null if the browser can't say.
 *
 * Lets a click land the caret exactly where the pointer was rather than at the start or end
 * of the text. Two spellings exist — the standard `caretPositionFromPoint` and WebKit/Blink's
 * older `caretRangeFromPoint` — and jsdom implements neither, hence the null fallback.
 */
function caretOffsetAtPoint(x: number, y: number, root: HTMLElement): number | null {
  const doc = root.ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  try {
    if (typeof doc.caretPositionFromPoint === "function") {
      const pos = doc.caretPositionFromPoint(x, y);
      if (pos && root.contains(pos.offsetNode)) return pos.offset;
    }
    if (typeof doc.caretRangeFromPoint === "function") {
      const range = doc.caretRangeFromPoint(x, y);
      if (range && root.contains(range.startContainer)) return range.startOffset;
    }
  } catch { /* unsupported — fall through */ }
  return null;
}

// ── Single step row ───────────────────────────────────────────────────────────

function StepRow({
  step,
  position,
  onUpdate,
  onDelete,
  onConvertToActionItem,
  onAddToCalendar,
  dragging,
  showIndicatorBefore,
  onDragStart,
  onDragOverRow,
  onDrop,
  onDragEnd,
}: {
  step: ActionItemStep;
  /** 1-based position in the full checklist, so numbers stay stable when items are hidden. */
  position: number;
  onUpdate: (id: number, data: Partial<Pick<ActionItemStep, "title" | "status" | "order">>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onConvertToActionItem?: (step: ActionItemStep) => Promise<void>;
  onAddToCalendar?: (step: ActionItemStep) => Promise<void>;
  /** This row is the one being dragged. */
  dragging?: boolean;
  /** Show the insertion line above this row. */
  showIndicatorBefore?: boolean;
  onDragStart?: () => void;
  onDragOverRow?: (dropAbove: boolean) => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(step.title);
  const [showComments, setShowComments] = useState(false);
  const [converting, setConverting] = useState(false);
  const [addingToCal, setAddingToCal] = useState(false);
  // Where to drop the caret when editing opens: a character offset, or null for end-of-text.
  const [caretAt, setCaretAt] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const done = isDone(step);

  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // Land the caret at the clicked character rather than selecting the whole value.
    const at = caretAt ?? input.value.length;
    const clamped = Math.max(0, Math.min(at, input.value.length));
    input.setSelectionRange(clamped, clamped);
  }, [editing, caretAt]);

  useEffect(() => { setEditTitle(step.title); }, [step.title]);

  /** Single click anywhere on the line starts editing — except on the row's own controls. */
  function handleLineClick(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest(ROW_CONTROLS)) return;
    if (editing) return;
    const root = titleRef.current;
    setCaretAt(root ? caretOffsetAtPoint(e.clientX, e.clientY, root) : null);
    setEditing(true);
  }

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
    <div
      className="group"
      onDragOver={onDragOverRow ? (e) => {
        e.preventDefault();
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        onDragOverRow(e.clientY < r.top + r.height / 2);
      } : undefined}
      onDrop={onDrop ? (e) => { e.preventDefault(); e.stopPropagation(); onDrop(); } : undefined}
    >
      {showIndicatorBefore && <StepDropIndicator />}
      <div
        onClick={handleLineClick}
        className={`flex items-start gap-2 py-1.5 transition-opacity ${dragging ? "opacity-40" : ""} ${editing ? "" : "cursor-text"}`}
      >
        {/* Drag handle — only the handle starts a drag, so the row's inputs and buttons
            keep working normally. */}
        <span
          draggable={!!onDragStart}
          onDragStart={onDragStart ? (e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(); } : undefined}
          onDragEnd={onDragEnd}
          title="Drag to reorder"
          aria-label={`Reorder ${step.title || "step"}`}
          role={onDragStart ? "button" : undefined}
          className={`shrink-0 pt-1 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity ${onDragStart ? "cursor-grab active:cursor-grabbing" : ""}`}
        >
          <svg viewBox="0 0 8 12" fill="currentColor" className="w-2 h-3">
            <circle cx="2" cy="2" r="1" /><circle cx="6" cy="2" r="1" />
            <circle cx="2" cy="6" r="1" /><circle cx="6" cy="6" r="1" />
            <circle cx="2" cy="10" r="1" /><circle cx="6" cy="10" r="1" />
          </svg>
        </span>

        <span className="shrink-0 text-xs tabular-nums text-[var(--twilio-gray-60)] w-4 text-right leading-5">
          {position}.
        </span>

        <span className="pt-0.5">
          <StepCheckbox done={done} onToggle={() => onUpdate(step.id, { status: done ? "Open" : "Done" })} />
        </span>

        {/* Title */}
        <div ref={titleRef} className="flex-1 min-w-0">
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
              className={`text-sm ${done ? "line-through text-gray-400" : ""}`}
              title="Click to edit"
            >
              {step.title || <span className="italic opacity-40">Untitled step</span>}
            </span>
          )}
        </div>

        {/* Action buttons — visible on hover */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
          {/* Comment */}
          <button
            type="button"
            onClick={() => setShowComments((v) => !v)}
            title="Comments"
            aria-label="Comments"
            className={`p-0.5 rounded hover:bg-gray-100 transition-colors outline-none focus:outline-none focus-visible:outline-none ${showComments ? "text-indigo-600" : "text-gray-400"}`}
          >
            <CommentIcon className="w-3 h-3" />
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
        <div className="ml-10 mt-1 mb-2">
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
  const { steps, loading, addStep, updateStep, deleteStep, reorderSteps } = useActionItemSteps(actionItemId);
  const [newTitle, setNewTitle] = useState("");
  const [hideChecked, setHideChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Drag to reorder ─────────────────────────────────────────────────────────
  const [dragId, setDragId] = useState<number | null>(null);
  // Where the dragged row would land: insert above this id, or at the end when null.
  const [dropBeforeId, setDropBeforeId] = useState<number | null>(null);
  // Applied straight away on drop so the numbers move under the cursor, then dropped once
  // the refetch confirms the server agrees.
  const [pendingIds, setPendingIds] = useState<number[] | null>(null);

  /**
   * The list to render: the server order, or the optimistic one while a reorder is in
   * flight. Steps missing from `pendingIds` (added elsewhere since the drag began) are
   * appended rather than vanishing.
   */
  const orderedSteps = (() => {
    if (!pendingIds) return steps;
    const byId = new Map(steps.map((s) => [s.id, s]));
    const listed = pendingIds.map((id) => byId.get(id)).filter((s): s is ActionItemStep => !!s);
    const seen = new Set(listed.map((s) => s.id));
    return [...listed, ...steps.filter((s) => !seen.has(s.id))];
  })();

  const doneCount = orderedSteps.filter(isDone).length;
  const percent = orderedSteps.length > 0 ? Math.round((doneCount / orderedSteps.length) * 100) : 0;
  // Numbers come from the full list, so hiding checked items leaves gaps (1, 3, 4) rather
  // than silently renumbering the survivors — the gap is the cue that something is hidden.
  const visible = hideChecked ? orderedSteps.filter((s) => !isDone(s)) : orderedSteps;

  function resetDrag() {
    setDragId(null);
    setDropBeforeId(null);
  }

  /** Commit the drag: splice the dragged id in at the indicator and persist. */
  async function handleDropReorder() {
    const moving = dragId;
    const before = dropBeforeId;
    resetDrag();
    if (moving == null) return;

    const ids = orderedSteps.map((s) => s.id);
    const without = ids.filter((id) => id !== moving);
    // `before` refers to a visible row, but the index must be into the full list so the
    // order stays correct even while checked items are hidden.
    const at = before != null ? without.indexOf(before) : -1;
    without.splice(at < 0 ? without.length : at, 0, moving);

    if (without.every((id, i) => id === ids[i])) return; // dropped where it already was

    setPendingIds(without);
    try {
      await reorderSteps(without);
    } finally {
      setPendingIds(null);
    }
  }

  /** Commit the draft row and stay focused, so several items can be typed in a row. */
  async function handleAddStep() {
    const t = newTitle.trim();
    if (!t || saving) return;
    setSaving(true);
    try {
      await addStep(t);
      setNewTitle("");
      inputRef.current?.focus();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)]">
          Checklist
          {orderedSteps.length > 0 && (
            <span className="ml-1.5 text-gray-400 font-normal normal-case tracking-normal">
              {doneCount}/{orderedSteps.length}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2 shrink-0">
          {doneCount > 0 && (
            <button
              type="button"
              onClick={() => setHideChecked((v) => !v)}
              className="text-[10px] font-semibold text-[var(--twilio-gray-60)] hover:text-[var(--twilio-navy)] transition-colors"
            >
              {hideChecked ? `Show checked items (${doneCount})` : "Hide checked items"}
            </button>
          )}
          {/* The draft row is always visible, so this is just a jump-to-it shortcut for
              when the list is long enough to scroll. */}
          <button
            type="button"
            onClick={() => inputRef.current?.focus()}
            className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
          >
            + Add step
          </button>
        </div>
      </div>

      {/* Progress: percentage label beside the bar, as on a Trello checklist. */}
      {orderedSteps.length > 0 && (
        <div className="flex items-center gap-2 mb-3">
          <span
            className="text-[10px] tabular-nums text-[var(--twilio-gray-60)] w-8 shrink-0"
            aria-label={`${percent}% complete`}
          >
            {percent}%
          </span>
          <div
            className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={`h-full rounded-full transition-all ${percent === 100 ? "bg-emerald-500" : "bg-indigo-500"}`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}

      {loading && <p className="text-xs text-gray-400 py-2 text-center italic">Loading…</p>}

      {/* Step list */}
      <div className="divide-y divide-gray-50">
        {visible.map((step) => (
          <StepRow
            key={step.id}
            step={step}
            position={orderedSteps.indexOf(step) + 1}
            onUpdate={updateStep}
            onDelete={deleteStep}
            onConvertToActionItem={onConvertToActionItem}
            onAddToCalendar={onAddToCalendar}
            dragging={dragId === step.id}
            showIndicatorBefore={dragId != null && dragId !== step.id && dropBeforeId === step.id}
            onDragStart={() => setDragId(step.id)}
            onDragOverRow={(dropAbove) => {
              if (dragId == null || dragId === step.id) return;
              // Hovering the lower half means "after this row", i.e. before the next
              // visible one — or the end of the list if this is the last row.
              if (dropAbove) {
                setDropBeforeId(step.id);
              } else {
                const i = visible.findIndex((s) => s.id === step.id);
                setDropBeforeId(visible[i + 1]?.id ?? null);
              }
            }}
            onDrop={() => void handleDropReorder()}
            onDragEnd={resetDrag}
          />
        ))}
      </div>

      {!loading && orderedSteps.length > 0 && visible.length === 0 && (
        <p className="text-xs text-gray-400 italic text-center py-2">
          All {orderedSteps.length} steps are done.
        </p>
      )}

      {/* Draft row — always present, styled as a greyed-out italic preview of the next item.
          There is no empty state and no "Add" step to click first: the row is a real input,
          so you can click straight into it and type. Enter (or blurring with text) commits
          and keeps focus here, so several items can be added in sequence. */}
      {!loading && (
        <div className="flex items-start gap-2 py-1.5">
          <span className="shrink-0 text-xs tabular-nums text-gray-300 w-4 text-right leading-5">
            {orderedSteps.length + 1}.
          </span>
          <span className="pt-0.5">
            <span className="block shrink-0 w-4 h-4 rounded border-2 border-gray-200" aria-hidden="true" />
          </span>
          <input
            ref={inputRef}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onBlur={() => { if (newTitle.trim()) void handleAddStep(); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); void handleAddStep(); }
              if (e.key === "Escape") { setNewTitle(""); inputRef.current?.blur(); }
            }}
            disabled={saving}
            aria-label="Add a checklist item"
            placeholder="Add an item…"
            className="flex-1 min-w-0 text-sm bg-transparent border-b border-transparent focus:border-indigo-400 focus:outline-none pb-0.5 placeholder:italic placeholder:text-gray-400 disabled:opacity-50"
          />
        </div>
      )}

      {actionItemTitle && (
        <p className="text-[10px] text-gray-400 mt-3 italic">
          Checklist on "{actionItemTitle}" · not synced to Airtable
        </p>
      )}
    </div>
  );
}
