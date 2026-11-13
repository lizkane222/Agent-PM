import { useCallback, useState } from "react";

export type TimelineScope = "mine" | "team";
export const TIMELINE_SCOPE_KEY = "accountTimelineScope-v1";

/** Mine / Team choice for the Account Detail Timeline, remembered per browser. Not a data hook:
 *  it only holds a UI preference (same exemption as lib/localStore.ts). */
export function useTimelineScope(): [TimelineScope, (s: TimelineScope) => void] {
  const [scope, setScopeState] = useState<TimelineScope>(() => {
    try {
      return localStorage.getItem(TIMELINE_SCOPE_KEY) === "team" ? "team" : "mine";
    } catch {
      return "mine";
    }
  });
  const setScope = useCallback((s: TimelineScope) => {
    setScopeState(s);
    try { localStorage.setItem(TIMELINE_SCOPE_KEY, s); } catch { /* storage unavailable */ }
  }, []);
  return [scope, setScope];
}
