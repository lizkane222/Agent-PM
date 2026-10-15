import { useEffect, useRef } from "react";
import { integrationsApi } from "../lib/api";

/** How often the open calendar page pulls from Google on its own. */
export const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
/** Ignore focus events closer together than this (alt-tabbing shouldn't hammer Google). */
export const MIN_FOCUS_SYNC_GAP_MS = 60 * 1000;

/**
 * Keep the calendar current with Google while the page is open: a quiet sync every 5
 * minutes and whenever the tab becomes visible again, then `onChanged()` if Google had
 * anything new. Also re-reads when another tab/device announces a sync (the backend's
 * `calendar.synced` activity, rebroadcast here as the `calendarUpdated` storage key).
 *
 * The manual "Sync Google Calendar" button is separate and unaffected; this never runs
 * while `busy` (a manual sync, a drag in progress) and never overlaps itself.
 */
export function useGoogleCalendarAutoSync({ enabled, busy, onChanged }: {
  enabled: boolean;
  busy: () => boolean;
  onChanged: () => void;
}) {
  const running = useRef(false);
  const lastRun = useRef(0);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    if (!enabled) return;

    async function run() {
      if (running.current || busyRef.current() || document.visibilityState === "hidden") return;
      running.current = true;
      lastRun.current = Date.now();
      try {
        const { data } = await integrationsApi.syncGoogleCalendar({ auto: true });
        // Older servers don't send `changed` — treat that as "maybe" and refresh.
        if (data.changed === undefined || data.changed > 0) onChangedRef.current();
      } catch {
        /* quiet: a background refresh must never toast; the next tick retries */
      } finally {
        running.current = false;
      }
    }

    const interval = window.setInterval(() => void run(), AUTO_SYNC_INTERVAL_MS);
    function onVisible() {
      if (document.visibilityState === "visible" && Date.now() - lastRun.current >= MIN_FOCUS_SYNC_GAP_MS) void run();
    }
    function onStorage(e: StorageEvent) {
      if (e.key === "calendarUpdated") onChangedRef.current();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("storage", onStorage);
    };
  }, [enabled]);
}
