// Calendar search: one matcher shared by the grid filter and the results list, so a
// result the dropdown offers is always one the grid would also keep.

import type { CalendarEvent } from "../types";

/** How far either side of today the results list looks (the grid filter has no window). */
export const SEARCH_WINDOW_DAYS = 365;
/** Fewer characters than this don't hit the server — "a" matches nearly everything. */
export const MIN_SERVER_QUERY = 2;
export const MAX_RESULTS = 20;

function haystack(e: CalendarEvent, accountName?: string | null): string {
  const people = (e.attendees ?? []).map((a) => `${a.displayName ?? ""} ${a.email ?? ""}`).join(" ");
  return [e.title, e.description, e.location, e.account_name, accountName, people]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Every whitespace-separated term must appear somewhere (title, notes, place, account, guests). */
export function eventMatchesQuery(e: CalendarEvent, query: string, accountName?: string | null): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const text = haystack(e, accountName);
  return terms.every((t) => text.includes(t));
}

/** `start` / `end` ISO bounds for the server-side search window around `now`. */
export function searchWindow(now: Date = new Date()): { start: string; end: string } {
  const ms = SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return {
    start: new Date(now.getTime() - ms).toISOString(),
    end: new Date(now.getTime() + ms).toISOString(),
  };
}

/** Results ordered nearest-to-now first (upcoming before past at equal distance), capped. */
export function rankResults(events: CalendarEvent[], now: Date = new Date()): CalendarEvent[] {
  const t = now.getTime();
  const seen = new Set<number>();
  return events
    .filter((e) => e.calendar_id !== "reminders" && !seen.has(e.id) && (seen.add(e.id), true))
    .sort((a, b) => {
      const da = new Date(a.start_datetime).getTime() - t;
      const db = new Date(b.start_datetime).getTime() - t;
      const diff = Math.abs(da) - Math.abs(db);
      return diff !== 0 ? diff : db - da;
    })
    .slice(0, MAX_RESULTS);
}
