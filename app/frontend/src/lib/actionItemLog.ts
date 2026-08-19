// Centralized activity-log writer for action-item *updates*.
//
// The activity log is frontend-driven: a single addLog() call feeds both the card's
// ActivityLogSection (filtered by `resource`) and the Activity Log page. Create, delete,
// zone-drag, reminder and conversion paths already log; the everyday edit paths (Save in a
// modal/side panel, inline field edits, status changes, reassignment, calendar due-date
// drags) route through airtableApi.updateActionItemFields / updateActionItemStatus and used
// to log nothing — so repeated edits were invisible between "created" and "deleted".
//
// Every edit surface routes through this one helper so the diff logic and message phrasing
// cannot drift across the several diverged action-item UIs (same rationale CLAUDE.md gives
// for lib/localStore.ts, lib/eventColors.ts, lib/actionItemSidebarOrder.ts).

import { addLog } from "./appLog";
import type { AirtableActionItem } from "../types";

/** Fields whose changes are worth surfacing, in the order clauses should appear. */
const LOGGED_FIELDS = [
  "status",
  "priority",
  "due_date",
  "task",
  "task_details",
  "assignee_name",
  "account_name",
  "estimated_time",
  "time_spent",
  "prep_time",
  "slack_thread_url",
] as const;

type LoggedField = (typeof LOGGED_FIELDS)[number];

/**
 * null / undefined / "" — and 0 for the numeric time fields — all read as "blank".
 * Airtable returns "" or null where the app writes the other, and null vs 0 for a
 * never-set duration; without this a save would log a spurious change every time.
 */
function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "" || v === 0;
}

function sameFieldValue(a: unknown, b: unknown): boolean {
  if (isBlank(a) && isBlank(b)) return true;
  return String(a ?? "") === String(b ?? "");
}

function formatDate(v: unknown): string {
  if (typeof v !== "string" || !v) return "";
  const d = new Date(`${v}T00:00:00`);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Human-readable clause describing one field's change, or null to skip it. */
function clauseFor(field: LoggedField, before: AirtableActionItem, next: unknown): string | null {
  switch (field) {
    case "status":
      return `Status: ${before.status} → ${next}`;
    case "priority":
      return `Priority: ${before.priority} → ${next}`;
    case "due_date":
      return isBlank(next) ? "Due date cleared" : `Due date → ${formatDate(next)}`;
    case "task":
      return "Title updated";
    case "task_details":
      return "Description edited";
    case "assignee_name":
      return isBlank(next) ? "Assignee cleared" : `Reassigned to ${next}`;
    case "account_name":
      return isBlank(next) ? "Account cleared" : `Account → ${next}`;
    case "estimated_time":
      return "Estimated time updated";
    case "time_spent":
      return "Time spent updated";
    case "prep_time":
      return "Prep time updated";
    case "slack_thread_url":
      return isBlank(next) ? "Slack link removed" : "Slack link updated";
  }
}

/**
 * Log the fields in `changes` that actually differ from `before`. One activity entry per
 * save, summarising every changed field. No-ops when nothing meaningful changed, when the
 * item has no server record yet (a `local-*` id — promoteBlankItem discards it, so a log
 * against it would orphan), or when `changes` is empty.
 *
 * `changes` may be a full form (many keys, most unchanged) or a narrow patch — either way
 * only real diffs are logged, which is why we diff against `before` rather than trust the
 * caller to send only what moved.
 */
export function logActionItemUpdate(
  before: AirtableActionItem,
  changes: Partial<AirtableActionItem>,
): void {
  const airtableId = before?.airtable_id;
  if (!airtableId || airtableId.startsWith("local-")) return;

  const clauses: string[] = [];
  for (const field of LOGGED_FIELDS) {
    if (!(field in changes)) continue;
    const next = changes[field];
    if (sameFieldValue(before[field], next)) continue;
    const clause = clauseFor(field, before, next);
    if (clause) clauses.push(clause);
  }

  if (clauses.length === 0) return;

  const label = before.task?.trim() || "Untitled";
  addLog({
    category: "action_item",
    message: `"${label}" — ${clauses.join("; ")}`,
    links: [{ label: "View action items", path: "/action-items" }],
    resource: { type: "action_item", id: airtableId },
  });
}
