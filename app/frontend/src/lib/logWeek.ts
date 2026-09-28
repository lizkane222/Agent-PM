/**
 * Shared types and helpers for the Cloud Coach "Log Week" flow.
 *
 * `roundUpToQuarterHour` and `buildLogDescription` are the browser halves of
 * `salesforce_sync/log_week.py`'s `round_up_to_quarter_hour` / `_build_description`.
 * They live here rather than inside a panel component because the two Log Time panel
 * copies (the live one inside `pages/CalendarPage.tsx` and its unreachable twin in
 * `components/calendar/LogTimePanel.tsx`) each had their own copy, and the hours the
 * panel shows must equal the hours the server writes.
 */

/** Cloud Coach bills in quarter hours — a 50-minute meeting is 0.75h, not 0.83h. */
export const QUARTER_HOUR_MINUTES = 15;

export function roundUpToQuarterHour(minutes: number): number {
  if (minutes <= 0) return 0;
  return Math.ceil(minutes / QUARTER_HOUR_MINUTES) * QUARTER_HOUR_MINUTES;
}

/** Decimal hours, the unit Cloud Coach's `Total_Hours__c` stores. */
export function decimalHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

/** Titles, one per line, then a total — the shape the panel has always sent. */
export function buildLogDescription(titles: string[], minutes: number): string {
  return [...titles, `Total: ${(minutes / 60).toFixed(2)} hrs`].join("\n");
}

/**
 * Salesforce record ids are 15 or 18 alphanumerics. The panel invents `local-7` /
 * `admin-pseudo-2` ids for rows with no Cloud Coach record, and those must never be
 * sent — the server drops them, but filtering client-side keeps the request honest.
 */
export function isSalesforceId(value: string): boolean {
  return /^[a-zA-Z0-9]{15,18}$/.test(value);
}

export interface LogWeekEntryInput {
  date: string;
  project_sf_id: string;
  project_name?: string;
  minutes: number;
  description?: string;
  titles?: string[];
}

export interface LogWeekRequest {
  week_start?: string;
  account_name?: string;
  entries?: LogWeekEntryInput[];
  dry_run?: boolean;
}

export interface PlannedEntry {
  date: string;
  project_sf_id: string;
  project_name: string;
  minutes: number;
  hours: number;
  description: string;
  source: "auto" | "manual" | "client";
  titles: string[];
  /** Present only on entries that were actually written. */
  sf_id?: string;
}

export interface SkippedEvent {
  event_id: number;
  title: string;
  date: string;
  reason:
    | "no_account_linked"
    | "no_cloud_coach_project"
    | "did_not_attend";
  account_name: string;
}

export interface WeekPlanReport {
  week_start: string;
  week_end: string;
  entries: PlannedEntry[];
  entry_count: number;
  total_minutes: number;
  total_hours: number;
  unlinked_events: SkippedEvent[];
  unlinked_count: number;
  not_attended_events: SkippedEvent[];
  not_attended_count: number;
  account_without_project: SkippedEvent[];
  account_without_project_count: number;
  already_logged: PlannedEntry[];
  already_logged_count: number;
  fields_skipped: string[];
  dry_run: boolean;
  logged: number;
  written?: PlannedEntry[];
}

export interface CloudCoachProjectMatch {
  projectId: string;
  projectName: string;
  accountId: string;
  accountName: string;
  startDate: string | null;
  endDate: string | null;
  /** Role lookup fields on the project that hold the caller's Salesforce user id. */
  myRoles: string[];
  isMember: boolean;
}

export interface CloudCoachProjectLookup {
  query: string;
  count: number;
  projects: CloudCoachProjectMatch[];
  fields_skipped: string[];
  roles_skipped: string[];
}

/** True when the report has something the user should be told about. */
export function hasWarnings(report: WeekPlanReport | null): boolean {
  if (!report) return false;
  return (
    report.unlinked_count > 0 ||
    report.not_attended_count > 0 ||
    report.account_without_project_count > 0
  );
}
