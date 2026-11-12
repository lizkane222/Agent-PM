/**
 * Converting between an `<input type="datetime-local">` value and an instant.
 *
 * That input has no time zone: its value is the wall clock the user sees, `YYYY-MM-DDTHH:MM`.
 * The server stores instants (UTC). Sending the input's value as-is — which the calendar
 * sidebar's reminder form did — makes Django read it as UTC, so a reminder set for 3 PM in
 * Pacific time was stored as 3 PM UTC (7 AM local). Showing `toISOString().slice(0, 16)` in
 * the input had the matching fault in the other direction: a UTC clock in a local field.
 *
 * Always go through these two so the form shows, and the server stores, the same moment.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** An ISO instant → the user's local wall clock, for a datetime-local input. */
export function toLocalDatetimeValue(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A datetime-local value (local wall clock) → an ISO instant with an explicit `Z`. */
export function fromLocalDatetimeValue(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/** The next whole hour from now, as a datetime-local value — the default for a new reminder. */
export function nextHourLocalValue(now: Date = new Date()): string {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return toLocalDatetimeValue(d.toISOString());
}

/** True when two ISO instants are the same moment (string forms differ: `Z`, offset, `:00`). */
export function sameInstant(a: string, b: string): boolean {
  const x = new Date(a).getTime();
  const y = new Date(b).getTime();
  return !Number.isNaN(x) && x === y;
}
