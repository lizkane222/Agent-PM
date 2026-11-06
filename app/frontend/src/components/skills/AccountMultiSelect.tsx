import { useEffect, useState } from "react";
import { accountsApi } from "../../lib/api";

interface AccountOption { id: number; company_name: string }

/** Choose any of the signed-in user's accounts, with Select all / Clear. */
export default function AccountMultiSelect({
  selected, onChange, label = "ACCOUNTS",
}: {
  selected: number[];
  onChange: (ids: number[]) => void;
  label?: string;
}) {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    accountsApi.listAccounts({ page_size: "1000" })
      .then((r) => { if (!cancelled) setAccounts((r.data.results ?? []).map((a) => ({ id: a.id, company_name: a.company_name }))); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const q = query.trim().toLowerCase();
  const shown = accounts.filter((a) => !q || a.company_name.toLowerCase().includes(q));
  const allSelected = accounts.length > 0 && accounts.every((a) => selected.includes(a.id));

  const toggle = (id: number) => onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  return (
    <div data-testid="account-multiselect">
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-secondary, #666)", letterSpacing: "0.04em" }}>
          {label} <span style={{ fontWeight: 400, opacity: 0.6 }}>({selected.length} of {accounts.length})</span>
        </span>
        <button type="button" onClick={() => onChange(allSelected ? [] : accounts.map((a) => a.id))}
          disabled={accounts.length === 0} style={linkBtn}>
          {allSelected ? "Clear all" : "Select all"}
        </button>
      </div>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter accounts…"
        aria-label="Filter accounts" style={inputStyle} />
      <div style={{ marginTop: "8px", maxHeight: "160px", overflowY: "auto", border: "1px solid var(--border, rgba(0,0,0,0.1))", borderRadius: "8px" }}>
        {loading && <p style={empty}>Loading accounts…</p>}
        {!loading && shown.length === 0 && <p style={empty}>{accounts.length === 0 ? "You aren't on any accounts yet." : "No accounts match."}</p>}
        {shown.map((a) => (
          <label key={a.id} style={{ display: "flex", gap: "8px", alignItems: "center", padding: "6px 12px", cursor: "pointer", fontSize: "0.8125rem" }}>
            <input type="checkbox" checked={selected.includes(a.id)} onChange={() => toggle(a.id)} aria-label={a.company_name} />
            {a.company_name}
          </label>
        ))}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "7px 12px", borderRadius: "7px", fontSize: "0.8125rem",
  border: "1px solid var(--border, rgba(0,0,0,0.12))", background: "var(--surface, #fff)", outline: "none",
  fontFamily: "var(--font-base)",
};
const linkBtn: React.CSSProperties = {
  background: "transparent", border: "none", cursor: "pointer", padding: 0, fontSize: "0.75rem",
  fontWeight: 600, color: "var(--twilio-red, #e22)", fontFamily: "var(--font-base)",
};
const empty: React.CSSProperties = { margin: 0, padding: "10px 12px", fontSize: "0.8125rem", color: "var(--text-secondary, #888)" };
