import { createCollapseSet } from "./useCollapseSet";

/**
 * Which Account Detail sections the user has folded away.
 *
 * One global key, deliberately not per account: the choice is a layout preference ("I never
 * look at the email section"), so it follows the user from account to account and survives a
 * reload. Same mechanics as the Action Items page's group collapse (`createCollapseSet`).
 */

export const ACCOUNT_SECTION_COLLAPSE_KEY = "accountDetailCollapsedSections-v1";

/** Stable ids for every collapsible section on the page. */
export const ACCOUNT_SECTION_IDS = {
  leftSidebar: "left-sidebar",
  sidebarDetails: "sidebar-details",
  sidebarQuickLinks: "sidebar-quick-links",
  rightSidebar: "right-sidebar",
  team: "team",
  timeline: "timeline",
  actionItems: "action-items",
  goals: "project-goals",
  accountNotes: "account-notes",
  // The Meeting Notes Timeline keeps the original id so its stored state carries over as-is.
  meetingNotes: "meeting-notes",
  reminders: "reminders",
  comments: "comments",
  artifacts: "artifacts",
  activityLog: "activity-log",
  email: "email",
  jiraTickets: "jira-tickets",
  zendeskTickets: "zendesk-tickets",
  productGaps: "product-gaps",
} as const;

/**
 * The old single "Meeting Notes" section was split into Account Notes + Meeting Notes Timeline.
 * Anyone who had folded the old section keeps both halves folded: copy "meeting-notes" to
 * "account-notes" once, guarded by a flag so un-folding Account Notes later is not undone.
 */
export const NOTES_SPLIT_MIGRATION_KEY = "accountDetailCollapsedSections-notesSplit-v1";
export function migrateNotesSplitCollapse(): void {
  try {
    if (localStorage.getItem(NOTES_SPLIT_MIGRATION_KEY)) return;
    const raw = localStorage.getItem(ACCOUNT_SECTION_COLLAPSE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.includes(ACCOUNT_SECTION_IDS.meetingNotes) && !parsed.includes(ACCOUNT_SECTION_IDS.accountNotes)) {
        localStorage.setItem(ACCOUNT_SECTION_COLLAPSE_KEY, JSON.stringify([...parsed, ACCOUNT_SECTION_IDS.accountNotes]));
      }
    }
    localStorage.setItem(NOTES_SPLIT_MIGRATION_KEY, "1");
  } catch { /* storage unavailable: nothing to migrate */ }
}
migrateNotesSplitCollapse();

const { useCollapseSet, reload } = createCollapseSet(ACCOUNT_SECTION_COLLAPSE_KEY);

export const useAccountSectionCollapse = useCollapseSet;
export const reloadAccountSectionCollapse = reload;
