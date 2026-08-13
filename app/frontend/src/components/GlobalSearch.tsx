/**
 * GlobalSearch — Cmd+K modal with fuzzy cross-base search + context chat.
 *
 * Usage: mount once in Layout. Opens on Cmd+K or the search button.
 * Dispatches "chat-inject" with selected records as context when the user
 * submits from the bottom chat bar.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { searchApi, type SearchResult } from "../lib/api";
import { useExport, searchResultToExportItem } from "../context/ExportContext";

// How each record type gets its left-border label color
const ACCENT_DEFAULTS: Record<string, string> = {
  action_item:     "#6366f1",
  task:            "#6366f1",
  meeting:         "#0ea5e9",
  calendar_event:  "#0ea5e9",
  airtable_account:"#10b981",
  account:         "#10b981",
  account_note:    "#8b5cf6",
  artifact:        "#ec4899",
  reminder:        "#f59e0b",
  skill:           "#f97316",
};

function useDebounce<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

interface Props {
  pageContext?: string; // e.g. "action_items", "calendar", "accounts"
}

export default function GlobalSearch({ pageContext = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const chatRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const navigate = useNavigate();
  const { toggleItem, isSelected: isExportSelected, exportMode, toggleMode } = useExport();

  const debouncedQuery = useDebounce(query, 220);

  // Open on Cmd+K / Ctrl+K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Also let other components open search via custom event
  useEffect(() => {
    function onOpen() { setOpen(true); }
    window.addEventListener("open-global-search", onOpen);
    return () => window.removeEventListener("open-global-search", onOpen);
  }, []);

  // Focus input when opened — do NOT reset state so re-opening restores context
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Fetch on debounced query change
  useEffect(() => {
    if (!debouncedQuery || debouncedQuery.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    searchApi.search(debouncedQuery, pageContext)
      .then(({ data }) => { setResults(data.results); setFocusedIdx(0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [debouncedQuery, pageContext]);

  const resultKey = (r: SearchResult) => `${r.type}:${r.id}`;

  const toggleSelect = useCallback((r: SearchResult) => {
    const k = resultKey(r);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }, []);

  // Keyboard nav inside list
  function onQueryKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setFocusedIdx((i) => Math.min(i + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setFocusedIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && results[focusedIdx]) {
      toggleSelect(results[focusedIdx]);
    }
    if (e.key === "Tab") { e.preventDefault(); chatRef.current?.focus(); }
  }

  // Scroll focused item into view
  useEffect(() => {
    const el = listRef.current?.children[focusedIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [focusedIdx]);

  function buildContextText(): string {
    const items = results.filter((r) => selected.has(resultKey(r)));
    if (items.length === 0) return "";
    const lines = items.map((r) =>
      `[${r.type_label}] "${r.title}"${r.account ? ` (${r.account})` : ""}${r.meta ? ` — ${r.meta}` : ""}`
    );
    return `Context:\n${lines.join("\n")}\n\n`;
  }

  async function handleChatSubmit() {
    const msg = chatInput.trim();
    if (!msg) return;
    setSending(true);
    const context = buildContextText();
    const full = context + msg;
    window.dispatchEvent(new CustomEvent("chat-inject", { detail: { text: full } }));
    // Reset everything after send — this is the intended clear point
    setQuery("");
    setResults([]);
    setSelected(new Set());
    setChatInput("");
    setFocusedIdx(0);
    setSending(false);
    setOpen(false);
  }

  function handleResultClick(r: SearchResult) {
    // Single click navigates; holding meta/ctrl selects
    navigate(r.url);
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Search (⌘K)"
        className="flex items-center gap-2 text-sm text-[rgba(255,255,255,0.55)] hover:text-white transition-colors px-3 py-2 w-full rounded-md hover:bg-[rgba(255,255,255,0.08)]"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4 shrink-0">
          <circle cx="6.5" cy="6.5" r="4.5" />
          <path d="M10.5 10.5L14 14" strokeLinecap="round" />
        </svg>
        <span>Search</span>
        <kbd className="ml-auto text-[10px] px-1 py-0.5 rounded bg-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.4)] font-mono">⌘K</kbd>
      </button>
    );
  }

  // Group results by type for visual separation
  const grouped: { label: string; items: SearchResult[] }[] = [];
  const seen = new Map<string, number>();
  for (const r of results) {
    const label = r.type_label;
    if (!seen.has(label)) {
      seen.set(label, grouped.length);
      grouped.push({ label, items: [] });
    }
    grouped[seen.get(label)!].items.push(r);
  }

  const flatResults = grouped.flatMap((g) => g.items);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[10vh]"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <div
        className="w-full max-w-2xl mx-4 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ background: "var(--surface, #fff)", maxHeight: "75vh" }}
      >
        {/* Search input row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" className="w-4 h-4 shrink-0 text-gray-400">
            <circle cx="6.5" cy="6.5" r="4.5" />
            <path d="M10.5 10.5L14 14" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onQueryKeyDown}
            placeholder="Search everything… (action items, meetings, accounts, reminders, artifacts)"
            className="flex-1 text-sm outline-none bg-transparent text-[var(--twilio-navy)] placeholder-gray-400"
          />
          {loading && (
            <span className="text-xs text-gray-400 shrink-0 animate-pulse">Searching…</span>
          )}
          {selected.size > 0 && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 shrink-0">
              {selected.size} selected
            </span>
          )}
          {(query || selected.size > 0 || chatInput) && (
            <button
              onClick={() => { setQuery(""); setResults([]); setSelected(new Set()); setChatInput(""); setFocusedIdx(0); inputRef.current?.focus(); }}
              className="text-[11px] px-2 py-0.5 rounded border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-200 transition-colors shrink-0"
              title="Clear search, selections, and chat"
            >
              Clear all
            </button>
          )}
          <kbd
            onClick={() => setOpen(false)}
            className="text-[11px] px-1.5 py-0.5 rounded border border-gray-200 text-gray-400 cursor-pointer hover:bg-gray-50 font-mono shrink-0"
          >
            Esc
          </kbd>
        </div>

        {/* Results list */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {results.length === 0 && query.length >= 2 && !loading && (
            <p className="text-sm text-gray-400 text-center py-10">No results for "{query}"</p>
          )}
          {results.length === 0 && query.length < 2 && (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-gray-400">Type at least 2 characters to search across all bases.</p>
              <p className="text-xs text-gray-300 mt-1">Action items · Meetings · Accounts · Reminders · Artifacts · Skills</p>
            </div>
          )}

          {grouped.length > 0 && (
            <ul ref={listRef} className="py-2">
              {grouped.map((group) => (
                <li key={group.label}>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 px-4 pt-3 pb-1">
                    {group.label}s
                  </p>
                  {group.items.map((r) => {
                    const k = resultKey(r);
                    const isSelected = selected.has(k);
                    const isFocused = flatResults[focusedIdx] && resultKey(flatResults[focusedIdx]) === k;
                    const accent = r.accent || ACCENT_DEFAULTS[r.type] || "#6366f1";
                    return (
                      <div
                        key={k}
                        className={`group flex items-start gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                          isFocused ? "bg-indigo-50" : isSelected ? "bg-indigo-50/60" : "hover:bg-gray-50"
                        }`}
                        onClick={() => toggleSelect(r)}
                      >
                        {/* Select checkbox */}
                        <button
                          className="shrink-0 mt-0.5"
                          onClick={(e) => { e.stopPropagation(); toggleSelect(r); }}
                          title={isSelected ? "Deselect" : "Select for chat context"}
                        >
                          <span className={`flex items-center justify-center w-4 h-4 rounded border transition-colors ${
                            isSelected
                              ? "bg-indigo-600 border-indigo-600"
                              : "border-gray-300 hover:border-indigo-400"
                          }`}>
                            {isSelected && (
                              <svg viewBox="0 0 10 8" fill="none" stroke="white" strokeWidth="1.8" className="w-2.5 h-2">
                                <path d="M1 4l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </span>
                        </button>

                        {/* Left accent bar + content */}
                        <div
                          className="flex-1 min-w-0 pl-3 border-l-2"
                          style={{ borderColor: accent }}
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
                              style={{ background: `${accent}18`, color: accent }}
                            >
                              {r.type_label}
                            </span>
                            {r.account && (
                              <span className="text-[10px] text-gray-400 truncate max-w-[120px]">{r.account}</span>
                            )}
                          </div>
                          <p className="text-sm font-medium text-[var(--twilio-navy)] mt-0.5 truncate">{r.title}</p>
                          {r.detail && (
                            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{r.detail}</p>
                          )}
                          {r.meta && (
                            <p className="text-[10px] text-gray-400 mt-0.5">{r.meta}</p>
                          )}
                        </div>
                        {/* Export-to-layouts toggle */}
                        <button
                          className={`shrink-0 mt-1 p-1 rounded transition-colors ${
                            isExportSelected(`${r.type}:${r.id}`)
                              ? "text-[var(--twilio-red,#DB131A)] opacity-100"
                              : "text-gray-300 opacity-0 group-hover:opacity-100 hover:text-[var(--twilio-red,#DB131A)]"
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            const item = searchResultToExportItem(r);
                            if (!exportMode) toggleMode();
                            toggleItem(item);
                          }}
                          title={isExportSelected(`${r.type}:${r.id}`) ? "Remove from export tray" : "Add to Layouts export tray"}
                        >
                          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3 h-3">
                            <rect x="1" y="4" width="10" height="7" rx="1" />
                            <path d="M4 4V3a2 2 0 0 1 4 0v1" strokeLinecap="round" />
                          </svg>
                        </button>
                        {/* Navigate arrow — stops propagation so it doesn't also toggle select */}
                        <button
                          className="shrink-0 mt-1 p-1 rounded text-gray-300 hover:text-indigo-500 hover:bg-indigo-50 transition-colors opacity-0 group-hover:opacity-100"
                          onClick={(e) => { e.stopPropagation(); handleResultClick(r); }}
                          title="Go to record"
                        >
                          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3 h-3">
                            <path d="M2 6h8M6 2l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Bottom chat bar */}
        <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
          {selected.size > 0 && (
            <p className="text-[11px] text-indigo-600 mb-2">
              {selected.size} item{selected.size > 1 ? "s" : ""} selected as context
              <button onClick={() => setSelected(new Set())} className="ml-2 text-gray-400 hover:text-red-400">
                ✕ clear
              </button>
            </p>
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={chatRef}
              rows={2}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleChatSubmit(); }
              }}
              placeholder={
                selected.size > 0
                  ? "What would you like to do with these items?"
                  : "Select items above, then ask the agent to act on them…"
              }
              className="flex-1 text-sm rounded-lg border border-gray-200 px-3 py-2 resize-none outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 bg-white"
              style={{ color: "var(--twilio-navy)" }}
            />
            <div className="flex flex-col gap-1.5 shrink-0">
              <button
                onClick={() => void handleChatSubmit()}
                disabled={!chatInput.trim() || sending}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-40 transition-colors"
                style={{ background: "var(--twilio-navy)" }}
              >
                Send
              </button>
              {selected.size > 0 && (
                <button
                  title="Add selected items to Layouts export tray and go to Layouts"
                  onClick={() => {
                    // Add all selected results to the export context
                    const toAdd = results.filter((r) => selected.has(resultKey(r)));
                    if (!exportMode) toggleMode();
                    toAdd.forEach((r) => {
                      const item = searchResultToExportItem(r);
                      if (!isExportSelected(item.id)) toggleItem(item);
                    });
                    setOpen(false);
                    navigate("/edit-preview");
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors"
                  style={{
                    background: "rgba(226,35,26,0.08)",
                    borderColor: "var(--twilio-red, #DB131A)",
                    color: "var(--twilio-red, #DB131A)",
                  }}
                >
                  Export to Layouts →
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
