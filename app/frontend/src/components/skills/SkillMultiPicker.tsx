import { useMemo, useState } from "react";

export interface PickerOption {
  id: string;
  label: string;
  detail?: string;
  group?: string;
}

/**
 * Search box + multiselect. Choices appear as removable flag chips above the box, so the
 * whole selection stays visible on the page. Used for Twilio skills, chained skills and
 * Slack sources.
 */
export default function SkillMultiPicker({
  label, hint, options, selected, onChange, placeholder, emptyText, disabledReason, testId,
  chipColor = "#e22",
}: {
  label: string;
  hint?: string;
  options: PickerOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  emptyText?: string;
  /** When set the picker is shown but inert, with this explanation. */
  disabledReason?: string;
  testId?: string;
  chipColor?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);

  const q = query.trim().toLowerCase();
  const matches = options.filter(
    (o) => !q || o.label.toLowerCase().includes(q) || (o.detail ?? "").toLowerCase().includes(q),
  );

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  return (
    <div data-testid={testId}>
      <label style={labelStyle}>
        {label} {hint && <span style={{ fontWeight: 400, opacity: 0.6 }}>{hint}</span>}
      </label>

      {selected.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px" }}>
          {selected.map((id) => (
            <span key={id} style={{
              display: "inline-flex", alignItems: "center", gap: "6px", padding: "3px 6px 3px 10px",
              borderRadius: "20px", fontSize: "0.75rem", fontWeight: 600,
              border: `1.5px solid ${chipColor}`, color: chipColor, background: "rgba(0,0,0,0.02)",
            }}>
              {byId.get(id)?.label ?? id}
              <button type="button" aria-label={`Remove ${byId.get(id)?.label ?? id}`}
                onClick={() => toggle(id)}
                style={{ border: "none", background: "transparent", cursor: "pointer", color: "inherit", fontSize: "0.875rem", lineHeight: 1, padding: 0 }}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {disabledReason ? (
        <div style={{ ...boxStyle, color: "var(--text-secondary, #888)", fontStyle: "italic", background: "rgba(0,0,0,0.03)" }}>
          {disabledReason}
        </div>
      ) : (
        <div style={{ position: "relative" }}>
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            placeholder={placeholder ?? "Search…"}
            aria-label={label}
            style={boxStyle}
          />
          {open && (
            <div role="listbox" style={{
              position: "absolute", left: 0, right: 0, top: "100%", zIndex: 30, marginTop: "4px",
              maxHeight: "220px", overflowY: "auto", background: "var(--surface, #fff)",
              border: "1px solid var(--border, rgba(0,0,0,0.12))", borderRadius: "8px",
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            }}>
              {matches.length === 0 && (
                <div style={{ padding: "10px 12px", fontSize: "0.8125rem", color: "var(--text-secondary, #888)" }}>
                  {emptyText ?? "No matches"}
                </div>
              )}
              {matches.map((o, i) => {
                const on = selected.includes(o.id);
                const newGroup = o.group && o.group !== matches[i - 1]?.group;
                return (
                  <div key={o.id}>
                    {newGroup && (
                      <div style={{ padding: "6px 12px 2px", fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-secondary, #999)" }}>
                        {o.group!.toUpperCase()}
                      </div>
                    )}
                    <button type="button" role="option" aria-selected={on}
                      onMouseDown={(e) => { e.preventDefault(); toggle(o.id); }}
                      style={{
                        display: "flex", gap: "8px", alignItems: "baseline", width: "100%", textAlign: "left",
                        padding: "7px 12px", border: "none", cursor: "pointer", fontFamily: "var(--font-base)",
                        background: on ? "rgba(226,35,26,0.06)" : "transparent", fontSize: "0.8125rem",
                      }}>
                      <span style={{ width: "14px", color: chipColor }}>{on ? "✓" : ""}</span>
                      <span style={{ fontWeight: 600 }}>{o.label}</span>
                      {o.detail && <span style={{ color: "var(--text-secondary, #888)", fontSize: "0.75rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.detail}</span>}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "0.8125rem", fontWeight: 600,
  color: "var(--text-secondary, #666)", marginBottom: "6px", letterSpacing: "0.04em",
};
const boxStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: "7px", fontSize: "0.875rem",
  border: "1px solid var(--border, rgba(0,0,0,0.12))", background: "var(--surface, #fff)",
  outline: "none", fontFamily: "var(--font-base)",
};
