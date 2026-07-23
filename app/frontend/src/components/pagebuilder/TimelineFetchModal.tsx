import { useState, useRef } from "react";
import { accountsApi } from "../../lib/api";
import type { Account } from "../../types";

interface Props {
  onConfirm: (account: Account) => void;
  onClose: () => void;
}

export default function TimelineFetchModal({ onConfirm, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleChange(v: string) {
    setQuery(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!v.trim()) { setSuggestions([]); return; }
    timerRef.current = setTimeout(() => {
      setLoading(true);
      accountsApi.listAccounts({ search: v, page_size: "10" })
        .then((res) => {
          const data = Array.isArray(res.data) ? res.data : (res.data as { results: Account[] }).results ?? [];
          setSuggestions(data);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 300);
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "#fff", borderRadius: 10, boxShadow: "0 6px 24px rgba(0,0,0,0.15)", width: 360, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px 8px", borderBottom: "1px solid #F3F4F6", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: "#121C2D", flex: 1 }}>Fetch meetings for account</span>
          <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", color: "#9CA3AF", fontSize: 16 }}>✕</button>
        </div>
        <div style={{ padding: "10px 16px 14px", position: "relative" }}>
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="Search accounts…"
            style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", border: "1px solid #D1D5DB", borderRadius: 6, fontSize: 13, outline: "none" }}
          />
          {loading && <span style={{ position: "absolute", right: 24, top: 18, fontSize: 10, color: "#9CA3AF" }}>…</span>}
          {suggestions.length > 0 && (
            <div style={{ border: "1px solid #E5E7EB", borderRadius: 6, marginTop: 4, overflow: "hidden" }}>
              {suggestions.map((a) => (
                <button
                  key={a.id}
                  onClick={() => onConfirm(a)}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", fontSize: 13, color: "#121C2D", border: "none", background: "#fff", cursor: "pointer", borderBottom: "1px solid #F3F4F6" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#F9FAFB")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
                >
                  {a.company_name}
                  <span style={{ marginLeft: 6, fontSize: 11, color: "#9CA3AF" }}>{a.status}</span>
                </button>
              ))}
            </div>
          )}
          {query && !loading && suggestions.length === 0 && (
            <p style={{ fontSize: 12, color: "#9CA3AF", marginTop: 6 }}>No accounts found</p>
          )}
        </div>
      </div>
    </div>
  );
}
