import { useCallback, useEffect, useRef, useState } from "react";
import { notificationsApi, schedulerApi } from "../lib/api";
import { outstandingAlerts } from "../lib/reminderAlerts";
import type { SnoozeRequest } from "../components/calendar/ReminderSnoozeMenu";
import type { AppNotification } from "../types/team";

export const REMINDER_ALERTS_POLL_MS = 20_000;

function snoozeErrorMessage(err: unknown): string {
  const data = (err as { response?: { data?: Record<string, unknown> } })?.response?.data;
  const first = data && Object.values(data)[0];
  const text = Array.isArray(first) ? first[0] : first;
  return typeof text === "string" && text ? text : "Couldn't snooze the reminder. Please try again.";
}

/**
 * Reminders that have fired and are still waiting for the user.
 *
 * An alert stays until it is acknowledged (marked read) or the reminder is snoozed (the server
 * marks it read as it reschedules). The list is re-read from the server every 20 s and on
 * returning to the tab, so it survives a reload and shows up in every open tab.
 */
export function useReminderAlerts() {
  const [alerts, setAlerts] = useState<AppNotification[]>([]);
  // Ids answered here that a poll already in flight may still report as unread.
  const answered = useRef(new Set<number>());

  const check = useCallback(async () => {
    try {
      const { data } = await notificationsApi.list({ channel: "in_app", kind: "reminder", unread: "1", page_size: "50" });
      setAlerts(outstandingAlerts(data.results ?? []).filter((n) => !answered.current.has(n.id)));
    } catch { /* offline or throttled: the alerts on screen stay, and we try again */ }
  }, []);

  useEffect(() => {
    void check();
    const timer = setInterval(() => void check(), REMINDER_ALERTS_POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [check]);

  /** "Got it": the alert goes away and stays away. */
  const acknowledge = useCallback(async (id: number) => {
    answered.current.add(id);
    setAlerts((prev) => prev.filter((n) => n.id !== id));
    try {
      await notificationsApi.markRead([id]);
    } catch {
      // Not saved, so it would come back on the next poll anyway; let it, and say nothing twice.
      answered.current.delete(id);
      void check();
    }
  }, [check]);

  /**
   * Reschedule the reminder this alert is about. The block that fired is the one that moves.
   * Resolves to an error message to show in the menu, or null when it worked (the alert is then gone).
   */
  const snooze = useCallback(async (n: AppNotification, request: SnoozeRequest): Promise<string | null> => {
    if (n.reminder === null) return "That reminder no longer exists.";
    try {
      await schedulerApi.snoozeReminder(n.reminder, { ...request, ...(n.fired_for ? { from: n.fired_for } : {}) });
    } catch (err) {
      return snoozeErrorMessage(err);
    }
    answered.current.add(n.id); // the server marked it read as it rescheduled
    setAlerts((prev) => prev.filter((a) => a.id !== n.id));
    window.dispatchEvent(new StorageEvent("storage", { key: "remindersUpdated", newValue: "1" }));
    void check(); // another alert for the same reminder may have been answered too
    return null;
  }, [check]);

  return { alerts, acknowledge, snooze };
}
