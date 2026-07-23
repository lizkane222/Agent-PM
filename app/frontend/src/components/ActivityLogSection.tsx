import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getLogsForResource, LOG_STORAGE_KEY } from "../lib/appLog";
import type { LogEntry, LogResource } from "../lib/appLog";

const CATEGORY_COLOR: Record<string, string> = {
  account: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
  team: "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
  action_item: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  calendar: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
};

const CATEGORY_LABEL: Record<string, string> = {
  account: "Account",
  team: "Team",
  action_item: "Action Item",
  calendar: "Calendar",
};

function formatTs(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

interface Props {
  resourceType: LogResource["type"];
  resourceId: number | string;
  /** Visual style: "panel" (card with heading) or "inline" (compact, no outer border) */
  variant?: "panel" | "inline";
  /** Called when user clicks Restore on a log entry that has restoreData */
  onRestore?: (restoreData: Record<string, unknown>, entry: LogEntry) => void;
}

export default function ActivityLogSection({ resourceType, resourceId, variant = "panel", onRestore }: Props) {
  const [entries, setEntries] = useState<LogEntry[]>(() =>
    getLogsForResource(resourceType, resourceId)
  );
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    setEntries(getLogsForResource(resourceType, resourceId));
  }, [resourceType, resourceId]);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === LOG_STORAGE_KEY) {
        setEntries(getLogsForResource(resourceType, resourceId));
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [resourceType, resourceId]);

  const body = (
    <>
      {entries.length === 0 ? (
        <p className="text-xs italic" style={{ color: "var(--twilio-gray-40)" }}>
          No activity recorded yet.
        </p>
      ) : (
        <div className="space-y-1.5">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="flex items-start gap-2.5 rounded-lg border border-gray-100 bg-white px-3 py-2 shadow-sm"
            >
              <span
                className={`mt-0.5 shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${CATEGORY_COLOR[entry.category] ?? "bg-gray-100 text-gray-500"}`}
              >
                {CATEGORY_LABEL[entry.category] ?? entry.category}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs leading-snug" style={{ color: "var(--twilio-navy)" }}>
                  {entry.message}
                </p>
                <div className="flex flex-wrap gap-2 mt-1 items-center">
                  {entry.links && entry.links.map((link) => (
                    <Link
                      key={link.path}
                      to={link.path}
                      className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800 hover:underline inline-flex items-center gap-0.5"
                    >
                      {link.label}
                      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-2 h-2 opacity-60">
                        <path d="M2.5 9.5l7-7M4 2.5h5.5V8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </Link>
                  ))}
                  {entry.restoreData && onRestore && (
                    <button
                      disabled={restoringId === entry.id}
                      onClick={async () => {
                        setRestoringId(entry.id);
                        try { await Promise.resolve(onRestore(entry.restoreData!, entry)); }
                        finally { setRestoringId(null); }
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 px-2 py-0.5 rounded-full transition-colors disabled:opacity-50"
                    >
                      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-2.5 h-2.5 shrink-0">
                        <path d="M2 6a4 4 0 1 0 .8-2.4" strokeLinecap="round"/>
                        <path d="M2 2.5V6h3.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      {restoringId === entry.id ? "Restoring…" : "Restore"}
                    </button>
                  )}
                </div>
              </div>
              <span className="shrink-0 text-[10px] tabular-nums whitespace-nowrap" style={{ color: "var(--twilio-gray-40)" }}>
                {formatTs(entry.ts)}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );

  if (variant === "inline") return body;

  return (
    <div
      className="rounded-lg px-4 py-4"
      style={{
        background: "var(--surface, #fff)",
        border: "1px solid var(--border, rgba(0,0,0,0.08))",
        boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
      }}
    >
      <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--twilio-gray-60)" }}>
        Activity Log
      </p>
      {body}
    </div>
  );
}
