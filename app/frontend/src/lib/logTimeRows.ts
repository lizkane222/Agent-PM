// Log Time panel rules — which calendar activity belongs on an account's timesheet, how
// long it lasted, and which project it files under. Pure functions so the panel's day
// columns, its week totals and the Log Week request all read from one definition; the
// server mirror is salesforce_sync/log_week.py + accounts/project_lookup.py.

import type { AccountProject, AirtableActionItem, CalendarEvent } from "../types";

/** Calendars that are never meeting rows (work_tracking blocks become action-item rows). */
const NON_MEETING_CALENDARS = new Set(["work_tracking", "reminders"]);

/** Local-time `YYYY-MM-DD`. The stored values are UTC, so `iso.slice(0, 10)` put an
 *  evening meeting on the next day for anyone west of UTC. */
export function localDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Seconds an event occupied. All-day events are not time worked, so they count as 0. */
export function eventSeconds(e: Pick<CalendarEvent, "start_datetime" | "end_datetime" | "all_day">): number {
  if (e.all_day) return 0;
  const secs = (new Date(e.end_datetime).getTime() - new Date(e.start_datetime).getTime()) / 1000;
  return Number.isFinite(secs) ? Math.max(0, secs) : 0;
}

function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

export function isAdminAccount(name: string): boolean {
  return name.trim().toLowerCase() === "admin";
}

/**
 * A meeting row for `accountName`: on this account, actually attended, not cancelled, not
 * all-day, and with a real duration. The server applies the same exclusions, so a row the
 * panel shows is a row Log Week would log.
 */
export function isLoggableMeeting(
  e: CalendarEvent,
  accountName: string,
  linkedAccountName: string | null | undefined,
): boolean {
  if (NON_MEETING_CALENDARS.has(e.calendar_id)) return false;
  if (e.status === "cancelled" || e.attended === false) return false;
  if (eventSeconds(e) <= 0) return false;
  // An in-session link wins over the stored FK; both compared case-insensitively, like the server.
  const owner = linkedAccountName ?? e.account_name;
  return !!owner && sameName(owner, accountName);
}

/**
 * Does `item` belong on `accountName`'s timesheet? Its own account must match. The Admin
 * panel also takes items with no account (personal overhead), but no longer every other
 * account's items, which is how customer work used to appear under Admin.
 */
export function itemBelongsToAccount(item: Pick<AirtableActionItem, "account_name">, accountName: string): boolean {
  if (item.account_name && item.account_name.trim()) return sameName(item.account_name, accountName);
  return isAdminAccount(accountName);
}

/**
 * Seconds tracked per (local day, action item) from work_tracking blocks — summed, so two
 * blocks for one item on one day both count (the old map kept only the last).
 */
export function trackedSecondsByDay(events: CalendarEvent[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of events) {
    if (e.calendar_id !== "work_tracking" || !e.agentpm_airtable_id) continue;
    if (e.status === "cancelled") continue;
    const secs = eventSeconds(e);
    if (secs <= 0) continue;
    const key = `${localDate(e.start_datetime)}::${e.agentpm_airtable_id}`;
    out.set(key, (out.get(key) ?? 0) + secs);
  }
  return out;
}

/**
 * The project an action item is filed under on the account page, or null.
 *
 * Assignment there is single-owner: an id lives in exactly one project's or goal's
 * `action_ids`. A goal is itself an AccountProject (`kind: "goal"`) listed in its parent
 * project's `goal_ids`, so an item under a goal resolves to that parent — Log Time files
 * against projects, never goals.
 */
export function projectForActionItem(airtableId: string, accountProjects: AccountProject[]): AccountProject | null {
  const owner = accountProjects.find((p) => (p.action_ids ?? []).includes(airtableId));
  if (!owner) return null;
  if (owner.kind !== "goal") return owner;
  const parent = accountProjects.find(
    (p) => p.kind !== "goal" && (p.goal_ids ?? []).map(String).includes(String(owner.id)),
  );
  return parent ?? null;
}

/** Negative-id space for local AccountProject pills in the panel (see CalendarPage). */
export function localProjectPillId(accountProjectId: number): number {
  return -(accountProjectId + 10000);
}
