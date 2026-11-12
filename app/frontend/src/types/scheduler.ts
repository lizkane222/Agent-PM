// Scheduler domain types — moved from types/index.ts in Pass 1.
// types/index.ts re-exports these for backwards compat during transition.

import type { EventCategory } from "./calendar";

export type ReminderStatus = "pending" | "sent" | "dismissed" | "snoozed";
export type ReminderResourceType = "account" | "calendar_event" | "action_item" | "task" | "general";

export interface Reminder {
  id: number;
  created_by: number;
  created_by_username: string;
  title: string;
  body: string;
  resource_type: ReminderResourceType;
  resource_id: number | null;
  resource_label: string;
  /** Everything the reminder is linked to; the three fields above mirror the primary one. */
  links: ReminderLink[];
  due_at: string;
  notify_in_app: boolean;
  notify_slack: boolean;
  notify_push: boolean;
  notify_sms: boolean;
  /** Other people notified besides the creator (user ids). Empty = only the creator. */
  recipients: number[];
  recipient_details: { id: number; name: string }[];
  /** Every time the reminder is on the calendar (each a 15-minute block), earliest first. */
  occurrences: ReminderOccurrence[];
  status: ReminderStatus;
  created_at: string;
  updated_at: string;
}

/** A record a reminder is linked to. The label is read from the database by the server. */
export interface ReminderLink {
  resource_type: ReminderLinkType;
  resource_id: number;
  resource_label: string;
}

/** The record types a reminder can link to (the picker's types). */
export type ReminderLinkType = "account" | "action_item" | "calendar_event" | "task";

/** One choice in the link picker. `at` is set for calendar events. */
export interface ReminderLinkOption {
  id: number;
  label: string;
  detail: string;
  at?: string;
}

/** One calendar block of a reminder. `id` is the CalendarEvent id. */
export interface ReminderOccurrence {
  id: number;
  start: string;
  end: string;
}

/** A teammate on an account who could be notified by a reminder. */
export interface ReminderRecipientOption {
  /** Null for a team member who has never signed in to AgentPM: listed, but not choosable. */
  user_id: number | null;
  member_id: number | null;
  name: string;
  /** False when they have turned off being notified by other users. */
  available: boolean;
  /** Why they are unavailable; shown as a tooltip. Empty when available. */
  reason: string;
  /** What puts them on the list: a linked account, "Your colleagues", or "Your manager". */
  accounts: string[];
}

/** Who a reminder with some links could notify, and which accounts they come from. */
export interface ReminderRecipientChoices {
  results: ReminderRecipientOption[];
  /** Where the people come from, in order: linked accounts, "Your colleagues", "Your manager". */
  sources: string[];
  /** The linked accounts alone (kept for older callers). */
  accounts: string[];
}

export interface Attendee {
  email: string;
  displayName?: string;
  responseStatus: "accepted" | "declined" | "tentative" | "needsAction";
}

export interface CalendarEvent {
  id: number;
  owner: number;
  owner_username: string;
  account: number | null;
  account_name: string | null;
  google_event_id: string;
  title: string;
  description: string;
  location: string;
  start_datetime: string;
  end_datetime: string;
  all_day: boolean;
  status: "confirmed" | "tentative" | "cancelled";
  attendees: Attendee[];
  meet_link: string;
  calendar_id: string;
  is_synced: boolean;
  event_category?: EventCategory;
  /**
   * Whether the owner attended. Tri-state, mirroring the Django column:
   *   null/undefined → never recorded (treated as attended)
   *   true           → explicitly Attended
   *   false          → explicitly Did not attend
   * Written through schedulerApi.setEventAttendance, never a plain updateEvent.
   */
  attended?: boolean | null;
  agentpm_airtable_id: string;
  /**
   * The Reminder this event is a scheduled occurrence of, when the user dropped a reminder
   * onto the calendar grid. Set at create time only — read-only on the serializer thereafter,
   * the same as `agentpm_airtable_id`. Paired with `calendar_id === "reminders"`.
   */
  reminder?: number | null;
  /** Account-page project this block belongs to (carried over from the scheduled item). Read-only. */
  project?: number | null;
  project_name?: string | null;
  /** AccountArtifact ids linked to this event. Only meaningful when `account` is set. */
  artifact_ids?: number[];
  created_at: string;
  updated_at: string;
  /**
   * Create-response only, for primary-calendar events: whether the event reached Google
   * and whether guests were emailed. Absent on list/detail reads.
   */
  google_sync?: GoogleSyncResult;
}

export interface GoogleSyncResult {
  status: "ok" | "not_connected" | "failed";
  invites_sent: boolean;
}

export interface MeetingNote {
  id: number;
  event: number;
  author: number | null;
  author_username: string | null;
  author_display: string;
  html: string;
  text: string;
  due_date: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}
