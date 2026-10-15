// Compare-calendars helpers: the availability response shape, overlay events for the grid,
// and the "everyone is free" finder. Pure, so the page and its tests share one definition.

import type { CalendarEvent } from "../types";

export interface BusyBlock {
  start: string;
  end: string;
  all_day: boolean;
  /** Real title only when the meeting is on an account you share; otherwise "Busy". */
  title: string;
  title_visible: boolean;
}

export interface PersonAvailability {
  email: string;
  name: string;
  source: "app" | "google";
  busy: BusyBlock[];
  /** e.g. "not_connected" (no Google link), "notFound", "google_error". */
  error: string | null;
}

export const COMPARE_PALETTE = ["#7c3aed", "#0891b2", "#ea580c", "#65a30d", "#db2777", "#0d9488", "#ca8a04", "#4f46e5"];
export const MAX_COMPARE_PEOPLE = 8;
/** Calendar id for overlay events — never matches a real calendar, so no edit path applies. */
export const COMPARE_CALENDAR_ID = "compare";

function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return -(Math.abs(h) + 100_000);
}

/**
 * Read-only grid events for a compared person. Negative ids and their own calendar_id keep
 * them out of every edit, attendance, comment and Log Time path, which all key on real rows.
 */
export function overlayEvents(person: PersonAvailability): CalendarEvent[] {
  return person.busy.map((b, i) => ({
    id: hashId(`${person.email}|${b.start}|${i}`),
    owner: 0,
    owner_username: person.name,
    account: null,
    account_name: null,
    google_event_id: `compare-${person.email}-${i}`,
    title: `${person.name}: ${b.title}`,
    description: "",
    location: "",
    start_datetime: b.start,
    end_datetime: b.end,
    all_day: b.all_day,
    status: "confirmed" as const,
    attendees: [],
    meet_link: "",
    calendar_id: COMPARE_CALENDAR_ID,
    is_synced: false,
    agentpm_airtable_id: "",
    created_at: "",
    updated_at: "",
  }));
}

export function isCompareEvent(e: Pick<CalendarEvent, "calendar_id">): boolean {
  return e.calendar_id === COMPARE_CALENDAR_ID;
}

export interface FreeSlot { start: Date; end: Date }

/**
 * Gaps of at least `minMinutes` within working hours on weekdays where nobody (you or anyone
 * compared) is busy. All-day busy blocks are ignored — an OOO marker on one person's calendar
 * should hide that day only for them, which the grid already shows.
 */
export function findFreeSlots(
  busy: Array<{ start: string; end: string; all_day?: boolean }>,
  rangeStart: Date,
  rangeEnd: Date,
  { minMinutes = 30, dayStartHour = 9, dayEndHour = 17, now = new Date(), includeWeekends = false } = {},
): FreeSlot[] {
  const intervals = busy
    .filter((b) => !b.all_day)
    .map((b) => [new Date(b.start).getTime(), new Date(b.end).getTime()] as const)
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s)
    .sort((a, b) => a[0] - b[0]);

  const slots: FreeSlot[] = [];
  const day = new Date(rangeStart);
  day.setHours(0, 0, 0, 0);
  for (; day < rangeEnd; day.setDate(day.getDate() + 1)) {
    const dow = day.getDay();
    if (!includeWeekends && (dow === 0 || dow === 6)) continue;
    const winStart = new Date(day); winStart.setHours(dayStartHour, 0, 0, 0);
    const winEnd = new Date(day); winEnd.setHours(dayEndHour, 0, 0, 0);
    let cursor = Math.max(winStart.getTime(), now.getTime(), rangeStart.getTime());
    const stop = Math.min(winEnd.getTime(), rangeEnd.getTime());
    for (const [s, e] of intervals) {
      if (e <= cursor) continue;
      if (s >= stop) break;
      if (s - cursor >= minMinutes * 60_000) slots.push({ start: new Date(cursor), end: new Date(s) });
      cursor = Math.max(cursor, e);
    }
    if (stop - cursor >= minMinutes * 60_000) slots.push({ start: new Date(cursor), end: new Date(stop) });
  }
  return slots;
}
