import { useEffect, useId, useState } from "react";
import { describeZone, isValidZone, localTimeLabel, resolveInput, type ZoneSuggestion } from "../../lib/timezones";

/** Re-renders every `ms` so a displayed local time stays current. */
function useNowTick(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/** Small muted "2:14 PM CST" for a contact chip or panel header. Renders nothing without a zone. */
export function ContactLocalTime({ zone, className = "" }: { zone?: string | null; className?: string }) {
  const now = useNowTick();
  if (!zone || !isValidZone(zone)) return null;
  return (
    <span data-testid="contact-local-time" title={zone} className={`text-[10px] text-[var(--twilio-gray-60)] leading-tight ${className}`}>
      {localTimeLabel(zone, now)}
    </span>
  );
}

/**
 * Time zone combobox. Accepts an IANA name, city, abbreviation, US state / Canadian province or a
 * country (name or ISO code), lists matches while typing and stores the resolved IANA name.
 */
export default function TimezoneField({
  value,
  onChange,
  inputId,
}: {
  value: string;
  onChange: (zone: string) => void;
  inputId?: string;
}) {
  const autoId = useId();
  const id = inputId ?? `tz-${autoId}`;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [alternatives, setAlternatives] = useState<ZoneSuggestion[]>([]);
  const now = useNowTick();

  const result = query.trim() ? resolveInput(query) : null;
  const suggestions = result?.suggestions ?? [];

  function commit(s: ZoneSuggestion, alts: ZoneSuggestion[] = []) {
    onChange(s.zone);
    setAlternatives(alts.filter((a) => a.zone !== s.zone));
    setQuery("");
    setOpen(false);
  }

  const inputStyle = { fontSize: "0.8125rem", border: "1px solid var(--border-subtle)", borderRadius: "7px", padding: "7px 10px", outline: "none", color: "var(--text-ink)", width: "100%" } as const;

  return (
    <div className="relative" data-testid="timezone-field">
      {value && isValidZone(value) && (
        <div className="flex items-center justify-between gap-2 mb-1">
          <span data-testid="timezone-resolved" className="text-xs text-[var(--twilio-navy)]">{describeZone(value, now).text}</span>
          <button
            type="button"
            onClick={() => { onChange(""); setAlternatives([]); }}
            className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800"
          >Clear</button>
        </div>
      )}
      {alternatives.length > 0 && (
        <div className="mb-1 text-[11px] text-[var(--twilio-gray-60)]" data-testid="timezone-alternatives">
          Other zone in this state:{" "}
          {alternatives.map((a) => (
            <button key={a.zone} type="button" onClick={() => commit(a)} className="font-semibold text-indigo-600 hover:text-indigo-800 mr-2">{a.label}</button>
          ))}
        </div>
      )}
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        autoComplete="off"
        value={query}
        placeholder="City, state, country or abbreviation (e.g. Chicago, TX, PST)"
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setOpen(false); return; }
          if (e.key === "Enter") {
            e.preventDefault();
            const r = resolveInput(query);
            if (r.zone) {
              const picked = r.suggestions.find((s) => s.zone === r.zone) ?? { zone: r.zone, label: r.zone, kind: "zone" };
              commit(picked, r.alternatives);
            }
          }
        }}
        style={inputStyle}
      />
      {open && suggestions.length > 0 && (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute left-0 right-0 z-20 mt-1 max-h-56 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg text-xs"
        >
          {suggestions.map((s) => {
            const d = describeZone(s.zone, now);
            return (
              <li key={`${s.zone}|${s.label}`} role="option" aria-selected={false}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commit(s, s.hint ? [] : (result?.alternatives ?? []))}
                  className="w-full text-left px-2 py-1.5 hover:bg-indigo-50"
                >
                  <span className="text-[var(--twilio-navy)]">{s.label}</span>
                  {s.hint && <span className="ml-1 text-amber-700">({s.hint})</span>}
                  <span className="block text-[10px] text-[var(--twilio-gray-60)]">{d.abbr} ({d.offset}) · {d.time}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
