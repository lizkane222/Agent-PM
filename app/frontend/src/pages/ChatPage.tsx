/**
 * ChatPage — full-screen chat interface with persistent message history.
 *
 * Uses the streaming /agents/sessions/send/ endpoint and renders tokens
 * as they arrive. The TranscriptFooter in Layout handles quick prompts;
 * this page is for focused multi-turn conversations.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { agentApi } from "../lib/api";
import { consumeExportToChat, EXPORT_ITEM_DRAG_KEY } from "../components/ExportBar";
import { AttachmentList } from "../components/chat/AttachmentChip";
import { formatMessageWithAttachments, parseMessageAttachments, type ChatAttachment } from "../lib/chatAttachments";
import { fmtUsd } from "../lib/tokenBudget";
import type { ExportItem } from "../context/ExportContext";
import ConversationIcon from "../assets/icons/Conversation.svg?react";
import PageBuilder from "../components/pagebuilder/PageBuilder";
import { getAccessToken, isTokenExpired, refreshAccessToken } from "../lib/auth";
import { budgetBlockedMessage } from "../lib/tokenBudget";
import type { AgentSession, SessionParticipant } from "../types";
import SlashSkillMenu from "../components/chat/SlashSkillMenu";
import { useSlashSkills } from "../hooks/useSlashSkills";

const LAST_SESSION_KEY = "agentpm_last_session_id";

interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  timestamp: Date;
  /** Real usage for an assistant message (from the stream's usage frame or the stored row). */
  usage?: { input: number; output: number; costUsd?: string | undefined };
}

/** Maps a stored API message onto what the page displays. */
function toDisplayMessage(m: { role: string; content: string; created_at?: string; input_tokens?: number; output_tokens?: number; cost_usd?: string }): DisplayMessage {
  const role = m.role === "tool_result" ? "assistant" : (m.role as "user" | "assistant");
  const usage = role === "assistant" && ((m.input_tokens ?? 0) > 0 || (m.output_tokens ?? 0) > 0)
    ? { input: m.input_tokens ?? 0, output: m.output_tokens ?? 0, costUsd: m.cost_usd }
    : undefined;
  return { role, content: m.content, timestamp: new Date(m.created_at ?? Date.now()), ...(usage ? { usage } : {}) };
}

const CONVERSATION_STARTERS = [
  {
    question: "How do I use this app?",
    answer:
      "Agent PM is organized across several key pages:\n\n**Dashboard** — your at-a-glance view of upcoming meetings, open action items, and team activity.\n\n**Calendar** — synced from your connected calendar, showing scheduled events with the ability to add or manage them via voice or chat.\n\n**Action Items** — a task board for tracking deliverables across your team and accounts.\n\n**Agent (this page)** — your AI assistant. Ask it anything: schedule meetings, draft emails, look up account notes, or run workflows on your behalf.\n\n**Claude Skills** — custom Python functions you can give the agent to extend its capabilities.\n\n**Accounts & Team** — CRM-style views of your accounts and teammates, with notes and activity history.\n\nYou can interact with the agent from any page using the quick-input bar at the bottom of the screen, or come here for a full focused conversation.",
  },
  {
    question: "What's the coolest thing this app can do?",
    answer:
      "With Twilio Voice powering Agent PM, you can click \"Start Voice Session\" on any page and give Agent PM tasks to carry out on your behalf — completely hands-free. This includes creating new action items, setting reminders that will notify you in-app, on your computer, or even on your phone via SMS. Just speak naturally and the agent handles the rest.",
  },
  {
    question: "How often is the data updated?",
    answer:
      "A Claude agent is configured to check all connected databases for new data every 15 minutes automatically. If you'd like to trigger a manual sync right now, click the stick figure icon above your username at the bottom of the left navigation sidebar.",
  },
  {
    question: "Can the agent take action on my behalf?",
    answer:
      "Yes — Agent PM isn't just conversational. It can create and update action items, draft and send calendar invites, log notes to accounts, and trigger custom workflows via Claude Skills. You can also chain tasks: \"Schedule a follow-up with Acme Corp next Tuesday and create an action item to prep the deck beforehand.\"",
  },
  {
    question: "How do I connect my calendar or Salesforce?",
    answer:
      "Head to **Settings** in the left sidebar. Under Integrations you'll find OAuth flows for Google Calendar, Salesforce, Airtable, and Slack. Once connected, the agent can read and write to those services on your behalf — pulling in meetings, syncing contacts, and pushing updates back automatically.",
  },
];

const chatCSS = `
@keyframes slideDown {
  from { opacity: 0; transform: translateY(-8px); }
  to   { opacity: 1; transform: translateY(0); }
}
`;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      style={{ flexShrink: 0, alignSelf: "center", padding: "2px 4px", borderRadius: "6px", color: "var(--text-secondary, #aaa)", background: "transparent", border: "none", cursor: "pointer", opacity: 0.6 }}
      onMouseEnter={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = "rgba(0,0,0,0.05)"; }}
      onMouseLeave={e => { e.currentTarget.style.opacity = "0.6"; e.currentTarget.style.background = "transparent"; }}
      title="Copy message"
    >
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      )}
    </button>
  );
}

