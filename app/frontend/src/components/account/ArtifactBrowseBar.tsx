import { useState } from "react";
import {
  SORT_OPTIONS, availableCreators, availableTypes, isArtifactBrowseActive, isLinkedToActionItem, typeLabel,
  type ArtifactBrowseState,
} from "../../lib/artifactBrowse";
import type { AccountArtifact } from "../../types/accounts";

type Panel = "sort" | "category" | "creator" | null;

const pill = (on: boolean) =>
  `px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors ${on ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`;

/**
 * One compact row: search, then Sort / Category / Creator / Linked toggles. Opening a toggle
 * expands its options as chips below (no native dropdowns). Active filters show as removable chips.
 * Controlled; the only local state is which chip row is open.
 */
export function ArtifactBrowseBar({ artifacts, state, onChange }: {
  artifacts: AccountArtifact[];
  state: ArtifactBrowseState;
  onChange: (next: ArtifactBrowseState) => void;
}) {
  const [open, setOpen] = useState<Panel>(null);
  const types = availableTypes(artifacts);
  const creators = availableCreators(artifacts);
  const linkedCount = artifacts.filter(isLinkedToActionItem).length;
  const searching = !!state.query.trim();
  const toggle = (p: Exclude<Panel, null>) => setOpen((cur) => (cur === p ? null : p));
  const sortLabel = SORT_OPTIONS.find((o) => o.value === state.sort)?.label ?? "";
  const active = isArtifactBrowseActive(state);

  const headBtn = (p: Exclude<Panel, null>, label: string, badge?: number) => (
    <button
      type="button"
      aria-expanded={open === p}
      data-testid={`artifact-filter-${p}`}
      onClick={() => {
        toggle(p);
        // Clicking Category also sorts the results by category, so the list groups itself as the chips open.
        if (p === "category" && state.sort !== "category") onChange({ ...state, sort: "category" });
      }}
      className={`px-2.5 py-1 rounded-full text-xs font-medium border ${open === p ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}
    >
      {label}{badge ? <span className="ml-1 text-indigo-600">{badge}</span> : null}
      <span aria-hidden className="ml-1 text-[9px]">{open === p ? "▴" : "▾"}</span>
    </button>
  );

  const removable = (key: string, label: string, onRemove: () => void) => (
    <span key={key} data-testid="artifact-active-chip" className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
      {label}
      <button type="button" aria-label={`Remove filter ${label}`} onClick={onRemove}
        className="w-4 h-4 rounded-full leading-none hover:bg-indigo-100">×</button>
    </span>
  );

  return (
    <div data-testid="artifact-browse-bar" className="flex flex-col gap-2 mb-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={state.query}
          onChange={(e) => onChange({ ...state, query: e.target.value })}
          placeholder="Search artifacts…"
          aria-label="Search artifacts"
          data-testid="artifact-search"
          data-filtered={searching ? "true" : "false"}
          className={`focus:outline-none text-xs rounded-full px-3 py-1 min-w-[200px] border ${searching ? "border-amber-400 ring-2 ring-amber-200 bg-amber-50" : "border-gray-200 bg-white"}`}
        />
        {headBtn("sort", "Sort")}
        {headBtn("category", "Category", state.types.length)}
        {headBtn("creator", "Creator", state.creators.length)}
        <button
          type="button"
          aria-pressed={state.linkedActionItem}
          data-testid="artifact-filter-linked"
          onClick={() => onChange({ ...state, linkedActionItem: !state.linkedActionItem })}
          className={pill(state.linkedActionItem)}
        >Linked to action item <span className="opacity-60">{linkedCount}</span></button>
        {active && (
          <button type="button" onClick={() => onChange({ ...state, query: "", types: [], creators: [], linkedActionItem: false })}
            className="text-xs text-indigo-600 hover:underline">Clear</button>
        )}
      </div>

      {open === "sort" && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sort by">
          {SORT_OPTIONS.map((o) => (
            <button key={o.value} type="button" aria-pressed={state.sort === o.value}
              data-testid={`artifact-sort-${o.value}`}
              onClick={() => onChange({ ...state, sort: o.value })} className={pill(state.sort === o.value)}>{o.label}</button>
          ))}
        </div>
      )}
      {open === "category" && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by category">
          {types.length === 0 && <span className="text-xs text-gray-400">No categories yet</span>}
          {types.map((t) => {
            const on = state.types.includes(t.key);
            return (
              <button key={t.key} type="button" aria-pressed={on} data-testid={`artifact-type-chip-${t.key}`}
                onClick={() => onChange({ ...state, types: on ? state.types.filter((k) => k !== t.key) : [...state.types, t.key] })}
                className={pill(on)}>{t.label} <span className="opacity-60">{t.count}</span></button>
            );
          })}
        </div>
      )}
      {open === "creator" && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by creator">
          {creators.length === 0 && <span className="text-xs text-gray-400">No creators yet</span>}
          {creators.map((c) => {
            const on = state.creators.includes(c.name);
            return (
              <button key={c.name} type="button" aria-pressed={on} data-testid={`artifact-creator-chip-${c.name}`}
                onClick={() => onChange({ ...state, creators: on ? state.creators.filter((k) => k !== c.name) : [...state.creators, c.name] })}
                className={pill(on)}>{c.name} <span className="opacity-60">{c.count}</span></button>
            );
          })}
        </div>
      )}

      {(state.sort !== "created_desc" || active) && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="artifact-active-filters">
          {state.sort !== "created_desc" && removable("sort", `Sort: ${sortLabel}`, () => onChange({ ...state, sort: "created_desc" }))}
          {state.types.map((k) => removable(`t-${k}`, typeLabel(k), () => onChange({ ...state, types: state.types.filter((x) => x !== k) })))}
          {state.creators.map((c) => removable(`c-${c}`, `By ${c}`, () => onChange({ ...state, creators: state.creators.filter((x) => x !== c) })))}
          {state.linkedActionItem && removable("linked", "Linked to action item", () => onChange({ ...state, linkedActionItem: false }))}
        </div>
      )}
    </div>
  );
}
