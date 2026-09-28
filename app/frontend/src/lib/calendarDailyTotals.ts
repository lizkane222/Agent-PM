/**
 * Per-day time totals for the calendar's footer row.
 *
 * Extracted so the day-overlap math is unit-testable directly — CalendarPage's own
 * footer only renders a day's label once `colPositions[day]` is populated by measuring
 * real `.fc-col-header-cell` DOM nodes, which the test suite's FullCalendar stub never
 * produces, so a page-level render test could never exercise this logic.
 */

export interface DailyTotalEvent {
  start_datetime: string;
  end_datetime: string;
  attended?: boolean | null;
}

/**
 * Seconds of `event`'s duration that fall within [dayStartMs, dayEndMs).
 *
 * Clips to the day rather than crediting the whole event to whichever day its start
 * falls in. A synthetic active-timer event (start = when the timer began, end = "now")
 * can span many days if the timer was never stopped, and all-or-nothing bucketing would
 * dump its entire multi-day elapsed time onto a single day.
 */
export function overlapSeconds(
  event: { start_datetime: string; end_datetime: string },
  dayStartMs: number,
  dayEndMs: number,
): number {
  const evStart = new Date(event.start_datetime).getTime();
  const evEnd = new Date(event.end_datetime).getTime();
  const overlapStart = Math.max(evStart, dayStartMs);
  const overlapEnd = Math.min(evEnd, dayEndMs);
  return overlapEnd > overlapStart ? (overlapEnd - overlapStart) / 1000 : 0;
}

/**
 * Total seconds of `events` overlapping each local calendar day in `days`.
 *
 * `days` are "YYYY-MM-DD" strings, bounded by local midnight-to-midnight — not a UTC
 * slice of the ISO string, which can disagree with the local day a week-view column
 * actually renders under. Events explicitly marked "did not attend" are excluded.
 */
export function computeDailyTotals<T extends DailyTotalEvent>(
  events: T[],
  days: string[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const day of days) {
    const [y, mo, dy] = day.split("-").map(Number) as [number, number, number];
    const dayStart = new Date(y, mo - 1, dy).getTime();
    const dayEnd = new Date(y, mo - 1, dy + 1).getTime();
    let secs = 0;
    for (const e of events) {
      if (e.attended === false) continue;
      secs += overlapSeconds(e, dayStart, dayEnd);
    }
    totals[day] = secs;
  }
  return totals;
}
