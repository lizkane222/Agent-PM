// ── Team domain types ──────────────────────────────────────────────────────────

export interface Tag {
  id: number;
  name: string;
  color: string;
  description: string;
}

export interface TeamMember {
  id: number;
  user: number | null;
  username?: string | null;
  full_name: string;
  email: string;
  /** Other addresses (Segment, SendGrid…). `email` stays the primary. */
  additional_emails?: string[];
  title: string;
  department: string;
  tags: Tag[];
  manager: number | null;
  manager_name: string | null;
  slack_handle: string;
  avatar_url: string;
  joined_at: string | null;
  /** Effective IANA zone: the person's own setting if set, else one someone assigned, else "". */
  timezone?: string;
  timezone_source?: "self" | "assigned" | "";
  /** Username of whoever assigned the zone; only present while the assignment is in force. */
  assigned_by_username?: string | null;
  created_at: string;
  updated_at: string;
}

/** A link to a document shared on a team member's profile (e.g. an OOO coverage doc). */
export interface TeamMemberDocument {
  id: number;
  team_member: number;
  name: string;
  url: string;
  position: number;
  added_by: number | null;
  added_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  id: number;
  username: string;
  email: string;
  is_staff: boolean;
  display_name: string;
  avatar_url: string;
  title: string;
  role: "admin" | "manager" | "member" | "viewer";
  phone_number: string;
  timezone: string;
  slack_user_id: string;
  google_account_email: string;
  airtable_collaborator_id: string;
  notification_email: boolean;
  notification_slack: boolean;
  notify_default_in_app: boolean;
  notify_default_slack: boolean;
  notify_default_push: boolean;
  notify_default_sms: boolean;
  /** Whether teammates may add me as a recipient of their reminders. */
  allow_reminders_from_others: boolean;
  push_subscription_active: boolean;
  staff_view_override: boolean;
  /** Authorisation tier. Read-only on /me/; Admins change it via teamApi.setAccessLevel. */
  access_level?: "basic" | "pm" | "admin";
  calendar_colors?: CalendarColorPrefs;
  /** Display-name preference per action-item status (display only). */
  status_labels?: Partial<Record<"Open" | "In Progress" | "Blocked" | "Done" | "Backlogged", string>>;
  gmail_watch_config?: GmailWatchConfig;
}

/**
 * Per-user calendar appearance. `categories` maps a colorable event type to a hex
 * color; `important` maps a single event's uid to the hex color chosen via the
 * calendar's "Mark as important!" menu. Both are sparse — anything absent falls back
 * to DEFAULT_CATEGORY_COLORS in lib/eventColors.ts.
 */
export interface CalendarColorPrefs {
  categories?: Record<string, string>;
  important?: Record<string, string>;
}

/**
 * Gmail watch configuration: label name, keywords to match, and keywords to block.
 * Keyword matching is fuzzy (SequenceMatcher ratio >= 0.7) to catch typos.
 */
export interface GmailWatchConfig {
  label_name?: string; // Gmail label to watch (e.g., "Agent PM - Threads")
  keywords?: string[];
  block_keywords?: string[];
}

// ── Notifications, public profile, left notes ──────────────────────────────────

export type NotificationChannel = "in_app" | "push" | "sms" | "slack" | "email";

export interface AppNotification {
  id: number;
  channel: NotificationChannel;
  kind: string;
  title: string;
  body: string;
  link: string;
  status: "sent" | "failed" | "skipped";
  read_at: string | null;
  created_at: string;
  /** For a reminder notification: the reminder that fired (null once it is deleted)… */
  reminder: number | null;
  /** …the moment that fired it (its due time, or the start of one of its calendar blocks)… */
  fired_for: string | null;
  /** …and whether this person owns it. Someone notified through a teammate's reminder can only acknowledge. */
  can_snooze: boolean;
}

export type PublicItemType = "artifact_link" | "artifact_file" | "note" | "record_ref";

export interface PublicItemRef {
  resource_type: string;
  resource_id: string | number;
  label: string;
  url: string;
}

export interface PublicItem {
  id: number;
  owner: number;
  item_type: PublicItemType;
  title: string;
  url: string;
  file_url: string;
  body: string;
  ref: Partial<PublicItemRef>;
  position: number;
  created_at: string;
  updated_at: string;
}

/** Safe public header for a team member, as served by /team/members/<id>/profile/. */
export interface MemberPublicProfile extends TeamMember {
  is_self: boolean;
}

export interface LeftNote {
  id: number;
  author: number;
  author_name: string;
  body: string;
  created_at: string;
}
