import { useEffect, useState } from "react";
import { schedulerApi } from "../../lib/api";
import { sanitizeHtml } from "../../lib/noteHelpers";
import type { MeetingNote } from "../../types";

/**
 * Notes written in the "Meeting notes" section under any calendar block of this action item
 * (scheduled or Live-Tracked), shown read-only inside the action item. Read from the source
 * notes on every open — never copied into the item — so editing or deleting a note on the
 * calendar is reflected here with nothing to keep in sync.
 */
export default function ActionItemCalendarNotes({ airtableId }: { airtableId: string }) {
  const [notes, setNotes] = useState<MeetingNote[] | null>(null);

  useEffect(() => {
    if (!airtableId || airtableId.startsWith("local-")) { setNotes([]); return; }
    let cancelled = false;
    schedulerApi.listMeetingNotesForActionItem(airtableId)
      .then(({ data }) => { if (!cancelled) setNotes(data.results); })
      .catch(() => { if (!cancelled) setNotes([]); });
    return () => { cancelled = true; };
  }, [airtableId]);

  if (!notes || notes.length === 0) return null;

  return (
    <div data-testid="action-item-calendar-notes" className="mt-4 pt-3 border-t border-gray-100">
      <p className="text-xs font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide mb-2">
        Calendar notes ({notes.length})
      </p>
      <ul className="space-y-2">
        {notes.map((n) => (
          <li key={n.id} className="rounded-lg bg-gray-50 px-3 py-2">
            <div
              className="text-[13px] text-[var(--twilio-navy)] prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(n.html || n.text) }}
            />
            <p className="mt-1 text-[11px] text-[var(--twilio-gray-60)]">
              {n.author_display || n.author_username || "Someone"} ·{" "}
              {new Date(n.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
