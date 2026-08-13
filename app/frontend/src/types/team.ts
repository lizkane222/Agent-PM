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
  notify_default_in_app: boolean;
  notify_default_slack: boolean;
  notify_default_push: boolean;
  notify_default_sms: boolean;
  push_subscription_active: boolean;
  staff_view_override: boolean;
}
