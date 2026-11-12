import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { userPageNoteApi } from "../../lib/api";
import { plainToHtml, sanitizeHtml, htmlToPreviewText } from "../../lib/noteHelpers";
import type { UserPageNote } from "../../types";

/**
 * The signed-in user's own Notepad notes that they linked to this account.
 *
 * Read-only here and derived on read (not copied into the account's notes), so editing or
 * unlinking a note in the Notepad is reflected at once and nothing goes stale. These notes are
 * private to their owner: the endpoint is owner-scoped, so a teammate never sees them.
 */
export function LinkedNotepadNotes({ accountId }: { accountId: number }) {
  const [notes, setNotes] = useState<UserPageNote[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () => userPageNoteApi.list({ account: accountId })
      .then(r => { if (alive) setNotes(r.data); })
      .catch(() => { if (alive) setNotes([]); });
    void load();
    // Notes are edited on the profile page, possibly in another tab; re-read when this tab is shown again.
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [accountId]);

  const shown = notes.filter(n => htmlToPreviewText(n.content));
  if (shown.length === 0) return null;

  return (
    <div data-testid="linked-notepad-notes" className="mt-3 rounded-xl border border-amber-200 bg-amber-50/40">
      <div className="flex items-center justify-between px-3 pt-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">From your Notepad</span>
        <Link to="/profile" className="text-[11px] text-indigo-600 hover:underline">Edit in Notepad</Link>
      </div>
      <p className="px-3 text-[11px] text-gray-500">Only you can see these.</p>
      <ul className="divide-y divide-amber-100">
        {shown.map(n => (
          <li key={n.id} className="px-3 py-2">
            <div
              className="rich-text text-sm text-gray-800"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(plainToHtml(n.content)) }}
            />
            <p className="mt-1 text-[10px] text-gray-400">
              Updated {new Date(n.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
