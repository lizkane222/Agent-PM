/**
 * The fields of a reminder form, and what saving one sends — one definition for every form.
 *
 * The Reminders page and the calendar sidebar both create reminders, and had drifted: different
 * ways to link records, a different set of channels, different defaults. Both now build their
 * request here, so they offer the same fields and send the same thing.
 */

import type { NotificationDefaults } from "../context/NotificationDefaultsContext";
import type { Reminder, ReminderLink } from "../types/scheduler";
import { fromLocalDatetimeValue } from "./datetimeLocal";

/** How a reminder reaches the person who made it. Other people are reached their own way. */
export const REMINDER_CHANNELS = [
  { key: "notify_in_app", label: "In-app" },
  { key: "notify_push", label: "Laptop" },
  { key: "notify_sms", label: "Phone" },
  { key: "notify_slack", label: "Slack" },
] as const;

export type ReminderChannelKey = (typeof REMINDER_CHANNELS)[number]["key"];
export type ReminderChannels = Record<ReminderChannelKey, boolean>;

/** The channels pre-ticked for a new reminder: the user's own Settings defaults. */
export function channelsFromDefaults(d: NotificationDefaults): ReminderChannels {
  return {
    notify_in_app: d.notify_default_in_app,
    notify_push: d.notify_default_push,
    notify_sms: d.notify_default_sms,
    notify_slack: d.notify_default_slack,
  };
}

export function channelsOf(r: Pick<Reminder, ReminderChannelKey>): ReminderChannels {
  return { notify_in_app: r.notify_in_app, notify_push: r.notify_push, notify_sms: r.notify_sms, notify_slack: r.notify_slack };
}

export interface ReminderDraft {
  title: string;
  body: string;
  /** The user's local wall clock, as a datetime-local input holds it. */
  dueLocal: string;
  links: ReminderLink[];
  /** How *the creator* wants to be told. */
  channels: ReminderChannels;
  /** Other people to notify (user ids). */
  recipients: number[];
}

/** Who is being added that the reminder did not already notify: these need an explicit yes. */
export function newlyAdded(recipients: readonly number[], original: readonly number[]): number[] {
  return recipients.filter((id) => !original.includes(id));
}

/**
 * The request body for saving a draft.
 *
 * `links` is sent whole (the server derives the single-link fields from it); `recipients` is
 * always sent so removing someone works; and `confirm_notify_others` is attached **only** when
 * somebody new is being added — the server refuses without it, and it should never be sent as a
 * habit.
 */
export function buildReminderPayload(draft: ReminderDraft, original: readonly number[] = []) {
  return {
    title: draft.title.trim(),
    body: draft.body.trim(),
    due_at: fromLocalDatetimeValue(draft.dueLocal),
    links: draft.links,
    ...draft.channels,
    recipients: draft.recipients,
    ...(newlyAdded(draft.recipients, original).length > 0 ? { confirm_notify_others: true } : {}),
  };
}

/** The first readable message in a DRF validation error, or a generic fallback. */
export function reminderSaveError(err: unknown): string {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (data && typeof data === "object") {
    for (const v of Object.values(data as Record<string, unknown>)) {
      const first = Array.isArray(v) ? v[0] : v;
      if (typeof first === "string" && first) return first;
    }
  }
  return "Couldn't save the reminder. Please try again.";
}