function ThinkingBubble() {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: "8px" }}>
      <div style={{ width: "28px", height: "28px", borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(226,35,26,0.08)", color: "var(--twilio-red, #e22)" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
      <div style={{ padding: "12px 16px", borderRadius: "12px", background: "var(--chat-agent-bubble, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", display: "flex", alignItems: "center", gap: "5px" }} role="status" aria-label="Agent is thinking">
        <style>{`
          @keyframes thinkingDot {
            0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
            40% { transform: scale(1); opacity: 1; }
          }
        `}</style>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{
            display: "inline-block", width: "7px", height: "7px", borderRadius: "50%",
            background: "var(--twilio-red, #e22)",
            animation: `thinkingDot 1.2s ease-in-out ${i * 0.2}s infinite`,
          }} />
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: DisplayMessage }) {
  const isUser = message.role === "user";
  const [showUsage, setShowUsage] = useState(false);
  const time = message.timestamp.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  // Attached records render as chips; the full text is still what was sent to the model.
  const { text, attachments } = parseMessageAttachments(message.content);
  const usage = message.usage;
  const metaStyle = { fontSize: "0.6875rem", color: "var(--text-secondary, #888)" } as const;
  return (
    <div
      data-testid="chat-message"
      data-role={message.role}
      style={{ display: "flex", gap: "8px", alignItems: "flex-start", justifyContent: isUser ? "flex-end" : "flex-start" }}
    >
      {!isUser && (
        <div style={{ flexShrink: 0, height: "28px", width: "28px", borderRadius: "50%", background: "var(--twilio-red, #e22)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "0.6875rem", fontWeight: 700 }}>
          AI
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxWidth: "min(85%, 560px)", minWidth: 0, alignItems: isUser ? "flex-end" : "flex-start" }}>
        <div
          style={{
            padding: "10px 14px", borderRadius: "12px", maxWidth: "100%",
            fontSize: "0.875rem", lineHeight: 1.55,
            background: isUser ? "var(--twilio-gray-10, #f4f4f6)" : "var(--chat-agent-bubble, #fff)",
            color: "var(--text-primary, #111)",
            border: "1px solid var(--border, rgba(0,0,0,0.08))",
            display: "flex", flexDirection: "column", gap: attachments.length ? 8 : 0,
          }}
        >
          {attachments.length > 0 && <AttachmentList attachments={attachments} />}
          {(text || message.isStreaming || attachments.length === 0) && (
            <p style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {text}
              {message.isStreaming && (
                <span style={{ display: "inline-block", marginLeft: "4px", height: "14px", width: "2px", background: "currentColor", verticalAlign: "middle", animation: "pulse 1s infinite" }} />
              )}
            </p>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: isUser ? "row-reverse" : "row" }}>
          <span style={metaStyle}>{time}</span>
          {!message.isStreaming && <CopyButton text={text || message.content} />}
          {!isUser && usage && !message.isStreaming && (
            <button
              type="button"
              onClick={() => setShowUsage((v) => !v)}
              aria-expanded={showUsage}
              title="Show token usage and cost for this reply"
              style={{ ...metaStyle, background: "transparent", border: "none", cursor: "pointer", padding: 0, fontVariantNumeric: "tabular-nums" }}
            >
              {showUsage
                ? `${(usage.input + usage.output).toLocaleString()} tokens (${usage.input.toLocaleString()} in · ${usage.output.toLocaleString()} out)${usage.costUsd !== undefined ? ` · ${fmtUsd(usage.costUsd)}` : ""}`
                : "tokens · cost"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M10 11v6"/>
      <path d="M14 11v6"/>
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
    </svg>
  );
}

function SharePicker({
  session,
  onClose,
  onShared,
}: {
  session: AgentSession;
  onClose: () => void;
  onShared: (updated: AgentSession) => void;
}) {
  const [users, setUsers] = useState<SessionParticipant[]>([]);
  const [selected, setSelected] = useState<Set<number>>(
    new Set(session.participants.map(p => p.id))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    agentApi.listUsers().then(({ data }) => setUsers(data)).catch(() => {});
  }, []);

  // Close on outside click.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const toggle = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleShare = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    setError("");
    try {
      const { data } = await agentApi.shareSession(session.id, [...selected]);
      onShared(data);
      onClose();
    } catch {
      setError("Failed to share. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      ref={pickerRef}
      style={{
        position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 100,
        background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.12))",
        borderRadius: "10px", padding: "12px", minWidth: "220px", maxWidth: "260px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
      }}
      onClick={e => e.stopPropagation()}
    >
      <p style={{ margin: "0 0 10px", fontSize: "0.75rem", fontWeight: 700, color: "var(--text-primary, #111)", fontFamily: "var(--font-base)" }}>
        Share with teammates
      </p>
      {users.length === 0 ? (
        <p style={{ fontSize: "0.75rem", color: "var(--text-secondary, #aaa)", fontFamily: "var(--font-base)" }}>No other users found.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "160px", overflowY: "auto" }}>
          {users.map(u => (
            <label
              key={u.id}
              style={{
                display: "flex", alignItems: "center", gap: "8px", padding: "6px 8px",
                borderRadius: "6px", cursor: "pointer", fontSize: "0.8125rem",
                fontFamily: "var(--font-base)", color: "var(--text-primary, #111)",
                background: selected.has(u.id) ? "var(--twilio-red-tint, rgba(226,35,26,0.06))" : "transparent",
              }}
              onMouseEnter={e => { if (!selected.has(u.id)) (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.03)"; }}
              onMouseLeave={e => { if (!selected.has(u.id)) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <input
                type="checkbox"
                checked={selected.has(u.id)}
                onChange={() => toggle(u.id)}
                style={{ accentColor: "var(--twilio-red, #e22)", flexShrink: 0 }}
              />
              <div style={{ overflow: "hidden" }}>
                <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {u.display_name}
                </div>
                <div style={{ fontSize: "0.6875rem", color: "var(--text-secondary, #888)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {u.email}
                </div>
              </div>
            </label>
          ))}
        </div>
      )}
      {error && <p style={{ margin: "8px 0 0", fontSize: "0.75rem", color: "var(--twilio-red, #e22)", fontFamily: "var(--font-base)" }}>{error}</p>}
      <button
        onClick={() => void handleShare()}
        disabled={saving || selected.size === 0}
        style={{
          marginTop: "10px", width: "100%", padding: "7px", borderRadius: "7px",
          background: "var(--twilio-red, #e22)", color: "#fff", border: "none",
          fontSize: "0.8125rem", fontWeight: 600, cursor: saving || selected.size === 0 ? "not-allowed" : "pointer",
          opacity: saving || selected.size === 0 ? 0.5 : 1, fontFamily: "var(--font-base)",
        }}
      >
        {saving ? "Sharing…" : "Share"}
      </button>
    </div>
  );
}

function SessionRow({
  session,
  isActive,
  onSelect,
  onDelete,
  onRename,
  onShare,
}: {
  session: AgentSession;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  onShare: (updated: AgentSession) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [draft, setDraft] = useState(session.title || `Session ${session.id}`);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirming) {
      onDelete();
    } else {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
    }
  };

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(session.title || `Session ${session.id}`);
    setEditing(true);
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 20);
  };

  const commitEdit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== (session.title || `Session ${session.id}`)) {
      onRename(trimmed);
    }
    setEditing(false);
  };

  return (
    <div
      style={{
        position: "relative",
        display: "flex", alignItems: "center", width: "100%",
        background: isActive ? "var(--twilio-red-tint, rgba(226,35,26,0.06))" : "transparent",
        borderLeft: isActive ? "3px solid var(--twilio-red, #e22)" : "3px solid transparent",
        transition: "background 0.12s",
      }}
      onMouseEnter={(e) => { setHovered(true); if (!isActive) e.currentTarget.style.background = "rgba(0,0,0,0.03)"; }}
      onMouseLeave={(e) => { setHovered(false); setConfirming(false); if (!isActive) e.currentTarget.style.background = "transparent"; }}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => {
            if (e.key === "Enter") commitEdit();
            if (e.key === "Escape") setEditing(false);
          }}
          style={{
            flex: 1, margin: "4px 8px", padding: "4px 8px", fontSize: "0.875rem",
            border: "1px solid var(--twilio-red, #e22)", borderRadius: "5px",
            outline: "none", fontFamily: "var(--font-base)", background: "var(--surface, #fff)",
            color: "var(--text-primary, #111)",
          }}
        />
      ) : (
        <button
          onClick={onSelect}
          style={{
            flex: 1, textAlign: "left", padding: "10px 16px", fontSize: "0.875rem", fontWeight: isActive ? 600 : 400,
            color: isActive ? "var(--twilio-red, #e22)" : "var(--text-primary, #111)",
            background: "transparent", border: "none", cursor: "pointer", overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-base)",
          }}
        >
          {session.is_shared && (
            <span style={{ marginRight: "5px", fontSize: "0.7rem", opacity: 0.6 }} title={`Shared with ${session.participants.map(p => p.display_name).join(", ")}`}>
              👥
            </span>
          )}
          {session.title || `Session ${session.id}`}
        </button>
      )}
      {hovered && !editing && (
        <div style={{ display: "flex", alignItems: "center", gap: "2px", marginRight: "8px", flexShrink: 0 }}>
          <button
            onClick={e => { e.stopPropagation(); setSharing(v => !v); }}
            title="Share conversation"
            style={{
              padding: "4px", borderRadius: "4px", border: "none",
              background: sharing ? "var(--twilio-red-tint, rgba(226,35,26,0.06))" : "transparent",
              color: sharing ? "var(--twilio-red, #e22)" : "var(--text-secondary, #aaa)",
              cursor: "pointer",
            }}
          >
            <ShareIcon />
          </button>
          <button
            onClick={startEdit}
            title="Rename conversation"
            style={{
              padding: "4px", borderRadius: "4px", border: "none",
              background: "transparent", color: "var(--text-secondary, #aaa)", cursor: "pointer",
            }}
          >
            <PencilIcon />
          </button>
          <button
            onClick={handleDelete}
            title={confirming ? "Click again to confirm" : "Delete conversation"}
            style={{
              padding: "4px", borderRadius: "4px", border: "none",
              background: confirming ? "rgba(226,35,26,0.08)" : "transparent",
              color: confirming ? "var(--twilio-red, #e22)" : "var(--text-secondary, #aaa)",
              cursor: "pointer",
            }}
          >
            <TrashIcon />
          </button>
        </div>
      )}
      {sharing && (
        <SharePicker
          session={session}
          onClose={() => setSharing(false)}
          onShared={updated => { onShare(updated); setSharing(false); }}
        />
      )}
    </div>
  );
}

