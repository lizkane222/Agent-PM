/** Date → RFC3339 string preserving local wall-clock time and real UTC offset. */
export function dateToLocalISO(d: Date): string {
  const offsetMin = d.getTimezoneOffset();
  const sign = offsetMin <= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${hh}:${mm}`;
}

/**
 * Converts a local "YYYY-MM-DDTHH:MM:SS" string (no tz suffix) to RFC3339
 * with the current environment's real UTC offset.
 */
export function toLocalISO(localStr: string): string {
  return dateToLocalISO(new Date(localStr));
}

/**
 * Adds milliseconds to a local ISO string and returns a new RFC3339 local string.
 * Does NOT go through toISOString() — that would return UTC and cause a
 * double-offset bug when feeding the result back into toLocalISO().
 */
export function addMsToLocalISO(localStr: string, ms: number): string {
  return dateToLocalISO(new Date(new Date(localStr).getTime() + ms));
}
