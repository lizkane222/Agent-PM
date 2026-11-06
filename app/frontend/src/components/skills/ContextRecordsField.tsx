import { useEffect, useRef, useState } from "react";
import { searchApi, type SearchResult } from "../../lib/api";
import type { SkillContextRecord } from "../../types/agents";

const MIN_QUERY = 2;

/**
 * Pin any record type (accounts, action items, meetings, artifacts, notes, other skills…)
 * as standing context. Uses the same search as the editor's `@#` picker, so every record
 * type that can be referenced anywhere in the app can be pinned here.
 */
export default function ContextRecordsField({
  records, onChange,
}: {
  records: SkillContextRecord[];
  onChange: (next: SkillContextRecord[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (query.trim().length < MIN_QUERY) { setResults([]); setLoading(false); return; }
    setLoading(true);
    timer.current = setTimeout(() => {
      searchApi.search(query.trim())
        .then((r) => setResults(r.data.results ?? []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 200);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query]);

  const has = (r: SearchResult) => records.some((x) => x.resource_type === r.type && String(x.resource_id) === String(r.id));
  function toggle(r: SearchResult) {
    if (has(r)) {
      onChange(records.filter((x) => !(x.resource_type === r.type && String(x.resource_id) === String(r.id))));
    } else {
      onChange([...records, { resource_type: r.type, resource_id: r.id, label: r.title, url: r.url }]);
    }
  }

  return (
    <div data-testid="context-records">
      <label style={{ display: "block", fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-secondary, #666)", marginBottom: "6px", letterSpacing: "0.04em" }}>
        CONTEXT RECORDS <span style={{ fontWeight: 400, opacity: 0.6 }}>(any record type the skill should always start from)</span>
      </label>
      {records.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px" }}>
          {records.map((r) => (
            <span key={`${r.resource_type}-${r.resource_id}`} style={{
              display: "inline-flex", alignItems: "center", gap: "6px", padding: "3px 6px 3px 10px", borderRadius: "20px",
              fontSize: "0.75rem", fontWeight: 600, border: "1.5px solid #6366f1", color: "#4f46e5", background: "rgba(99,102,241,0.06)",
            }}>
              <span style={{ opacity: 0.6, fontWeight: 500 }}>{r.resource_type.replace(/_/g, " ")}</span> {r.label}
              <button type="button" aria-label={`Remove ${r.label}`}
                onClick={() => onChange(records.filter((x) => x !== r))}
                style={{ border: "none", background: "transparent", cursor: "pointer", color: "inherit", fontSize: "0.875rem", lineHeight: 1, padding: 0 }}>×</button>
            </span>
          ))}
        </div>
      )}
      <div style={{ position: "relative" }}>
        <input value={query} onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search records to pin (account, action item, meeting, artifact…)"
          aria-label="Search records" style={{
            width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: "7px", fontSize: "0.875rem",
            border: "1px solid var(--border, rgba(0,0,0,0.12))", background: "var(--surface, #fff)", outline: "none", fontFamily: "var(--font-base)",
          }} />
        {open && query.trim().length >= MIN_QUERY && (
          <div style={{ position: "absolute", left: 0, right: 0, top: "100%", zIndex: 30, marginTop: "4px", maxHeight: "240px", overflowY: "auto", background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.12))", borderRadius: "8px", boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>
            {loading && <div style={msg}>Searching…</div>}
            {!loading && results.length === 0 && <div style={msg}>No results for “{query}”</div>}
            {results.map((r) => (
              <button key={`${r.type}-${r.id}`} type="button" role="option" aria-selected={has(r)}
                onMouseDown={(e) => { e.preventDefault(); toggle(r); }}
                style={{ display: "flex", gap: "8px", alignItems: "baseline", width: "100%", textAlign: "left", padding: "7px 12px", border: "none", cursor: "pointer", background: has(r) ? "rgba(99,102,241,0.08)" : "transparent", fontSize: "0.8125rem", fontFamily: "var(--font-base)" }}>
                <span style={{ width: "14px", color: "#4f46e5" }}>{has(r) ? "✓" : ""}</span>
                <span style={{ fontSize: "0.6875rem", fontWeight: 700, color: r.accent || "#888", minWidth: "84px" }}>{r.type_label}</span>
                <span style={{ fontWeight: 600 }}>{r.title}</span>
                {r.detail && <span style={{ color: "var(--text-secondary, #888)", fontSize: "0.75rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.detail}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const msg: React.CSSProperties = { padding: "10px 12px", fontSize: "0.8125rem", color: "var(--text-secondary, #888)" };
