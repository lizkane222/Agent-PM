/**
 * Default MSW handlers for the `/salesforce/` endpoints.
 *
 * The `log-week/` default returns a clean week — no unlinked items, nothing skipped —
 * so every pre-existing CalendarPage test's DOM is unchanged (the warning modal renders
 * nothing on a clean report). A test that wants warnings overrides with
 * `server.use(...)` and `weekPlanReport({...})`.
 */

import { http, HttpResponse } from "msw";
import type { PlannedEntry, SkippedEvent, WeekPlanReport } from "../../lib/logWeek";
import type { CloudCoachPushResult, CloudCoachSyncReport } from "../../lib/cloudCoachPush";

export const mockSalesforceProject = {
  id: 1,
  sf_id: "a0B000000000001",
  account: 1,
  account_name: "Acme Corp",
  name: "Acme Rollout",
  status: "In Flight",
  description: "Segment migration",
  start_date: "2026-08-01",
  end_date: "2026-12-31",
  owner_name: "Owner Person",
  members: [],
  tasks: [],
};

export function mockPlannedEntry(overrides: Partial<PlannedEntry> = {}): PlannedEntry {
  return {
    date: "2026-08-31",
    project_sf_id: "a0B000000000001",
    project_name: "Acme Rollout",
    minutes: 60,
    hours: 1,
    description: "Kickoff\nTotal: 1.00 hrs",
    source: "auto",
    titles: ["Kickoff"],
    ...overrides,
  };
}

export function mockSkippedEvent(overrides: Partial<SkippedEvent> = {}): SkippedEvent {
  return {
    event_id: 1,
    title: "Mystery sync",
    date: "2026-08-31",
    reason: "no_account_linked",
    account_name: "",
    ...overrides,
  };
}

/**
 * A full report with every count derived from the lists, so a test only has to supply
 * the events it cares about and the counts cannot disagree with them.
 */
export function weekPlanReport(overrides: Partial<WeekPlanReport> = {}): WeekPlanReport {
  const entries = overrides.entries ?? [];
  const unlinked = overrides.unlinked_events ?? [];
  const notAttended = overrides.not_attended_events ?? [];
  const noProject = overrides.account_without_project ?? [];
  const alreadyLogged = overrides.already_logged ?? [];
  const totalMinutes = entries.reduce((sum, e) => sum + e.minutes, 0);
  return {
    week_start: "2026-08-31",
    week_end: "2026-09-07",
    entries,
    entry_count: entries.length,
    total_minutes: totalMinutes,
    total_hours: Math.round((totalMinutes / 60) * 100) / 100,
    unlinked_events: unlinked,
    unlinked_count: unlinked.length,
    not_attended_events: notAttended,
    not_attended_count: notAttended.length,
    account_without_project: noProject,
    account_without_project_count: noProject.length,
    already_logged: alreadyLogged,
    already_logged_count: alreadyLogged.length,
    fields_skipped: [],
    dry_run: false,
    logged: entries.length,
    written: entries,
    ...overrides,
  };
}

export function mockCloudCoachPush(
  overrides: Partial<CloudCoachPushResult> = {},
): CloudCoachPushResult {
  return {
    status: "pushed",
    mechanism: "role_field",
    field: "Deliverability__c",
    member_name: "Jane Doe",
    project_name: "Acme Rollout",
    message: "Jane Doe added to Acme Rollout in Cloud Coach.",
    ...overrides,
  };
}

export function mockCloudCoachSyncReport(
  overrides: Partial<CloudCoachSyncReport> = {},
): CloudCoachSyncReport {
  const results = overrides.results ?? [mockCloudCoachPush()];
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return {
    status: "ok",
    dry_run: false,
    project_name: "Acme Rollout",
    sf_project_id: "a0B000000000001",
    member_count: results.length,
    counts,
    results,
    ...overrides,
  };
}

export const salesforceHandlers = [
  http.get("/api/v1/salesforce/status/", () =>
    HttpResponse.json({
      connected: true,
      instance_url: "https://example.my.salesforce.com",
      namespace: "project_cloud",
      sf_user_email: "sf@example.com",
      last_synced: "2026-08-31T09:00:00Z",
    })
  ),
  http.get("/api/v1/salesforce/projects/", () =>
    HttpResponse.json({ results: [] })
  ),
  http.get("/api/v1/salesforce/tasks/", () => HttpResponse.json({ results: [] })),
  http.get("/api/v1/salesforce/log-time-assignments/", () => HttpResponse.json([])),
  http.post("/api/v1/salesforce/log-time-assignments/", () =>
    HttpResponse.json({}, { status: 201 })
  ),
  http.delete("/api/v1/salesforce/log-time-assignments/", () =>
    new HttpResponse(null, { status: 204 })
  ),
  http.post("/api/v1/salesforce/log-time/", () => HttpResponse.json({}, { status: 201 })),
  // Clean by default — see the module docstring.
  http.post("/api/v1/salesforce/log-week/", () => HttpResponse.json(weekPlanReport())),
  http.get("/api/v1/salesforce/projects/lookup/", ({ request }) => {
    const name = new URL(request.url).searchParams.get("name") ?? "";
    return HttpResponse.json({
      query: name, count: 0, projects: [], fields_skipped: [], roles_skipped: [],
    });
  }),
  // Default returns a real push. `AccountViewSet`'s own default response carries no
  // `cloud_coach_pushes` key, so no existing AccountsPage test's DOM changes.
  http.post("/api/v1/accounts/projects/:id/sync-members-to-salesforce/", async ({ request }) => {
    const body = (await request.json()) as { dry_run?: boolean };
    return HttpResponse.json(mockCloudCoachSyncReport({ dry_run: !!body?.dry_run }));
  }),
];
