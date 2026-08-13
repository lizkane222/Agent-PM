import React, { useState } from "react";
import type { GmailThread, GmailCalendarSlot } from "../../lib/api";
import { integrationsApi } from "../../lib/api";
import { EmailStatusBadge, STATUS_COLORS } from "./EmailStatusBadge";

function formatEmailDate(raw: string): string {
  if (!raw) return "";
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return raw;
  }
}

function applyHighlight(text: string, searchTerm: string, baseKey: number): React.ReactNode[] {
  if (!searchTerm.trim()) return [<React.Fragment key={baseKey}>{text}</React.Fragment>];
  const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((part, i) =>
    i % 2 === 1
      ? <mark key={baseKey + i} style={{ background: "rgba(245,158,11,0.25)", borderRadius: 2, padding: "0 1px" }}>{part}</mark>
      : <React.Fragment key={baseKey + i}>{part}</React.Fragment>
  );
}

function renderBody(
  body: string,
  slots: GmailCalendarSlot[],
  searchTerm: string
): React.ReactNode {
  const slotByUrl: Record<string, GmailCalendarSlot> = {};
  for (const s of slots) slotByUrl[s.url] = s;

  // Match <URL> angle-bracket form or bare https:// URLs
  const URL_RE = /<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<>'"]+)/g;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;

  while ((m = URL_RE.exec(body)) !== null) {
    if (m.index > last) {
      nodes.push(...applyHighlight(body.slice(last, m.index), searchTerm, key));
      key += 200;
    }
    const raw = m[1] ?? m[2];
    const url = raw.replace(/[).,;>]+$/, "");
    const slot = slotByUrl[url];

    if (slot) {
      nodes.push(
        <a key={key++} href={url} target="_blank" rel="noopener noreferrer"
          style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            margin: "2px 4px", padding: "3px 9px", borderRadius: 6,
            background: "rgba(18,28,45,0.06)", color: "var(--twilio-navy, #121c2d)",
            fontWeight: 600, fontSize: "0.75rem", textDecoration: "none",
            border: "1px solid rgba(18,28,45,0.18)", cursor: "pointer",
          }}>
          📅 {slot.label}
        </a>
      );
    } else if (url.includes("calendar.google.com")) {
      nodes.push(
        <a key={key++} href={url} target="_blank" rel="noopener noreferrer"
          style={{ color: "var(--twilio-navy, #121c2d)", fontSize: "0.75rem", textDecoration: "underline" }}>
          View in Calendar
        </a>
      );
    } else {
      nodes.push(
        <a key={key++} href={url} target="_blank" rel="noopener noreferrer"
          style={{ color: "#2563eb", textDecoration: "underline", wordBreak: "break-all", fontSize: "0.8125rem" }}>
          {url.length > 60 ? url.slice(0, 57) + "…" : url}
        </a>
      );
    }
    last = m.index + m[0].length;
  }

  if (last < body.length) {
    nodes.push(...applyHighlight(body.slice(last), searchTerm, key));
  }

  return <>{nodes}</>;
}

