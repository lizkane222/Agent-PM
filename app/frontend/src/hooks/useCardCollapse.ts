import { createCollapseSet } from "./useCollapseSet";

/**
 * Per-card collapse state, keyed by `airtable_id`.
 *
 * Used by the Stage Today, Currently Tracking and Pinned In Progress sections so a card can
 * be folded down to just its title, status and account. Persisted, so the choice survives
 * navigation and reloads — and shared, so the same card reads the same way wherever it is
 * rendered.
 */

export const CARD_COLLAPSE_KEY = "actionItemCardCollapsed-v1";

const { useCollapseSet, reload } = createCollapseSet(CARD_COLLAPSE_KEY);

export const useCardCollapse = useCollapseSet;
export const reloadCardCollapse = reload;
