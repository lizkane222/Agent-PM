// dueDateGroup classifies an action item's due_date relative to "now".
// Tests must inject a clock (nowIso) so they are fully deterministic.

export type DueDateGroup = "Overdue" | "Today" | "This Week" | "Later" | "No Date";

export interface DueDateGroupFixture {
  nowIso: string;       // ISO date string standing in for Date.now()
  due_date: string | null;
  expected: DueDateGroup;
  note?: string;
}

// All fixtures use 2024-03-15 (Friday) as "today" to keep dates anchored.
const TODAY = "2024-03-15";

export const DUE_DATE_GROUP_FIXTURES: DueDateGroupFixture[] = [
  // ── No Date ───────────────────────────────────────────────────────────────
  { nowIso: TODAY, due_date: null, expected: "No Date" },
  // ── Overdue ───────────────────────────────────────────────────────────────
  { nowIso: TODAY, due_date: "2024-03-14", expected: "Overdue", note: "yesterday" },
  { nowIso: TODAY, due_date: "2024-01-01", expected: "Overdue", note: "far past" },
  // ── Today ─────────────────────────────────────────────────────────────────
  { nowIso: TODAY, due_date: "2024-03-15", expected: "Today" },
  // ── This Week (tomorrow through 6 days out) ───────────────────────────────
  { nowIso: TODAY, due_date: "2024-03-16", expected: "This Week", note: "tomorrow" },
  { nowIso: TODAY, due_date: "2024-03-21", expected: "This Week", note: "6 days out" },
  // ── Later (7+ days) ──────────────────────────────────────────────────────
  { nowIso: TODAY, due_date: "2024-03-22", expected: "Later", note: "exactly 7 days out" },
  { nowIso: TODAY, due_date: "2025-01-01", expected: "Later", note: "far future" },
  // NOTE: date-only strings like "2024-03-15" parse as UTC midnight.
  // When nowIso is also a date-only string the UTC offset cancels out and
  // comparisons are stable. Mixing a datetime nowIso with a date-only
  // due_date produces timezone-dependent results — so we only pair
  // date-only nowIso with date-only due_date in this fixture matrix.
];
