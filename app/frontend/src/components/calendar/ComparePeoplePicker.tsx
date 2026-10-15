import { useEffect, useRef, useState } from "react";
import { teamApi } from "../../lib/api";
import { COMPARE_PALETTE, MAX_COMPARE_PEOPLE, type PersonAvailability } from "../../lib/availability";
import type { TeamMember } from "../../types";

export interface ComparedPerson { email: string; name: string; color: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "Search for people" — pick teammates (or type any work email) to overlay their busy time.
 * Chips show who is compared, in their overlay colour, with any availability error inline
 * (e.g. Google not connected, address not found) so a missing calendar never looks "free".
 */
export default function ComparePeoplePicker({
  people,
  onChange,
  availability,
  showFreeSlots,
  onToggleFreeSlots,
}: {
  people: ComparedPerson[];
  onChange: (next: ComparedPerson[]) => void;
  availability: PersonAvailability[];
  showFreeSlots: boolean;
  onToggleFreeSlots: () => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<TeamMember[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const params: Record<string, string> = query.trim() ? { search: query.trim() } : {};
      teamApi.listMembers(params)
        .then(({ data }) => setResults((data.results ?? []).filter((m) => !!m.email)))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const chosen = new Set(people.map((p) => p.email.toLowerCase()));
  const full = people.length >= MAX_COMPARE_PEOPLE;

  function add(email: string, name: string) {
    const key = email.trim().toLowerCase();
    if (!key || chosen.has(key) || full) return;
    const used = new Set(people.map((p) => p.color));
    const color = COMPARE_PALETTE.find((c) => !used.has(c)) ?? COMPARE_PALETTE[people.length % COMPARE_PALETTE.length];
    onChange([...people, { email: key, name: name || key, color }]);
    setQuery("");
  }

  const typedEmail = EMAIL_RE.test(query.trim()) && !chosen.has(query.trim().toLowerCase()) ? query.trim() : null;
  const errorFor = (email: string) => availability.find((a) => a.email === email)?.error ?? null;

  return (
    <div ref={boxRef} className="relative flex items-center gap-1.5 flex-wrap">
      <div className="flex items-center gap-1.5 rounded-full px-3 py-2 border border-gray-300 bg-white shadow-sm w-52 focus-within:border-indigo-400">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-3.5 h-3.5 shrink-0 text-gray-400">
          <circle cx="7" cy="7" r="3" /><path d="M2 17c0-3 2.5-5 5-5s5 2 5 5" strokeLinecap="round" />
          <circle cx="14" cy="6" r="2.5" /><path d="M13 11.5c3 0 5 1.8 5 4.5" strokeLinecap="round" />
        </svg>
        <input
          aria-label="Search for people"
          placeholder={full ? `Up to ${MAX_COMPARE_PEOPLE} people` : "Search for people…"}
          disabled={full}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && typedEmail) { add(typedEmail, typedEmail); setOpen(false); }
            if (e.key === "Escape") setOpen(false);
          }}
          className="flex-1 min-w-0 text-sm bg-transparent outline-none text-[var(--twilio-navy)] placeholder:text-gray-400 disabled:cursor-not-allowed"
        />
      </div>

      {people.map((p) => {
        const err = errorFor(p.email);
        return (
          <span
            key={p.email}
            data-testid="compared-person"
            title={err ? `No calendar shown for ${p.email}: ${err.replace(/_/g, " ")}` : p.email}
            className="inline-flex items-center gap-1 rounded-full pl-2 pr-1 py-1 text-xs font-medium border bg-white shadow-sm"
            style={{ borderColor: p.color, color: p.color }}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
            <span className="max-w-[9rem] truncate">{p.name}</span>
            {err && <span className="text-amber-600" aria-label="calendar unavailable">⚠</span>}
            <button
              aria-label={`Stop comparing ${p.name}`}
              onClick={() => onChange(people.filter((x) => x.email !== p.email))}
              className="ml-0.5 text-gray-400 hover:text-gray-600 leading-none px-1"
            >
              ✕
            </button>
          </span>
        );
      })}

      {people.length > 0 && (
        <button
          onClick={onToggleFreeSlots}
          aria-pressed={showFreeSlots}
          className={[
            "rounded-full px-3 py-1 text-xs font-semibold border shadow-sm transition-colors",
            showFreeSlots ? "bg-emerald-600 border-emerald-600 text-white" : "bg-white border-gray-300 text-[var(--twilio-navy)] hover:bg-gray-50",
          ].join(" ")}
        >
          Find free time
        </button>
      )}

      {open && !full && (
        <div data-testid="people-results" className="absolute left-0 top-full mt-1 w-72 max-h-72 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl z-40 py-1">
          {typedEmail && (
            <button
              onClick={() => { add(typedEmail, typedEmail); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-indigo-50"
            >
              Compare <span className="font-medium">{typedEmail}</span>
            </button>
          )}
          {results.filter((m) => !chosen.has(m.email.toLowerCase())).map((m) => (
            <button
              key={m.id}
              onClick={() => { add(m.email, m.full_name); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 hover:bg-indigo-50"
            >
              <p className="text-sm font-medium text-[var(--twilio-navy)] truncate">{m.full_name || m.email}</p>
              <p className="text-[11px] text-gray-500 truncate">{m.title ? `${m.title} · ` : ""}{m.email}</p>
            </button>
          ))}
          {!typedEmail && results.length === 0 && (
            <p className="px-3 py-2 text-xs text-gray-500">No teammates match. Type a full email to compare anyone.</p>
          )}
        </div>
      )}
    </div>
  );
}
