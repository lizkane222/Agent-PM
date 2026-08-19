import { useCallback, useMemo, useSyncExternalStore } from "react";
import { createLocalStore } from "../lib/localStore";

/**
 * Factory for a localStorage-backed set of collapsed keys.
 *
 * Two things collapse independently on the Action Items page — account groups and
 * individual cards — with identical mechanics, so both are built from this.
 *
 * Storage is an array of collapsed keys rather than a single "all collapsed" boolean:
 * a bulk toggle and independently-remembered per-key state have to coexist, and a
 * boolean cannot express "all collapsed except one".
 */

export interface CollapseSet {
  isCollapsed: (key: string) => boolean;
  toggle: (key: string) => void;
  /** Collapse or expand every key in the list, leaving keys outside it untouched. */
  setAll: (keys: string[], collapsed: boolean) => void;
  /** True only when the list is non-empty and every key in it is collapsed. */
  allCollapsed: (keys: string[]) => boolean;
}

export function createCollapseSet(storageKey: string): {
  useCollapseSet: () => CollapseSet;
  /** Re-read from localStorage. Needed after `localStorage.clear()`, which fires no event. */
  reload: () => void;
} {
  const store = createLocalStore<string[]>(
    storageKey,
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

  function useCollapseSet(): CollapseSet {
    const keys = useSyncExternalStore(store.subscribe, store.get, store.get);
    const collapsedSet = useMemo(() => new Set(keys), [keys]);

    const isCollapsed = useCallback((key: string) => collapsedSet.has(key), [collapsedSet]);

    const toggle = useCallback((key: string) => {
      store.update((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
    }, []);

    const setAll = useCallback((groupKeys: string[], collapsed: boolean) => {
      store.update((prev) => {
        if (collapsed) return [...new Set([...prev, ...groupKeys])];
        const removing = new Set(groupKeys);
        return prev.filter((k) => !removing.has(k));
      });
    }, []);

    const allCollapsed = useCallback(
      (groupKeys: string[]) => groupKeys.length > 0 && groupKeys.every((k) => collapsedSet.has(k)),
      [collapsedSet],
    );

    return { isCollapsed, toggle, setAll, allCollapsed };
  }

  return { useCollapseSet, reload: () => store.reload() };
}
