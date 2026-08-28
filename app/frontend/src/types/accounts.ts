// ── Account domain types ──────────────────────────────────────────────────────
// Moved from types/index.ts (CustomerContact*, Account*, AccountNote, etc.) and
// from AccountDetailPage.tsx inline definitions (GoalResource, GoalSection,
// PanelItem). types/index.ts re-exports all of these for backwards compatibility.

import type { AirtableActionItem, AirtableMeeting } from "./airtable";
import type { TeamMember } from "./team";
import type { CalendarEvent, Reminder } from "./scheduler";

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

export interface AccountProject {
  id: number;
  account: number;
  name: string;
  description: string;
  url: string;
  position: number;
  action_ids: string[];
  meeting_ids: string[];
  goal_ids: string[];
  resources: GoalResource[];
  sf_data: SalesforceProjectData;
  sf_project_id: string;
  kind: "project" | "goal";
  created_at: string;
}

// A team.TeamMember linked to a specific AccountProject — a member can be on
// several projects under the same account, which Account.team_members alone
// cannot express.
export interface ProjectMember {
  id: number;
  project: number;
  team_member: number;
  team_member_name: string;
  team_member_email: string;
  team_member_avatar_url: string;
  role: string;
  added_by: number | null;
  created_at: string;
}

// ── Goal / Project section types (previously inline in AccountDetailPage.tsx) ──

export interface GoalResource {
  id: string;
  label: string;
  url: string;
  iconKey?: string;
}

