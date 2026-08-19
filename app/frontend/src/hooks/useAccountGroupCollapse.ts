import { createCollapseSet } from "./useCollapseSet";

/**
 * Collapse state for the account groups on the Action Items page.
 *
 * Shared between the Views grid (one row per account) and the Projects view (one group per
 * account) so a single "Collapse all" button and a single memory covers both, and the
 * choice survives navigation.
 */

export const ACCOUNT_COLLAPSE_KEY = "actionItemsCollapsedAccounts-v1";

/** Key for a group with no account. */
export const NO_ACCOUNT_GROUP_KEY = "__none__";
/** Key for the catch-all row of items whose account matches no known account. */
export const UNMATCHED_GROUP_KEY = "__unmatched__";

/**
 * Canonical group key for an account name.
 *
 * The Views grid keys rows by `acc.key` ("at-3" / "app-7") while the Projects view keys by
 * account name, so both are normalised to the lowercased name. Without this the two views
 * would write to the same store under different keys and never agree.
 */
export function accountGroupKey(name?: string | null): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed.toLowerCase() : NO_ACCOUNT_GROUP_KEY;
}

const { useCollapseSet, reload } = createCollapseSet(ACCOUNT_COLLAPSE_KEY);

export const useAccountGroupCollapse = useCollapseSet;
export const reloadAccountGroupCollapse = reload;
