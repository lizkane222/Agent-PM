import { useCallback, useEffect, useRef, useState } from "react";
import { integrationsApi, realtimeApi } from "../lib/api";
import { MEETING_NOTES_UPDATED_EVENT } from "../lib/meetingNotes";

/** How often the open app scans the inbox for new Gong / Zoom recaps on its own. */
export const NOTES_CHECK_INTERVAL_MS = 10 * 60 * 1000;
/** How often to look for notification events (also written by the server-side schedule). */
export const NOTES_POLL_INTERVAL_MS = 60 * 1000;
/** Ignore focus events closer together than this. */
export const MIN_FOCUS_CHECK_GAP_MS = 60 * 1000;

export interface MeetingNotesNotification {
  id: number;
  title: string;
  metadata: { meeting_id?: number; meeting_name?: string; account_name?: string | null; source?: string; kind?: "notes" | "recording" };
}

/**
 * Check the inbox for meeting notes every 10 minutes (and when the tab regains focus),
 * and surface a notification for each meeting that gained notes.
 *
 * The scan runs against "now" on every call — the server looks back from the moment of
 * the request. Notifications come from the activity feed, so ones created by the Celery
 * schedule or by the manual GET Meeting Notes button show up too. Never toasts on error.
 */
export function useMeetingNotesAutoCheck(enabled = true) {
  const [pending, setPending] = useState<MeetingNotesNotification[]>([]);
  const running = useRef(false);
  const lastRun = useRef(0);
  const since = useRef(new Date().toISOString());
  const seen = useRef(new Set<number>());

  const poll = useCallback(async () => {
    const from = since.current;
    since.current = new Date().toISOString();
    try {
      const { data } = await realtimeApi.listActivity({ event_type: "meeting_notes", since: from });
      const fresh = (data.results ?? []).filter(
        (ev) => ev.event_type === "meeting_notes" && !seen.current.has(ev.id)
      );
      if (fresh.length === 0) return;
      fresh.forEach((ev) => seen.current.add(ev.id));
      setPending((prev) => [
        ...prev,
        ...fresh.map((ev) => ({
          id: ev.id,
          title: ev.title,
          metadata: ev.metadata as MeetingNotesNotification["metadata"],
        })),
      ]);
      window.dispatchEvent(new Event(MEETING_NOTES_UPDATED_EVENT));
    } catch {
      /* quiet: the next tick retries */
    }
  }, []);

  const check = useCallback(async () => {
    if (running.current || document.visibilityState === "hidden") return;
    running.current = true;
    lastRun.current = Date.now();
    try {
      await integrationsApi.getMeetingNotesFromEmail({ auto: true });
      await poll();
    } catch {
      /* Gmail not connected or unreachable — a background check must never toast */
    } finally {
      running.current = false;
    }
  }, [poll]);

  useEffect(() => {
    if (!enabled) return;
    const checkId = window.setInterval(() => void check(), NOTES_CHECK_INTERVAL_MS);
    const pollId = window.setInterval(() => void poll(), NOTES_POLL_INTERVAL_MS);
    function onVisible() {
      if (document.visibilityState === "visible" && Date.now() - lastRun.current >= MIN_FOCUS_CHECK_GAP_MS) {
        void check();
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(checkId);
      window.clearInterval(pollId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, check, poll]);

  const dismiss = useCallback((id: number) => setPending((prev) => prev.filter((n) => n.id !== id)), []);
  return { pending, dismiss };
}
