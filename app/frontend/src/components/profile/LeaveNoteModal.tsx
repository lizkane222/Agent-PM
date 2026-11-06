import { useState } from "react";
import { memberProfileApi } from "../../lib/api";
import { useAppError } from "../../context/AppErrorContext";

interface Props {
  memberId: number;
  personName: string;
  onClose: () => void;
}

/** A private note. It never appears on the public page — the recipient is notified. */
export default function LeaveNoteModal({ memberId, personName, onClose }: Props) {
  const { reportError } = useAppError();
  const first = personName.split(" ")[0] || personName;
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(false);

  async function send() {
    if (!body.trim() || saving) return;
    setSaving(true);
    try {
      await memberProfileApi.leaveNote(memberId, body.trim());
      setSent(true);
    } catch (err) {
      reportError(err instanceof Error ? err.message : "Could not send the note.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div role="dialog" aria-label={`Leave a note for ${personName}`} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: 420, maxWidth: "92vw" }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: 0, fontSize: "1.0625rem" }}>Leave a note for {first}</h2>
        {sent ? (
          <>
            <p style={{ fontSize: "0.875rem" }}>Sent. {first} has been notified.</p>
            <button onClick={onClose} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border, rgba(0,0,0,0.15))", background: "#fff", cursor: "pointer", fontWeight: 600 }}>Close</button>
          </>
        ) : (
          <>
            <p style={{ fontSize: "0.75rem", color: "var(--text-secondary, #666)" }}>Only {first} will see this. It is not shown on their public page.</p>
            <textarea
              aria-label="Note"
              autoFocus
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--border, rgba(0,0,0,0.15))", fontFamily: "var(--font-base)", fontSize: "0.875rem", boxSizing: "border-box", resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
              <button onClick={onClose} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border, rgba(0,0,0,0.15))", background: "#fff", cursor: "pointer" }}>Cancel</button>
              <button onClick={() => void send()} disabled={!body.trim() || saving} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "var(--twilio-navy, #0d1b2e)", color: "#fff", fontWeight: 600, cursor: "pointer", opacity: body.trim() && !saving ? 1 : 0.5 }}>
                {saving ? "Sending…" : "Send note"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
