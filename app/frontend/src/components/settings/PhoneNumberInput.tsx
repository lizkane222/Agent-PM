import { useEffect, useState } from "react";
import { COUNTRY_CODES, isValidE164, joinE164, splitE164 } from "../../lib/phone";

/** Country code + national number, emitting E.164 ("+14155550123") through `onChange`. */
export default function PhoneNumberInput({ value, onChange }: { value: string; onChange: (e164: string) => void }) {
  const [iso, setIso] = useState(() => splitE164(value).iso);
  const [national, setNational] = useState(() => splitE164(value).national);

  // Re-seed when the stored value changes from outside (profile load / save response).
  useEffect(() => {
    if (joinE164(iso, national) === (value ?? "")) return;
    const next = splitE164(value, iso);
    setIso(next.iso);
    setNational(next.national);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const e164 = joinE164(iso, national);
  const invalid = national !== "" && !isValidE164(e164);

  return (
    <div>
      <div className="flex gap-2">
        <select
          aria-label="Country code"
          value={iso}
          onChange={(e) => { setIso(e.target.value); onChange(joinE164(e.target.value, national)); }}
          className="w-28 shrink-0 rounded-md border border-gray-300 px-2 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          {COUNTRY_CODES.map((c) => (
            <option key={c.iso} value={c.iso}>{c.iso} +{c.dial}</option>
          ))}
        </select>
        <input
          type="tel"
          aria-label="Phone number"
          inputMode="tel"
          value={national}
          placeholder="415 555 0123"
          onChange={(e) => { setNational(e.target.value); onChange(joinE164(iso, e.target.value)); }}
          className={[
            "flex-1 min-w-0 rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1",
            invalid ? "border-red-400 focus:border-red-500 focus:ring-red-500" : "border-gray-300 focus:border-indigo-500 focus:ring-indigo-500",
          ].join(" ")}
        />
      </div>
      {invalid && <p className="mt-1 text-xs text-red-600">That doesn't look like a valid number for this country.</p>}
    </div>
  );
}
