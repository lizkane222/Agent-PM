/**
 * Per-user DISPLAY names for action-item statuses.
 *
 * Only the text a user reads changes. Stored/API/Airtable status values stay the five
 * canonical strings below, and every comparison, filter and select option VALUE keeps
 * using them. Mirrors `UserProfileSerializer.STATUS_LABEL_CHOICES` on the backend.
 */
export type CanonicalStatus = "Open" | "In Progress" | "Blocked" | "Done" | "Backlogged";

export type StatusLabelPrefs = Partial<Record<CanonicalStatus, string>>;

/** First option of each status is the default (the canonical name). */
export const STATUS_LABEL_OPTIONS: Record<CanonicalStatus, readonly string[]> = {
  Open: ["Open", "Not Started"],
  "In Progress": ["In Progress", "Pending"],
  Blocked: ["Blocked"],
  Done: ["Done", "Completed"],
  Backlogged: ["Backlogged", "Not Going To Do"],
};

export const CANONICAL_STATUSES = Object.keys(STATUS_LABEL_OPTIONS) as CanonicalStatus[];

/**
 * The name to show for `status`. Unknown statuses and unset / junk preferences fall
 * back to the status text itself, so default prefs render exactly the canonical text.
 */
export function labelForStatus(
  status: string | null | undefined,
  prefs?: StatusLabelPrefs | null,
): string {
  if (!status) return "";
  const options = STATUS_LABEL_OPTIONS[status as CanonicalStatus];
  if (!options) return status;
  const chosen = prefs?.[status as CanonicalStatus];
  return chosen && options.includes(chosen) ? chosen : status;
}
