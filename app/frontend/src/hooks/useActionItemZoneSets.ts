import { useMemo, useSyncExternalStore } from "react";
import { createLocalStore } from "../lib/localStore";

/**
 * The `actionItemZones` map, read as sets — single owner of that key for read-only consumers.
 *
 * The calendar sidebars both used to inline their own `useState` seeded from this key, and both
 * collected only the `"today"` zone. Now they share one store, in the same shape
 * `hooks/useFocusPins.ts` owns `actionFocusPins`: one module-level value plus one `storage`
 * listener, so N sibling copies cannot drift within a tab.
 *
 * Read-only on purpose. `pages/ActionItemsPage.tsx` is the writer, and it writes with a plain
 * `localStorage.setItem` — that is out of scope to change, and it never co-mounts with the
 * calendar sidebar anyway, so a cross-tab `storage` event is the only update path either way.
 */

export const ACTION_ITEM_ZONES_KEY = "actionItemZones";

type ZonesMap = Record<string, string>;

const store = createLocalStore<ZonesMap>(
  ACTION_ITEM_ZONES_KEY,
  (raw) => {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as ZonesMap) : {};
    } catch {
      return {};
    }
  },
  (value) => JSON.stringify(value),
);

/** Re-read zones from localStorage. Needed after `localStorage.clear()`, which fires no
 *  storage event — call this in test setup to keep tests order-independent. */
export function reloadActionItemZones(): void {
  store.reload();
}

function idsInZone(zones: ZonesMap, zone: string): Set<string> {
  const out = new Set<string>();
  for (const [id, value] of Object.entries(zones)) {
    if (value === zone) out.add(id);
  }
  return out;
}

export function useActionItemZoneSets(): { trackingIds: Set<string>; stagedIds: Set<string> } {
  const zones = useSyncExternalStore(store.subscribe, store.get, store.get);

  // Rebuilt only when the stored map reference changes (i.e. on an actual write).
  // `active` is the zone behind the "Currently Tracking" column — see ZONE_LABELS in
  // ActionItemsPage, whose label for it is confusingly "In Progress".
  return useMemo(
    () => ({ trackingIds: idsInZone(zones, "active"), stagedIds: idsInZone(zones, "today") }),
    [zones],
  );
}
