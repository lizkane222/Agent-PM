import { useEffect, useRef } from "react";
import { integrationsApi } from "../lib/api";

/** How often the open calendar page pulls from Google on its own. */
export const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
/** Ignore focus events closer together than this (alt-tabbing shouldn't hammer Google). */
export const MIN_FOCUS_SYNC_GAP_MS = 60 * 1000;

/**
 * Keep the calendar current with Google while the page is open: a quiet sync every 5
 * minutes and whenever the tab becomes visible again, then `onChanged()` so the page re-reads, even when
 * this call found nothing new (the server's background job may have applied the change first).
 * Also re-reads when another tab/device announces a sync (the backend's `calendar.synced`
 * activity, rebroadcast here as the `calendarUpdated` storage key).
 *
 * This is the only client-side trigger now that the manual "Sync Google Calendar" button is
 * gone. It also runs once when the page opens, so a visit never starts from data older than the
 * last poll. It never runs while `busy` (a drag in progress) and never overlaps itself.
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

    async function run(opts: { onlyIfChanged?: boolean } = {}) {
      if (running.current || busyRef.current() || document.visibilityState === "hidden") return;
      running.current = true;
      lastRun.current = Date.now();
      try {
        const { data } = await integrationsApi.syncGoogleCalendar({ auto: true });
        // On open the page has just read the DB, so only a change this very call made needs a
        // re-read. On every later tick, re-read regardless of `changed`: the server's own
        // 5-minute job usually applies a Google change (a deleted or moved meeting) before this
        // poll runs, so the call reports "nothing new" while the page is stale. Gating on
        // `changed` left a meeting deleted in Google on screen indefinitely.
        const changed = data.changed === undefined || data.changed > 0;
        if (!opts.onlyIfChanged || changed) onChangedRef.current();
      } catch {
        /* quiet: a background refresh must never toast; the next tick retries */
      } finally {
        running.current = false;
      }
    }

    void run({ onlyIfChanged: true });
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
