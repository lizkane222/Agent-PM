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
  meetingNotes: "meeting-notes",
  reminders: "reminders",
  comments: "comments",
  artifacts: "artifacts",
  activityLog: "activity-log",
  email: "email",
} as const;

const { useCollapseSet, reload } = createCollapseSet(ACCOUNT_SECTION_COLLAPSE_KEY);

export const useAccountSectionCollapse = useCollapseSet;
export const reloadAccountSectionCollapse = reload;
