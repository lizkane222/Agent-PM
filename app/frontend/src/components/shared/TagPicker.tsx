import { useId, useState } from "react";

export const MAX_TAG_LENGTH = 30;
export const MAX_TAGS = 10;

/** Trim and collapse spaces. */
export function cleanTag(raw: string): string {
  return raw.split(/\s+/).filter(Boolean).join(" ");
}

export interface TagOption { name: string; count?: number }

/**
 * Multi-select of tags that already exist (from any item), plus typing a new one.
 * Selected tags are highlighted; matching is case-insensitive so "SMS" and "sms" are one tag.
 */
export default function TagPicker({
  value, onChange, options, label = "Tags", max = MAX_TAGS,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  options: TagOption[];
  label?: string;
  max?: number;
}) {
  const uid = useId();
  const [query, setQuery] = useState("");
  const selected = new Set(value.map((t) => t.toLowerCase()));
  const q = cleanTag(query);
  const exact = options.find((o) => o.name.toLowerCase() === q.toLowerCase());
  const atMax = value.length >= max;

  const matches = options
    .filter((o) => !q || o.name.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 40);

  const toggle = (name: string) => {
    if (selected.has(name.toLowerCase())) {
      onChange(value.filter((t) => t.toLowerCase() !== name.toLowerCase()));
    } else if (!atMax) {
      onChange([...value, name]);
    }
  };

  const create = () => {
    if (!q) return;
    if (q.length > MAX_TAG_LENGTH) return;
    toggle(exact ? exact.name : q);
    setQuery("");
  };

  const tooLong = q.length > MAX_TAG_LENGTH;
  const canCreate = !!q && !tooLong && !exact && !selected.has(q.toLowerCase()) && !atMax;

  const chip = (active: boolean) => ({
    background: active ? "var(--twilio-red, #e22)" : "var(--surface-subtle-2)",
    color: active ? "#fff" : "var(--text-primary, #111)",
    border: `1px solid ${active ? "var(--twilio-red, #e22)" : "var(--border-subtle, #e5e7eb)"}`,
  });

  return (
    <div>
      <label htmlFor={`${uid}-tags`} className="block text-xs font-semibold text-[var(--twilio-gray-80)] mb-1">
        {label}{" "}
        <span className="font-normal text-[var(--twilio-gray-40)]">
          (optional, {value.length}/{max} — pick existing tags or type a new one)
        </span>
      </label>
      <input
        id={`${uid}-tags`}
        value={query}
        maxLength={MAX_TAG_LENGTH + 10}
        autoComplete="off"
        placeholder="Search tags, or type a new one and press Enter"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); create(); }
          if (e.key === "," ) { e.preventDefault(); create(); }
        }}
        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-[var(--twilio-navy)] focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
      />
      {tooLong && <p className="text-xs text-red-600 mt-1">A tag can be at most {MAX_TAG_LENGTH} characters.</p>}
      {atMax && <p className="text-xs mt-1" style={{ color: "var(--text-secondary, #9ca3af)" }}>Up to {max} tags per item.</p>}

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2" aria-label="Selected tags">
          {value.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => toggle(t)}
              aria-label={`Remove tag ${t}`}
              className="text-[11px] px-2 py-0.5 rounded-full font-medium"
              style={chip(true)}
            >
              {t} ✕
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1 mt-2 max-h-32 overflow-y-auto" role="group" aria-label="Existing tags">
        {canCreate && (
          <button
            type="button"
            onClick={create}
            className="text-[11px] px-2 py-0.5 rounded-full font-medium"
            style={{ ...chip(false), borderStyle: "dashed" }}
          >
            Create “{q}”
          </button>
        )}
        {matches.map((o) => {
          const active = selected.has(o.name.toLowerCase());
          return (
            <button
              key={o.name.toLowerCase()}
              type="button"
              aria-pressed={active}
              disabled={!active && atMax}
              onClick={() => toggle(o.name)}
              className="text-[11px] px-2 py-0.5 rounded-full font-medium disabled:opacity-40"
              style={chip(active)}
            >
              {o.name}{o.count ? <span style={{ opacity: 0.7 }}> · {o.count}</span> : null}
            </button>
          );
        })}
        {matches.length === 0 && !canCreate && (
          <span className="text-[11px]" style={{ color: "var(--text-secondary, #9ca3af)" }}>No tags yet.</span>
        )}
      </div>
    </div>
  );
}
