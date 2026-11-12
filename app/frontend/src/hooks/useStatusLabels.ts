import { useCallback, useEffect, useSyncExternalStore } from "react";
import { teamApi } from "../lib/api";
import { useCurrentUser } from "../context/CurrentUserContext";
import {
  labelForStatus,
  STATUS_LABEL_OPTIONS,
  type CanonicalStatus,
  type StatusLabelPrefs,
} from "../lib/statusLabels";

/**
 * The user's status display names (`UserProfile.status_labels`).
 *
 * Not built on `useResource`: it is one preferences object, and it updates optimistically
 * (apply locally, PATCH, revert on failure) like `useCalendarColors`. The value lives in a
 * module-level store seeded from the shared current-user context, so any number of cards
 * can call this hook without issuing a request, and a change repaints all of them at once.
 */
let prefs: StatusLabelPrefs = {};
const subscribers = new Set<() => void>();

function setPrefs(next: StatusLabelPrefs) {
  prefs = next;
  subscribers.forEach((cb) => cb());
}

function subscribe(cb: () => void) {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}

/** Keep only well-formed entries so a hand-edited profile cannot blank a column header. */
function sanitize(raw: unknown): StatusLabelPrefs {
  const out: StatusLabelPrefs = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [status, label] of Object.entries(raw as Record<string, unknown>)) {
    const options = STATUS_LABEL_OPTIONS[status as CanonicalStatus];
    if (options && typeof label === "string" && options.includes(label)) {
      out[status as CanonicalStatus] = label;
    }
  }
  return out;
}

/** Test helper: replace / clear the module-level store. */
export function seedStatusLabels(next: StatusLabelPrefs = {}) {
  setPrefs(sanitize(next));
}

export function useStatusLabels() {
  const current = useSyncExternalStore(subscribe, () => prefs, () => prefs);
  const profile = useCurrentUser();
  const stored = profile?.status_labels;

  useEffect(() => {
    if (stored !== undefined) setPrefs(sanitize(stored));
  }, [stored]);

  /** Display name for a canonical status under the current preferences. */
  const label = useCallback(
    (status: string | null | undefined) => labelForStatus(status, current),
    [current],
  );

  /** Choose a display name for one status; reverts if the server rejects it. */
  const setLabel = useCallback(
    async (status: CanonicalStatus, name: string): Promise<void> => {
      const previous = prefs;
      const next = { ...prefs, [status]: name };
      setPrefs(next);
      try {
        await teamApi.updateMyProfile({ status_labels: next } as Parameters<typeof teamApi.updateMyProfile>[0]);
      } catch (err) {
        setPrefs(previous);
        throw err;
      }
    },
    [],
  );

  return { prefs: current, label, setLabel };
}