// Salesforce Cloud Coach project fields — all optional; populated from SF API
// or entered manually until the integration is connected.
export interface SalesforceProjectData {
  // displayed on compact card
  health?: string;          // "Green" | "Yellow" | "Red"
  remainingHours?: string;
  // Overview
  projectStatus?: string; projectType?: string; externalProjectView?: string;
  projectSummary?: string; utilizationCategory?: string; onHold?: string;
  psProjectOwner?: string; timeApprovedByPm?: string; twilioProducts?: string;
  externalAccountId?: string; projectUnits?: string; completionPctTasks?: string;
  completionPctHours?: string; siPartnerName?: string; productPartnerName?: string;
  engagementManager?: string;
  // Work at Risk
  workAtRiskApproved?: string; atRiskAmount?: string; atRiskHours?: string;
  atRiskNotes?: string; atRiskStart?: string; atRiskEnd?: string; contractSigned?: string;
  // Project Duration and Hours
  startDate?: string; endDate?: string; kickoffDate?: string;
  enteredHours?: string; estimatedHours?: string; totalHoursSold?: string;
  scheduledHours?: string; subconIncluded?: string; estimatedNbTime?: string;
  subcontractingPartner?: string; subconHoursTotal?: string;
  twilioProductEndCustomer?: string; subconHoursEntered?: string;
  // Project Health
  projectStage?: string; plannedGoLiveDate?: string; healthTrafficLight?: string;
  plannedGoLiveNotes?: string; healthReason?: string; onHoldStart?: string;
  pathToGreen?: string; onHoldEnd?: string; daysOnHold?: string;
  // Status Summary
  statusSummary?: string; projectHealthStatus?: string;
  statusSummaryLastChange?: string; issuesRisks?: string;
  requestSalesFollowUp?: string; salesFollowUpNotes?: string;
  // Project Health Scorecard
  scopeHealthLight?: string; scopeHealth?: string;
  scheduleHealthLight?: string; scopeHealthReason?: string;
  budgetHealthLight?: string; scheduleHealth?: string;
  scheduleHealthReason?: string; budgetHealth?: string; budgetHealthReason?: string;
  // Launch Fields
  aeLaunchDate?: string; customerLaunchDate?: string; mst?: string;
  projectedMstDate?: string; mstDate?: string; launchDelayReason?: string;
  daysToMst?: string; secondaryLaunchDelayReasons?: string;
  // Project Financials
  billingType?: string; revRecType?: string; projectBudget?: string;
  currentMargin?: string; reimbursableExpenseBudget?: string;
  currentMarginPct?: string; goodwillAmount?: string;
  totalCompletedMilestone?: string; subconBudget?: string;
  totalReimbursableMilestone?: string; asSoldMargin?: string;
  totalRemainingReimbursable?: string; totalProjectMilestone?: string;
  calculatedCost?: string; totalForecastCost?: string; calculatedRate?: string;
  // Opportunity Information
  salesAmount?: string; opportunityOwner?: string; changeRequestAmount?: string;
  accountOwner?: string; primaryProduct?: string; sfAccount?: string;
  opportunityEarr?: string; cyCommsTerritory?: string;
  linkToSegmentContract?: string; opportunityServices?: string;
  segmentCsm?: string; opportunityProduct?: string;
  changeRequestOpportunity?: string; rateCard?: string; currentSegmentCsmPlan?: string;
  // Reporting Dimensions
  deliveryRegion?: string; salesCountry?: string; practice?: string;
  salesRegion?: string; deliveryManager?: string;
  // Project Team
  integrationConsultant?: string; projectManager?: string;
  integrationConsultantComplete?: string; projectManagerComplete?: string;
  deliverabilityConsultant?: string; technicalProgramManager?: string;
  deliverabilityConsultantComplete?: string; solutionArchitectPrimary?: string;
  solutionArchitectSecondary?: string; programManager?: string;
  // Recurring Details
  initialTerm?: string; churnOfTerms?: string; contractTermEndDate?: string;
  churnDateChargesCanceled?: string; isRenewal?: string;
  churnNotesBillingTicket?: string; renewalTerm?: string; churnReason?: string;
  outClause?: string; monthlyRecurringRevenue?: string; ofRenewalType?: string;
  churnRisk?: string; terminationClauseOptOutDate?: string;
  // Project Retrospective
  whatDidWeDoWell?: string; retroActionItems?: string;
  whatCouldHaveBeenDoneBetter?: string; retroParticipants?: string;
  dateOfRetrospective?: string; retroDelayReason?: string;
  // Project Admin
  surveyDoNotSend?: string; expertServicesProject?: string;
  surveyDoNotSendReason?: string; allowUnassignedTimeEntry?: string;
  surveyEligibleStakeholders?: string; selfAssignable?: string;
  daysBeforeSurvey?: string; surveyOptOuts?: string;
  // System Information
  createdBy?: string; resourcingMode?: string; recurringService?: string;
  lastModifiedBy?: string; calculatedStartDate?: string; calculatedEndDate?: string;
  weeklyTimeBasedAssignments?: string; projectTemplate?: string; clonedFrom?: string;
  lastSurveySentDate?: string; daysSinceLastTimeLogged?: string;
  segmentSideId?: string; segmentStatusCustom?: string;
  desiredStartDate?: string; desiredEndDate?: string;
}

export interface GoalSection {
  id: string;
  name: string;
  kind?: "project" | "goal";
  description?: string;
  url?: string;
  actionIds: string[];
  meetingIds: string[];
  goalIds: string[]; // for projects: IDs of nested goals
  resources: GoalResource[];
  sfData?: SalesforceProjectData;
  sfProjectId?: string;
}

// ── Account RBAC roles ────────────────────────────────────────────────────────

export type AccountRoleType = "sync_reviewer" | "account_owner";

export interface AccountRole {
  id: number;
  user: number;
  user_email: string;
  user_display: string;
  account: number;
  role: AccountRoleType;
  assigned_by: number | null;
  assigned_by_email: string | null;
  created_at: string;
}

// ── Side-panel routing type (previously inline in AccountDetailPage.tsx) ────────

export type PanelItem =
  | { kind: "action"; item: AirtableActionItem }
  | { kind: "meeting"; item: AirtableMeeting }
  | { kind: "member"; item: TeamMember }
  | { kind: "contact"; item: CustomerContact }
  | {
      kind: "calendar";
      item: CalendarEvent;
      linkedMeeting?: AirtableMeeting;
      reminders?: Reminder[];
      onAddReminder?: (due_at: string, title: string) => Promise<void>;
      onDismissReminder?: (id: number) => Promise<void>;
    };
