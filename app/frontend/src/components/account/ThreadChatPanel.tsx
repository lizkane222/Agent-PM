import { useState, useRef, useEffect } from "react";
import type { GmailThread } from "../../lib/api";

function openInGmail(subject: string, body: string) {
  const url = `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

export function ThreadChatPanel({ thread, onClose }: { thread: GmailThread; onClose: () => void }) {
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; text: string }[]>([
    { role: "assistant", text: `I've read the "${thread.subject}" email chain (${thread.message_count} messages). Ask me anything about it.` },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", text }]);
    setSending(true);
    try {
      const threadContext = thread.messages
        .map(m => `From: ${m.from}\nDate: ${m.date}\n\n${m.body}`)
        .join("\n\n---\n\n")
        .slice(0, 8000);
      const token = localStorage.getItem("agentpm_access");
      const baseUrl = (import.meta.env["VITE_API_BASE_URL"] as string) ?? "/api/v1";
      const res = await fetch(`${baseUrl}/agents/sessions/send/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          message: `Email thread context:\n\nSubject: ${thread.subject}\n\n${threadContext}\n\n---\n\nUser question: ${text}`,
        }),
      });
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");
      const dec = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
      }
      setMessages(prev => [...prev, { role: "assistant", text: acc }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", text: `Error: ${e instanceof Error ? e.message : "Unknown"}` }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }} onClick={onClose}>
      <div style={{
        width: "100%", maxWidth: 540, maxHeight: "80vh", borderRadius: 12,
        background: "var(--surface, #fff)", boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
        display: "flex", flexDirection: "column", fontFamily: "var(--font-base)",
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ margin: 0, fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary, #111)" }}>Chat about this thread</p>
            <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "var(--text-secondary, #888)", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{thread.subject}</p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary, #888)", fontSize: "1.125rem", lineHeight: 1 }}>✕</button>
        </div>
        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ fontSize: "0.6875rem", fontWeight: 700, width: 64, flexShrink: 0, paddingTop: 2,
                color: m.role === "user" ? "var(--twilio-navy, #121c2d)" : "var(--twilio-red, #e22)" }}>
                {m.role === "user" ? "You" : "Agent PM"}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: "0.8125rem", lineHeight: 1.55, color: "var(--text-primary, #111)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.text}</p>
                {m.role === "assistant" && i > 0 && (
                  <button
                    onClick={() => openInGmail(`Re: ${thread.subject}`, m.text)}
                    style={{
                      marginTop: 8, padding: "4px 10px", borderRadius: 6, fontSize: "0.75rem", fontWeight: 600,
                      background: "transparent", color: "var(--twilio-red, #e22)",
                      border: "1px solid var(--twilio-red, #e22)", cursor: "pointer",
                      display: "inline-flex", alignItems: "center", gap: 5,
                    }}
                  >
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M0 4a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H2a2 2 0 01-2-2V4zm2 0v.217l6 3.6 6-3.6V4H2zm12 1.383l-5.646 3.388a.5.5 0 01-.708 0L2 5.383V12h12V5.383z"/>
                    </svg>
                    Open in Gmail
                  </button>
                )}
              </div>
            </div>
          ))}
          {sending && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: "0.6875rem", fontWeight: 700, width: 64, color: "var(--twilio-red, #e22)" }}>Agent PM</span>
              <span style={{ display: "flex", gap: 3 }}>
                {[0,1,2].map(i => <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--twilio-red, #e22)", display: "inline-block", animation: `tfDot 1.2s ease-in-out ${i*0.2}s infinite` }} />)}
              </span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        {/* Input */}
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border, rgba(0,0,0,0.08))", display: "flex", gap: 8 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && void send()}
            placeholder="Ask about this email chain…"
            disabled={sending}
            style={{
              flex: 1, padding: "7px 11px", borderRadius: 7, fontSize: "0.875rem",
              border: "1px solid var(--border, rgba(0,0,0,0.15))", background: "var(--bg, #f5f5f5)",
              color: "var(--text-primary, #111)", outline: "none",
            }}
          />
          <button onClick={() => void send()} disabled={sending || !input.trim()} style={{
            padding: "7px 14px", borderRadius: 7, fontSize: "0.875rem", fontWeight: 600,
            background: "var(--twilio-red, #e22)", color: "#fff", border: "none",
            cursor: sending || !input.trim() ? "not-allowed" : "pointer", opacity: sending || !input.trim() ? 0.6 : 1,
          }}>Send</button>
        </div>
      </div>
    </div>
  );
}
