import type { CalendarEvent } from "./scheduler";

export type ContentView = "all" | "meetings" | "action-items" | "reminders" | "accounts" | "unlinked";

export interface OverlayUser {
  username: string;
  displayName: string;
  avatarUrl: string;
  color: string;
}

export type EventCategory =
  | "meeting"
  | "task"
  | "out_of_office"
  | "focus_time"
  | "working_location"
  | "appointment";

export interface GuestEntry {
  email: string;
  name: string;
  source: "twilio-team" | "customer-contact" | "manual";
}

export interface ScheduledItem {
  airtableId: string;
  task: string;
  accountName: string | null;
  start: string;
  end: string;
  googleEventId?: string;
  uid?: string;
}

export interface ScheduledReminder {
  reminderId: number;
  title: string;
  start: string;
  end: string;
}

export interface ActiveTimer {
  startedAt: number;
  elapsed: number;
  task: string;
  accountName: string | null;
}

export interface EventAccountLink {
  accountName: string;
  accountId: number;
}

export interface NewEventDraft {
  start: string;
  end: string;
  allDay: boolean;
  title: string;
  /** top-level kind: calendar event vs. airtable action item */
  type: "meeting" | "action-item";
  /** category within calendar-event types */
  category: EventCategory;
  accountQuery: string;
  selectedAccount: { id: number; name: string } | null;
  accountResults: { id: number; name: string }[];
  /** selected guests for the event */
  guests: GuestEntry[];
  /** freeform description typed by the user */
  description: string;
  /** airtable IDs of linked action items */
  linkedActionItemIds: string[];
  /** numeric IDs of linked artifacts */
  linkedArtifactIds: number[];
  videoConference: "none" | "meet" | "zoom";
  /** URL for Zoom (user-supplied) or Meet link */
  videoConferenceUrl: string;
  /** minutes before start to fire an in-app reminder; null = no notification */
  notificationMinutes: number | null;
  repeatFrequency: "none" | "daily" | "weekly" | "biweekly" | "monthly";
}

export interface PendingReschedule {
  ev: CalendarEvent;
  newStart: string;
  newEnd: string;
  revert: () => void;
}

export interface CtxMenuState {
  x: number;
  y: number;
  airtableId: string;
  type: "scheduled" | "timer" | "db-work" | "meeting";
  event: CalendarEvent;
}
