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
