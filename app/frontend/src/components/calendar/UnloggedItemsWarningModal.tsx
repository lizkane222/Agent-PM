/**
 * Temporary popup shown after Log Week, naming what did *not* reach Cloud Coach.
 *
 * Renders nothing when the week logged cleanly, so the happy path is unchanged.
 * Auto-dismisses, because this is a notice rather than a decision — but the close
 * button and a backdrop click work immediately, and hovering pauses the timer so a
 * long list can actually be read.
 */

import { useEffect, useRef, useState } from "react";
import type { SkippedEvent, WeekPlanReport } from "../../lib/logWeek";
import { hasWarnings } from "../../lib/logWeek";

export const AUTO_DISMISS_MS = 8000;

/** How many titles to name before collapsing the rest into "+N more". */
const TITLE_PREVIEW_LIMIT = 4;

interface Props {
  report: WeekPlanReport | null;
  onClose: () => void;
  /** Escape hatch for tests and for a caller that wants it to stay put. */
  autoDismissMs?: number;
}

interface Category {
  key: string;
  count: number;
  events: SkippedEvent[];
  label: string;
  hint: string;
}

function titleList(events: SkippedEvent[]): string {
  const shown = events.slice(0, TITLE_PREVIEW_LIMIT).map((e) => e.title || "(untitled)");
  const extra = events.length - shown.length;
  return extra > 0 ? `${shown.join(", ")} +${extra} more` : shown.join(", ");
}

export default function UnloggedItemsWarningModal({ report, onClose, autoDismissMs = AUTO_DISMISS_MS }: Props) {
  const [paused, setPaused] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const show = hasWarnings(report);

  useEffect(() => {
    if (!show || paused || autoDismissMs <= 0) return;
    const timer = setTimeout(() => onCloseRef.current(), autoDismissMs);
    return () => clearTimeout(timer);
  }, [show, paused, autoDismissMs]);

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show]);

  if (!show || !report) return null;

  const categories: Category[] = [
    {
      key: "unlinked",
      count: report.unlinked_count,
      events: report.unlinked_events,
      label: "not linked to an account",
      hint: "Link them to an account, then run Log Week again.",
    },
    {
      key: "not_attended",
      count: report.not_attended_count,
      events: report.not_attended_events,
      label: "marked did not attend",
      hint: "These were skipped on purpose.",
    },
    // Not one of the two categories asked for, but these events also fail to log —
    // reporting a drop rather than swallowing it. Hidden entirely when the count is 0.
    {
      key: "no_project",
      count: report.account_without_project_count,
      events: report.account_without_project,
      label: "linked to an account with no Cloud Coach project",
      hint: "Add the Salesforce project id on the account's project, or check you hold a role on it.",
    },
  ].filter((c) => c.count > 0);

  const noun = (n: number) => (n === 1 ? "calendar item" : "calendar items");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
      data-testid="unlogged-warning-backdrop"
    >
      <div
        role="alertdialog"
        aria-label="Some calendar items were not logged"
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[var(--twilio-navy)]">
              Not everything was logged
            </h2>
            <p className="text-xs text-[var(--twilio-gray-60)] mt-0.5">
              {report.logged > 0
                ? `${report.total_hours} hrs logged to Cloud Coach across ${report.entry_count} ${report.entry_count === 1 ? "entry" : "entries"}.`
                : "Nothing was logged to Cloud Coach."}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Dismiss"
            className="shrink-0 text-[var(--twilio-gray-60)] hover:text-[var(--twilio-gray-80)] text-xl leading-none"
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-4 space-y-3">
          {categories.map((c) => (
            <div key={c.key} data-testid={`warning-${c.key}`} className="flex gap-2.5">
              <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[var(--twilio-navy)]">
                  {c.count} {noun(c.count)} {c.label}
                </p>
                <p className="text-[11px] text-[var(--twilio-gray-60)] break-words">
                  {titleList(c.events)}
                </p>
                <p className="text-[11px] text-gray-400 mt-0.5">{c.hint}</p>
              </div>
            </div>
          ))}

          {report.already_logged_count > 0 && (
            <p data-testid="warning-already-logged" className="text-[11px] text-gray-400">
              {report.already_logged_count} already logged earlier — not written again.
            </p>
          )}

          {report.fields_skipped.length > 0 && (
            <p data-testid="warning-fields-skipped" className="text-[11px] text-gray-400">
              Salesforce fields not present in your org, so left blank:{" "}
              {report.fields_skipped.join(", ")}.
            </p>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold bg-[var(--twilio-navy)] text-white hover:opacity-90"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
