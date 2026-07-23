import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getLogs, LOG_STORAGE_KEY, syncLogsFromBackend } from "../lib/appLog";
import NotificationIcon from "../assets/icons/Notification.svg?react";
import type { LogEntry, LogCategory } from "../lib/appLog";
import { schedulerApi, commentsApi, feedbackApi, agentApi, skillsApi } from "../lib/api";
import type { TokenStats, SkillTokenStats } from "../lib/api";
import type { CalendarEvent, Comment, Reminder, FeedbackItem } from "../types";
import FeedbackDetailModal from "../components/feedback/FeedbackDetailModal";

// ── Tab definition ────────────────────────────────────────────────────────────

type Tab = "activity" | "events" | "comments" | "notifications" | "reminders" | "feedback" | "tokens";

const TABS: { id: Tab; label: string }[] = [
  { id: "activity", label: "Activity" },
  { id: "events", label: "Events" },
  { id: "comments", label: "Comments" },
  { id: "notifications", label: "Notifications" },
  { id: "reminders", label: "Reminders" },
  { id: "feedback", label: "Feedback" },
  { id: "tokens", label: "Tokens" },
];

// ── Activity tab helpers ──────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<LogCategory, string> = {
  account: "Account",
  team: "Team",
  action_item: "Action Item",
  calendar: "Calendar",
};

const CATEGORY_COLOR: Record<LogCategory, string> = {
  account: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
  team: "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
  action_item: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  calendar: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
};

// ── Shared helpers ────────────────────────────────────────────────────────────

function formatTs(ts: number | string): string {
  const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 py-16 flex flex-col items-center gap-2">
      <p className="text-sm" style={{ color: "var(--twilio-gray-60)" }}>{text}</p>
    </div>
  );
}

// ── Events tab ────────────────────────────────────────────────────────────────

const EVENT_STATUS_COLOR: Record<string, string> = {
  confirmed: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  tentative: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  cancelled: "bg-gray-100 text-gray-500 ring-1 ring-gray-200",
};

