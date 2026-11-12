import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ActivityLogSection from "../ActivityLogSection";
import { accountsApi } from "../../lib/api";
import type { AccountLogCategory, AccountLogRow } from "../../lib/api";

const TABS: { key: AccountLogCategory; label: string }[] = [
  { key: "activity", label: "Activity" },
  { key: "events", label: "Events" },
  { key: "comments", label: "Comments" },
  { key: "notifications", label: "Notifications" },
  { key: "reminders", label: "Reminders" },
  { key: "feedback", label: "Feedback" },
  { key: "tokens", label: "Tokens" },
];

function fmt(ts: string | null): string {
  if (!ts) return "";
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * The account's Activity Log. "Activity" is the existing log (this browser's entries plus the
 * server copy); the other six categories are pulled from the rest of the app by
 * GET /accounts/accounts/<id>/activity-log/, which applies the same visibility rules as the UI.
 */
export default function AccountActivityLog({ accountId }: { accountId: number }) {
  const [tab, setTab] = useState<AccountLogCategory>("activity");
  const [counts, setCounts] = useState<Partial<Record<AccountLogCategory, number>>>({});
  const [rows, setRows] = useState<AccountLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    accountsApi.getActivityLog(accountId, tab === "activity" ? undefined : tab)
      .then(({ data }) => {
        if (cancelled) return;
        setCounts(data.counts);
        setRows(tab === "activity" ? [] : data.results);
      })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accountId, tab]);

  return (
    <div
      className="rounded-lg px-4 py-4"
      style={{ background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}
    >
      <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--twilio-gray-60)" }}>
        Activity Log
      </p>
      <div role="tablist" className="flex flex-wrap gap-1.5 mb-3">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
              tab === t.key ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >
            {t.label}
            {counts[t.key] !== undefined && (
              <span data-testid={`count-${t.key}`} className="ml-1 opacity-80">{counts[t.key]}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "activity" ? (
        <ActivityLogSection resourceType="account" resourceId={accountId} variant="inline" />
      ) : error ? (
        <p className="text-xs text-red-600">Could not load this part of the activity log.</p>
      ) : loading ? (
        <p className="text-xs italic text-gray-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs italic" style={{ color: "var(--twilio-gray-40)" }}>Nothing recorded yet.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.id} className="flex items-start gap-2.5 rounded-lg border border-gray-100 bg-white px-3 py-2 shadow-sm">
              <div className="flex-1 min-w-0">
                <p className="text-xs leading-snug font-medium" style={{ color: "var(--text-ink)" }}>{r.title}</p>
                {r.body && <p className="text-[11px] mt-0.5 text-gray-500 break-words">{r.body}</p>}
                <div className="flex flex-wrap gap-2 mt-1 items-center">
                  {r.actor && <span className="text-[10px] text-gray-500">by {r.actor}</span>}
                  {r.status && <span className="text-[10px] text-gray-400">{r.status}</span>}
                  {r.link && r.link.startsWith("/") && (
                    <Link to={r.link} className="text-[11px] font-medium text-indigo-600 hover:underline">Open</Link>
                  )}
                </div>
              </div>
              <span className="shrink-0 text-[10px] tabular-nums whitespace-nowrap text-gray-400">{fmt(r.ts)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
