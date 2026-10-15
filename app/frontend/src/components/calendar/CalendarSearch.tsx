import { useEffect, useRef, useState } from "react";
import { schedulerApi } from "../../lib/api";
import { MIN_SERVER_QUERY, rankResults, searchWindow } from "../../lib/calendarSearch";
import type { CalendarEvent } from "../../types";

const DEBOUNCE_MS = 250;

function fmtWhen(e: CalendarEvent): string {
  const d = new Date(e.start_datetime);
  const date = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  if (e.all_day) return date;
  return `${date} · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

/**
 * Calendar search box. `onQueryChange` narrows the visible grid as you type (the page owns
 * that filter); the dropdown lists matches across ±1 year from the server's `?search=`, so
 * an event outside the visible week is still findable, and picking one jumps to it.
 */
export default function CalendarSearch({
  query,
  onQueryChange,
  onPick,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  onPick: (event: CalendarEvent) => void;
}) {
  const [results, setResults] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_SERVER_QUERY) {
      setResults([]);
      setLoading(false);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      schedulerApi
        .listEvents({ search: q, ...searchWindow() })
        .then(({ data }) => { if (!cancelled) { setResults(rankResults(data)); setFailed(false); } })
        .catch(() => { if (!cancelled) { setResults([]); setFailed(true); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const showDropdown = open && query.trim().length >= MIN_SERVER_QUERY;

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-1.5 rounded-full px-3 py-2 border border-gray-300 bg-white shadow-sm w-56 focus-within:border-indigo-400">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3.5 h-3.5 shrink-0 text-gray-400">
          <circle cx="9" cy="9" r="6" />
          <path d="M14 14l4 4" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          aria-label="Search calendar"
          placeholder="Search calendar…"
          value={query}
          onChange={(e) => { onQueryChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { onQueryChange(""); setOpen(false); }
            if (e.key === "Enter" && results[0]) { onPick(results[0]); setOpen(false); }
          }}
          className="flex-1 min-w-0 text-sm bg-transparent outline-none text-[var(--twilio-navy)] placeholder:text-gray-400"
        />
        {query && (
          <button
            aria-label="Clear search"
            onClick={() => { onQueryChange(""); setOpen(false); }}
            className="text-gray-400 hover:text-gray-600 leading-none"
          >
            ✕
          </button>
        )}
      </div>

      {showDropdown && (
        <div
          data-testid="calendar-search-results"
          className="absolute right-0 mt-1 w-80 max-h-80 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl z-40 py-1"
        >
          {loading && results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-500">Searching…</p>
          ) : failed ? (
            <p className="px-3 py-2 text-xs text-red-600">Search failed — try again.</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-500">No events match “{query.trim()}”.</p>
          ) : (
            results.map((e) => (
              <button
                key={e.id}
                onClick={() => { onPick(e); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 hover:bg-indigo-50 transition-colors"
              >
                <p className="text-sm font-medium text-[var(--twilio-navy)] truncate">{e.title || "(untitled)"}</p>
                <p className="text-[11px] text-gray-500 truncate">
                  {fmtWhen(e)}{e.account_name ? ` · ${e.account_name}` : ""}
                </p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
