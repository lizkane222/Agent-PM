/**
 * Writing a scheduled action item or reminder to the database.
 *
 * ## Why this module exists
 *
 * Scheduled action items and reminders used to live only in `localStorage`
 * (`scheduledActionItems` / `scheduledReminders`), rendered as synthetic overlay events with a
 * fake `google_event_id` of `scheduled-<airtableId>__<startMin>`. That had three consequences,
 * the third of which was a data-loss bug:
 *
 * 1. They were browser-local — invisible on another device, gone with the storage.
 * 2. Nothing else in the app could see them; only this page knew the work was scheduled.
 * 3. **The Google sync deleted the `localStorage` entry before confirming the round trip had
 *    replaced it with a database row.** When the pull did not bring it back, the scheduling
 *    existed nowhere. See `_reconcile_missing_google_events` in `integrations/views.py`.
 *
 * Scheduling now writes a real `CalendarEvent` immediately, so the row is the original and
 * Google is the mirror. The sync's PHASE 1b pushes rows that have no `google_event_id` yet.
 *
 * Kept in `lib/` rather than inline in `CalendarPage.tsx` for the same reason as
 * `lib/localStore.ts` and `lib/eventColors.ts`: there are five call sites plus a migration
 * path, and they must not drift.
 */

import { schedulerApi } from "./api";
import type { CalendarEvent } from "../types/scheduler";

/** localStorage keys of the legacy browser-only representation. Read for migration only. */
export const LEGACY_SCHEDULED_ITEMS_KEY = "scheduledActionItems";
export const LEGACY_SCHEDULED_REMINDERS_KEY = "scheduledReminders";

/** `calendar_id` for a scheduled action item — matches the Django side. */
export const WORK_TRACKING_CALENDAR_ID = "work_tracking";
/** `calendar_id` for a scheduled reminder occurrence. */
export const REMINDERS_CALENDAR_ID = "reminders";

/** Default length of a dropped block, matching the dominant slot size already in the data. */
export const DEFAULT_SLOT_MINUTES = 15;

export interface LegacyScheduledItem {
  airtableId: string;
  task: string;
  accountName?: string | null;
  start: string;
  end: string;
  uid?: string;
  googleEventId?: string;
}

export interface LegacyScheduledReminder {
  reminderId: number;
  title: string;
  start: string;
  end: string;
}

export interface ScheduleActionItemInput {
  airtableId: string;
  task: string;
  start: string;
  end: string;
  accountName?: string | null;
}

export interface ScheduleReminderInput {
  reminderId: number;
  title: string;
  start: string;
  end?: string;
}

/** "YYYY-MM-DDTHH:MM" — the granularity a duplicate is judged at. */
export function startMinute(iso: string): string {
  return (iso ?? "").slice(0, 16);
}

export function endFor(start: string, end?: string): string {
  if (end) return end;
  const parsed = new Date(start);
  if (Number.isNaN(parsed.getTime())) return start;
  return new Date(parsed.getTime() + DEFAULT_SLOT_MINUTES * 60_000).toISOString();
}

/**
 * True when `events` already holds this action item at this start minute.
 *
 * Duplicate detection stays client-side against the events the page has already fetched,
 * preserving `saveScheduledItem`'s original contract (it returned null on a same-minute
 * duplicate). A server-side unique constraint would be stronger, but a scheduled occurrence is
 * legitimately repeatable on other days and adding one now would reject the restored rows.
 */
export function hasActionItemAt(
  events: readonly CalendarEvent[],
  airtableId: string,
  start: string,
): boolean {
  const minute = startMinute(start);
  return events.some(
    (e) =>
      e.calendar_id === WORK_TRACKING_CALENDAR_ID &&
      e.agentpm_airtable_id === airtableId &&
      startMinute(e.start_datetime) === minute,
  );
}

export function hasReminderAt(
  events: readonly CalendarEvent[],
  reminderId: number,
  start: string,
): boolean {
  const minute = startMinute(start);
  return events.some(
    (e) =>
      e.calendar_id === REMINDERS_CALENDAR_ID &&
      e.reminder === reminderId &&
      startMinute(e.start_datetime) === minute,
  );
}

