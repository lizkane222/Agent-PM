/**
 * Reports the outcome of a Cloud Coach project-membership push.
 *
 * A dedicated component rather than `useAppError` because `reportError` is that context's
 * entire surface — it has no notion of a success — and these pushes have a success worth
 * confirming ("Jane added to Acme Rollout in Cloud Coach"). Failures are still *also* sent
 * to `reportError` by the callers, so they reach the error log.
 *
 * Renders nothing when there is nothing to say, so no surface changes on a no-op.
 */

import { useEffect, useRef, useState } from "react";
import type { CloudCoachPushResult } from "../../lib/cloudCoachPush";
import { isPushOk, summarizePushes } from "../../lib/cloudCoachPush";

export const PUSH_TOAST_DISMISS_MS = 6000;

interface Props {
  results: CloudCoachPushResult[] | null;
  onClose: () => void;
  autoDismissMs?: number;
}

export default function CloudCoachPushToast({
  results,
  onClose,
  autoDismissMs = PUSH_TOAST_DISMISS_MS,
}: Props) {
  const [paused, setPaused] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const items = results ?? [];
  const show = items.length > 0;

  useEffect(() => {
    if (!show || paused || autoDismissMs <= 0) return;
    const timer = setTimeout(() => onCloseRef.current(), autoDismissMs);
    return () => clearTimeout(timer);
  }, [show, paused, autoDismissMs]);

  if (!show) return null;

  // Tone follows the worst outcome in the batch: a single failure among successes still
  // needs to read as needing attention.
  const allOk = items.every(isPushOk);

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="cloud-coach-toast"
      data-tone={allOk ? "ok" : "warn"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={[
        "fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border px-4 py-3 shadow-lg",
        allOk
          ? "bg-emerald-50 border-emerald-300"
          : "bg-amber-50 border-amber-300",
      ].join(" ")}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={[
            "mt-0.5 h-1.5 w-1.5 rounded-full shrink-0",
            allOk ? "bg-emerald-500" : "bg-amber-500",
          ].join(" ")}
        />
        <div className="min-w-0">
          <p
            className={[
              "text-xs font-semibold",
              allOk ? "text-emerald-900" : "text-amber-900",
            ].join(" ")}
          >
            {summarizePushes(items)}
          </p>
          {items.length > 1 && (
            <ul className="mt-1 space-y-0.5">
              {items.map((item, i) => (
                <li key={`${item.member_name ?? ""}-${i}`} className="text-[11px] text-gray-600">
                  {item.message || item.status}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Dismiss"
          className="shrink-0 text-gray-400 hover:text-gray-600 text-sm leading-none"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
