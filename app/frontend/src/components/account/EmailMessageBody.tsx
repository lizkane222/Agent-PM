import { useState } from "react";
import {
  formatMessageDate, linkify, parseSender, splitQuoted, toParagraphs,
} from "../../lib/emailThreadFormat";

function Rich({ text, highlight }: { text: string; highlight: string }) {
  const term = highlight.trim();
  const re = term ? new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi") : null;
  const mark = (s: string, k: string) =>
    re
      ? s.split(re).map((part, i) =>
          i % 2 === 1
            ? <mark key={`${k}-${i}`} style={{ background: "rgba(245,158,11,0.25)", borderRadius: 2, padding: "0 1px" }}>{part}</mark>
            : part)
      : s;
  return (
    <>
      {toParagraphs(text).map((p, pi) => (
        <p key={pi} style={{ margin: pi === 0 ? 0 : "8px 0 0", fontSize: "0.8125rem", lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--text-primary, #111)" }}>
          {linkify(p).map((seg, si) =>
            seg.type === "link" ? (
              <a key={si} href={seg.href} target="_blank" rel="noopener noreferrer"
                style={{ color: "#2563eb", textDecoration: "underline" }}>{seg.text}</a>
            ) : (
              <span key={si}>{mark(seg.text, `${pi}-${si}`)}</span>
            ))}
        </p>
      ))}
    </>
  );
}

/** One message of an expanded thread: header, linkified paragraphs, collapsed quoted text. */
export function EmailMessageBody({
  from, date, subject, body, threadSubject, searchTerm = "",
}: { from: string; date: string; subject?: string; body: string; threadSubject?: string; searchTerm?: string }) {
  const [showHidden, setShowHidden] = useState(false);
  const sender = parseSender(from);
  const { main, hidden } = splitQuoted(body);
  const showSubject = !!subject && subject.trim() !== (threadSubject ?? "").trim();
  return (
    <div style={{ padding: "12px 14px", borderRadius: 8, background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.07))" }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
        <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--twilio-navy, #121c2d)" }}>
          {sender.name}
          {sender.email && sender.email !== sender.name && (
            <span style={{ fontWeight: 400, color: "var(--text-secondary, #888)", marginLeft: 6 }}>&lt;{sender.email}&gt;</span>
          )}
        </span>
        <span style={{ fontSize: "0.6875rem", color: "var(--text-secondary, #aaa)" }}>{formatMessageDate(date)}</span>
      </div>
      {showSubject && (
        <p style={{ margin: "0 0 6px", fontSize: "0.8125rem", fontWeight: 700, color: "var(--text-primary, #111)" }}>{subject}</p>
      )}
      <Rich text={main} highlight={searchTerm} />
      {hidden && (
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setShowHidden((v) => !v)}
            aria-expanded={showHidden}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: "0.6875rem", fontWeight: 600, color: "var(--text-secondary, #666)" }}
          >
            {showHidden ? "Hide quoted text" : "Show quoted text"}
          </button>
          {showHidden && (
            <div data-testid="quoted-text" style={{ marginTop: 6, paddingLeft: 10, borderLeft: "3px solid var(--border, rgba(0,0,0,0.15))", opacity: 0.8 }}>
              <Rich text={hidden} highlight={searchTerm} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
