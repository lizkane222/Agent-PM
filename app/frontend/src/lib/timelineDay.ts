/**
 * Day keys for the Account Detail timeline. Always the user's LOCAL calendar day.
 *
 * The old key was `toISOString().slice(0, 10)`, which is the UTC day: a 4:30 PM Pacific
 * meeting is already tomorrow in UTC, so it was drawn in the next day's column.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
// A date-typed field that arrives as a UTC-midnight timestamp still means "that date".
const UTC_MIDNIGHT = /^(\d{4}-\d{2}-\d{2})T00:00:00(\.0+)?(Z|\+00:00)?$/;

/** YYYY-MM-DD of a Date in local time. */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Day key for a real point in time (a calendar event's start): the local day it falls on. */
export function instantDayKey(value: string | Date): string {
  return localDateKey(value instanceof Date ? value : new Date(value));
}

/**
 * Day key for a field that means a calendar DATE (a due date, a meeting's date).
 * A date-only string is used as written, since parsing it as a timestamp would shift it by the
 * UTC offset; anything with a real time of day is converted to the local day.
 */
export function dateFieldDayKey(value: string | Date): string {
  if (typeof value === "string") {
    if (DATE_ONLY.test(value)) return value;
    const m = UTC_MIDNIGHT.exec(value);
    if (m) return m[1];
  }
  return instantDayKey(value);
}
