import { useState } from "react";

/** The ARR figure, hidden until the eye is clicked. Revealed state is local to this mounted
 *  instance and is never persisted, so every load (and, via `key`, every account) starts hidden. */
export default function MaskedArrValue({ value }: { value: string | null | undefined }) {
  const [revealed, setRevealed] = useState(false);
  const has = value !== null && value !== undefined && value !== "";
  if (!has) {
    return <span style={{ color: "var(--twilio-gray-60)", fontStyle: "italic", fontSize: "0.75rem" }}>—</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-xs" data-testid="arr-value">{revealed ? `$${Number(value).toLocaleString()}` : "$••••••"}</span>
      <button
        type="button"
        aria-pressed={revealed}
        aria-label={revealed ? "Hide ARR" : "Show ARR"}
        title={revealed ? "Hide ARR" : "Show ARR"}
        onClick={(e) => { e.stopPropagation(); setRevealed((v) => !v); }}
        className="inline-flex items-center justify-center hover:opacity-70"
        style={{ color: "var(--twilio-gray-60)" }}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M1.5 8s2.3-4.5 6.5-4.5S14.5 8 14.5 8 12.2 12.5 8 12.5 1.5 8 1.5 8z" />
          <circle cx="8" cy="8" r="1.8" />
          {!revealed && <path d="M2.5 13.5l11-11" />}
        </svg>
      </button>
    </span>
  );
}
