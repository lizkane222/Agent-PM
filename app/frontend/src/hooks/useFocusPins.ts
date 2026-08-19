import { useCallback, useMemo, useSyncExternalStore } from "react";
import { createLocalStore } from "../lib/localStore";

/**
 * Focus pins — the set of action items pinned to the "Pinned In Progress" section.
 *
 * Single source of truth for the `actionFocusPins` key. Every action item card calls
 * this hook directly rather than receiving pin state through props, so a card anywhere
 * in the app (Action Items, Calendar, Account Detail) stays in sync with every other.
 *
 * Storage shape is a JSON array of `airtable_id` strings, insertion-ordered — unchanged
 * from the three ad-hoc copies this replaces, so existing pins survive with no migration.
 *
 * Note: never pin a `local-*` blank card. `promoteBlankItem` discards that id in favour
 * of a real `recXXX`, which would orphan the pin permanently.
 */

export const FOCUS_PINS_KEY = "actionFocusPins";

const store = createLocalStore<string[]>(
  FOCUS_PINS_KEY,
  (raw) => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
    } catch {
      return [];
    }
  },
  (value) => JSON.stringify(value),
);

/** Toggle a pin from outside React (event handlers, non-component code). */
export function toggleFocusPin(airtableId: string): void {
  store.update((prev) =>
    prev.includes(airtableId) ? prev.filter((id) => id !== airtableId) : [...prev, airtableId]
  );
}

export function isFocusPinned(airtableId: string): boolean {
  return store.get().includes(airtableId);
}

/** Re-read pins from localStorage. Needed after `localStorage.clear()`, which fires no
 *  storage event — call this in test setUp to keep tests order-independent. */
export function reloadFocusPins(): void {
  store.reload();
}

export function useFocusPins() {
  const ids = useSyncExternalStore(store.subscribe, store.get, store.get);

  // Rebuilt only when the stored array reference changes (i.e. on an actual mutation).
  const pinnedIds = useMemo(() => new Set(ids), [ids]);

  const isPinned = useCallback((airtableId: string) => pinnedIds.has(airtableId), [pinnedIds]);
  const toggle = useCallback((airtableId: string) => toggleFocusPin(airtableId), []);

  return { pinnedIds, isPinned, toggle };
}
