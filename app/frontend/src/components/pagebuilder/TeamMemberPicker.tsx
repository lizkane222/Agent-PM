import { useState, useEffect, useRef, useCallback } from "react";
import { teamApi, accountsApi } from "../../lib/api";
import type { TeamMember, Account, AccountTeamMember } from "../../types";

export interface PickedMember {
  fullName: string;
  title: string;
  email: string;
  role: string;
  accentColor: string;
}

interface Props {
  onConfirm: (members: PickedMember[]) => void;
  onClose: () => void;
}

// Normalise both TeamMember and AccountTeamMember into a flat shape
interface Row {
  key: string;
  fullName: string;
  title: string;
  email: string;
  role: string;
  source: string; // "Team" or account name
}

const ACCENTS = ["#059669", "#0263E0", "#7C3AED", "#F59E0B", "#EF4444", "#0891B2", "#DB2777"];
function accentFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}

export default function TeamMemberPicker({ onConfirm, onClose }: Props) {
  const [teamRows, setTeamRows] = useState<Row[]>([]);
  const [accountRows, setAccountRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [accountQuery, setAccountQuery] = useState("");
  const [accountSuggestions, setAccountSuggestions] = useState<Account[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const accountQueryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    teamApi.listMembers({ page_size: "200" })
      .then((res) => {
        const data = Array.isArray(res.data) ? res.data : (res.data as { results: TeamMember[] }).results ?? [];
        setTeamRows(data.map((m) => ({
          key: `team:${m.id}`,
          fullName: m.full_name,
          title: m.title || "",
          email: m.email,
          role: m.department || "",
          source: "Team",
        })));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const searchAccounts = useCallback((q: string) => {
    if (!q.trim()) { setAccountSuggestions([]); return; }
    setLoadingAccounts(true);
    accountsApi.listAccounts({ search: q, page_size: "10" })
      .then((res) => {
        const data = Array.isArray(res.data) ? res.data : (res.data as { results: Account[] }).results ?? [];
        setAccountSuggestions(data);
      })
      .catch(() => {})
      .finally(() => setLoadingAccounts(false));
  }, []);

  function onAccountQueryChange(v: string) {
    setAccountQuery(v);
    if (accountQueryRef.current) clearTimeout(accountQueryRef.current);
    accountQueryRef.current = setTimeout(() => searchAccounts(v), 300);
  }

  function pickAccount(acct: Account) {
    setAccountQuery(acct.company_name);
    setAccountSuggestions([]);
    const members: AccountTeamMember[] = acct.team_members || [];
    const rows: Row[] = members.map((m) => ({
      key: `acct:${acct.id}:${m.id}`,
      fullName: m.full_name,
      title: m.title || "",
      email: m.email,
      role: "",
      source: acct.company_name,
    }));
    // Merge — avoid duplicate emails already in accountRows
    setAccountRows((prev) => {
      const existingEmails = new Set(prev.map((r) => r.email));
      const fresh = rows.filter((r) => !existingEmails.has(r.email));
      return [...prev, ...fresh];
    });
  }

  function toggleKey(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function toggleAll(rows: Row[]) {
    const allSelected = rows.every((r) => selectedKeys.has(r.key));
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      rows.forEach((r) => allSelected ? next.delete(r.key) : next.add(r.key));
      return next;
    });
  }

  function confirm() {
    const allRows = [...teamRows, ...accountRows];
    const picked = allRows
      .filter((r) => selectedKeys.has(r.key))
      .map((r): PickedMember => ({
        fullName: r.fullName,
        title: r.title,
        email: r.email,
        role: r.role,
        accentColor: accentFor(r.fullName),
      }));
    onConfirm(picked);
  }

  const q = search.toLowerCase();
  const filteredTeam = teamRows.filter(
    (r) => !q || r.fullName.toLowerCase().includes(q) || r.email.toLowerCase().includes(q) || r.title.toLowerCase().includes(q)
  );
  const filteredAccount = accountRows.filter(
    (r) => !q || r.fullName.toLowerCase().includes(q) || r.email.toLowerCase().includes(q) || r.source.toLowerCase().includes(q)
  );

  const allVisible = [...filteredTeam, ...filteredAccount];

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "#fff", borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        width: 520, maxHeight: "80vh", display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid #F3F4F6", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#121C2D", flex: 1 }}>Import Team Members</span>
          <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16, color: "#9CA3AF" }}>✕</button>
        </div>

        {/* Account lookup */}
        <div style={{ padding: "10px 16px 0", position: "relative" }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 4 }}>
            Import from account
          </label>
          <div style={{ position: "relative" }}>
            <input
              type="text"
              value={accountQuery}
              onChange={(e) => onAccountQueryChange(e.target.value)}
              placeholder="Search accounts…"
              style={{
                width: "100%", boxSizing: "border-box", padding: "6px 10px",
                border: "1px solid #D1D5DB", borderRadius: 6, fontSize: 13,
                outline: "none",
              }}
            />
            {loadingAccounts && (
              <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "#9CA3AF" }}>…</span>
            )}
          </div>
          {accountSuggestions.length > 0 && (
            <div style={{
              position: "absolute", left: 16, right: 16, top: "100%", zIndex: 10,
              background: "#fff", border: "1px solid #E5E7EB", borderRadius: 6,
              boxShadow: "0 4px 12px rgba(0,0,0,0.1)", overflow: "hidden",
            }}>
              {accountSuggestions.map((a) => (
                <button
                  key={a.id}
                  onClick={() => pickAccount(a)}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "7px 12px", fontSize: 13, color: "#121C2D",
                    border: "none", background: "none", cursor: "pointer",
                    borderBottom: "1px solid #F3F4F6",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#F9FAFB")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                >
                  <span style={{ fontWeight: 600 }}>{a.company_name}</span>
                  {a.team_members?.length > 0 && (
                    <span style={{ marginLeft: 6, fontSize: 11, color: "#6B7280" }}>
                      {a.team_members.length} member{a.team_members.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Search */}
        <div style={{ padding: "8px 16px 6px" }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by name, email, title…"
            style={{
              width: "100%", boxSizing: "border-box", padding: "6px 10px",
              border: "1px solid #E5E7EB", borderRadius: 6, fontSize: 13,
              background: "#F9FAFB", outline: "none",
            }}
          />
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px" }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>Loading…</div>
          ) : (
            <>
              {[
                { label: "Team", rows: filteredTeam },
                ...(filteredAccount.length > 0 ? [{ label: "From accounts", rows: filteredAccount }] : []),
              ].map(({ label, rows: sectionRows }) => (
                <div key={label}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "6px 8px 2px", position: "sticky", top: 0, background: "#fff", zIndex: 1,
                  }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.07em", flex: 1 }}>
                      {label}
                    </span>
                    <button
                      onClick={() => toggleAll(sectionRows)}
                      style={{ fontSize: 10, color: "#0263E0", border: "none", background: "none", cursor: "pointer", padding: "0 2px" }}
                    >
                      {sectionRows.every((r) => selectedKeys.has(r.key)) ? "Deselect all" : "Select all"}
                    </button>
                  </div>
                  {sectionRows.map((row) => {
                    const checked = selectedKeys.has(row.key);
                    const initials = row.fullName.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
                    const accent = accentFor(row.fullName);
                    return (
                      <label
                        key={row.key}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "6px 8px", borderRadius: 6, cursor: "pointer",
                          background: checked ? `${accent}10` : "transparent",
                          transition: "background 0.1s",
                        }}
                        onMouseEnter={(e) => { if (!checked) (e.currentTarget as HTMLElement).style.background = "#F9FAFB"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = checked ? `${accent}10` : "transparent"; }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleKey(row.key)}
                          style={{ accentColor: accent, width: 14, height: 14, flexShrink: 0 }}
                        />
                        <div style={{
                          width: 30, height: 30, borderRadius: "50%",
                          background: accent, color: "#fff",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 11, fontWeight: 700, flexShrink: 0,
                        }}>
                          {initials}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#121C2D", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {row.fullName}
                          </div>
                          <div style={{ fontSize: 11, color: "#6B7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {[row.title, row.email].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        {row.source !== "Team" && (
                          <span style={{ fontSize: 10, color: "#6B7280", background: "#F3F4F6", padding: "1px 5px", borderRadius: 99, flexShrink: 0 }}>
                            {row.source}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              ))}
              {allVisible.length === 0 && (
                <div style={{ padding: 24, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>No results</div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "10px 16px", borderTop: "1px solid #F3F4F6",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ fontSize: 12, color: "#6B7280" }}>
            {selectedKeys.size > 0 ? `${selectedKeys.size} selected` : "Select members to add"}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onClose}
              style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #E5E7EB", background: "#fff", fontSize: 13, cursor: "pointer", color: "#374151" }}
            >
              Cancel
            </button>
            <button
              onClick={confirm}
              disabled={selectedKeys.size === 0}
              style={{
                padding: "6px 14px", borderRadius: 6, border: "none",
                background: selectedKeys.size > 0 ? "#0263E0" : "#E5E7EB",
                color: selectedKeys.size > 0 ? "#fff" : "#9CA3AF",
                fontSize: 13, fontWeight: 600, cursor: selectedKeys.size > 0 ? "pointer" : "not-allowed",
              }}
            >
              Add {selectedKeys.size > 0 ? `${selectedKeys.size} card${selectedKeys.size !== 1 ? "s" : ""}` : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
