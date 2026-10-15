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
  due_at: string;
  notify_in_app: boolean;
  notify_slack: boolean;
  notify_push: boolean;
  notify_sms: boolean;
  status: ReminderStatus;
  created_at: string;
  updated_at: string;
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
