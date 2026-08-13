import React, { useEffect, useState } from "react";

export function SidebarField({
  label,
  value,
  onSave,
  type = "text",
  options,
  readOnly = false,
  renderValue,
}: {
  label: string;
  value: string;
  onSave?: (val: string) => Promise<void>;
  type?: "text" | "select" | "number" | "url";
  options?: { value: string; label: string }[];
  readOnly?: boolean;
  renderValue?: (val: string) => React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(value); }, [value]);

  async function commit() {
    if (readOnly || !onSave) { setEditing(false); return; }
    if (draft === value) { setEditing(false); return; }
    setSaving(true);
    try { await onSave(draft); } finally { setSaving(false); setEditing(false); }
  }

  const empty = <span style={{ color: "var(--twilio-gray-60)", fontStyle: "italic", fontSize: "0.75rem" }}>—</span>;
  const display = renderValue ? renderValue(value) : (value ? <span className="text-xs">{value}</span> : empty);

  return (
    <div>
      {label && (
        <div className="flex items-center gap-1 mb-0.5">
          <p className="text-[11px] text-[var(--twilio-gray-60)] uppercase tracking-wide">{label}</p>
          {!readOnly && !editing && (
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-2.5 h-2.5 opacity-0 group-hover/field:opacity-40 transition-opacity shrink-0" style={{ color: "var(--twilio-gray-60)" }}>
              <path d="M8 1.5l2.5 2.5-6 6L2 10.5l.5-2.5 6-6z" strokeLinejoin="round"/>
            </svg>
          )}
        </div>
      )}
      {editing ? (
        type === "select" ? (
          <select
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            className="w-full text-xs rounded border border-red-300 px-1.5 py-1 focus:outline-none focus:border-red-400 focus:ring-1 focus:ring-red-100"
            style={{ fontFamily: "var(--font-base)" }}
          >
            {options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <input
            autoFocus
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commit();
              if (e.key === "Escape") { setDraft(value); setEditing(false); }
            }}
            className="w-full text-xs rounded border border-red-300 px-1.5 py-1 focus:outline-none focus:border-red-400 focus:ring-1 focus:ring-red-100"
            style={{ fontFamily: "var(--font-base)" }}
          />
        )
      ) : (
        <div
          onClick={() => { if (!readOnly) { setDraft(value); setEditing(true); } }}
          className={`group/field leading-snug rounded px-1 -mx-1 py-0.5 -my-0.5 flex items-center gap-1.5 transition-colors ${!readOnly ? "cursor-pointer hover:bg-red-50" : ""} ${saving ? "opacity-40" : ""}`}
        >
          <span className="flex-1 min-w-0">{display}</span>
          {!readOnly && (
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-2.5 h-2.5 shrink-0 opacity-0 group-hover/field:opacity-30 transition-opacity" style={{ color: "var(--twilio-navy)" }}>
              <path d="M8 1.5l2.5 2.5-6 6L2 10.5l.5-2.5 6-6z" strokeLinejoin="round"/>
            </svg>
          )}
        </div>
      )}
    </div>
  );
}
