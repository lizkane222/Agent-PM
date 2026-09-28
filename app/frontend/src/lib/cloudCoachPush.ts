/**
 * Wording for the outcome of adding someone to a Cloud Coach project.
 *
 * Lives in `lib/` because three surfaces report it — the Accounts-page member drag, the
 * account page's project-member picker, and the backfill button — and they must not word
 * the same outcome three different ways.
 *
 * The status strings mirror the constants in `salesforce_sync/project_members.py`. They
 * are a contract; a typo here renders as the unknown-status fallback rather than throwing.
 */

export type CloudCoachPushStatus =
  | "pushed"
  | "already_member"
  | "no_free_slot"
  | "no_sf_user"
  | "no_mechanism"
  | "error";

export interface CloudCoachPushResult {
  status: CloudCoachPushStatus | string;
  mechanism?: string;
  field?: string;
  sf_project_id?: string;
  sf_user_id?: string;
  member_name?: string;
  member_email?: string;
  project_name?: string;
  message?: string;
  fields_skipped?: string[];
}

export interface CloudCoachSyncReport {
  status: string;
  dry_run: boolean;
  project_name?: string;
  sf_project_id?: string;
  member_count?: number;
  counts?: Record<string, number>;
  results: CloudCoachPushResult[];
  message?: string;
}

/** Outcomes that mean "nothing is wrong" — used to pick the toast's tone. */
const BENIGN = new Set(["pushed", "already_member"]);

export function isPushOk(result: CloudCoachPushResult | null | undefined): boolean {
  return !!result && BENIGN.has(result.status);
}

/** `Solution_Architect_Primary__c` → `Solution Architect Primary`. */
export function humanizeRole(field: string): string {
  return field.replace(/__c$/, "").replace(/_/g, " ").trim();
}

/**
 * One sentence for a single outcome.
 *
 * The server already composes a `message` for every status, so that is preferred — it has
 * the project and person names to hand. These fallbacks exist so a status arriving without
 * a message still reads as something a human wrote.
 */
export function summarizePush(result: CloudCoachPushResult): string {
  if (result.message) return result.message;
  const who = result.member_name || "That person";
  const where = result.project_name || "the project";
  switch (result.status) {
    case "pushed":
      return `${who} added to ${where} in Cloud Coach.`;
    case "already_member":
      return `${who} is already on ${where}.`;
    case "no_free_slot":
      return `Every project role on ${where} is filled, so ${who} was not added.`;
    case "no_sf_user":
      return `No Salesforce user found for ${who}.`;
    case "no_mechanism":
      return "This Salesforce org exposes no way to add a project member.";
    default:
      return `Could not add ${who} to ${where} in Cloud Coach.`;
  }
}

/** One line covering a batch — the Accounts-page drag can add several at once. */
export function summarizePushes(results: CloudCoachPushResult[]): string {
  if (!results.length) return "";
  if (results.length === 1) return summarizePush(results[0]);
  const ok = results.filter(isPushOk).length;
  const failed = results.length - ok;
  const parts = [`${ok} added to Cloud Coach`];
  if (failed) parts.push(`${failed} could not be added`);
  return `${parts.join(", ")}.`;
}

/** `{pushed: 2, already_member: 1}` → `"2 added, 1 already on it"`. */
const COUNT_LABELS: Record<string, string> = {
  pushed: "added",
  already_member: "already on it",
  no_free_slot: "no free project role",
  no_sf_user: "no Salesforce user",
  no_mechanism: "no supported mechanism",
  error: "failed",
};

export function summarizeSyncReport(report: CloudCoachSyncReport): string {
  if (report.message) return report.message;
  const counts = report.counts ?? {};
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  if (!entries.length) return "No project members to sync.";
  const body = entries
    .map(([status, n]) => `${n} ${COUNT_LABELS[status] ?? status}`)
    .join(", ");
  return report.dry_run ? `Would sync: ${body}.` : `Synced: ${body}.`;
}
