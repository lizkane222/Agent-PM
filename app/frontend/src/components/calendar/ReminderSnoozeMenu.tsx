import { useState } from "react";
import { fromLocalDatetimeValue, nextHourLocalValue } from "../../lib/datetimeLocal";
import { snoozeOptions, type SnoozeOption } from "../../lib/reminderSnooze";

export type SnoozeRequest = ({ until: string } | { preset: "next_account_meeting" }) & { from?: string };

interface Props {
  /** The current time; the options' times are computed from it. */
  now: Date;
  /** Whether the reminder is linked to an account ("before next account meeting" needs one). */
  hasAccount: boolean;
  accent: string;
  /** Resolves to an error message to show, or null on success (the menu is then closed by the parent). */
  onSnooze: (request: SnoozeRequest) => Promise<string | null>;
  onClose: () => void;
}

function whenLabel(d: Date, now: Date): string {
  const sameDay = d.toDateString() === now.toDateString();
  return d.toLocaleString(undefined, sameDay
    ? { hour: "numeric", minute: "2-digit" }
    : { weekday: "short", hour: "numeric", minute: "2-digit" });
}

/**
 * Reschedule a reminder. "Custom" is listed first and reveals a date/time field; the ready-made
 * choices follow. Nothing is applied until a choice is clicked (or Snooze on the custom time).
 */
export default function ReminderSnoozeMenu({ now, hasAccount, accent, onSnooze, onClose }: Props) {
  const [custom, setCustom] = useState(false);
  const [customValue, setCustomValue] = useState(() => nextHourLocalValue(now));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(request: SnoozeRequest) {
    setBusy(true);
    setError(null);
    const message = await onSnooze(request);
    setBusy(false);
    if (message) setError(message);
  }

  const customInstant = fromLocalDatetimeValue(customValue);
  const customInFuture = !!customInstant && new Date(customInstant).getTime() > now.getTime();

  function choose(o: SnoozeOption) {
    if (o.disabled || busy) return;
    void run(o.preset ? { preset: o.preset } : { until: o.until!.toISOString() });
  }

  const row = "w-full text-left px-2 py-1 text-[11px] rounded transition-colors";
  return (
    <div
      role="menu"
      aria-label="Snooze until"
      className="mt-1 rounded-md border bg-white py-1 flex flex-col"
      style={{ borderColor: accent }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button" role="menuitem" aria-expanded={custom} onClick={() => setCustom((v) => !v)}
        className={`${row} font-semibold hover:bg-gray-50`}
      >Custom…</button>
      {custom && (
        <div className="px-2 pb-1.5 flex items-center gap-1.5">
          <input
            type="datetime-local" aria-label="Snooze until"
            value={customValue} onChange={(e) => setCustomValue(e.target.value)}
            className="flex-1 min-w-0 text-[11px] rounded border px-1.5 py-1 bg-white" style={{ borderColor: accent }}
          />
          <button
            type="button" disabled={busy || !customInFuture}
            title={customInFuture ? undefined : "Pick a time in the future."}
            onClick={() => void run({ until: customInstant })}
            className="px-2 py-1 text-[11px] font-semibold rounded-md disabled:opacity-40 text-white" style={{ background: accent }}
          >Snooze</button>
        </div>
      )}
      {snoozeOptions(now, { hasAccount }).map((o) => (
        <button
          key={o.key} type="button" role="menuitem" disabled={o.disabled || busy}
          title={o.disabled ? o.reason : undefined}
          onClick={() => choose(o)}
          className={`${row} flex items-center justify-between gap-2 ${o.disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-gray-50"}`}
        >
          <span>{o.label}</span>
          {o.until && <span className="text-[10px] text-[var(--twilio-gray-60)]">{whenLabel(o.until, now)}</span>}
        </button>
      ))}
      {error && <p role="alert" className="px-2 pt-1 text-[11px] text-red-600">{error}</p>}
      <button type="button" onClick={onClose} className="self-end px-2 pt-1 text-[10px] text-[var(--twilio-gray-60)] hover:text-[var(--twilio-navy)]">Cancel</button>
    </div>
  );
}