export function ThreadCard({ thread, isExpanded, onToggle, onChat }: {
  thread: GmailThread; isExpanded: boolean; onToggle: () => void; onChat: () => void;
}) {
  const color = STATUS_COLORS[thread.status_color] ?? STATUS_COLORS.gray;
  const displayParticipants = (thread.all_participants ?? thread.participants).slice(0, 2).join(", ");
  return (
    <div style={{
      minWidth: 260, maxWidth: 300, flexShrink: 0, borderRadius: 10,
      border: `1px solid ${isExpanded ? "var(--twilio-red, #e22)" : "var(--border, rgba(0,0,0,0.1))"}`,
      background: "var(--surface, #fff)", cursor: "pointer",
      boxShadow: isExpanded ? "0 0 0 2px rgba(226,35,26,0.18)" : "0 1px 4px rgba(0,0,0,0.06)",
      transition: "box-shadow 0.15s, border-color 0.15s",
    }}>
      <div style={{ padding: "14px 14px 10px" }} onClick={onToggle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <EmailStatusBadge status={thread.status} color={thread.status_color} />
          <button
            onClick={e => { e.stopPropagation(); onChat(); }}
            title="Chat about this thread"
            style={{
              background: "rgba(226,35,26,0.07)", border: "none", borderRadius: 6,
              padding: "4px 7px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
              color: "var(--twilio-red, #e22)", fontSize: "0.6875rem", fontWeight: 600,
            }}
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 2h12v9H9l-3 3v-3H2V2z"/>
            </svg>
            Chat
          </button>
        </div>
        <p style={{ margin: "0 0 5px", fontSize: "0.8125rem", fontWeight: 700, color: "var(--text-primary, #111)", lineHeight: 1.35,
          overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
          {thread.subject}
        </p>
        <p style={{ margin: "0 0 8px", fontSize: "0.75rem", color: "var(--text-secondary, #666)", lineHeight: 1.45,
          overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
          {thread.summary || thread.snippet}
        </p>
        {thread.next_action && (
          <p style={{ margin: "0 0 8px", fontSize: "0.6875rem", padding: "4px 8px", borderRadius: 5,
            background: color.bg, color: color.text, lineHeight: 1.4 }}>
            → {thread.next_action}
          </p>
        )}
        <div style={{ display: "flex", gap: 10, fontSize: "0.6875rem", color: "var(--text-secondary, #aaa)" }}>
          <span>{thread.message_count} msg{thread.message_count !== 1 ? "s" : ""}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {displayParticipants}
          </span>
        </div>
      </div>
      <div style={{ padding: "4px 14px 8px", textAlign: "right" }} onClick={onToggle}>
        <span style={{ fontSize: "0.6875rem", color: "var(--text-secondary, #aaa)" }}>
          {isExpanded ? "▲ collapse" : "▼ view thread"}
        </span>
      </div>
    </div>
  );
}

export function ThreadExpanded({
  thread,
  searchTerm,
  onSummaryUpdate,
}: {
  thread: GmailThread;
  searchTerm: string;
  onSummaryUpdate?: (update: Pick<GmailThread, "summary" | "status" | "status_color" | "next_action">) => void;
}) {
  const slots = thread.calendar_slots ?? [];
  const allP = thread.all_participants ?? thread.participants;
  const responded = thread.responders ?? thread.participants;
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefreshSummary() {
    if (!onSummaryUpdate) return;
    setRefreshing(true);
    try {
      const { data } = await integrationsApi.summarizeThread({
        subject: thread.subject,
        messages: thread.messages,
        all_participants: allP,
        is_invitation: thread.is_invitation ?? false,
      });
      onSummaryUpdate(data);
    } catch { /* silent */ } finally {
      setRefreshing(false);
    }
  }

  return (
    <div style={{
      borderRadius: 10, border: "1px solid var(--border, rgba(0,0,0,0.1))",
      background: "var(--bg, #f5f5f5)", padding: "16px 20px",
      display: "flex", flexDirection: "column", gap: 12,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <p style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-primary, #111)", flex: 1 }}>
          {thread.subject}
        </p>
        <EmailStatusBadge status={thread.status} color={thread.status_color} />
        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary, #aaa)" }}>
          {thread.message_count} message{thread.message_count !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Summary + participants */}
      {(thread.summary || allP.length > 0) && (
        <div style={{
          padding: "10px 14px", borderRadius: 7, fontSize: "0.8125rem", lineHeight: 1.55,
          background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))",
          color: "var(--text-primary, #111)", display: "flex", flexDirection: "column", gap: 6,
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
            {thread.summary && (
              <p style={{ margin: 0, flex: 1 }}><strong>Summary:</strong> {thread.summary}</p>
            )}
            {onSummaryUpdate && (
              <button
                onClick={() => void handleRefreshSummary()}
                disabled={refreshing}
                title="Refresh summary"
                style={{
                  flexShrink: 0, background: "none", border: "1px solid var(--border, rgba(0,0,0,0.12))",
                  borderRadius: 5, padding: "3px 7px", cursor: refreshing ? "not-allowed" : "pointer",
                  fontSize: "0.6875rem", color: "var(--text-secondary, #666)",
                  display: "flex", alignItems: "center", gap: 4, opacity: refreshing ? 0.5 : 1,
                }}
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round"
                  style={{ animation: refreshing ? "spin 1s linear infinite" : "none" }}>
                  <path d="M13.5 8a5.5 5.5 0 1 1-1.1-3.3"/>
                  <path d="M13.5 2v3.5H10"/>
                </svg>
                {refreshing ? "Refreshing…" : "Refresh"}
              </button>
            )}
          </div>
          {allP.length > 0 && (
            <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-secondary, #555)" }}>
              <strong>All participants:</strong> {allP.join(", ")}
            </p>
          )}
          {responded.length > 0 && responded.length < allP.length && (
            <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-secondary, #555)" }}>
              <strong>Responded:</strong> {responded.join(", ")}
            </p>
          )}
        </div>
      )}

      {/* Messages */}
      {thread.messages.map((m, i) => (
        <div key={i} style={{
          padding: "12px 14px", borderRadius: 8, background: "var(--surface, #fff)",
          border: "1px solid var(--border, rgba(0,0,0,0.07))",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--twilio-navy, #121c2d)" }}>
              {m.from}
            </span>
            <span style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--twilio-navy, #121c2d)" }}>
              {formatEmailDate(m.date)}
            </span>
          </div>
          <p style={{
            margin: 0, fontSize: "0.8125rem", lineHeight: 1.55,
            color: "var(--text-primary, #111)", whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>
            {renderBody(m.body, slots, searchTerm)}
          </p>
        </div>
      ))}
    </div>
  );
}
