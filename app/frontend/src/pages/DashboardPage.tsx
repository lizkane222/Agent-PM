import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { airtableApi, schedulerApi } from "../lib/api";
import { logActionItemUpdate } from "../lib/actionItemLog";
import HomeIcon from "../assets/icons/Home.svg?react";
import type { AirtableActionItem, AirtableAccount, CalendarEvent, Reminder } from "../types";

function StatCard({ label, value, sublabel, to }: {
  label: string;
  value: string | number;
  sublabel?: string;
  to?: string;
}) {
  const inner = (
    <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow">
      <p className="text-sm font-medium text-[var(--twilio-gray-60)]">{label}</p>
      <p className="mt-1 text-4xl font-semibold text-[var(--twilio-navy)] tabular-nums">{value}</p>
      {sublabel && <p className="mt-1 text-xs text-[var(--twilio-gray-60)]">{sublabel}</p>}
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : <>{inner}</>;
}

const PRIORITY_BADGE: Record<string, string> = {
  Critical: "bg-red-50 text-red-700",
  High: "bg-orange-50 text-orange-700",
  Medium: "bg-sky-50 text-sky-700",
  Low: "bg-gray-100 text-[var(--twilio-navy)]",
};

const STATUS_BADGE: Record<string, string> = {
  "Open": "bg-gray-100 text-[var(--twilio-navy)]",
  "In Progress": "bg-indigo-50 text-indigo-700",
  "Blocked": "bg-red-50 text-red-700",
  "Backlogged": "bg-slate-100 text-slate-600",
  "Done": "bg-green-50 text-green-700",
};

function fmt(dt: string) {
  return new Date(dt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function fmtDate(dt: string) {
  return new Date(dt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function readZones(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem("actionItemZones") ?? "{}"); } catch { return {}; }
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [actionItems, setActionItems] = useState<AirtableActionItem[]>([]);
  const [todayEvents, setTodayEvents] = useState<CalendarEvent[]>([]);
  const [accounts, setAccounts] = useState<AirtableAccount[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissingId, setDismissingId] = useState<number | null>(null);
  const [trackingId, setTrackingId] = useState<string | null>(null);

  function fetchAll(opts?: { silent?: boolean }) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    if (!opts?.silent) setLoading(true);

    const safe = <T,>(p: Promise<{ data: { results: T[] } }>, fallback: T[] = []): Promise<T[]> =>
      p.then((r) => r.data.results).catch(() => fallback);
    const safeArr = <T,>(p: Promise<{ data: T[] }>, fallback: T[] = []): Promise<T[]> =>
      p.then((r) => r.data).catch(() => fallback);

    Promise.all([
      safeArr(airtableApi.listActionItems({ status: "Open,In Progress,Blocked,Backlogged,Done", page_size: "200" })),
      safeArr(schedulerApi.listEvents({ start: todayStart.toISOString(), end: todayEnd.toISOString() })),
      safe(airtableApi.listAccounts({ page_size: "200" })),
      safe(schedulerApi.listReminders({ status: "pending,snoozed", page_size: "100" })),
    ]).then(([items, events, accounts, reminders]) => {
      setActionItems(items as AirtableActionItem[]);
      const realEvents = (events as CalendarEvent[])
        .filter((e) => e.calendar_id !== "work_tracking")
        .sort((a, b) => new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime());
      setTodayEvents(realEvents);
      setAccounts(accounts as AirtableAccount[]);
      setReminders(reminders as Reminder[]);
    }).finally(() => { setLoading(false); });
  }

  useEffect(() => {
    fetchAll();

    function onVisibility() {
      if (document.visibilityState === "visible") fetchAll({ silent: true });
    }
    function onStorage(e: StorageEvent) {
      if (e.key === "actionItemsUpdated" || e.key === "accountsUpdated" || e.key === "calendarUpdated") fetchAll({ silent: true });
    }

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("storage", onStorage);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("storage", onStorage);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Today's items: explicitly staged to "today" or "active", due today, or on the calendar today
  const zones = readZones();
  const todayDateStr = new Date().toDateString();
  const calendarAirtableIds = new Set(
    todayEvents.map((e) => e.agentpm_airtable_id).filter(Boolean)
  );
  const todayItems = actionItems.filter((i) => {
    if (i.airtable_id.startsWith("local-")) return false;
    const zone = zones[i.airtable_id];
    if (zone === "today" || zone === "active") return true;
    if (calendarAirtableIds.has(i.airtable_id)) return true;
    if (i.due_date && new Date(i.due_date).toDateString() === todayDateStr) return true;
    return false;
  });

  const openItems = actionItems.filter((i) => i.status === "Open");
  const inProgressItems = actionItems.filter((i) => i.status === "In Progress");
  const blockedItems = actionItems.filter((i) => i.status === "Blocked");

  // Reminders: split today vs overdue
  const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
  const tomorrowMidnight = new Date(); tomorrowMidnight.setHours(23, 59, 59, 999);

  const todayReminders = reminders.filter((r) => {
    const d = new Date(r.due_at);
    return d >= todayMidnight && d <= tomorrowMidnight;
  }).sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());

  const overdueReminders = reminders.filter((r) => {
    return new Date(r.due_at) < todayMidnight;
  }).sort((a, b) => new Date(b.due_at).getTime() - new Date(a.due_at).getTime());

  async function handleDismiss(id: number) {
    setDismissingId(id);
    try {
      await schedulerApi.dismissReminder(id);
      setReminders((prev) => prev.filter((r) => r.id !== id));
    } catch {
      // silent — reminder stays visible
    } finally {
      setDismissingId(null);
    }
  }

  async function handleTrack(item: AirtableActionItem) {
    if (trackingId) return;
    const nextStatus = item.status === "Open" ? "In Progress" : "Done";
    setTrackingId(item.airtable_id);
    setActionItems((prev) =>
      prev.map((i) => i.airtable_id === item.airtable_id ? { ...i, status: nextStatus as AirtableActionItem["status"] } : i)
    );
    try {
      await airtableApi.updateActionItemStatus(item.airtable_id, nextStatus);
      logActionItemUpdate(item, { status: nextStatus as AirtableActionItem["status"] });
    } catch {
      // revert on failure
      setActionItems((prev) =>
        prev.map((i) => i.airtable_id === item.airtable_id ? { ...i, status: item.status } : i)
      );
    } finally {
      setTrackingId(null);
    }
  }

  const todayStr = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const allReminders = [...overdueReminders, ...todayReminders];

  return (
    <div className="px-6 py-8 space-y-8 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-[var(--twilio-navy)] flex items-center gap-2"><HomeIcon width={24} height={24} style={{ flexShrink: 0 }} />Dashboard</h1>
          <p className="mt-1 text-sm text-[var(--twilio-gray-60)]">{todayStr}</p>
        </div>
        <button
          onClick={() => {
            navigate("/agent", { state: { openWhereToStart: true } });
          }}
          style={{
            padding: "8px 14px", borderRadius: "8px", fontSize: "0.875rem", fontWeight: 600,
            background: "transparent",
            color: "var(--text-secondary, #666)",
            border: "1px solid var(--border, rgba(0,0,0,0.08))",
            cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,0,0,0.03)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
        >
          ✦ Where to start
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard
          label="Open Action Items"
          value={loading ? "—" : openItems.length}
          sublabel="not yet started"
          to="/action-items"
        />
        <StatCard
          label="In Progress"
          value={loading ? "—" : inProgressItems.length}
          sublabel={blockedItems.length > 0 ? `${blockedItems.length} blocked` : "no blockers"}
          to="/action-items"
        />
        <StatCard
          label="Meetings Today"
          value={loading ? "—" : todayEvents.length}
          sublabel={todayEvents.length > 0 ? `next at ${fmt(todayEvents[0].start_datetime)}` : "none scheduled"}
          to="/calendar"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

        {/* Today's meetings */}
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--twilio-navy)]">Today's Meetings</h2>
            <Link to="/calendar" className="text-xs text-indigo-600 hover:underline">View calendar →</Link>
          </div>
          <div className="divide-y divide-gray-50">
            {loading && <p className="px-5 py-4 text-sm text-[var(--twilio-gray-60)]">Loading…</p>}
            {!loading && todayEvents.length === 0 && (
              <p className="px-5 py-4 text-sm text-[var(--twilio-gray-60)]">No meetings today.</p>
            )}
            {todayEvents.slice(0, 6).map((ev) => (
              <div key={ev.id} className="px-5 py-3 flex items-start gap-3">
                <div className="shrink-0 text-right w-16">
                  <p className="text-xs font-medium text-[var(--twilio-navy)] tabular-nums">{fmt(ev.start_datetime)}</p>
                  <p className="text-xs text-[var(--twilio-gray-60)] tabular-nums">{fmt(ev.end_datetime)}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--twilio-navy)] truncate">{ev.title}</p>
                  {ev.attendees.length > 0 && (
                    <p className="text-xs text-[var(--twilio-gray-60)] mt-0.5">{ev.attendees.length} attendee{ev.attendees.length !== 1 ? "s" : ""}</p>
                  )}
                </div>
                {ev.status === "tentative" && (
                  <span className="text-xs bg-yellow-50 text-yellow-700 px-1.5 py-0.5 rounded shrink-0">Tentative</span>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Today's staged action items */}
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--twilio-navy)]">Today's Action Items</h2>
            <Link to="/action-items" className="text-xs text-indigo-600 hover:underline">View all →</Link>
          </div>
          <div className="divide-y divide-gray-50">
            {loading && <p className="px-5 py-4 text-sm text-[var(--twilio-gray-60)]">Loading…</p>}
            {!loading && todayItems.length === 0 && (
              <p className="px-5 py-4 text-sm text-[var(--twilio-gray-60)]">No action items staged for today.</p>
            )}
            {todayItems.slice(0, 8).map((item) => {
              const isTracking = trackingId === item.airtable_id;
              const isDone = item.status === "Done";
              const isInProgress = item.status === "In Progress";
              return (
                <div key={item.airtable_id} className="px-5 py-3 flex items-center gap-3">
                  {/* Track button */}
                  {!isDone && (
                    <button
                      onClick={() => handleTrack(item)}
                      disabled={isTracking || !!trackingId}
                      title={isInProgress ? "Mark done" : "Start task"}
                      style={{
                        flexShrink: 0,
                        width: 28, height: 28,
                        borderRadius: "50%",
                        border: `2px solid ${isInProgress ? "var(--twilio-red, #e00b1c)" : "var(--twilio-gray-60, #6b7280)"}`,
                        background: isInProgress ? "var(--twilio-red, #e00b1c)" : "transparent",
                        color: isInProgress ? "#fff" : "var(--twilio-gray-60, #6b7280)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        cursor: isTracking || !!trackingId ? "not-allowed" : "pointer",
                        opacity: isTracking ? 0.5 : 1,
                        transition: "all 0.15s",
                        fontSize: 13,
                        padding: 0,
                      }}
                    >
                      {isTracking ? "…" : isInProgress ? "✓" : "▶"}
                    </button>
                  )}
                  {isDone && (
                    <div style={{
                      flexShrink: 0, width: 28, height: 28, borderRadius: "50%",
                      border: "2px solid #10b981", background: "#10b981",
                      color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 13,
                    }}>✓</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${isDone ? "line-through opacity-50 text-[var(--twilio-gray-60)]" : "text-[var(--twilio-navy)]"}`}>
                      {item.task || <span className="italic opacity-50">Untitled</span>}
                    </p>
                    <div className="flex items-center gap-1 mt-0.5 min-w-0">
                      {item.account_name && (
                        <span className="text-xs text-[var(--twilio-gray-60)] truncate">{item.account_name}</span>
                      )}
                      {item.account_name && item.due_date && (
                        <span className="text-xs text-[var(--twilio-gray-60)] shrink-0">·</span>
                      )}
                      {item.due_date && (
                        <span className="text-xs text-[var(--twilio-gray-60)] shrink-0">Due {fmtDate(item.due_date)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${PRIORITY_BADGE[item.priority] ?? "bg-gray-100 text-[var(--twilio-navy)]"}`}>
                      {item.priority}
                    </span>
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${STATUS_BADGE[item.status] ?? "bg-green-50 text-green-700"}`}>
                      {item.status}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Reminders */}
      <section className="bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-[var(--twilio-navy)]">Reminders</h2>
              {!loading && overdueReminders.length > 0 && (
                <span className="text-xs font-medium bg-red-50 text-red-700 px-1.5 py-0.5 rounded">
                  {overdueReminders.length} overdue
                </span>
              )}
            </div>
            <Link to="/reminders" className="text-xs text-indigo-600 hover:underline">View all →</Link>
          </div>

          {loading && <p className="px-5 py-4 text-sm text-[var(--twilio-gray-60)]">Loading…</p>}

          {!loading && allReminders.length === 0 && (
            <p className="px-5 py-4 text-sm text-[var(--twilio-gray-60)]">No active or snoozed reminders.</p>
          )}

          {!loading && allReminders.length > 0 && (
            <div className="divide-y divide-gray-50">
              {overdueReminders.map((r) => (
                <ReminderRow
                  key={r.id}
                  reminder={r}
                  overdue
                  dismissing={dismissingId === r.id}
                  onDismiss={() => handleDismiss(r.id)}
                />
              ))}
              {todayReminders.map((r) => (
                <ReminderRow
                  key={r.id}
                  reminder={r}
                  overdue={false}
                  dismissing={dismissingId === r.id}
                  onDismiss={() => handleDismiss(r.id)}
                />
              ))}
            </div>
          )}
        </section>

      {/* Accounts strip */}
      {!loading && accounts.length > 0 && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--twilio-navy)]">Accounts</h2>
            <Link to="/accounts" className="text-xs text-indigo-600 hover:underline">View all →</Link>
          </div>
          <div className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {accounts.filter((acct) => acct.name?.trim()).map((acct) => (
              <Link
                key={acct.id}
                to={`/accounts/${acct.id}`}
                className="bg-gray-50 rounded-lg p-3 border border-gray-200 hover:border-indigo-300 hover:shadow-sm transition-all"
              >
                <p className="text-sm font-semibold text-[var(--twilio-navy)] truncate">{acct.name}</p>
                {acct.health_score && (
                  <p className="text-xs text-[var(--twilio-gray-60)] mt-0.5">Health: {acct.health_score}</p>
                )}
                {acct.open_ticket_count > 0 && (
                  <p className="text-xs text-orange-600 mt-0.5">{acct.open_ticket_count} open ticket{acct.open_ticket_count !== 1 ? "s" : ""}</p>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ReminderRow({ reminder, overdue, dismissing, onDismiss }: {
  reminder: Reminder;
  overdue: boolean;
  dismissing: boolean;
  onDismiss: () => void;
}) {
  return (
    <div className={`px-5 py-3 flex items-start gap-3 ${overdue ? "bg-red-50/40" : ""}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-[var(--twilio-navy)] truncate">{reminder.title}</p>
          {overdue && (
            <span className="text-xs font-medium bg-red-100 text-red-700 px-1.5 py-0.5 rounded shrink-0">Overdue</span>
          )}
          {reminder.status === "snoozed" && (
            <span className="text-xs bg-yellow-50 text-yellow-700 px-1.5 py-0.5 rounded shrink-0">Snoozed</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <p className={`text-xs tabular-nums ${overdue ? "text-red-600 font-medium" : "text-[var(--twilio-gray-60)]"}`}>
            {new Date(reminder.due_at).toLocaleString(undefined, {
              month: "short", day: "numeric",
              hour: "numeric", minute: "2-digit",
            })}
          </p>
          {reminder.resource_label && (
            <span className="text-xs text-[var(--twilio-gray-60)] truncate max-w-[180px]">· {reminder.resource_label}</span>
          )}
        </div>
      </div>
      <button
        onClick={onDismiss}
        disabled={dismissing}
        className="shrink-0 text-xs text-[var(--twilio-gray-60)] hover:text-[var(--twilio-navy)] px-2 py-1 rounded hover:bg-gray-100 transition-colors disabled:opacity-40"
      >
        {dismissing ? "…" : "Dismiss"}
      </button>
    </div>
  );
}