function EventsTab() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    schedulerApi.listEvents({ ordering: "-start_datetime", page_size: "200" })
      .then(r => setEvents(r.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState />;
  if (events.length === 0) return <EmptyState text="No events found." />;

  return (
    <div className="space-y-2">
      {events.map(ev => (
        <div key={ev.id} className="flex items-start gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
          <span className={`mt-0.5 shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${EVENT_STATUS_COLOR[ev.status] ?? "bg-gray-100 text-gray-500"}`}>
            {ev.status}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" style={{ color: "var(--twilio-navy)" }}>{ev.title}</p>
            <div className="flex flex-wrap gap-x-3 mt-0.5">
              <span className="text-xs" style={{ color: "var(--twilio-gray-60)" }}>
                {formatDate(ev.start_datetime)} – {formatDate(ev.end_datetime)}
              </span>
              {ev.account_name && (
                <span className="text-xs" style={{ color: "var(--twilio-gray-60)" }}>
                  {ev.account_name}
                </span>
              )}
              {ev.attendees?.length > 0 && (
                <span className="text-xs" style={{ color: "var(--twilio-gray-60)" }}>
                  {ev.attendees.length} attendee{ev.attendees.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>
          <span className="shrink-0 text-[11px] tabular-nums" style={{ color: "var(--twilio-gray-40)" }}>
            {formatDate(ev.created_at)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Comments tab ──────────────────────────────────────────────────────────────

const RESOURCE_TYPE_LABEL: Record<string, string> = {
  account: "Account",
  airtable_account: "Account",
  action_item: "Action Item",
  meeting: "Meeting",
  calendar_event: "Event",
  reminder: "Reminder",
  task: "Task",
  account_note: "Note",
  artifact: "Artifact",
  meeting_note: "Meeting Note",
};

const RESOURCE_TYPE_COLOR: Record<string, string> = {
  account: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
  airtable_account: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
  action_item: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  meeting: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  calendar_event: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  reminder: "bg-purple-50 text-purple-700 ring-1 ring-purple-200",
  task: "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
  account_note: "bg-gray-100 text-gray-600 ring-1 ring-gray-200",
  artifact: "bg-gray-100 text-gray-600 ring-1 ring-gray-200",
  meeting_note: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
};

function CommentsTab() {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    commentsApi.listAll()
      .then(r => setComments(r.data.results ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState />;
  if (comments.length === 0) return <EmptyState text="No comments yet." />;

  return (
    <div className="space-y-2">
      {comments.map(c => (
        <div key={c.id} className="flex items-start gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
          <span className={`mt-0.5 shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${RESOURCE_TYPE_COLOR[c.resource_type] ?? "bg-gray-100 text-gray-500"}`}>
            {RESOURCE_TYPE_LABEL[c.resource_type] ?? c.resource_type}
          </span>
          <div className="flex-1 min-w-0">
            {c.resource_label && (
              <p className="text-xs font-medium mb-0.5 truncate" style={{ color: "var(--twilio-gray-60)" }}>
                {c.resource_label}
              </p>
            )}
            <p className="text-sm leading-snug" style={{ color: "var(--twilio-navy)" }}>{c.content}</p>
            {c.replies?.length > 0 && (
              <p className="text-xs mt-1" style={{ color: "var(--twilio-gray-60)" }}>
                {c.replies.length} repl{c.replies.length !== 1 ? "ies" : "y"}
              </p>
            )}
          </div>
          <span className="shrink-0 text-[11px] tabular-nums" style={{ color: "var(--twilio-gray-40)" }}>
            {formatDate(c.created_at)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Notifications tab ─────────────────────────────────────────────────────────

// Notifications = reminders that have already fired (sent) filtered to notify_in_app=true,
// plus any status-change reminders. We display the full sent/dismissed/snoozed history.

const NOTIF_STATUS_COLOR: Record<string, string> = {
  sent: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  dismissed: "bg-gray-100 text-gray-500 ring-1 ring-gray-200",
  snoozed: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  pending: "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
};

function NotificationsTab() {
  const [items, setItems] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch all statuses and show those with notify_in_app true
    schedulerApi.listReminders({ page_size: "200" })
      .then(r => {
        const all = r.data.results ?? [];
        setItems(all.filter(rem => rem.notify_in_app));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState />;
  if (items.length === 0) return <EmptyState text="No in-app notifications on record." />;

  return (
    <div className="space-y-2">
      {items.map(rem => (
        <div key={rem.id} className="flex items-start gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
          <span className={`mt-0.5 shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${NOTIF_STATUS_COLOR[rem.status] ?? "bg-gray-100 text-gray-500"}`}>
            {rem.status}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium" style={{ color: "var(--twilio-navy)" }}>{rem.title}</p>
            {rem.body && (
              <p className="text-xs mt-0.5 leading-snug" style={{ color: "var(--twilio-gray-60)" }}>{rem.body}</p>
            )}
            {rem.resource_label && (
              <p className="text-xs mt-0.5" style={{ color: "var(--twilio-gray-60)" }}>
                {RESOURCE_TYPE_LABEL[rem.resource_type] ?? rem.resource_type}: {rem.resource_label}
              </p>
            )}
            <div className="flex gap-1 mt-1 flex-wrap">
              {rem.notify_slack && <ChannelBadge label="Slack" />}
              {rem.notify_push && <ChannelBadge label="Push" />}
              {rem.notify_sms && <ChannelBadge label="SMS" />}
            </div>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-1">
            <span className="text-[11px] tabular-nums" style={{ color: "var(--twilio-gray-40)" }}>
              Due {formatDate(rem.due_at)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ChannelBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">
      {label}
    </span>
  );
}

// ── Reminders tab ─────────────────────────────────────────────────────────────

const REMINDER_STATUS_COLOR: Record<string, string> = {
  pending: "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
  sent: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  dismissed: "bg-gray-100 text-gray-500 ring-1 ring-gray-200",
  snoozed: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
};

function RemindersTab() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    schedulerApi.listReminders({ page_size: "200" })
      .then(r => setReminders(r.data.results ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState />;
  if (reminders.length === 0) return <EmptyState text="No reminders found." />;

  return (
    <div className="space-y-2">
      {reminders.map(rem => (
        <div key={rem.id} className="flex items-start gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
          <span className={`mt-0.5 shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${REMINDER_STATUS_COLOR[rem.status] ?? "bg-gray-100 text-gray-500"}`}>
            {rem.status}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium" style={{ color: "var(--twilio-navy)" }}>{rem.title}</p>
            {rem.body && (
              <p className="text-xs mt-0.5 leading-snug" style={{ color: "var(--twilio-gray-60)" }}>{rem.body}</p>
            )}
            {rem.resource_label && (
              <p className="text-xs mt-0.5" style={{ color: "var(--twilio-gray-60)" }}>
                {RESOURCE_TYPE_LABEL[rem.resource_type] ?? rem.resource_type}: {rem.resource_label}
              </p>
            )}
          </div>
          <span className="shrink-0 text-[11px] tabular-nums" style={{ color: "var(--twilio-gray-40)" }}>
            {formatDate(rem.due_at)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Feedback tab ─────────────────────────────────────────────────────────────

const FB_STATUS_COLOR: Record<string, string> = {
  open: "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
  in_progress: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  resolved: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  wont_fix: "bg-gray-100 text-gray-500 ring-1 ring-gray-200",
};

const FB_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  wont_fix: "Won't Fix",
};

function FeedbackTab() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<FeedbackItem | null>(null);

  useEffect(() => {
    feedbackApi.list()
      .then(r => setItems(r.data.results ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState />;
  if (items.length === 0) return <EmptyState text="No feedback submitted yet." />;

  return (
    <>
      <div className="space-y-2">
        {items.map(fb => (
          <button
            key={fb.id}
            onClick={() => setSelected(fb)}
            style={{
              display: "flex", alignItems: "flex-start", gap: 12, width: "100%", textAlign: "left",
              padding: "12px 16px", borderRadius: 12,
              border: "1px solid var(--border, rgba(0,0,0,0.08))",
              background: "var(--surface, #fff)",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              cursor: "pointer", fontFamily: "var(--font-base)",
              transition: "box-shadow 0.15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)")}
            onMouseLeave={e => (e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)")}
          >
            <span className={`mt-0.5 shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${FB_STATUS_COLOR[fb.status] ?? "bg-gray-100 text-gray-500"}`}>
              {FB_STATUS_LABEL[fb.status] ?? fb.status}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: "0.875rem", color: "var(--twilio-navy)", margin: 0, lineHeight: 1.5 }}>
                {fb.description.length > 120 ? fb.description.slice(0, 120) + "…" : fb.description}
              </p>
              <div style={{ display: "flex", gap: 12, marginTop: 4, flexWrap: "wrap" }}>
                {fb.element_label && (
                  <span style={{ fontSize: "0.75rem", color: "var(--twilio-red,#DB131A)", display: "flex", alignItems: "center", gap: 3 }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    {fb.element_label}
                  </span>
                )}
                {fb.comment_count > 0 && (
                  <span style={{ fontSize: "0.75rem", color: "var(--twilio-gray-60)" }}>
                    {fb.comment_count} comment{fb.comment_count !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>
            <span style={{ shrinkTo: 0, fontSize: "0.6875rem", color: "var(--twilio-gray-40)", whiteSpace: "nowrap" } as React.CSSProperties}>
              {formatDate(fb.created_at)}
            </span>
          </button>
        ))}
      </div>
      {selected && (
        <FeedbackDetailModal
          item={selected}
          onClose={() => setSelected(null)}
          onUpdated={updated => {
            setItems(prev => prev.map(f => f.id === updated.id ? updated : f));
            setSelected(updated);
          }}
          onDeleted={id => {
            setItems(prev => prev.filter(f => f.id !== id));
            setSelected(null);
          }}
        />
      )}
    </>
  );
}

// ── Shared loading ────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm animate-pulse">
          <div className="flex gap-3 items-center">
            <div className="h-5 w-16 rounded-full bg-gray-100" />
            <div className="h-4 flex-1 rounded bg-gray-100" />
            <div className="h-4 w-20 rounded bg-gray-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Activity tab ──────────────────────────────────────────────────────────────

function ActivityTab() {
  const [entries, setEntries] = useState<LogEntry[]>(() => getLogs());

  useEffect(() => {
    syncLogsFromBackend();
    function onStorage(e: StorageEvent) {
      if (e.key === LOG_STORAGE_KEY) setEntries(getLogs());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (entries.length === 0) return <EmptyState text="No activity yet. Events will appear here as you use the app." />;

  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className="flex items-start gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm"
        >
          <span className={`mt-0.5 shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${CATEGORY_COLOR[entry.category]}`}>
            {CATEGORY_LABEL[entry.category]}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm" style={{ color: "var(--twilio-navy)" }}>{entry.message}</p>
            {entry.links && entry.links.length > 0 && (
              <div className="flex flex-wrap gap-3 mt-1.5">
                {entry.links.map((link) => (
                  <Link
                    key={link.path}
                    to={link.path}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-800 hover:underline inline-flex items-center gap-0.5"
                  >
                    {link.label}
                    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-2.5 h-2.5 opacity-60">
                      <path d="M2.5 9.5l7-7M4 2.5h5.5V8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </Link>
                ))}
              </div>
            )}
          </div>
          <span className="shrink-0 text-[11px] tabular-nums" style={{ color: "var(--twilio-gray-40)" }}>
            {formatTs(entry.ts)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Tokens tab ────────────────────────────────────────────────────────────────

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function TokenBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(1, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ height: 4, borderRadius: 2, background: "var(--twilio-gray-10, #f0f0f0)", flex: 1 }}>
      <div style={{ height: "100%", width: `${pct}%`, borderRadius: 2, background: "var(--twilio-red, #e22)" }} />
    </div>
  );
}

function TokensTab() {
  const [agentStats, setAgentStats] = useState<TokenStats | null>(null);
  const [skillStats, setSkillStats] = useState<SkillTokenStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      agentApi.getTokenStats().catch(() => null),
      skillsApi.getTokenStats().catch(() => null),
    ]).then(([a, s]) => {
      setAgentStats(a?.data ?? null);
      setSkillStats(s?.data ?? null);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState />;

  const agentTotal = agentStats?.all_time.total_tokens ?? 0;
  const skillTotal = skillStats?.all_time.total_tokens ?? 0;
  const grandTotal = agentTotal + skillTotal;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total tokens", value: grandTotal, sub: "across all features" },
          { label: "Agent chat", value: agentTotal, sub: `${agentStats?.by_session.length ?? 0} sessions` },
          { label: "Skill invocations", value: skillTotal, sub: `${skillStats?.by_skill.reduce((s, r) => s + r.invocation_count, 0) ?? 0} runs` },
        ].map(({ label, value, sub }) => (
          <div key={label} className="rounded-xl border border-gray-100 bg-white px-5 py-4 shadow-sm">
            <p className="text-xs font-medium mb-1" style={{ color: "var(--twilio-gray-60)" }}>{label}</p>
            <p className="text-2xl font-bold tabular-nums" style={{ color: "var(--twilio-navy)" }}>{fmtTokens(value)}</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--twilio-gray-40)" }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* Agent sessions breakdown */}
      {(agentStats?.by_session.length ?? 0) > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--twilio-navy)" }}>Agent sessions</h2>
          <div className="space-y-2">
            {agentStats!.by_session.map(row => (
              <div key={row.session_id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--twilio-navy)" }}>{row.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <TokenBar value={row.total_tokens} max={agentStats!.all_time.total_tokens} />
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold tabular-nums" style={{ color: "var(--twilio-navy)" }}>{fmtTokens(row.total_tokens)}</p>
                  <p className="text-[11px] tabular-nums" style={{ color: "var(--twilio-gray-40)" }}>
                    {fmtTokens(row.input_tokens)} in · {fmtTokens(row.output_tokens)} out
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Skill invocations breakdown */}
      {(skillStats?.by_skill.length ?? 0) > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--twilio-navy)" }}>Skill invocations</h2>
          <div className="space-y-2">
            {skillStats!.by_skill.map(row => (
              <div key={row.skill_id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--twilio-navy)" }}>{row.skill_name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <TokenBar value={row.total_tokens} max={skillStats!.all_time.total_tokens} />
                    <span className="shrink-0 text-[11px]" style={{ color: "var(--twilio-gray-40)" }}>
                      {row.invocation_count} run{row.invocation_count !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold tabular-nums" style={{ color: "var(--twilio-navy)" }}>{fmtTokens(row.total_tokens)}</p>
                  <p className="text-[11px] tabular-nums" style={{ color: "var(--twilio-gray-40)" }}>
                    {fmtTokens(row.input_tokens)} in · {fmtTokens(row.output_tokens)} out
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {grandTotal === 0 && (
        <EmptyState text="No token usage recorded yet. Token counts appear after you use the Agent or run a Claude Skill." />
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LogsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("activity");

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-semibold flex items-center gap-2" style={{ color: "var(--twilio-navy)" }}><NotificationIcon width={24} height={24} style={{ flexShrink: 0 }} />Activity Log</h1>
        <p className="text-sm mt-1" style={{ color: "var(--twilio-gray-60)" }}>
          Historical record of events, comments, notifications, and reminders.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-200">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="px-4 py-2 text-sm font-medium transition-colors relative"
            style={{
              color: activeTab === tab.id ? "var(--twilio-red, #e22)" : "var(--twilio-gray-60)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              paddingBottom: "10px",
            }}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span
                className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t"
                style={{ background: "var(--twilio-red, #e22)" }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "activity" && <ActivityTab />}
      {activeTab === "events" && <EventsTab />}
      {activeTab === "comments" && <CommentsTab />}
      {activeTab === "notifications" && <NotificationsTab />}
      {activeTab === "reminders" && <RemindersTab />}
      {activeTab === "feedback" && <FeedbackTab />}
      {activeTab === "tokens" && <TokensTab />}
    </div>
  );
}
