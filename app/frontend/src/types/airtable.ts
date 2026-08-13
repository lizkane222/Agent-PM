// ── Airtable-synced entities ──────────────────────────────────────────────────
// Moved from types/index.ts. types/index.ts re-exports all of these for
// backwards compatibility — call sites importing from "../types" are unaffected.

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
