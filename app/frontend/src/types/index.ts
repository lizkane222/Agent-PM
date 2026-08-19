// ── Auth ──────────────────────────────────────────────────────────────────────

export interface TokenPair {
  access: string;
  refresh: string;
}

export interface AuthUser {
  id: number;
  username: string;
  email: string;
}

// ── Agent (moved to types/agents.ts — re-exported here for backwards compat) ────
export type { SessionParticipant, AgentSession, AgentMessage, ToolCall, AgentSkill, AgentSkillStatus, AgentSkillVisibility, AgentSkillScript } from "./agents";

// ── Scheduler (moved to types/scheduler.ts — re-exported here for backwards compat) ────
export type { Reminder, ReminderStatus, ReminderResourceType, CalendarEvent, MeetingNote, Attendee } from "./scheduler";

export interface ActionItem {
  id: number;
  assigned_to: number | null;
  assigned_to_username: string | null;
  created_by: number | null;
  title: string;
  notes: string;
  priority: "urgent" | "high" | "normal" | "low";
  status: "open" | "in_progress" | "done" | "dismissed";
  due_date: string | null;
  source_event: number | null;
  account: number | null;
  account_name: string | null;
  airtable_record_id: string;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: number;
  title: string;
  description: string;
  assigned_to: number | null;
  assigned_to_username: string | null;
  created_by: number | null;
  status: "backlog" | "todo" | "in_progress" | "review" | "done" | "archived";
  priority: "urgent" | "high" | "normal" | "low";
  due_date: string | null;
  tags: string[];
  action_item: number | null;
  airtable_record_id: string;
  created_at: string;
  updated_at: string;
}

// ── Team (moved to types/team.ts — re-exported here for backwards compat) ────
export type { Tag, TeamMember, UserProfile } from "./team";

// ── Realtime ──────────────────────────────────────────────────────────────────

export interface AgentActivityEvent {
  id: number;
  event_type: string;
  title: string;
  detail: string;
  metadata: Record<string, unknown>;
  sync_document_id: string;
  client_id: string;
  client_ts: number | null;
  created_at: string;
}

export interface SyncToken {
  token: string;
  identity: string;
  sync_service_sid: string;
}

