import { useState } from "react";

import { integrationsApi } from "../../lib/api";
import type { MeetingNotesEmailReport } from "../../lib/api";

/**
 * "GET Meeting Notes" — scans the user's Gong / Zoom recap emails and attaches any AI
 * summary to the meeting it belongs to.
 *
 * The scope is the caller's decision, and it differs by page:
 *  - **Account detail page** passes `scope`, so only that account's meetings are
 *    considered. Anything else would report imports the page can't show.
 *  - **Profile and role pages** omit it, covering every account the user is on — that's
 *    the point of running it from a personal page rather than per-account.
 *
 * One component for both so the button, the request, and the result wording can't drift
 * apart between the three pages.
 */

export type MeetingNotesScope = {
  /** AirtableAccount PK or `rec*` id — preferred, since a Django company_name can drift. */
  account?: string;
  /** Display name; also the name fallback for accounts with no Airtable link. */
  accountName: string;
};

export function GetMeetingNotesButton({
  scope,
  onImported,
  className,
}: {
  scope?: MeetingNotesScope;
  /** Fired after a successful scan so the host can re-read whatever it renders. */
  onImported?: () => void | Promise<void>;
  className?: string;
}) {
  const [state, setState] = useState<
    | { stage: "idle" }
    | { stage: "loading" }
    | { stage: "done"; report: MeetingNotesEmailReport }
    | { stage: "error"; message: string }
  >({ stage: "idle" });

  const target = scope ? scope.accountName : "all of your accounts";

  async function run() {
    if (state.stage === "loading") return;
    setState({ stage: "loading" });
    try {
      const { data } = await integrationsApi.getMeetingNotesFromEmail(
        scope
          ? { account: scope.account || undefined, account_name: scope.accountName }
          : {}
      );
      setState({ stage: "done", report: data });
      await onImported?.();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setState({
        stage: "error",
        message: detail ?? "Could not read Gmail. Check the connection in Settings.",
      });
    }
  }

  return (
    <div className={className}>
      <button
        onClick={() => void run()}
        disabled={state.stage === "loading"}
        title={`Check your email for Gong or Zoom meeting summaries for ${target} and attach them to meetings that don't have notes yet`}
        className="flex items-center gap-1.5 text-xs font-medium disabled:opacity-60 px-3 py-1.5 rounded-md transition-opacity hover:opacity-90"
        style={{ background: "var(--twilio-red, #e22)", color: "#fff", border: "none" }}
      >
        {state.stage === "loading" ? (
          <>
            <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
            </svg>
            Checking email…
          </>
        ) : (
          <>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
              <rect x="1.5" y="3" width="13" height="10" rx="1.5"/>
              <path d="M1.5 4.5L8 9l6.5-4.5" strokeLinecap="round"/>
            </svg>
            GET Meeting Notes
          </>
        )}
      </button>

      {state.stage === "error" && (
        <p role="alert" className="text-[11px] mt-2" style={{ color: "var(--twilio-red, #e22)" }}>
          {state.message}
        </p>
      )}

      {state.stage === "done" && (
        <MeetingNotesResult report={state.report} scopedTo={scope ? scope.accountName : null} />
      )}
    </div>
  );
}

function MeetingNotesResult({
  report,
  scopedTo,
}: {
  report: MeetingNotesEmailReport;
  /** Account name when the scan was narrowed to one, else null for all accounts. */
  scopedTo: string | null;
}) {
  const { updated } = report;
  const emailWord = report.scanned_emails === 1 ? "email" : "emails";
  const meetingWord = report.scanned_meetings === 1 ? "meeting" : "meetings";

  return (
    <div
      role="status"
      className="mt-2 rounded-md px-3 py-2"
      style={{ background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.2)" }}
    >
      <p className="text-[11px] font-semibold" style={{ color: "#4f46e5" }}>
        {updated.length === 0
          ? `No new meeting notes found ${scopedTo ? `for ${scopedTo}` : "across your accounts"} — scanned ${report.scanned_emails} recap ${emailWord} against ${report.scanned_meetings} ${meetingWord}.`
          : `Added notes to ${updated.length} ${updated.length === 1 ? "meeting" : "meetings"}.`}
      </p>
      {updated.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {updated.map((item) => (
            <li key={item.meeting_id} className="text-[11px] text-[var(--twilio-navy)]">
              {item.meeting_name || "Untitled meeting"}
              {item.date
                ? ` · ${new Date(item.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                : ""}
              {" · "}
              <span style={{ textTransform: "capitalize" }}>{item.sources.join(" + ")}</span>
              {/* The account is only worth naming when the scan spanned several. */}
              {!scopedTo && item.account_name ? ` · ${item.account_name}` : ""}
              {/* Flagged because the meeting record didn't exist before this run — it
                  was a calendar-only meeting, which is the common case. */}
              {item.created_meeting ? " · new" : ""}
            </li>
          ))}
        </ul>
      )}
      {/* Without this, a mailbox full of visible Zoom "Meeting assets" emails looks like
          the scan simply failed. Name the real cause: those emails link to the summary
          rather than containing it. */}
      {report.no_summary_in_email > 0 && (
        <p className="text-[11px] mt-1" style={{ color: "var(--twilio-gray-60)" }}>
          {report.no_summary_in_email}{" "}
          {report.no_summary_in_email === 1 ? "meeting had an email that links" : "meetings had emails that link"}
          {" "}to a summary instead of containing it — open those in Gong or Zoom and paste
          the summary in.
          {report.recordings_linked > 0
            ? ` Saved ${report.recordings_linked} recording ${report.recordings_linked === 1 ? "link" : "links"}.`
            : ""}
        </p>
      )}
      {report.summaries_truncated && (
        <p className="text-[11px] mt-1" style={{ color: "var(--twilio-gray-60)" }}>
          Stopped at the per-run limit of {report.max_summaries}. Run it again to pick up the rest.
        </p>
      )}
    </div>
  );
}