function StarterCards({
  onSelect,
  onClose,
  messages,
  isSending,
  input,
  onInputChange,
  onKeyDown,
  onSend,
  messagesEndRef,
}: {
  onSelect: (q: string) => void;
  onClose: () => void;
  messages: DisplayMessage[];
  isSending: boolean;
  input: string;
  onInputChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  messagesEndRef: React.RefObject<HTMLDivElement>;
}) {

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Starter cards — always visible */}
      <div style={{ flexShrink: 0, padding: "24px 28px 20px", borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))", background: "var(--surface, #fff)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
          <h2 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700, fontFamily: "var(--font-base)" }}>Where to start</h2>
          <button
            onClick={onClose}
            style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "0.875rem", color: "var(--text-secondary, #888)", fontFamily: "var(--font-base)", padding: "4px 8px" }}
            onMouseEnter={e => e.currentTarget.style.color = "var(--text-primary, #111)"}
            onMouseLeave={e => e.currentTarget.style.color = "var(--text-secondary, #888)"}
          >
            ✕ close
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          {CONVERSATION_STARTERS.map((s, i) => {
            return (
              <button
                key={i}
                onClick={() => onSelect(s.question)}
                style={{
                  padding: "10px 14px",
                  borderRadius: "10px",
                  border: "1px solid var(--border, rgba(0,0,0,0.08))",
                  background: "var(--surface, #fff)",
                  textAlign: "left",
                  cursor: "pointer",
                  transition: "border-color 0.15s, background 0.15s",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
                onMouseOver={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "#818cf8";
                  (e.currentTarget as HTMLButtonElement).style.background = "var(--tint-indigo-50, #eef2ff)";
                }}
                onMouseOut={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border, rgba(0,0,0,0.08))";
                  (e.currentTarget as HTMLButtonElement).style.background = "var(--surface, #fff)";
                }}
              >
                <span style={{ fontSize: "0.8125rem", lineHeight: 1 }}>
                  {["💬", "✨", "🔄", "⚡", "🔗"][i] ?? "💬"}
                </span>
                <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--twilio-navy, #061237)", lineHeight: 1.3 }}>
                  {s.question}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Messages below the cards */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px", display: "flex", flexDirection: "column", gap: "16px", background: "var(--bg, #f5f5f5)" }}>
        {messages.length === 0 && (
          <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #aaa)", textAlign: "center", paddingTop: "12px", fontFamily: "var(--font-base)" }}>
            Pick a question above or type your own below.
          </p>
        )}
        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}
        {isSending && <ThinkingBubble />}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ borderTop: "1px solid var(--border, rgba(0,0,0,0.08))", padding: "16px 24px", display: "flex", gap: "12px", alignItems: "flex-end", background: "var(--surface, #fff)" }}>
        <textarea
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
          disabled={isSending}
          style={{ flex: 1, resize: "none", padding: "14px 18px", borderRadius: "12px", fontSize: "0.875rem", border: "1px solid var(--border, rgba(0,0,0,0.12))", background: "var(--surface, #fff)", outline: "none", fontFamily: "var(--font-base)", lineHeight: 1.5 }}
        />
        <button
          onClick={onSend}
          disabled={isSending || !input.trim()}
          style={{ padding: "14px 24px", borderRadius: "12px", fontSize: "0.9375rem", fontWeight: 600, background: "var(--twilio-red, #e22)", color: "#fff", border: "none", cursor: "pointer", opacity: (isSending || !input.trim()) ? 0.4 : 1, fontFamily: "var(--font-base)", whiteSpace: "nowrap" }}
        >
          {isSending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}

function MainStarterGrid({ onSelect }: { onSelect: (q: string) => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", width: "100%", maxWidth: "680px" }}>
      {CONVERSATION_STARTERS.map((s, i) => {
        return (
          <button
            key={i}
            onClick={() => onSelect(s.question)}
            style={{
              padding: "12px 14px",
              borderRadius: "12px",
              border: "1px solid var(--border, rgba(0,0,0,0.08))",
              background: "var(--surface, #fff)",
              textAlign: "left",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontFamily: "var(--font-base)",
            }}
            onMouseOver={e => { (e.currentTarget).style.borderColor = "var(--twilio-red, #e22)"; (e.currentTarget).style.background = "rgba(226,35,26,0.04)"; }}
            onMouseOut={e => { (e.currentTarget).style.borderColor = "var(--border, rgba(0,0,0,0.08))"; (e.currentTarget).style.background = "var(--surface, #fff)"; }}
          >
            <span style={{ fontSize: "0.875rem", lineHeight: 1, flexShrink: 0 }}>
              {["💬", "✨", "🔄", "⚡", "🔗"][i] ?? "💬"}
            </span>
            <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-primary, #111)", lineHeight: 1.35 }}>
              {s.question}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ChatNameHeader({
  sessionId,
  title,
  onRename,
}: {
  sessionId: number | null;
  title: string;
  onRename: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const displayTitle = title || (sessionId ? `Session ${sessionId}` : "New conversation");

  const startEdit = () => {
    setDraft(displayTitle);
    setEditing(true);
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 20);
  };

  const commitEdit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== displayTitle) onRename(trimmed);
    setEditing(false);
  };

  return (
    <div style={{
      flexShrink: 0, display: "flex", alignItems: "center", gap: "10px",
      padding: "10px 24px", borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))",
      background: "var(--surface, #fff)", zIndex: 10,
    }}>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => {
            if (e.key === "Enter") commitEdit();
            if (e.key === "Escape") setEditing(false);
          }}
          style={{
            flex: 1, fontSize: "0.9375rem", fontWeight: 600,
            padding: "4px 10px", borderRadius: "6px",
            border: "1px solid var(--twilio-red, #e22)", outline: "none",
            fontFamily: "var(--font-base)", background: "var(--surface, #fff)",
            color: "var(--text-primary, #111)",
          }}
        />
      ) : (
        <span
          onClick={startEdit}
          title="Click to rename"
          style={{
            flex: 1, fontSize: "0.9375rem", fontWeight: 600,
            color: "var(--text-primary, #111)", fontFamily: "var(--font-base)",
            cursor: "text", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}
        >
          {displayTitle}
        </span>
      )}
      {!editing && (
        <button
          onClick={startEdit}
          title="Rename conversation"
          style={{
            flexShrink: 0, padding: "4px", borderRadius: "4px", border: "none",
            background: "transparent", color: "var(--text-secondary, #aaa)",
            cursor: "pointer", display: "flex", alignItems: "center",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = "var(--text-primary, #111)"; e.currentTarget.style.background = "rgba(0,0,0,0.05)"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "var(--text-secondary, #aaa)"; e.currentTarget.style.background = "transparent"; }}
        >
          <PencilIcon />
        </button>
      )}
      {!editing && sessionId !== null && (
        <ExportSessionButton sessionId={sessionId} sessionTitle={displayTitle} />
      )}
    </div>
  );
}

function ExportSessionButton({ sessionId, sessionTitle }: { sessionId: number; sessionTitle: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"json" | "md" | null>(null);

  async function download(format: "json" | "md") {
    setBusy(format);
    try {
      const { data } = await agentApi.exportSession(sessionId, format);
      const blob = data instanceof Blob ? data : new Blob([data as BlobPart], {
        type: format === "md" ? "text/markdown" : "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safeTitle = (sessionTitle || `session-${sessionId}`).replace(/[^\w.-]+/g, "-").slice(0, 60);
      a.href = url;
      a.download = `${safeTitle}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch { /* best-effort */ } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Export conversation"
        style={{
          padding: "4px 8px", borderRadius: "4px", border: "none",
          background: "transparent", color: "var(--text-secondary, #aaa)",
          cursor: "pointer", fontSize: "0.75rem", fontFamily: "var(--font-base)",
        }}
        onMouseEnter={e => { e.currentTarget.style.color = "var(--text-primary, #111)"; e.currentTarget.style.background = "rgba(0,0,0,0.05)"; }}
        onMouseLeave={e => { e.currentTarget.style.color = "var(--text-secondary, #aaa)"; e.currentTarget.style.background = "transparent"; }}
      >
        Export
      </button>
      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 30,
            background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.1))",
            borderRadius: "6px", boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            minWidth: "160px", overflow: "hidden",
          }}
        >
          <button
            onClick={() => void download("md")}
            disabled={busy !== null}
            style={{
              display: "block", width: "100%", textAlign: "left",
              padding: "8px 12px", border: "none", background: "transparent",
              color: "var(--text-primary, #111)", cursor: busy ? "wait" : "pointer",
              fontSize: "0.8125rem", fontFamily: "var(--font-base)",
            }}
          >{busy === "md" ? "Downloading…" : "Download as Markdown"}</button>
          <button
            onClick={() => void download("json")}
            disabled={busy !== null}
            style={{
              display: "block", width: "100%", textAlign: "left",
              padding: "8px 12px", border: "none", background: "transparent",
              color: "var(--text-primary, #111)", cursor: busy ? "wait" : "pointer",
              fontSize: "0.8125rem", fontFamily: "var(--font-base)",
              borderTop: "1px solid var(--border, rgba(0,0,0,0.06))",
            }}
          >{busy === "json" ? "Downloading…" : "Download as JSON"}</button>
        </div>
      )}
    </div>
  );
}

function ExportBuilderPanel({
  expanded,
  onToggleExpand,
  onClose,
}: {
  expanded: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        height: expanded ? "100vh" : "50vh",
        flexShrink: 0,
        borderTop: "2px solid var(--twilio-red, #e22)",
        display: "flex",
        flexDirection: "column",
        background: "var(--surface, #fff)",
        overflow: "hidden",
        transition: "height 0.3s cubic-bezier(0.22,1,0.36,1)",
        position: expanded ? "fixed" : "relative",
        inset: expanded ? 0 : undefined,
        zIndex: expanded ? 100 : undefined,
      }}
    >
      {/* Panel toolbar */}
      <div style={{
        flexShrink: 0,
        height: "36px",
        display: "flex",
        alignItems: "center",
        paddingLeft: "16px",
        paddingRight: "12px",
        gap: "8px",
        borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))",
        background: "var(--surface, #fff)",
      }}>
        <span style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--twilio-gray-60, #8891aa)", flex: 1 }}>
          Layout Builder — drag components, drop content, save as layout
        </span>
        <button
          onClick={onToggleExpand}
          title={expanded ? "Collapse to half" : "Expand full screen"}
          style={{ padding: "3px 6px", border: "none", borderRadius: "4px", background: "transparent", cursor: "pointer", color: "var(--twilio-gray-60, #8891aa)", fontSize: "13px" }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,0,0,0.05)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
        >
          {expanded ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/>
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
            </svg>
          )}
        </button>
        <button
          onClick={onClose}
          title="Close layout builder"
          style={{ padding: "3px 6px", border: "none", borderRadius: "4px", background: "transparent", cursor: "pointer", color: "var(--twilio-gray-40, #aab)", fontSize: "15px" }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--twilio-red, #e22)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--twilio-gray-40, #aab)"; }}
        >
          ✕
        </button>
      </div>

      {/* PageBuilder fills remaining space */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <PageBuilder />
      </div>
    </div>
  );
}

export default function ChatPage() {
  const location = useLocation();
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const slash = useSlashSkills({ value: input, onChange: setInput, inputRef: composerRef });
  const [isSending, setIsSending] = useState(false);
  const [showWhereToStart, setShowWhereToStart] = useState(
    !!(location.state as { openWhereToStart?: boolean } | null)?.openWhereToStart
  );
  const [showMainStarters, setShowMainStarters] = useState(false);
  const [showExportBuilder, setShowExportBuilder] = useState(false);
  const [builderExpanded, setBuilderExpanded] = useState(false);
  // WTS has its own isolated session so it never loads the existing chat
  const [wtsMessages, setWtsMessages] = useState<DisplayMessage[]>([]);
  const [wtsSessionId, setWtsSessionId] = useState<number | null>(null);
  const [wtsInput, setWtsInput] = useState("");
  const [wtsIsSending, setWtsIsSending] = useState(false);
  const [sessionTokens, setSessionTokens] = useState<{ input: number; output: number }>({ input: 0, output: 0 });
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [dropActive, setDropActive] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wtsEndRef = useRef<HTMLDivElement>(null);

  // Load sessions on mount, restoring last viewed session.
  useEffect(() => {
    (async () => {
      try {
        const { data } = await agentApi.listSessions();
        setSessions(data.results);
        if (data.results.length > 0) {
          const savedId = localStorage.getItem(LAST_SESSION_KEY);
          const target = savedId
            ? (data.results.find((s) => s.id === parseInt(savedId, 10)) ?? data.results[0]!)
            : data.results[0]!;
          setActiveSessionId(target.id);
          setMessages(target.messages.map(toDisplayMessage));
        }
      } catch {
        // First time — no sessions yet.
      }
    })();
  }, []);

  // Persist active session to localStorage whenever it changes.
  useEffect(() => {
    if (activeSessionId !== null) {
      localStorage.setItem(LAST_SESSION_KEY, String(activeSessionId));
    }
  }, [activeSessionId]);

  // Listen for sessions created from TranscriptFooter (bottom chat bar on any page).
  useEffect(() => {
    async function onFooterSession(e: StorageEvent) {
      if (e.key !== "agentSessionUpdated" || !e.newValue) return;
      const id = parseInt(e.newValue, 10);
      try {
        const { data } = await agentApi.getSession(id);
        setSessions((prev) => {
          const exists = prev.some((s) => s.id === id);
          return exists
            ? prev.map((s) => (s.id === id ? data : s))
            : [data, ...prev];
        });
      } catch {
        // best-effort — just refresh the full list
        agentApi.listSessions().then(({ data }) => setSessions(data.results)).catch(() => {});
      }
    }
    window.addEventListener("storage", onFooterSession);
    return () => window.removeEventListener("storage", onFooterSession);
  }, []);

  // Receive "Send to Chat" from the export tray. Two paths, one payload:
  // the event fires when this page is already mounted, and the mount check below
  // covers arriving here *because* of the send. `consumeExportToChat` deletes as
  // it reads, so whichever path runs first is the only one that sends.
  useEffect(() => {
    function deliver() {
      const text = consumeExportToChat();
      if (!text) return;
      startNewSession();
      setShowExportBuilder(true);
      setBuilderExpanded(false);
      setTimeout(() => { void sendExportMessage(text); }, 80);
    }
    deliver();
    window.addEventListener("export-to-chat", deliver);
    return () => window.removeEventListener("export-to-chat", deliver);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll on new messages.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(async (overrideMessage?: string) => {
    const typed = (overrideMessage ?? input).trim();
    // Attachments ride in the same string the model receives; the UI renders them back as chips.
    const attached = overrideMessage === undefined ? pendingAttachments : [];
    if ((!typed && attached.length === 0) || isSending) return;
    const message = formatMessageWithAttachments(
      typed || (attached.length ? "Please review the attached records." : ""), attached);

    setInput("");
    setPendingAttachments([]);
    setIsSending(true);
    setShowMainStarters(true); // reveal sticky starters bar on first send
    const now = new Date();
    setMessages((prev) => [
      ...prev,
      { role: "user", content: message, timestamp: now },
      { role: "assistant", content: "", isStreaming: true, timestamp: now },
    ]);

    try {
      // Proactively refresh the access token if it has expired so the
      // streaming fetch (which bypasses the Axios interceptor) stays authenticated.
      let token = getAccessToken();
      if (!token || isTokenExpired(token)) {
        token = await refreshAccessToken();
      }
      const baseUrl = import.meta.env["VITE_API_BASE_URL"] ?? "/api/v1";

      const response = await fetch(`${baseUrl}/agents/sessions/send/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message,
          session_id: activeSessionId ?? undefined,
        }),
      });

      const sessionId = response.headers.get("X-Session-Id");
      if (sessionId) {
        const newId = parseInt(sessionId, 10);
        setActiveSessionId(newId);
        localStorage.setItem(LAST_SESSION_KEY, String(newId));
        agentApi.getSession(newId).then(({ data: sess }) => {
          setSessions((prev) => {
            const exists = prev.some((s) => s.id === newId);
            return exists ? prev.map((s) => (s.id === newId ? sess : s)) : [sess, ...prev];
          });
        }).catch(() => {});
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(budgetBlockedMessage(response.status, errText) ?? `Server error ${response.status}: ${errText.slice(0, 200)}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body.");

      const decoder = new TextDecoder();
      let accumulated = "";
      const TOKEN_SENTINEL = "\x00TOKEN_USAGE:";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });

        // Extract token usage sentinel frames before appending to the displayed text.
        const sentinelIdx = chunk.indexOf(TOKEN_SENTINEL);
        const textChunk = sentinelIdx >= 0 ? chunk.slice(0, sentinelIdx) : chunk;
        if (sentinelIdx >= 0) {
          try {
            const jsonStart = sentinelIdx + TOKEN_SENTINEL.length;
            const jsonEnd = chunk.indexOf("\x00", jsonStart);
            const raw = chunk.slice(jsonStart, jsonEnd >= 0 ? jsonEnd : undefined);
            const usage = JSON.parse(raw) as { input_tokens: number; output_tokens: number; cost_usd?: string };
            setSessionTokens(prev => ({
              input: prev.input + (usage.input_tokens ?? 0),
              output: prev.output + (usage.output_tokens ?? 0),
            }));
            const turnUsage = { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0, costUsd: usage.cost_usd };
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last && last.role === "assistant") updated[updated.length - 1] = { ...last, usage: turnUsage };
              return updated;
            });
          } catch { /* ignore parse errors */ }
        }

        accumulated += textChunk;
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.isStreaming) {
            updated[updated.length - 1] = { ...last, content: accumulated };
          }
          return updated;
        });
      }

      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.isStreaming) {
          updated[updated.length - 1] = { ...last, isStreaming: false };
        }
        return updated;
      });
      // Notify Layout to refresh lifetime token counter.
      window.dispatchEvent(new StorageEvent("storage", { key: "agentSessionUpdated" }));
    } catch (err) {
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.isStreaming) {
          updated[updated.length - 1] = {
            role: "assistant",
            content: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
            isStreaming: false,
            timestamp: last.timestamp,
          };
        }
        return updated;
      });
    } finally {
      setIsSending(false);
    }
  }, [input, isSending, activeSessionId, pendingAttachments]);

  // Auto-scroll WTS messages
  useEffect(() => {
    wtsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [wtsMessages]);

  const sendWtsMessage = useCallback(async (overrideMessage?: string) => {
    const message = (overrideMessage ?? wtsInput).trim();
    if (!message || wtsIsSending) return;

    setWtsInput("");
    setWtsIsSending(true);
    const now = new Date();
    setWtsMessages((prev) => [
      ...prev,
      { role: "user", content: message, timestamp: now },
      { role: "assistant", content: "", isStreaming: true, timestamp: now },
    ]);

    try {
      // Proactively refresh the access token if it has expired so the
      // streaming fetch (which bypasses the Axios interceptor) stays authenticated.
      let token = getAccessToken();
      if (!token || isTokenExpired(token)) {
        token = await refreshAccessToken();
      }
      const baseUrl = import.meta.env["VITE_API_BASE_URL"] ?? "/api/v1";

      const response = await fetch(`${baseUrl}/agents/sessions/send/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ message, session_id: wtsSessionId ?? undefined }),
      });

      const sessionId = response.headers.get("X-Session-Id");
      if (sessionId) setWtsSessionId(parseInt(sessionId, 10));

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(budgetBlockedMessage(response.status, errText) ?? `Server error ${response.status}: ${errText.slice(0, 200)}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body.");
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setWtsMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.isStreaming) updated[updated.length - 1] = { ...last, content: accumulated };
          return updated;
        });
      }

      setWtsMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.isStreaming) updated[updated.length - 1] = { ...last, isStreaming: false };
        return updated;
      });
    } catch (err) {
      setWtsMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.isStreaming) {
          updated[updated.length - 1] = {
            role: "assistant",
            content: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
            isStreaming: false,
            timestamp: last.timestamp,
          };
        }
        return updated;
      });
    } finally {
      setWtsIsSending(false);
    }
  }, [wtsInput, wtsIsSending, wtsSessionId]);

  const handleStarterSelect = useCallback((question: string) => {
    void sendWtsMessage(question);
  }, [sendWtsMessage]);

  const handleWtsKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void sendWtsMessage();
      }
    },
    [sendWtsMessage]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (slash.handleKeyDown(e)) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void sendMessage();
      }
    },
    [sendMessage, slash]
  );

  const startNewSession = useCallback(() => {
    setActiveSessionId(null);
    setMessages([]);
    setSessionTokens({ input: 0, output: 0 });
    setPendingAttachments([]);
    setShowWhereToStart(false);
    setShowMainStarters(false);
    localStorage.removeItem(LAST_SESSION_KEY);
  }, []);

  // Sends a pre-built export payload into a fresh session.
  // Not wrapped in useCallback because it references mutable state that will be
  // reset by startNewSession — called only from the event listener above.
  async function sendExportMessage(message: string) {
    setIsSending(true);
    setShowMainStarters(true);
    const now = new Date();
    setMessages([
      { role: "user", content: message, timestamp: now },
      { role: "assistant", content: "", isStreaming: true, timestamp: now },
    ]);
    try {
      let token = getAccessToken();
      if (!token || isTokenExpired(token)) token = await refreshAccessToken();
      const baseUrl = import.meta.env["VITE_API_BASE_URL"] ?? "/api/v1";
      const response = await fetch(`${baseUrl}/agents/sessions/send/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ message }),
      });
      const sessionId = response.headers.get("X-Session-Id");
      if (sessionId) {
        const newId = parseInt(sessionId, 10);
        setActiveSessionId(newId);
        localStorage.setItem(LAST_SESSION_KEY, String(newId));
      }
      if (!response.ok) throw new Error(`Server error ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body.");
      const decoder = new TextDecoder();
      let accumulated = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.isStreaming) updated[updated.length - 1] = { ...last, content: accumulated };
          return updated;
        });
      }
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.isStreaming) updated[updated.length - 1] = { ...last, isStreaming: false };
        return updated;
      });
    } catch (err) {
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.isStreaming) updated[updated.length - 1] = { role: "assistant", content: `Error: ${err instanceof Error ? err.message : "Unknown"}`, isStreaming: false, timestamp: last.timestamp };
        return updated;
      });
    } finally {
      setIsSending(false);
    }
  }

  const deleteSession = useCallback(async (id: number) => {
    try {
      await agentApi.deleteSession(id);
    } catch {
      // best-effort; remove from local state regardless
    }
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeSessionId === id) {
      setActiveSessionId(null);
      setMessages([]);
      setShowWhereToStart(false);
      setShowMainStarters(false);
      localStorage.removeItem(LAST_SESSION_KEY);
    }
  }, [activeSessionId]);

  const renameSession = useCallback(async (id: number, title: string) => {
    try {
      await agentApi.renameSession(id, title);
      setSessions((prev) => prev.map((s) => s.id === id ? { ...s, title } : s));
    } catch {
      // best-effort
    }
  }, []);

  const switchSession = useCallback((s: AgentSession) => {
    setActiveSessionId(s.id);
    setShowWhereToStart(false);
    setShowMainStarters(false);
    setMessages(s.messages.map(toDisplayMessage));
    // Restore persisted token counts for this session.
    const input = s.messages.reduce((sum, m) => sum + (m.input_tokens ?? 0), 0);
    const output = s.messages.reduce((sum, m) => sum + (m.output_tokens ?? 0), 0);
    setSessionTokens({ input, output });
  }, []);

  // Export-tray pills dragged onto the chat become pending attachments. dragover can only read
  // the payload's *types*, never its data, so the drop target is chosen by type alone.
  const isExportDrag = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes(EXPORT_ITEM_DRAG_KEY);
  const dropHandlers = showWhereToStart ? {} : {
    onDragOver: (e: React.DragEvent) => {
      if (!isExportDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (!dropActive) setDropActive(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropActive(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!isExportDrag(e)) return;
      e.preventDefault();
      setDropActive(false);
      try {
        const item = JSON.parse(e.dataTransfer.getData(EXPORT_ITEM_DRAG_KEY)) as ExportItem;
        setPendingAttachments((prev) => prev.some((a) => a.id === item.id) ? prev : [...prev, {
          id: item.id, type: item.type, label: item.label, summary: item.summary, content: item.content,
        }]);
      } catch { /* not one of ours */ }
    },
  };
  const removeAttachment = (a: ChatAttachment) => setPendingAttachments((prev) => prev.filter((x) => x.id !== a.id));
  const canSend = !isSending && (input.trim().length > 0 || pendingAttachments.length > 0);

  const composerAttachments = pendingAttachments.length > 0 && (
    <div data-testid="pending-attachments" style={{ marginBottom: 8 }}>
      <AttachmentList attachments={pendingAttachments} onRemove={removeAttachment} />
    </div>
  );

  return (
    <>
      <style>{chatCSS}</style>

      <div style={{ display: "flex", height: "100%", fontFamily: "var(--font-base)", overflow: "hidden" }}>

        {/* ── Left panel ── */}
        <div style={{
          width: "280px", flexShrink: 0,
          borderRight: "1px solid var(--border, rgba(0,0,0,0.08))",
          display: "flex", flexDirection: "column",
          background: "var(--surface, #fff)", overflowY: "auto",
        }}>
          {/* Header */}
          <div style={{ padding: "20px 16px 12px", borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h1 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700 }}>
                <button
                  type="button"
                  onClick={startNewSession}
                  title="Start a new conversation"
                  style={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}
                ><ConversationIcon width={18} height={18} style={{ flexShrink: 0 }} />Agent</button>
              </h1>
              <button
                onClick={startNewSession}
                style={{
                  padding: "5px 12px", borderRadius: "5px", fontSize: "0.875rem", fontWeight: 600,
                  background: "var(--twilio-red, #e22)", color: "#fff", border: "none", cursor: "pointer",
                }}
              >
                + New
              </button>
            </div>
            <p style={{ margin: "6px 0 0", fontSize: "0.875rem", color: "var(--text-secondary, #888)", lineHeight: 1.5 }}>
              Your AI assistant for tasks, scheduling, and insights.
            </p>
          </div>

          {/* Session list */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {sessions.length === 0 && (
              <div style={{ padding: "20px 16px", fontSize: "0.875rem", color: "var(--text-secondary, #888)" }}>
                No conversations yet. Click <strong>+ New</strong> to start.
              </div>
            )}
            {sessions.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                isActive={activeSessionId === s.id}
                onSelect={() => switchSession(s)}
                onDelete={() => deleteSession(s.id)}
                onRename={(title) => renameSession(s.id, title)}
                onShare={(updated) => setSessions(prev => prev.map(x => x.id === updated.id ? updated : x))}
              />
            ))}
          </div>

          {/* Where to start */}
          <div style={{ borderTop: "1px solid var(--border, rgba(0,0,0,0.08))", padding: "12px 16px" }}>
            <button
              onClick={() => {
                startNewSession();
                setWtsMessages([]);
                setWtsSessionId(null);
                setWtsInput("");
                setShowWhereToStart(true);
              }}
              style={{
                width: "100%", padding: "8px 14px", borderRadius: "8px", fontSize: "0.875rem", fontWeight: 600,
                background: showWhereToStart ? "var(--twilio-red-tint, rgba(226,35,26,0.06))" : "transparent",
                color: showWhereToStart ? "var(--twilio-red, #e22)" : "var(--text-secondary, #666)",
                border: "1px solid var(--border, rgba(0,0,0,0.08))",
                cursor: "pointer", textAlign: "left",
              }}
              onMouseEnter={e => { if (!showWhereToStart) e.currentTarget.style.background = "rgba(0,0,0,0.03)"; }}
              onMouseLeave={e => { if (!showWhereToStart) e.currentTarget.style.background = "transparent"; }}
            >
              ✦ Where to start
            </button>
          </div>
        </div>

        {/* ── Right panel ── */}
        <div
          data-testid="chat-drop-zone"
          {...dropHandlers}
          style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg, var(--twilio-gray-10, #f5f5f5))", position: "relative", outline: dropActive ? "2px dashed var(--twilio-red, #e22)" : "none", outlineOffset: -4 }}
        >
          {dropActive && (
            <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 20, padding: "6px 14px", borderRadius: 99, background: "var(--twilio-red, #e22)", color: "#fff", fontSize: "0.75rem", fontWeight: 600, pointerEvents: "none" }}>
              Drop to attach to your message
            </div>
          )}

          {showWhereToStart ? (
            <StarterCards
              onSelect={handleStarterSelect}
              onClose={() => setShowWhereToStart(false)}
              messages={wtsMessages}
              isSending={wtsIsSending}
              input={wtsInput}
              onInputChange={setWtsInput}
              onKeyDown={handleWtsKeyDown}
              onSend={() => void sendWtsMessage()}
              messagesEndRef={wtsEndRef}
            />
          ) : messages.length === 0 ? (
            /* ── Empty state ── */
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "28px", padding: "60px 40px", textAlign: "center" }}>
              <div style={{ width: "96px", height: "96px", borderRadius: "28px", background: "rgba(226,35,26,0.06)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--twilio-red, #e22)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: "1.625rem", fontWeight: 700 }}>Agent PM is ready</h2>
                <p style={{ margin: "12px 0 0", fontSize: "1rem", color: "var(--text-secondary, #888)", maxWidth: "480px", lineHeight: 1.6 }}>
                  Ask me to schedule meetings, draft emails, manage tasks, or query your team's data.
                </p>
              </div>

              {/* Conversation starter buttons */}
              <MainStarterGrid onSelect={(q) => { setShowMainStarters(true); void sendMessage(q); }} />

              {/* Input */}
              <div style={{ width: "100%", maxWidth: "680px", borderTop: "1px solid var(--border, rgba(0,0,0,0.08))", paddingTop: "24px", display: "flex", gap: "12px", alignItems: "flex-end" }}>
                <div style={{ flex: 1, position: "relative" }}>
                  <SlashSkillMenu menu={slash} />
                  {composerAttachments}
                  <textarea
                    value={input}
                    ref={composerRef}
                    onChange={slash.handleChange}
                    onSelect={slash.handleSelect}
                    onKeyDown={handleKeyDown}
                    rows={3}
                    placeholder="Or just start typing… (/ for skills)"
                    disabled={isSending}
                    style={{ width: "100%", resize: "none", padding: "14px 18px", borderRadius: "12px", fontSize: "0.875rem", border: "1px solid var(--border, rgba(0,0,0,0.12))", background: "var(--surface, #fff)", outline: "none", fontFamily: "var(--font-base)", lineHeight: 1.5 }}
                  />
                </div>
                <button
                  onClick={() => void sendMessage()}
                  disabled={!canSend}
                  style={{ padding: "14px 24px", borderRadius: "12px", fontSize: "0.9375rem", fontWeight: 600, background: "var(--twilio-red, #e22)", color: "#fff", border: "none", cursor: "pointer", opacity: !canSend ? 0.4 : 1, fontFamily: "var(--font-base)", whiteSpace: "nowrap" }}
                >
                  {isSending ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
          ) : (
            /* ── Active chat ── */
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--surface, #fff)" }}>

              {/* Sticky chat name header */}
              <ChatNameHeader
                sessionId={activeSessionId}
                title={sessions.find(s => s.id === activeSessionId)?.title ?? ""}
                onRename={(title) => { if (activeSessionId) renameSession(activeSessionId, title); }}
              />

              {/* Per-session token counter */}
              {(sessionTokens.input > 0 || sessionTokens.output > 0) && (
                <div style={{
                  flexShrink: 0, padding: "5px 20px",
                  borderBottom: "1px solid var(--border, rgba(0,0,0,0.06))",
                  background: "var(--surface, #fff)",
                  display: "flex", alignItems: "center", gap: 14,
                }}>
                  <span style={{ fontSize: "0.6875rem", color: "var(--text-secondary, #999)", fontVariantNumeric: "tabular-nums" }}>
                    <span style={{ marginRight: 8 }}>↑ {sessionTokens.input.toLocaleString()} in</span>
                    <span style={{ marginRight: 8 }}>↓ {sessionTokens.output.toLocaleString()} out</span>
                    <span style={{ fontWeight: 600, color: "var(--text-primary, #555)" }}>{(sessionTokens.input + sessionTokens.output).toLocaleString()} tokens</span>
                  </span>
                </div>
              )}

              {/* Sticky starters bar — shown after first message */}
              {showMainStarters && (
                <div style={{ flexShrink: 0, padding: "10px 20px", borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))", background: "var(--surface, #fff)", display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
                  {CONVERSATION_STARTERS.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => void sendMessage(s.question)}
                      disabled={isSending}
                      style={{ padding: "6px 12px", borderRadius: "8px", border: "1px solid var(--border, rgba(0,0,0,0.08))", background: "var(--surface, #fff)", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-primary, #111)", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px", fontFamily: "var(--font-base)", transition: "border-color 0.15s, background 0.15s", opacity: isSending ? 0.5 : 1 }}
                      onMouseEnter={e => { if (!isSending) { e.currentTarget.style.borderColor = "var(--twilio-red, #e22)"; e.currentTarget.style.background = "rgba(226,35,26,0.04)"; } }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border, rgba(0,0,0,0.08))"; e.currentTarget.style.background = "var(--surface, #fff)"; }}
                    >
                      <span style={{ fontSize: "0.6875rem" }}>{["💬", "✨", "🔄", "⚡", "🔗"][i] ?? "💬"}</span>
                      {s.question}
                    </button>
                  ))}
                  <button
                    onClick={() => setShowMainStarters(false)}
                    style={{ marginLeft: "auto", background: "transparent", border: "none", cursor: "pointer", fontSize: "0.75rem", color: "var(--text-secondary, #aaa)", fontFamily: "var(--font-base)", padding: "4px" }}
                    onMouseEnter={e => e.currentTarget.style.color = "var(--text-primary, #111)"}
                    onMouseLeave={e => e.currentTarget.style.color = "var(--text-secondary, #aaa)"}
                  >
                    ✕
                  </button>
                </div>
              )}

              <div style={{ flex: 1, overflowY: "auto", padding: "24px 16px" }}>
              <div style={{ width: "100%", maxWidth: "720px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "14px" }}>
                {messages.map((msg, i) => {
                  const msgDay = msg.timestamp.toDateString();
                  const prevDay = i > 0 ? messages[i - 1]!.timestamp.toDateString() : null;
                  const showDate = msgDay !== prevDay;
                  return (
                    <div key={i}>
                      {showDate && (
                        <div style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start", margin: "8px 0" }}>
                          <span style={{ fontSize: "0.6875rem", fontWeight: 700, color: "var(--text-secondary, #aaa)", padding: "3px 10px", background: "var(--surface-alt, rgba(0,0,0,0.04))", borderRadius: "99px", letterSpacing: "0.04em" }}>
                            {msg.timestamp.toLocaleDateString(undefined, { month: "long", day: "numeric" })}
                          </span>
                        </div>
                      )}
                      <MessageBubble message={msg} />
                    </div>
                  );
                })}
                {isSending && <ThinkingBubble />}
                <div ref={messagesEndRef} />
              </div>
              </div>
              <div style={{ borderTop: "1px solid var(--border, rgba(0,0,0,0.08))", padding: "12px 16px", display: "flex", flexDirection: "column", gap: "8px", alignItems: "center" }}>
               <div style={{ width: "100%", maxWidth: "720px", display: "flex", flexDirection: "column", gap: "8px" }}>
                {/* Token counter chip */}
                {(sessionTokens.input > 0 || sessionTokens.output > 0) && (
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <span style={{
                      fontSize: "0.6875rem", color: "var(--text-secondary, #999)", fontVariantNumeric: "tabular-nums",
                      padding: "2px 8px", borderRadius: "99px", background: "var(--surface-alt, rgba(0,0,0,0.04))",
                      border: "1px solid var(--border, rgba(0,0,0,0.07))",
                    }}>
                      {(sessionTokens.input + sessionTokens.output).toLocaleString()} tokens this session
                    </span>
                  </div>
                )}
                <div style={{ display: "flex", gap: "12px", alignItems: "flex-end" }}>
                <div style={{ flex: 1, position: "relative" }}>
                  <SlashSkillMenu menu={slash} />
                  {composerAttachments}
                  <textarea
                    value={input}
                    ref={composerRef}
                    onChange={slash.handleChange}
                    onSelect={slash.handleSelect}
                    onKeyDown={handleKeyDown}
                    rows={3}
                    placeholder="Type a message… (Enter to send, / for skills)"
                    disabled={isSending}
                    style={{ width: "100%", resize: "none", padding: "14px 18px", borderRadius: "12px", fontSize: "0.875rem", border: "1px solid var(--border, rgba(0,0,0,0.12))", background: "var(--surface, #fff)", outline: "none", fontFamily: "var(--font-base)", lineHeight: 1.5 }}
                  />
                </div>
                <button
                  onClick={() => void sendMessage()}
                  disabled={!canSend}
                  style={{ padding: "14px 24px", borderRadius: "12px", fontSize: "0.9375rem", fontWeight: 600, background: "var(--twilio-red, #e22)", color: "#fff", border: "none", cursor: "pointer", opacity: !canSend ? 0.4 : 1, fontFamily: "var(--font-base)", whiteSpace: "nowrap" }}
                >
                  {isSending ? "Sending…" : "Send"}
                </button>
                </div>
               </div>
              </div>
            </div>
          )}

          {/* ── Export builder panel ── */}
          {showExportBuilder && (
            <ExportBuilderPanel
              expanded={builderExpanded}
              onToggleExpand={() => setBuilderExpanded((v) => !v)}
              onClose={() => { setShowExportBuilder(false); setBuilderExpanded(false); }}
            />
          )}
        </div>
      </div>
    </>
  );
}
