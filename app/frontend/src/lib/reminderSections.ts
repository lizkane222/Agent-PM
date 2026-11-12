/**
 * Which section of the calendar's Reminders sidebar a reminder belongs in.
 *
 * A reminder can be on the calendar several times, each a 15-minute block, and it is "due" at
 * each of them. So where it sits depends on its **next** time that has not finished:
 *
 *  - Today      — that time is today (including one in progress right now);
 *  - Upcoming   — that time is a later day;
 *  - Historical — every time has finished, or the reminder was dismissed.
 *
 * "Finished" means its 15 minutes are over, so a reminder moves to Historical once its time has
 * passed. The caller re-evaluates with a fresh `now` every minute; nothing here reads the clock.
 */

import type { Reminder } from "../types/scheduler";

/** How often the sidebar re-reads the clock, so a finished reminder moves to Historical on its own. */
export const REMINDER_CLOCK_TICK_MS = 30_000;

export type ReminderSection = "today" | "upcoming" | "historical";

/** Matches `OCCURRENCE_MINUTES` on the server. */
export const OCCURRENCE_MS = 15 * 60_000;

export interface Classified {
  reminder: Reminder;
  section: ReminderSection;
  /** The time to show and sort by: the next unfinished one, else the most recent. */
  at: Date;
}

/** Every moment the reminder is due: its due time plus each calendar block, earliest first. */
export function reminderTimes(r: Reminder): Date[] {
  const stamps = new Set<number>();
  const add = (iso: string | undefined) => {
    const t = iso ? new Date(iso).getTime() : NaN;
    if (!Number.isNaN(t)) stamps.add(t);
  };
  add(r.due_at);
  (r.occurrences ?? []).forEach((o) => add(o.start));
  return [...stamps].sort((a, b) => a - b).map((t) => new Date(t));
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function classifyReminder(r: Reminder, now: Date): Classified {
  const times = reminderTimes(r);
  const latest = times[times.length - 1] ?? new Date(r.due_at);
  if (r.status === "dismissed") return { reminder: r, section: "historical", at: latest };

  const next = times.find((t) => t.getTime() + OCCURRENCE_MS > now.getTime());
  if (!next) return { reminder: r, section: "historical", at: latest };
  return { reminder: r, section: sameLocalDay(next, now) ? "today" : "upcoming", at: next };
}

export interface ReminderSections {
  today: Classified[];
  upcoming: Classified[];
  historical: Classified[];
}

/** Today and Upcoming run soonest first; Historical runs most recent first. */
export function groupReminders(reminders: readonly Reminder[], now: Date): ReminderSections {
  const out: ReminderSections = { today: [], upcoming: [], historical: [] };
  for (const r of reminders) {
    const c = classifyReminder(r, now);
    out[c.section].push(c);
  }
  out.today.sort((a, b) => a.at.getTime() - b.at.getTime());
  out.upcoming.sort((a, b) => a.at.getTime() - b.at.getTime());
  out.historical.sort((a, b) => b.at.getTime() - a.at.getTime());
  return out;
}
