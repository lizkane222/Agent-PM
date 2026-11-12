/** The date ranges a skill run can be limited to. Each `value` is something the server's range reader understands. */
export interface TimeframePreset { value: string; label: string }

export const TIMEFRAME_PRESETS: readonly TimeframePreset[] = [
  { value: "last-7-days", label: "Last 7 days" },
  { value: "last-14-days", label: "Last 14 days" },
  { value: "last-30-days", label: "Last 30 days" },
  { value: "last-90-days", label: "Last 90 days" },
  { value: "this-week", label: "This week" },
  { value: "last-week", label: "Last week" },
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "this-quarter", label: "This quarter" },
  { value: "last-quarter", label: "Last quarter" },
  { value: "this-year", label: "This year" },
  { value: "last-year", label: "Last year" },
];

/** What a run uses when nothing is chosen. Matches the server's default. */
export const DEFAULT_TIMEFRAME = "last-30-days";

/** Marks the "pick your own dates" choice (not a value the server reads). */
export const CUSTOM_TIMEFRAME = "custom";

/** "2026-10-01..2026-10-31" from two dates; "" until both are set. A reversed pair is fine - the server orders it. */
export function customRange(from: string, to: string): string {
  return from && to ? `${from}..${to}` : "";
}
