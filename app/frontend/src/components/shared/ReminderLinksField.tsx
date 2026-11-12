import { useEffect, useId, useRef, useState } from "react";
import { schedulerApi } from "../../lib/api";
import type { ReminderLink, ReminderLinkOption, ReminderLinkType } from "../../types/scheduler";

export const LINK_TYPE_LABELS: Record<ReminderLinkType, string> = {
  account: "Account",
  action_item: "Action item",
  calendar_event: "Calendar event",
  task: "Task",
};
const TYPES = Object.keys(LINK_TYPE_LABELS) as ReminderLinkType[];

interface Props {
  value: ReminderLink[];
  onChange: (links: ReminderLink[]) => void;
}

function detailLine(o: ReminderLinkOption): string {
  if (o.at) {
    const when = new Date(o.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    return o.detail ? `${when} · ${o.detail}` : when;
  }
  return o.detail;
}

/**
 * Link a reminder to any number of records, of any mix of types (an action item and an account
 * and a calendar event, say).
 *
 * Pick a type, then choose from the list of existing records of that type; typing filters the
 * list. Every option comes from the server already scoped to what this user can see in the
 * app, and the server checks again on save, so nothing here is a way around that.
 */
export default function ReminderLinksField({ value, onChange }: Props) {
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<ReminderLinkType>("account");
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<ReminderLinkOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  // Load the list for the chosen type, and again (debounced) as the user types to filter it.
  useEffect(() => {
    if (!adding) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    const t = setTimeout(() => {
      schedulerApi.listReminderLinkOptions(type, query.trim())
        .then(({ data }) => { if (!cancelled) { setOptions(data.results ?? []); setActive(0); } })
        .catch(() => { if (!cancelled) { setOptions([]); setFailed(true); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, query ? 200 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [adding, type, query]);

  useEffect(() => { if (adding) inputRef.current?.focus(); }, [adding, type]);

  const chosen = (o: ReminderLinkOption) => value.some((l) => l.resource_type === type && l.resource_id === o.id);
  const choices = options.filter((o) => !chosen(o));

  function pick(o: ReminderLinkOption) {
    onChange([...value, { resource_type: type, resource_id: o.id, resource_label: o.label }]);
    setQuery("");
    setAdding(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, choices.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && choices[active]) { e.preventDefault(); pick(choices[active]); }
    else if (e.key === "Escape") { e.stopPropagation(); setAdding(false); }
  }

  const box: React.CSSProperties = { border: "1px solid var(--border-subtle-2)", borderRadius: 6, padding: "6px 8px", fontSize: "0.8125rem", background: "var(--surface-card)" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }} data-testid="reminder-links-field">
      {value.length > 0 && (
        <ul style={{ display: "flex", flexWrap: "wrap", gap: 6, listStyle: "none", margin: 0, padding: 0 }} aria-label="Linked records">
          {value.map((l) => (
            <li
              key={`${l.resource_type}:${l.resource_id}`}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--surface-subtle-2)", borderRadius: 999, padding: "2px 4px 2px 10px", fontSize: "0.75rem" }}
            >
              <span style={{ color: "var(--text-gray-500)" }}>{LINK_TYPE_LABELS[l.resource_type] ?? l.resource_type}</span>
              <span style={{ fontWeight: 600 }}>{l.resource_label}</span>
              <button
                type="button"
                aria-label={`Remove link to ${l.resource_label}`}
                onClick={() => onChange(value.filter((x) => !(x.resource_type === l.resource_type && x.resource_id === l.resource_id)))}
                style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-gray-400)", padding: "0 6px", lineHeight: 1 }}
              >✕</button>
            </li>
          ))}
        </ul>
      )}

      {!adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          style={{ alignSelf: "flex-start", border: "1px dashed #9ca3af", background: "transparent", borderRadius: 6, padding: "4px 10px", fontSize: "0.8125rem", cursor: "pointer" }}
        >{value.length === 0 ? "+ Link to a record" : "+ Link another record"}</button>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <select
              aria-label="Record type"
              value={type}
              onChange={(e) => { setType(e.target.value as ReminderLinkType); setQuery(""); }}
              style={{ ...box, flex: "0 0 auto" }}
            >
              {TYPES.map((t) => <option key={t} value={t}>{LINK_TYPE_LABELS[t]}</option>)}
            </select>
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-label={`Search ${LINK_TYPE_LABELS[type].toLowerCase()}s`}
              aria-autocomplete="list"
              placeholder={`Type to filter ${LINK_TYPE_LABELS[type].toLowerCase()}s…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              style={{ ...box, flex: 1, minWidth: 0 }}
            />
            <button type="button" onClick={() => setAdding(false)} aria-label="Cancel linking" style={{ ...box, cursor: "pointer" }}>✕</button>
          </div>
          <ul
            id={listId}
            role="listbox"
            aria-label={`${LINK_TYPE_LABELS[type]} results`}
            style={{ ...box, listStyle: "none", margin: 0, padding: 2, maxHeight: 180, overflowY: "auto" }}
          >
            {loading && <li style={{ padding: "4px 8px", color: "var(--text-gray-500)" }}>Loading…</li>}
            {!loading && failed && <li style={{ padding: "4px 8px", color: "#dc2626" }}>Couldn't load records.</li>}
            {!loading && !failed && choices.length === 0 && (
              <li style={{ padding: "4px 8px", color: "var(--text-gray-500)" }}>
                {query ? "No matching records." : options.length > 0 ? "Everything is already linked." : `No ${LINK_TYPE_LABELS[type].toLowerCase()}s available to you.`}
              </li>
            )}
            {!loading && choices.map((o, i) => (
              <li
                key={o.id}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                style={{ padding: "4px 8px", borderRadius: 4, cursor: "pointer", background: i === active ? "var(--tint-indigo-50)" : "transparent" }}
              >
                <div style={{ fontWeight: 600 }}>{o.label}</div>
                {detailLine(o) && <div style={{ fontSize: "0.7rem", color: "var(--text-gray-500)" }}>{detailLine(o)}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
