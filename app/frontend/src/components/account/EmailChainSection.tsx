import { useCallback, useState } from "react";
import { integrationsApi } from "../../lib/api";
import type { GmailThread } from "../../lib/api";
import type { Account } from "../../types";
import { ThreadCard, ThreadExpanded } from "./ThreadCard";
import { ThreadChatPanel } from "./ThreadChatPanel";
import { STATUS_COLORS } from "./EmailStatusBadge";

export function EmailChainSection({ account }: { account: Account }) {
  const [threads, setThreads] = useState<GmailThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [chatThread, setChatThread] = useState<GmailThread | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [generatingOnePager, setGeneratingOnePager] = useState(false);

  const domain = account.website
    ? account.website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]
    : "";

  const handleSummaryUpdate = useCallback((
    threadId: string,
    update: Pick<GmailThread, "summary" | "status" | "status_color" | "next_action">
  ) => {
    setThreads(prev => prev.map(t => t.id === threadId ? { ...t, ...update } : t));
  }, []);

  async function load(q?: string) {
    setLoading(true);
    setError(null);
    try {
      const { data } = await integrationsApi.getGmailThreads({
        account_domain: domain || undefined,
        account_name: account.company_name,
        q: q || undefined,
      });
      setThreads(data.threads);
      setLoaded(true);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? "Failed to load Gmail threads.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  function handleSearch(term: string) {
    setSearchTerm(term);
  }

  const filtered = searchTerm.trim()
    ? threads.filter(t =>
        t.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.summary?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.messages.some(m => m.body.toLowerCase().includes(searchTerm.toLowerCase()) || m.from.toLowerCase().includes(searchTerm.toLowerCase()))
      )
    : threads;

  async function generateOnePager() {
    if (!threads.length) return;
    setGeneratingOnePager(true);
    try {
      const lines: string[] = [
        `# Email Chain Status Report — ${account.company_name}`,
        `_Generated ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}_`,
        "",
        "## Summary",
        "",
      ];
      for (const t of threads) {
        const c = STATUS_COLORS[t.status_color] ?? STATUS_COLORS.gray;
        void c;
        lines.push(`### ${t.subject}`);
        lines.push(`**Status:** ${t.status}  `);
        lines.push(`**Participants:** ${t.participants.join(", ")}  `);
        lines.push(`**Messages:** ${t.message_count}  `);
        lines.push("");
        if (t.summary) lines.push(t.summary);
        if (t.next_action) lines.push(`**Next action:** ${t.next_action}`);
        lines.push("");
      }
      const md = lines.join("\n");
      const blob = new Blob([md], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${account.company_name.toLowerCase().replace(/\s+/g, "-")}-email-status-${new Date().toISOString().slice(0,10)}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setGeneratingOnePager(false);
    }
  }

  return (
    <div style={{ padding: "20px 24px", borderTop: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
      {/* Section header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-primary, #111)" }}>
            Email Chain Summary &amp; Status
          </h3>
          <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "var(--text-secondary, #888)" }}>
            Gmail threads related to {account.company_name}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {loaded && (
            <div style={{ position: "relative" }}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"
                style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--text-secondary, #aaa)", pointerEvents: "none" }}>
                <circle cx="6.5" cy="6.5" r="4.5"/><path d="M10.5 10.5L14 14" strokeLinecap="round"/>
              </svg>
              <input
                value={searchTerm}
                onChange={e => handleSearch(e.target.value)}
                placeholder="Search threads…"
                style={{
                  paddingLeft: 28, paddingRight: 10, paddingTop: 5, paddingBottom: 5,
                  borderRadius: 6, fontSize: "0.8125rem", border: "1px solid var(--border, rgba(0,0,0,0.12))",
                  background: "var(--surface, #fff)", outline: "none", width: 180,
                  color: "var(--text-primary, #111)",
                }}
              />
            </div>
          )}
          {!loaded ? (
            <button
              onClick={() => void load()}
              disabled={loading}
              style={{
                padding: "6px 14px", borderRadius: 7, fontSize: "0.8125rem", fontWeight: 600,
                background: "var(--twilio-red, #e22)", color: "#fff", border: "none",
                cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1,
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              {loading ? (
                <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: "spin 1s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Loading…</>
              ) : (
                <><svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M0 4a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H2a2 2 0 01-2-2V4zm2 0v.217l6 3.6 6-3.6V4H2zm12 1.383l-5.646 3.388a.5.5 0 01-.708 0L2 5.383V12h12V5.383z"/></svg>Load Gmail Threads</>
              )}
            </button>
          ) : (
            <button
              onClick={() => void load(searchTerm || undefined)}
              disabled={loading}
              style={{
                padding: "6px 12px", borderRadius: 7, fontSize: "0.8125rem", fontWeight: 600,
                background: "transparent", color: "var(--text-secondary, #666)", border: "1px solid var(--border, rgba(0,0,0,0.15))",
                cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? "↻ Refreshing…" : "↻ Refresh"}
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(239,68,68,0.08)", color: "#dc2626",
          border: "1px solid rgba(239,68,68,0.2)", fontSize: "0.875rem", marginBottom: 14 }}>
          {error}
        </div>
      )}

      {/* Empty / not loaded state */}
      {!loaded && !loading && !error && (
        <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-secondary, #aaa)", fontSize: "0.875rem" }}>
          Click <strong>Load Gmail Threads</strong> to fetch and summarise email chains for this account.
        </div>
      )}

      {loaded && !loading && filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text-secondary, #aaa)", fontSize: "0.875rem" }}>
          {searchTerm ? `No threads match "${searchTerm}"` : "No email threads found for this account."}
        </div>
      )}

      {/* Horizontal card scroll */}
      {filtered.length > 0 && (
        <div style={{ overflowX: "auto", paddingBottom: 8 }}>
          <div style={{ display: "flex", gap: 12, minWidth: "max-content", paddingBottom: 4 }}>
            {filtered.map(t => (
              <ThreadCard
                key={t.id}
                thread={t}
                isExpanded={expandedId === t.id}
                onToggle={() => setExpandedId(expandedId === t.id ? null : t.id)}
                onChat={() => setChatThread(t)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Expanded thread detail */}
      {expandedId && (() => {
        const t = filtered.find(th => th.id === expandedId);
        if (!t) return null;
        return (
          <div style={{ marginTop: 14 }}>
            <ThreadExpanded
            thread={t}
            searchTerm={searchTerm}
            onSummaryUpdate={(update) => handleSummaryUpdate(t.id, update)}
          />
          </div>
        );
      })()}

      {/* One-pager button */}
      {loaded && threads.length > 0 && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border, rgba(0,0,0,0.07))", display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={() => void generateOnePager()}
            disabled={generatingOnePager}
            style={{
              padding: "8px 18px", borderRadius: 7, fontSize: "0.875rem", fontWeight: 600,
              background: "var(--twilio-navy, #121c2d)", color: "#fff", border: "none",
              cursor: generatingOnePager ? "not-allowed" : "pointer", opacity: generatingOnePager ? 0.7 : 1,
              display: "flex", alignItems: "center", gap: 7,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 14a1 1 0 001 1h10a1 1 0 001-1V5l-4-4H3a1 1 0 00-1 1v12zm9-9h2.5L11 2.5V5zM8 7v4m0 0l-1.5-1.5M8 11l1.5-1.5"/>
            </svg>
            {generatingOnePager ? "Generating…" : "Download Status One-Pager"}
          </button>
        </div>
      )}

      {/* Thread chat modal */}
      {chatThread && <ThreadChatPanel thread={chatThread} onClose={() => setChatThread(null)} />}
    </div>
  );
}