export interface VoiceSession {
  id: number;
  call_sid: string;
  from_number: string;
  to_number: string;
  status: "ringing" | "in_progress" | "completed" | "failed" | "no_answer";
  duration_seconds: number;
  recording_url: string;
  transcript: string;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

// ── Customer Contacts ─────────────────────────────────────────────────────────

// ── Accounts (moved to types/accounts.ts — re-exported here for backwards compat) ────
export type {
  CustomerContactNote,
  CustomerContact,
  AccountTeamMember,
  Account,
  AccountNote,
  AccountQuickLink,
  AccountArtifact,
  AccountProject,
  GoalResource,
  SalesforceProjectData,
  GoalSection,
  AccountRoleType,
  AccountRole,
  PanelItem,
} from "./accounts";

// ── Salesforce / Cloud Coach ──────────────────────────────────────────────────

export interface SalesforceConnectionStatus {
  connected: boolean;
  instance_url?: string;
  namespace?: string;
  sf_user_email?: string;
  last_synced?: string | null;
}

export interface SalesforceAccount {
  id: number;
  sf_id: string;
  name: string;
  website: string;
  industry: string;
  account_type: string;
  phone: string;
  billing_city: string;
  billing_country: string;
  owner_name: string;
}

export interface SalesforceTeamMember {
  id: number;
  sf_id: string;
  project: number;
  sf_user_id: string;
  name: string;
  email: string;
  role: string;
  local_member_id: number | null;
}

export interface SalesforceTask {
  id: number;
  sf_id: string;
  project: number | null;
  project_name: string;
  account: number | null;
  account_name: string;
  subject: string;
  status: string;
  priority: string;
  due_date: string | null;
  description: string;
  assigned_to_name: string;
}

export interface SalesforceProject {
  id: number;
  sf_id: string;
  account: number | null;
  account_name: string;
  name: string;
  status: string;
  description: string;
  start_date: string | null;
  end_date: string | null;
  owner_name: string;
  members: SalesforceTeamMember[];
  tasks: SalesforceTask[];
}

export interface LogTimeDayAssignment {
  id: number;
  date: string;
  project: number;
  project_sf_id: string;
  project_name: string;
  position: number;
}

export interface SalesforceTimeEntry {
  id: number;
  sf_id: string;
  project: number | null;
  project_name: string;
  task: number | null;
  task_subject: string;
  date: string;
  duration_minutes: number;
  description: string;
  synced_to_sf: boolean;
  sync_error: string;
  created_at: string;
}

// ── Airtable Sync ─────────────────────────────────────────────────────────────

export interface AirtableAccount {
  id: number;
  airtable_id: string;
  name: string;
  email_domain: string;
  health_score: string;
  next_meeting: string | null;
  open_ticket_count: number;
  time_budget: number;
  total_meeting_duration: number;
  salesforce_account_id: string;
  segment_workspaces: string;
  last_synced: string;
}

export interface AirtableMeeting {
  id: number;
  airtable_id: string;
  account: number | null;
  account_name: string | null;
  name: string;
  date: string | null;
  duration: number;
  expected_topics: string;
  gong_notes: string;
  gong_url: string;
  // Zoom AI Companion recaps are stored alongside the Gong ones, not instead of them.
  // Gong wins when both are present; the meeting-summary panel toggles between them.
  zoom_notes: string;
  zoom_url: string;
  customer_slack: string;
  account_team_slack: string;
  last_synced: string;
}

export interface ActionItemAttachment {
  id: number;
  action_item: number;
  artifact_type: "link" | "file";
  name: string;
  url: string | null;
  icon_key?: string;
  file_url: string | null;
  mime_type: string;
  file_size: number | null;
  uploaded_by: number | null;
  uploaded_by_username: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActionItemDependency {
  id: number;
  airtable_id: string;
  task: string;
  status: "Open" | "In Progress" | "Done" | "Blocked" | "Backlogged";
}

export interface AirtableActionItem {
  id: number;
  airtable_id: string;
  account: number | null;
  account_name: string | null;
  task: string;
  task_details: string;
  status: "Open" | "In Progress" | "Done" | "Blocked" | "Backlogged";
  priority: "Low" | "Medium" | "High" | "Critical";
  due_date: string | null;
  estimated_time: number;
  time_spent: number;
  prep_time: number;
  slack_thread_url: string;
  salesforce_task_id: string;
  assignee_airtable_id: string;
  assignee_name: string;
  reminder: number | null;
  reminder_id: number | null;
  reminder_due_at: string | null;
  reminder_status: string | null;
  linked_meeting: number | null;
  linked_meeting_name: string | null;
  created_at: string;
  updated_at: string;
  marked_done_at: string | null;
  last_synced: string;
  attachments?: ActionItemAttachment[];
  waiting_on?: ActionItemDependency[];
}

export interface EventMatchResult {
  needs_categorization: boolean;
  match_method?: string;
  categorization?: string;
  account?: AirtableAccount | null;
  action_items?: AirtableActionItem[];
  meetings?: AirtableMeeting[];
  this_meeting?: AirtableMeeting | null; // the stub linked to THIS specific event
  accounts?: AirtableAccount[]; // only when needs_categorization=true
}

// ── Integrations ──────────────────────────────────────────────────────────────

export interface OAuthCredential {
  id: number;
  provider: "google" | "slack" | "airtable" | "salesforce" | "gong" | "zoom" | "lucidchart" | "github" | "google_drive" | "notion" | "microsoft" | "gmail";
  provider_display: string;
  scopes: string;
  is_active: boolean;
  token_expiry: string | null;
  created_at: string;
  updated_at: string;
}

// ── Claude Skills ─────────────────────────────────────────────────────────────

export type ClaudeSkillStatus = "pending_review" | "reviewing" | "approved" | "rejected" | "disabled";

export const ROLE_OPTIONS = [
  "Solutions Architect",
  "Customer Success Manager",
  "Product Manager",
  "Manager",
  "Technical Account Manager",
] as const;

export type RoleOption = typeof ROLE_OPTIONS[number];

export interface ClaudeSkill {
  id: number;
  name: string;
  description: string;
  command: string;
  roles: string[];
  code: string;
  input_schema: Record<string, unknown>;
  status: ClaudeSkillStatus;
  review_feedback: string;
  review_suggestions: string;
  invocation_count: number;
  submitted_by_username: string | null;
  created_at: string;
  updated_at: string;
}


// ── API Pagination ────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// ── Comments ──────────────────────────────────────────────────────────────────

// ── Comments (moved to types/comments.ts — re-exported here for backwards compat) ────
export type {
  CommentResourceType, CommentReference, CommentMention, Comment,
  CommentPreview, CommentSummary, CommentSummaryResponse,
} from "./comments";

// ── Feedback (moved to types/feedback.ts — re-exported here for backwards compat) ────
export type { FeedbackStatus, FeedbackComment, FeedbackItem } from "./feedback";

// ── Discover (moved to types/discover.ts — re-exported here for backwards compat) ────
export type { DiscoverApplet, AppletCategory, ItemType, UrlStatus } from "./discover";

// ── Action item steps ─────────────────────────────────────────────────────────
export type { StepStatus, ActionItemStep } from "./action_items";

// ── Page Layouts ──────────────────────────────────────────────────────────────

export interface PageLayout {
  id: number;
  name: string;
  creator: number | null;
  creator_name: string | null;
  forked_from: number | null;
  forked_from_name: string | null;
  nodes: unknown[];
  is_public: boolean;
  heart_count: number;
  fork_count: number;
  hearted: boolean;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

// ── Working Sessions ──────────────────────────────────────────────────────────

export interface ExportItemSnapshot {
  id: string;
  type: string;
  label: string;
  summary: string;
  content: string;
  accountId?: number;
  accountName?: string;
  url?: string;
  accent?: string;
}

export interface WorkingSession {
  id: number;
  owner: number;
  owner_username: string;
  name: string;
  canvas_nodes: unknown[];
  record_refs: ExportItemSnapshot[];
  airtable_id: string;
  created_at: string;
  updated_at: string;
}

export interface UserPageNote {
  id: number;
  owner: number;
  owner_username: string;
  content: string;
  account_ref_label: string;
  created_at: string;
  updated_at: string;
}

// ── Sync Review ───────────────────────────────────────────────────────────────
export type {
  SyncReviewSource,
  SyncReviewContentType,
  SyncReviewStatus,
  SyncDeleteRequestStatus,
  SyncReviewItem,
  SyncDeleteRequest,
} from "./sync_review";

// ── Account Feed ──────────────────────────────────────────────────────────────
export type {
  AirtableFieldType,
  AirtableFieldTypeChoice,
  AccountFeedCustomField,
  AccountFeedConfig,
} from "./account_feed";
