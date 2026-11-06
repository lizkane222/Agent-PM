import { useMemo, useState } from "react";
import type { AgentTool } from "../../types/agents";

const GROUP_LABELS: Record<AgentTool["group"], string> = {
  read: "Read", create: "Create", update: "Update", delete: "Delete",
  communicate: "Communicate", skills: "Skills", other: "Other",
};
const GROUP_ORDER: AgentTool["group"][] = ["read", "create", "update", "communicate", "skills", "other", "delete"];

/**
 * The full list of agent capabilities a skill may use, grouped, searchable and
 * expandable, with a one-line description under each. Only `skill_safe` tools are
 * offered — the server refuses the rest at save.
 */
export default function CapabilityPicker({
  tools, selected, onChange, loading,
}: {
  tools: AgentTool[];
  selected: string[];
  onChange: (names: string[]) => void;
  loading?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const offered = useMemo(() => tools.filter((t) => t.skill_safe), [tools]);
  const q = query.trim().toLowerCase();
  const visible = offered.filter((t) => !q || t.name.includes(q) || t.description.toLowerCase().includes(q));

  const groups = GROUP_ORDER
    .map((g) => ({ group: g, items: visible.filter((t) => t.group === g) }))
    .filter((g) => g.items.length > 0);

  const toggle = (name: string) =>
    onChange(selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name]);
  const toggleGroup = (names: string[]) => {
    const all = names.every((n) => selected.includes(n));
    onChange(all ? selected.filter((n) => !names.includes(n)) : Array.from(new Set([...selected, ...names])));
  };

  return (
    <div data-testid="capability-picker">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", marginBottom: "6px" }}>
        <label style={labelStyle}>
          AGENT CAPABILITIES <span style={{ fontWeight: 400, opacity: 0.6 }}>
            ({selected.length} of {offered.length} selected — what this skill may do)
          </span>
        </label>
        <button type="button" onClick={() => setExpanded((v) => !v)} style={linkBtn}>
          {expanded ? "Hide full list" : "View full list"}
        </button>
      </div>

      <input value={query} onChange={(e) => { setQuery(e.target.value); if (e.target.value) setExpanded(true); }}
        placeholder="Search capabilities, e.g. calendar, artifact, reminder…" aria-label="Search capabilities" style={inputStyle} />

      {selected.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
          {selected.map((name) => (
            <button key={name} type="button" onClick={() => toggle(name)} title="Click to remove" style={chip(true)}>
              ✓ {name}
            </button>
          ))}
        </div>
      )}

      {loading && <p style={note}>Loading capabilities…</p>}

      {expanded && (
        <div style={{ marginTop: "10px", border: "1px solid var(--border, rgba(0,0,0,0.1))", borderRadius: "8px", maxHeight: "340px", overflowY: "auto" }}>
          {groups.length === 0 && <p style={{ ...note, padding: "10px 12px" }}>No capabilities match “{query}”.</p>}
          {groups.map(({ group, items }) => {
            const names = items.map((t) => t.name);
            const open = q !== "" || openGroups.has(group);
            const count = names.filter((n) => selected.includes(n)).length;
            return (
              <div key={group} data-group={group}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "7px 12px", background: "rgba(0,0,0,0.03)", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                  <button type="button" aria-expanded={open}
                    onClick={() => setOpenGroups((prev) => { const n = new Set(prev); if (n.has(group)) n.delete(group); else n.add(group); return n; })}
                    style={{ ...linkBtn, color: "var(--text-primary, #111)", fontWeight: 700 }}>
                    {open ? "▾" : "▸"} {GROUP_LABELS[group]} ({count}/{items.length})
                  </button>
                  <button type="button" onClick={() => toggleGroup(names)} style={{ ...linkBtn, marginLeft: "auto" }}>
                    {count === items.length ? "Clear" : "Select all"}
                  </button>
                </div>
                {open && items.map((t) => {
                  const on = selected.includes(t.name);
                  return (
                    <label key={t.name} style={{ display: "flex", gap: "10px", alignItems: "flex-start", padding: "7px 12px", cursor: "pointer", borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                      <input type="checkbox" checked={on} onChange={() => toggle(t.name)} aria-label={t.name} style={{ marginTop: "3px" }} />
                      <span>
                        <code style={{ fontSize: "0.75rem", fontWeight: 600 }}>{t.name}</code>
                        <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary, #888)", lineHeight: 1.4 }}>{t.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
      <p style={note}>The instructions may only use the capabilities checked here; review rejects anything else.</p>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-secondary, #666)", letterSpacing: "0.04em",
};
const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: "7px", fontSize: "0.875rem",
  border: "1px solid var(--border, rgba(0,0,0,0.12))", background: "var(--surface, #fff)", outline: "none",
  fontFamily: "var(--font-base)",
};
const linkBtn: React.CSSProperties = {
  background: "transparent", border: "none", cursor: "pointer", padding: 0, fontSize: "0.75rem",
  fontWeight: 600, color: "var(--twilio-red, #e22)", fontFamily: "var(--font-base)",
};
const note: React.CSSProperties = { margin: "6px 0 0", fontSize: "0.75rem", color: "var(--text-secondary, #aaa)", lineHeight: 1.5 };
const chip = (active: boolean): React.CSSProperties => ({
  padding: "4px 12px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 600,
  fontFamily: "var(--font-mono, monospace)",
  border: active ? "1.5px solid var(--twilio-red, #e22)" : "1.5px solid rgba(0,0,0,0.12)",
  background: active ? "rgba(226,35,26,0.07)" : "transparent",
  color: active ? "var(--twilio-red, #e22)" : "var(--text-secondary, #888)", cursor: "pointer",
});