/**
 * Create the calendar row for a dropped action item.
 *
 * Rejects a `local-*` id: `promoteBlankItem` discards that id for a real `recXXX`, so a row
 * pointing at one would orphan — the same guard focus pins, comments and the activity log use.
 *
 * Throws on a failed request rather than swallowing it. The caller must know, because the
 * whole point of this change is that a scheduling is never silently dropped.
 */
export async function scheduleActionItem(
  input: ScheduleActionItemInput,
): Promise<CalendarEvent> {
  if (!input.airtableId || input.airtableId.startsWith("local-")) {
    throw new Error("Cannot schedule an unsaved action item.");
  }
  const { data } = await schedulerApi.createEvent({
    title: input.task,
    start_datetime: input.start,
    end_datetime: endFor(input.start, input.end),
    calendar_id: WORK_TRACKING_CALENDAR_ID,
    agentpm_airtable_id: input.airtableId,
  });
  return data;
}

/** Create the calendar row for a dropped reminder. */
export async function scheduleReminder(
  input: ScheduleReminderInput,
): Promise<CalendarEvent> {
  const { data } = await schedulerApi.createEvent({
    title: input.title,
    start_datetime: input.start,
    end_datetime: endFor(input.start, input.end),
    calendar_id: REMINDERS_CALENDAR_ID,
    reminder: input.reminderId,
  });
  return data;
}

export function readLegacyItems(): LegacyScheduledItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEGACY_SCHEDULED_ITEMS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function readLegacyReminders(): LegacyScheduledReminder[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEGACY_SCHEDULED_REMINDERS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export interface MigrationResult {
  /** Rows created in the database. */
  created: number;
  /** Entries that already had a row, so nothing was written. */
  alreadyPresent: number;
  /** Entries whose create failed. Non-zero means the localStorage key is **kept**. */
  failed: number;
}

/**
 * Move any surviving `localStorage` schedulings into the database, once.
 *
 * **The key is cleared only when every entry is accounted for** — created or already present.
 * A single failure leaves the whole key intact so the next mount retries. Clearing on partial
 * success is precisely the bug this migration exists to undo, so it must not be reintroduced
 * here; a duplicate row is recoverable, a dropped scheduling is not.
 */
export async function migrateLegacyScheduledItems(
  events: readonly CalendarEvent[],
): Promise<MigrationResult> {
  const result: MigrationResult = { created: 0, alreadyPresent: 0, failed: 0 };

  const items = readLegacyItems();
  const reminders = readLegacyReminders();
  if (items.length === 0 && reminders.length === 0) return result;

  // Grows as rows are created, so two legacy entries for the same slot cannot both write.
  const known: CalendarEvent[] = [...events];

  for (const item of items) {
    if (!item?.airtableId || !item?.start) { result.alreadyPresent += 1; continue; }
    if (item.airtableId.startsWith("local-")) {
      // Unsaveable by design — count as handled so it does not pin the key forever.
      result.alreadyPresent += 1;
      continue;
    }
    if (hasActionItemAt(known, item.airtableId, item.start)) {
      result.alreadyPresent += 1;
      continue;
    }
    try {
      known.push(await scheduleActionItem({
        airtableId: item.airtableId,
        task: item.task || "Action item",
        start: item.start,
        end: item.end,
        accountName: item.accountName,
      }));
      result.created += 1;
    } catch {
      result.failed += 1;
    }
  }

  for (const reminder of reminders) {
    if (!reminder?.reminderId || !reminder?.start) { result.alreadyPresent += 1; continue; }
    if (hasReminderAt(known, reminder.reminderId, reminder.start)) {
      result.alreadyPresent += 1;
      continue;
    }
    try {
      known.push(await scheduleReminder({
        reminderId: reminder.reminderId,
        title: reminder.title || "Reminder",
        start: reminder.start,
        end: reminder.end,
      }));
      result.created += 1;
    } catch {
      result.failed += 1;
    }
  }

  if (result.failed === 0) {
    try {
      if (items.length) localStorage.removeItem(LEGACY_SCHEDULED_ITEMS_KEY);
      if (reminders.length) localStorage.removeItem(LEGACY_SCHEDULED_REMINDERS_KEY);
    } catch {
      /* best effort — a kept key only costs a no-op retry next mount */
    }
  }

  return result;
}
