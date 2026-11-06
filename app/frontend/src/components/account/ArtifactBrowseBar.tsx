import {
  GROUP_OPTIONS, SORT_OPTIONS, availableTypes,
  type ArtifactBrowseState, type ArtifactGroupBy, type ArtifactSort,
} from "../../lib/artifactBrowse";
import type { AccountArtifact } from "../../types/accounts";

/** Search, sort, group-by and type chips for an artifact list. Controlled; holds no state. */
export function ArtifactBrowseBar({ artifacts, state, onChange }: {
  artifacts: AccountArtifact[];
  state: ArtifactBrowseState;
  onChange: (next: ArtifactBrowseState) => void;
}) {
  const types = availableTypes(artifacts);
  const searching = !!state.query.trim();
  const selectStyle = { fontSize: "0.75rem", border: "1px solid rgba(0,0,0,0.12)", borderRadius: 6, padding: "3px 6px", background: "#fff" } as const;
  return (
    <div data-testid="artifact-browse-bar" style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <input
          type="search"
          value={state.query}
          onChange={(e) => onChange({ ...state, query: e.target.value })}
          placeholder="Search name, creator, description, URL…"
          aria-label="Search artifacts"
          data-testid="artifact-search"
          data-filtered={searching ? "true" : "false"}
          className="focus:outline-none"
          style={searching
            ? { fontSize: "0.75rem", borderRadius: 6, padding: "3px 8px", minWidth: 220, border: "1px solid #f59e0b", boxShadow: "0 0 0 2px rgba(245,158,11,0.45)", background: "#fffbeb" }
            : { fontSize: "0.75rem", borderRadius: 6, padding: "3px 8px", minWidth: 220, border: "1px solid rgba(0,0,0,0.12)", background: "#fff" }}
        />
        <label style={{ fontSize: "0.6875rem", color: "var(--twilio-gray-60)" }}>
          Sort{" "}
          <select aria-label="Sort artifacts" value={state.sort} style={selectStyle}
            onChange={(e) => onChange({ ...state, sort: e.target.value as ArtifactSort })}>
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label style={{ fontSize: "0.6875rem", color: "var(--twilio-gray-60)" }}>
          Group by{" "}
          <select aria-label="Group artifacts" value={state.groupBy} style={selectStyle}
            onChange={(e) => onChange({ ...state, groupBy: e.target.value as ArtifactGroupBy })}>
            {GROUP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        {(searching || state.types.length > 0) && (
          <button type="button" onClick={() => onChange({ ...state, query: "", types: [] })}
            style={{ fontSize: "0.6875rem", color: "#6366f1", background: "none", border: "none", cursor: "pointer" }}>
            Clear filters
          </button>
        )}
      </div>
      {types.length > 1 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }} role="group" aria-label="Filter by type">
          {types.map((t) => {
            const on = state.types.includes(t.key);
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={on}
                data-testid={`artifact-type-chip-${t.key}`}
                onClick={() => onChange({ ...state, types: on ? state.types.filter((k) => k !== t.key) : [...state.types, t.key] })}
                className={`px-2 py-0.5 rounded-full text-xs font-medium ${on ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
              >{t.label} <span className="opacity-60">{t.count}</span></button>
            );
          })}
        </div>
      )}
    </div>
  );
}
