/**
 * Which reminder notifications are still waiting on the user.
 *
 * An in-app reminder stays on screen until the user either acknowledges it or snoozes the
 * reminder. "Waiting" is therefore server state — an unread in-app reminder notification —
 * not something remembered in the browser, so a reload, a second tab, or coming back after a
 * night away shows the same alerts, and none of them quietly time out.
 *
 * (An earlier version only showed what arrived after the page loaded and dropped anything
 * older than six hours; that is exactly how a reminder gets missed.)
 */

import type { AppNotification } from "../types/team";

/** The alerts to show, oldest first: unread, in-app, delivered reminders. */
export function outstandingAlerts(list: readonly AppNotification[]): AppNotification[] {
  return list
    .filter((n) => n.kind === "reminder" && n.channel === "in_app" && n.status === "sent" && n.read_at === null)
    .sort((a, b) => a.id - b.id);
}
