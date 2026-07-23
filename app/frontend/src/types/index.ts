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

// ── Agent ─────────────────────────────────────────────────────────────────────

export interface SessionParticipant {
  id: number;
  username: string;
  email: string;
  display_name: string;
}

export interface AgentSession {
  id: number;
  title: string;
  status: "active" | "completed" | "error";
  is_shared: boolean;
  owner_username: string;
  participants: SessionParticipant[];
  started_at: string;
  ended_at: string | null;
  messages: AgentMessage[];
  created_at: string;
  updated_at: string;
}

export interface AgentMessage {
  id: number;
  role: "user" | "assistant" | "tool_result";
  content: string;
  input_tokens: number;
  output_tokens: number;
  tool_calls: ToolCall[];
  created_at: string;
}

export interface ToolCall {
  id: number;
  tool_name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  status: "pending" | "success" | "error";
  error_message: string;
  duration_ms: number;
  created_at: string;
}

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

// ── Team ──────────────────────────────────────────────────────────────────────

export interface Tag {
  id: number;
  name: string;
  color: string;
  description: string;
}

export interface TeamMember {
  id: number;
  user: number | null;
  full_name: string;
  email: string;
  title: string;
  department: string;
  tags: Tag[];
  manager: number | null;
  manager_name: string | null;
  slack_handle: string;
  avatar_url: string;
  joined_at: string | null;
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
  // Reminder notification defaults
  notify_default_in_app: boolean;
  notify_default_slack: boolean;
  notify_default_push: boolean;
  notify_default_sms: boolean;
  // True if a Web Push subscription is saved for this user's current device
  push_subscription_active: boolean;
  // Staff only: when false, restricts visibility to personally assigned records
  staff_view_override: boolean;
}

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

export interface CustomerContactNote {
  id: number;
  contact: number;
  author: number | null;
  author_display: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface CustomerContact {
  id: number;
  account: number;
  name: string;
  role: string;
  description: string;
  email: string;
  airtable_id: string;
  notes_count: number;
  notes: CustomerContactNote[];
  created_at: string;
  updated_at: string;
}

// ── Accounts ─────────────────────────────────────────────────────────────────

export interface AccountTeamMember {
  id: number;
  full_name: string;
  title: string;
  email: string;
  avatar_url: string;
  slack_handle: string;
}

export interface Account {
  id: number;
  company_name: string;
  airtable_id: string;
  website: string;
  industry: string;
  status: "prospect" | "active" | "inactive" | "churned";
  arr: string | null;
  owner: number | null;
  owner_username: string | null;
  primary_contact: number | null;
  primary_contact_name: string | null;
  team_members: AccountTeamMember[];
  notes_count: number;
  created_by: number | null;
  is_admin_account: boolean;
  created_at: string;
  updated_at: string;
}

export interface AccountNote {
  id: number;
  account: number;
  author: number | null;
  author_username: string | null;
  author_display: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface AccountQuickLink {
  id: number;
  account: number;
  name: string;
  url: string;
  position: number;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface AccountArtifact {
  id: number;
  account: number;
  artifact_type: "link" | "file";
  name: string;
  url: string | null;
  secondary_url: string;
  icon_key: string;
  file_url: string | null;
  mime_type: string;
  file_size: number | null;
  uploaded_by: number | null;
  uploaded_by_username: string | null;
  created_at: string;
  updated_at: string;
}

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

export interface AccountProject {
  id: number;
  account: number;
  name: string;
  description: string;
  position: number;
  created_at: string;
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
  provider: "google" | "slack" | "airtable";
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

// ── Agent Skills (structured, instructions-based) ────────────────────────────

export type AgentSkillStatus = "draft" | "pending_review" | "approved" | "rejected";
export type AgentSkillVisibility = "private" | "team" | "public";

export interface AgentSkillScript {
  filename: string;
  language: string;
  code: string;
}

export interface AgentSkill {
  id: number;
  name: string;
  description: string;
  instructions: string;
  allowed_tools: string[];
  scripts: AgentSkillScript[];
  references: string[];
  status: AgentSkillStatus;
  visibility: AgentSkillVisibility;
  review_verdict: string;
  review_findings: Record<string, string>;
  reviewed_at: string | null;
  pinned_to_roles: string[];
  pinned_by_me: boolean;
  version: number;
  created_by_username: string | null;
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

export type CommentResourceType =
  | "account"
  | "airtable_account"
  | "action_item"
  | "meeting"
  | "calendar_event"
  | "reminder"
  | "task"
  | "account_note"
  | "artifact"
  | "meeting_note"
  | "claude_skill";

export interface CommentReference {
  resource_type: CommentResourceType;
  resource_id: number;
  label: string;
  url: string;
}

export interface CommentMention {
  user_id: number;
  username: string;
  display_name: string;
}

export interface Comment {
  id: number;
  resource_type: CommentResourceType;
  resource_id: number;
  resource_label: string;
  author: number | null;
  author_username: string | null;
  author_display: string;
  content: string;
  parent: number | null;
  references: CommentReference[];
  mentions: CommentMention[];
  replies: Comment[];
  created_at: string;
  updated_at: string;
}

// ── Feedback ──────────────────────────────────────────────────────────────────

export type FeedbackStatus = "open" | "in_progress" | "resolved" | "wont_fix";

export interface FeedbackComment {
  id: number;
  feedback: number;
  author: number | null;
  author_username: string | null;
  author_display: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface FeedbackItem {
  id: number;
  author: number | null;
  author_username: string | null;
  author_display: string;
  description: string;
  element_label: string;
  element_path: string;
  page_url: string;
  attachment: string | null;
  status: FeedbackStatus;
  comments: FeedbackComment[];
  comment_count: number;
  created_at: string;
  updated_at: string;
}

// ── Discover / Applets ────────────────────────────────────────────────────────

export interface DiscoverApplet {
  id: number;
  type: "applet" | "repo";
  name: string;
  description: string;
  url: string;
  category: string;
  author: string;
  tags: string[];
  airtable_id: string;
  submitted_by_username: string | null;
  created_at: string;
  updated_at: string;
}

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
