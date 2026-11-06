import { useState } from "react";
import { schedulerApi } from "../../lib/api";
import { useAppError } from "../../context/AppErrorContext";

interface Props {
  personName: string;
  personEmail: string;
  onClose: () => void;
  onScheduled?: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function localInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Schedule a meeting with this person (plus any other invitees) on everyone's calendar. */
export default function ScheduleCallModal({ personName, personEmail, onClose, onScheduled }: Props) {
  const { reportError } = useAppError();
  const first = personName.split(" ")[0] || personName;
  const start0 = new Date();
  start0.setMinutes(0, 0, 0);
  start0.setHours(start0.getHours() + 1);

  const [title, setTitle] = useState(`Call with ${personName}`);
  const [start, setStart] = useState(localInput(start0));
  const [minutes, setMinutes] = useState(30);
  const [extra, setExtra] = useState("");
  // Emailing an invitation is something the user opts into for this meeting; it is never
  // assumed. Unchecked, the meeting is created and nobody is emailed.
  const [emailInvites, setEmailInvites] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const extraEmails = extra.split(/[,\s;]+/).map((e) => e.trim()).filter(Boolean);
  const badEmail = extraEmails.find((e) => !EMAIL_RE.test(e));
  const canSave = title.trim() && start && minutes > 0 && !badEmail && !saving;

  async function save() {
    setSaving(true);
    try {
      const startDate = new Date(start);
      const endDate = new Date(startDate.getTime() + minutes * 60000);
      const emails = Array.from(new Set([personEmail, ...extraEmails].map((e) => e.toLowerCase())));
      const { data } = await schedulerApi.createEvent({
        title: title.trim(),
        start_datetime: startDate.toISOString(),
        end_datetime: endDate.toISOString(),
        all_day: false,
        calendar_id: "primary",
        status: "confirmed",
        event_category: "meeting",
        attendees: emails.map((email) => ({ email, displayName: email === personEmail.toLowerCase() ? personName : email, responseStatus: "needsAction" as const })),
        meet_link: "https://meet.google.com/new",
        send_invites: emailInvites,
      });
      const sync = data.google_sync;
      // Report what the server says happened, not what was asked for: the invite gate can
      // refuse an approved send, and a message claiming guests were emailed when they were
      // not is worse than no message.
      if (!sync || sync.status === "not_connected") {
        setResult("Added to your calendar. Google Calendar isn't connected, so nobody was invited.");
      } else if (sync.status === "failed") {
        setResult("Saved in AgentPM, but Google Calendar couldn't be updated, so nobody was invited.");
      } else if (sync.invites_sent) {
        setResult(`Scheduled. Invitation emails were sent to ${emails.length} ${emails.length === 1 ? "person" : "people"}.`);
      } else if (emailInvites) {
        setResult("Added to your calendar and Google. You asked to email the invitations, but none were sent (invitation emails are turned off or this meeting wasn't eligible).");
      } else {
        setResult("Added to your calendar and Google. No email was sent.");
      }
      onScheduled?.();
    } catch (err) {
      reportError(err instanceof Error ? err.message : "Could not schedule the call.");
    } finally {
      setSaving(false);
    }
  }

  const field = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border, rgba(0,0,0,0.15))", fontSize: "0.875rem", fontFamily: "var(--font-base)", boxSizing: "border-box" as const };
  const label = { display: "block", fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" as const, margin: "12px 0 4px", color: "var(--text-secondary, #666)" };

  return (
    <div role="dialog" aria-label={`Schedule call with ${personName}`} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: 420, maxWidth: "92vw" }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: 0, fontSize: "1.0625rem" }}>Schedule call with {first}</h2>
        {result ? (
          <>
            <p style={{ fontSize: "0.875rem" }}>{result}</p>
            <button onClick={onClose} style={{ ...field, width: "auto", cursor: "pointer", fontWeight: 600 }}>Close</button>
          </>
        ) : (
          <>
            <label style={label} htmlFor="sc-title">Title</label>
            <input id="sc-title" style={field} value={title} onChange={(e) => setTitle(e.target.value)} />
            <label style={label} htmlFor="sc-start">Start</label>
            <input id="sc-start" type="datetime-local" style={field} value={start} onChange={(e) => setStart(e.target.value)} />
            <label style={label} htmlFor="sc-min">Length (minutes)</label>
            <input id="sc-min" type="number" min={5} step={5} style={field} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
            <label style={label} htmlFor="sc-extra">Other invitees (emails)</label>
            <input id="sc-extra" style={field} placeholder="a@x.com, b@y.com" value={extra} onChange={(e) => setExtra(e.target.value)} />
            {badEmail && <p style={{ color: "#b91c1c", fontSize: "0.75rem", margin: "4px 0 0" }}>"{badEmail}" is not a valid email.</p>}
            <p style={{ fontSize: "0.75rem", color: "var(--text-secondary, #666)" }}>{personName} ({personEmail}) is added to the meeting automatically.</p>
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.8125rem", margin: "6px 0" }}>
              <input type="checkbox" checked={emailInvites} onChange={(e) => setEmailInvites(e.target.checked)} style={{ marginTop: 3 }} />
              <span>Email the invitation to everyone on this meeting. It is sent once, now, and not re-sent if you edit the meeting later.</span>
            </label>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={onClose} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border, rgba(0,0,0,0.15))", background: "#fff", cursor: "pointer" }}>Cancel</button>
              <button onClick={() => void save()} disabled={!canSave} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "var(--twilio-navy, #0d1b2e)", color: "#fff", fontWeight: 600, cursor: canSave ? "pointer" : "not-allowed", opacity: canSave ? 1 : 0.5 }}>
                {saving ? "Scheduling…" : "Schedule"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
