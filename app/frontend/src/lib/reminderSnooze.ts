/**
 * The ready-made choices in a reminder's Snooze menu. "Custom" is separate and always listed
 * first; "before the next account meeting" is resolved by the server (it needs the calendar),
 * so it carries a `preset` instead of a time.
 *
 * Times are the user's local wall clock. `now` is passed in so each rule is testable.
 */

export interface SnoozeOption {
  key: "in_15" | "end_of_day" | "tomorrow_9am" | "next_account_meeting";
  label: string;
  /** The instant to snooze until, when it is known client-side. */
  until?: Date;
  /** Resolved by the server instead. */
  preset?: "next_account_meeting";
  disabled?: boolean;
  /** Why it is unavailable, shown as a tooltip. */
  reason?: string;
}

/** "End of day" is 5:00 PM local. */
export const END_OF_DAY_HOUR = 17;
export const MORNING_HOUR = 9;
export const SNOOZE_MINUTES = 15;

function at(day: Date, hour: number): Date {
  const d = new Date(day);
  d.setHours(hour, 0, 0, 0);
  return d;
}

export function snoozeOptions(now: Date, opts: { hasAccount: boolean }): SnoozeOption[] {
  const inFifteen = new Date(now.getTime() + SNOOZE_MINUTES * 60_000);
  inFifteen.setSeconds(0, 0);

  const endOfDay = at(now, END_OF_DAY_HOUR);
  const endOfDayPast = endOfDay.getTime() <= now.getTime() + 60_000;

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  return [
    { key: "in_15", label: "15 minutes later", until: inFifteen },
    {
      key: "end_of_day", label: "Before end of day", until: endOfDay,
      disabled: endOfDayPast, reason: endOfDayPast ? "It's already past 5:00 PM." : undefined,
    },
    { key: "tomorrow_9am", label: "Tomorrow morning", until: at(tomorrow, MORNING_HOUR) },
    {
      key: "next_account_meeting", label: "Before next account meeting", preset: "next_account_meeting",
      disabled: !opts.hasAccount,
      reason: opts.hasAccount ? undefined : "Link this reminder to an account to use this.",
    },
  ];
}
