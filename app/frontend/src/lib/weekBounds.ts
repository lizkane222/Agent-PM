/**
 * Local-time week bounds. The calendar (FullCalendar, no `firstDay` set) uses Sunday-start
 * weeks, so the default `firstDay` is 0 (Sunday); pass 1 for Monday-start.
 * Calendar-day arithmetic via setDate keeps this correct across DST changes (a week can be
 * 167 or 169 hours long).
 */
export function startOfWeek(now: Date, firstDay = 0): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() - firstDay + 7) % 7));
  return d;
}

/** Last instant (23:59:59.999 local, on the day before the next week starts) of now's week. */
export function endOfWeek(now: Date, firstDay = 0): Date {
  const d = startOfWeek(now, firstDay);
  d.setDate(d.getDate() + 7);
  return new Date(d.getTime() - 1);
}
