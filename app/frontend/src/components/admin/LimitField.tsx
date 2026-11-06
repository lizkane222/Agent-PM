import { useEffect, useState } from "react";
import type { LimitView } from "../../types/tokenBudget";

/** What the admin typed, in whichever unit they used. `null` clears the limit. */
export type LimitEdit = { unit: "tokens"; value: number | null } | { unit: "usd"; value: string | null };

/**
 * One limit, always shown in tokens AND dollars. The admin may type either; the other updates
 * live from the blended rate, as a preview only — the server does the real conversion, so what is
 * saved is always exactly what the server reports back.
 */
export default function LimitField({
  label, value, blendedUsdPerMillion, onEdit, disabled,
}: {
  label: string;
  value: LimitView;
  blendedUsdPerMillion: number;
  onEdit: (edit: LimitEdit | undefined) => void;
  disabled?: boolean;
}) {
  const [tokens, setTokens] = useState(value.tokens === null ? "" : String(value.tokens));
  const [usd, setUsd] = useState(value.usd === null ? "" : trimUsd(value.usd));

  // Follow the server whenever it reports a new value (after a save, or a rate change).
  useEffect(() => {
    setTokens(value.tokens === null ? "" : String(value.tokens));
    setUsd(value.usd === null ? "" : trimUsd(value.usd));
  }, [value.tokens, value.usd]);

  const perToken = blendedUsdPerMillion / 1_000_000;

  function editTokens(raw: string) {
    const clean = raw.replace(/[^\d]/g, "");
    setTokens(clean);
    if (clean === "") { setUsd(""); onEdit({ unit: "tokens", value: null }); return; }
    setUsd(trimUsd((Number(clean) * perToken).toFixed(4)));
    onEdit({ unit: "tokens", value: Number(clean) });
  }
  function editUsd(raw: string) {
    const clean = raw.replace(/[^\d.]/g, "");
    setUsd(clean);
    if (clean === "" || clean === ".") { setTokens(""); onEdit({ unit: "usd", value: null }); return; }
    setTokens(perToken > 0 ? String(Math.round(Number(clean) / perToken)) : "");
    onEdit({ unit: "usd", value: clean });
  }

  const input = "w-full rounded border border-gray-300 px-2 py-1 text-sm tabular-nums focus:border-indigo-500 focus:outline-none disabled:bg-gray-50";
  return (
    <div className="flex items-center gap-2" data-testid={`limit-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <label className="flex-1 min-w-[96px]">
        <span className="sr-only">{label} tokens</span>
        <input className={input} inputMode="numeric" placeholder="not set" value={tokens} disabled={disabled}
          onChange={(e) => editTokens(e.target.value)} aria-label={`${label} tokens`} />
      </label>
      <span className="text-xs text-gray-400">tokens ≈</span>
      <label className="w-24">
        <span className="sr-only">{label} dollars</span>
        <div className="relative">
          <span className="absolute left-2 top-1 text-sm text-gray-400">$</span>
          <input className={`${input} pl-5`} inputMode="decimal" placeholder="—" value={usd} disabled={disabled}
            onChange={(e) => editUsd(e.target.value)} aria-label={`${label} dollars`} />
        </div>
      </label>
    </div>
  );
}

function trimUsd(s: string): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n >= 1 ? n.toFixed(2) : String(Number(n.toFixed(4)));
}

