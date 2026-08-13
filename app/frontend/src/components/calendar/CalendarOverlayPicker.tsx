import { useEffect, useRef, useState } from "react";
import { teamApi } from "../../lib/api";
import type { CalendarOverlay, OverlayUser } from "../../hooks/useCalendarOverlay";
import type { TeamMember } from "../../types";

interface Props {
  overlays: CalendarOverlay[];
  onAdd: (user: OverlayUser) => void;
  onRemove: (username: string) => void;
  nextColor: () => string;
}

export default function CalendarOverlayPicker({ overlays, onAdd, onRemove, nextColor }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TeamMember[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params: Record<string, string> = {};
      if (query.trim()) params.search = query.trim();
      teamApi
        .listMembers(params)
        .then(({ data }) => {
          setResults((data.results ?? []).filter((m) => !!m.username));
        })
        .catch(() => setResults([]));
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open]);

  // Load initial results when panel opens
  useEffect(() => {
    if (!open) return;
    teamApi
      .listMembers({})
      .then(({ data }) => {
        setResults((data.results ?? []).filter((m) => !!m.username));
      })
      .catch(() => setResults([]));
  }, [open]);

  const addedUsernames = new Set(overlays.map((o) => o.user.username));
  const isActive = open || overlays.length > 0;

  return (
    <div className="relative" ref={panelRef}>
      {/* Toggle button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={[
          "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border shadow-sm transition-colors",
          isActive
            ? "bg-violet-600 border-violet-600 text-white shadow-md"
            : "bg-white border-gray-300 text-[var(--twilio-navy)] hover:bg-gray-50 hover:border-violet-300",
        ].join(" ")}
      >
        {/* Person-group SVG icon */}
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-3.5 h-3.5 shrink-0">
          <path d="M7 9a3 3 0 100-6 3 3 0 000 6z" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M1 18c0-3.314 2.686-6 6-6s6 2.686 6 6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14.5 7a2.5 2.5 0 110-5 2.5 2.5 0 010 5z" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M19 18c0-2.761-2.015-5-4.5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Team Calendars
        {overlays.length > 0 && (
          <span className="ml-1 flex items-center justify-center w-5 h-5 rounded-full bg-white text-violet-700 text-[10px] font-bold">
            {overlays.length}
          </span>
        )}
      </button>

      {/* Floating panel */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-2xl bg-white border border-gray-200 shadow-xl z-50">
          <div className="p-4">
            <p className="text-sm font-semibold text-gray-800 mb-3">Overlay team calendars</p>

            {/* Search input */}
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search teammates…"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-400 mb-3"
            />

            {/* Search results */}
            {results.length > 0 && (
              <ul className="max-h-48 overflow-y-auto divide-y divide-gray-100 mb-3 rounded-lg border border-gray-100">
                {results.map((m) => {
                  const isAdded = addedUsernames.has(m.username!);
                  return (
                    <li key={m.id}>
                      <button
                        disabled={isAdded}
                        onClick={() => {
                          if (!m.username) return;
                          onAdd({
                            username: m.username,
                            displayName: m.full_name || m.username,
                            avatarUrl: m.avatar_url ?? "",
                            color: nextColor(),
                          });
                        }}
                        className={[
                          "w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors",
                          isAdded
                            ? "opacity-50 cursor-not-allowed bg-gray-50"
                            : "hover:bg-violet-50 cursor-pointer",
                        ].join(" ")}
                      >
                        {/* Avatar or initial */}
                        {m.avatar_url ? (
                          <img src={m.avatar_url} alt={m.full_name} className="w-7 h-7 rounded-full object-cover shrink-0" />
                        ) : (
                          <span className="w-7 h-7 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center shrink-0">
                            {(m.full_name || m.username || "?")[0].toUpperCase()}
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-gray-800 truncate">{m.full_name || m.username}</div>
                          {m.title && <div className="text-xs text-gray-500 truncate">{m.title}</div>}
                        </div>
                        {isAdded && (
                          <span className="text-xs text-gray-400 shrink-0">Added</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Current overlays */}
            {overlays.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Showing</p>
                <ul className="space-y-1">
                  {overlays.map(({ user }) => (
                    <li key={user.username} className="flex items-center gap-2 px-1">
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: user.color }}
                      />
                      <span className="flex-1 text-sm text-gray-700 truncate">{user.displayName}</span>
                      <button
                        onClick={() => onRemove(user.username)}
                        className="text-gray-400 hover:text-red-500 transition-colors text-base leading-none shrink-0"
                        title={`Remove ${user.displayName}`}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
