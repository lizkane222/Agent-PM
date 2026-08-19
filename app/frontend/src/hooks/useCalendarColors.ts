import { useCallback, useEffect, useState } from "react";
import { teamApi } from "../lib/api";
import type { CalendarColorPrefs } from "../types/team";
import {
  DEFAULT_CATEGORY_COLORS,
  isHexColor,
  type ColorableEventType,
} from "../lib/eventColors";

/**
 * The user's calendar color choices, stored on `UserProfile.calendar_colors`.
 *
 * Deliberately not built on `useResource`: this is a single preferences object, not a
 * `T[]` resource list, and HOOK_SPEC's "no optimistic updates" rule doesn't apply.
 * A color click has to repaint the grid immediately, so state updates first and the
 * PATCH follows, reverting on failure. Same exemption `lib/localStore.ts` claims for
 * UI state.
 *
 * Reads tolerate junk: a stored value that isn't a `#RRGGBB` string is ignored in
 * favour of the default, so a hand-edited profile can never blank out the calendar.
 */
export function useCalendarColors() {
  const [prefs, setPrefs] = useState<CalendarColorPrefs>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    teamApi
      .getMyProfile()
      .then(({ data }) => {
        if (!cancelled) setPrefs(data.calendar_colors ?? {});
      })
      .catch(() => {
        // Non-fatal: the calendar still renders with default colors.
        if (!cancelled) setError("Could not load your calendar colors.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  /** Persist `next`, rolling back to the previous value if the server rejects it. */
  const persist = useCallback((next: CalendarColorPrefs) => {
    setPrefs((prev) => {
      teamApi
        .updateMyProfile({ calendar_colors: next } as Parameters<typeof teamApi.updateMyProfile>[0])
        .then(() => setError(null))
        .catch(() => {
          setPrefs(prev);
          setError("Could not save that color. Please try again.");
        });
      return next;
    });
  }, []);

  /** The color for an event type, falling back to the shipped default. */
  const colorFor = useCallback(
    (type: ColorableEventType): string => {
      const stored = prefs.categories?.[type];
      return isHexColor(stored) ? stored : DEFAULT_CATEGORY_COLORS[type];
    },
    [prefs],
  );

  /** The "important" override for a single event, or null when not marked. */
  const importantFor = useCallback(
    (uid: string): string | null => {
      const stored = prefs.important?.[uid];
      return isHexColor(stored) ? stored : null;
    },
    [prefs],
  );

  const setCategoryColor = useCallback(
    (type: ColorableEventType, color: string) => {
      if (!isHexColor(color)) return;
      persist({ ...prefs, categories: { ...prefs.categories, [type]: color } });
    },
    [prefs, persist],
  );

  const setImportant = useCallback(
    (uid: string, color: string) => {
      if (!uid || !isHexColor(color)) return;
      persist({ ...prefs, important: { ...prefs.important, [uid]: color } });
    },
    [prefs, persist],
  );

  const clearImportant = useCallback(
    (uid: string) => {
      if (!prefs.important?.[uid]) return;
      const important = { ...prefs.important };
      delete important[uid];
      persist({ ...prefs, important });
    },
    [prefs, persist],
  );

  /** Drop every stored choice and go back to the shipped defaults. */
  const resetCategoryColors = useCallback(() => {
    persist({ ...prefs, categories: {} });
  }, [prefs, persist]);

  return {
    loading,
    error,
    colorFor,
    importantFor,
    setCategoryColor,
    setImportant,
    clearImportant,
    resetCategoryColors,
  };
}
