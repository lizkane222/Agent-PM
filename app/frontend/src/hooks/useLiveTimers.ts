import { useEffect, useState, useSyncExternalStore } from "react";
import { getLiveTimers, subscribeLiveTimers, type LiveTimer } from "../lib/liveTimers";

/**
 * The caller's running Live Tracking timers, keyed by action-item airtable_id, re-rendering
 * once a second while any is running so elapsed displays tick. Not a `useResource` hook —
 * it is a shared external store (lib/liveTimers.ts), the same exemption lib/localStore.ts
 * claims — but the data is server-owned, so every tab and device agrees.
 */
export function useLiveTimers(): { timers: Record<string, LiveTimer>; now: number } {
  const timers = useSyncExternalStore(subscribeLiveTimers, getLiveTimers, getLiveTimers);
  const [now, setNow] = useState(() => Date.now());
  const running = Object.keys(timers).length > 0;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  return { timers, now };
}
