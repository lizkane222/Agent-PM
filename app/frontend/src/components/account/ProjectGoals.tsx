import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AccountTeamMember, AirtableActionItem, AirtableMeeting, GoalResource, GoalSection, ProjectMember, SalesforceProjectData } from "../../types";
import { accountsApi } from "../../lib/api";
import { ArtifactIconImg, CATALOG_BY_KEY, getAutoIconKey } from "./ArtifactIcon";
import { ActionItemCard } from "./ActionItemCard";

function uid() { return Math.random().toString(36).slice(2, 9); }

// ── SF section schema ─────────────────────────────────────────────────────────

type SFFieldType = "text" | "textarea" | "date" | "number" | "currency" | "percent" | "checkbox" | "url" | "picklist";
type SFField = {
  key: keyof SalesforceProjectData;
  label: string;
  fieldType: SFFieldType;
  options?: string[]; // for picklist
};
type SFSection = { label: string; fields: SFField[] };

const TRAFFIC_LIGHT = ["Green", "Yellow", "Red"];
const HEALTH_OPTIONS = [...TRAFFIC_LIGHT, "N/A"];

const SF_SECTIONS: SFSection[] = [
  { label: "Overview", fields: [
    { key: "projectStatus",        label: "Project Status",                    fieldType: "picklist", options: ["Active", "Closed", "On Hold", "Completed", "Cancelled"] },
    { key: "projectType",          label: "Project Type",                      fieldType: "picklist", options: ["Implementation", "Advisory", "Managed Services", "Training", "Other"] },
    { key: "externalProjectView",  label: "External Project View",             fieldType: "url" },
    { key: "projectSummary",       label: "Project Summary",                   fieldType: "textarea" },
    { key: "utilizationCategory",  label: "Utilization Category",              fieldType: "picklist", options: ["Billable", "Non-Billable", "Internal", "Investment"] },
    { key: "onHold",               label: "On Hold",                           fieldType: "checkbox" },
    { key: "psProjectOwner",       label: "PS Project Owner",                  fieldType: "text" },
    { key: "timeApprovedByPm",     label: "Time Approved by Project Manager",  fieldType: "checkbox" },
    { key: "twilioProducts",       label: "Twilio Products",                   fieldType: "text" },
    { key: "externalAccountId",    label: "External Account ID",               fieldType: "text" },
    { key: "projectUnits",         label: "Project Units",                     fieldType: "picklist", options: ["Hours", "Days", "Fixed"] },
    { key: "completionPctTasks",   label: "Completion % (Tasks)",              fieldType: "percent" },
    { key: "completionPctHours",   label: "Completion % (Hours)",              fieldType: "percent" },
    { key: "siPartnerName",        label: "SI Partner Name",                   fieldType: "text" },
    { key: "productPartnerName",   label: "Product Partner Name",              fieldType: "text" },
    { key: "engagementManager",    label: "Engagement Manager",                fieldType: "text" },
  ]},
  { label: "Work at Risk", fields: [
    { key: "workAtRiskApproved",   label: "Work at Risk Approved",             fieldType: "checkbox" },
    { key: "atRiskAmount",         label: "At Risk Amount",                    fieldType: "currency" },
    { key: "atRiskHours",          label: "At Risk Hours",                     fieldType: "number" },
    { key: "atRiskNotes",          label: "At Risk Notes",                     fieldType: "textarea" },
    { key: "atRiskStart",          label: "At Risk Start",                     fieldType: "date" },
    { key: "atRiskEnd",            label: "At Risk End",                       fieldType: "date" },
    { key: "contractSigned",       label: "Contract Signed",                   fieldType: "checkbox" },
  ]},
  { label: "Project Duration and Hours", fields: [
    { key: "startDate",                  label: "Project Start Date",                   fieldType: "date" },
    { key: "endDate",                    label: "Project End Date",                     fieldType: "date" },
    { key: "kickoffDate",                label: "Project Kick-off Date",                fieldType: "date" },
    { key: "enteredHours",               label: "Entered Hours",                        fieldType: "number" },
    { key: "estimatedHours",             label: "Estimated Hours",                      fieldType: "number" },
    { key: "totalHoursSold",             label: "Total Hours Sold",                     fieldType: "number" },
    { key: "scheduledHours",             label: "Scheduled Hours (by allocation)",      fieldType: "number" },
    { key: "remainingHours",             label: "Remaining Time (hrs)",                 fieldType: "number" },
    { key: "subconIncluded",             label: "Subcon Included",                      fieldType: "checkbox" },
    { key: "estimatedNbTime",            label: "Estimated NB Time (hrs)",              fieldType: "number" },
    { key: "subcontractingPartner",      label: "Subcontracting Partner",               fieldType: "text" },
    { key: "subconHoursTotal",           label: "Subcon Hours Total",                   fieldType: "number" },
    { key: "twilioProductEndCustomer",   label: "Twilio Product End Customer",          fieldType: "text" },
    { key: "subconHoursEntered",         label: "Subcon Hours Entered",                 fieldType: "number" },
  ]},
  { label: "Project Health", fields: [
    { key: "projectStage",         label: "Project Stage",           fieldType: "picklist", options: ["Discovery", "Design", "Build", "Test", "Go Live", "Hypercare", "Closed"] },
    { key: "plannedGoLiveDate",    label: "Planned Go Live Date",    fieldType: "date" },
    { key: "health",               label: "Health (Traffic Light)",  fieldType: "picklist", options: HEALTH_OPTIONS },
    { key: "plannedGoLiveNotes",   label: "Planned Go Live Notes",   fieldType: "textarea" },
    { key: "healthReason",         label: "Health Reason",           fieldType: "text" },
    { key: "onHoldStart",          label: "On Hold Start",           fieldType: "date" },
    { key: "pathToGreen",          label: "Path to Green",           fieldType: "textarea" },
    { key: "onHoldEnd",            label: "On Hold End",             fieldType: "date" },
    { key: "daysOnHold",           label: "Days on Hold",            fieldType: "number" },
  ]},
  { label: "Status Summary", fields: [
    { key: "statusSummary",            label: "Status Summary",                   fieldType: "textarea" },
    { key: "projectHealthStatus",      label: "Project Health Status",            fieldType: "picklist", options: HEALTH_OPTIONS },
    { key: "statusSummaryLastChange",  label: "Status Summary Last Change Date",  fieldType: "date" },
    { key: "issuesRisks",              label: "Issues & Risks",                   fieldType: "textarea" },
    { key: "requestSalesFollowUp",     label: "Request Sales Follow Up",          fieldType: "checkbox" },
    { key: "salesFollowUpNotes",       label: "Sales Follow Up Notes",            fieldType: "textarea" },
  ]},
  { label: "Project Health Scorecard", fields: [
    { key: "scopeHealthLight",      label: "Scope Health (Traffic Light)",      fieldType: "picklist", options: HEALTH_OPTIONS },
    { key: "scopeHealth",           label: "Scope Health",                      fieldType: "picklist", options: HEALTH_OPTIONS },
    { key: "scheduleHealthLight",   label: "Schedule Health (Traffic Light)",   fieldType: "picklist", options: HEALTH_OPTIONS },
    { key: "scopeHealthReason",     label: "Scope Health Reason",               fieldType: "text" },
    { key: "budgetHealthLight",     label: "Budget Health (Traffic Light)",     fieldType: "picklist", options: HEALTH_OPTIONS },
    { key: "scheduleHealth",        label: "Schedule Health",                   fieldType: "picklist", options: HEALTH_OPTIONS },
    { key: "scheduleHealthReason",  label: "Schedule Health Reason",            fieldType: "text" },
    { key: "budgetHealth",          label: "Budget Health",                     fieldType: "picklist", options: HEALTH_OPTIONS },
    { key: "budgetHealthReason",    label: "Budget Health Reason",              fieldType: "text" },
  ]},
  { label: "Launch Fields", fields: [
    { key: "aeLaunchDate",                  label: "AE Launch Date",                       fieldType: "date" },
    { key: "customerLaunchDate",            label: "Customer Launch Date",                 fieldType: "date" },
    { key: "mst",                           label: "MST",                                  fieldType: "checkbox" },
    { key: "projectedMstDate",              label: "Projected MST Date",                   fieldType: "date" },
    { key: "mstDate",                       label: "MST Date",                             fieldType: "date" },
    { key: "launchDelayReason",             label: "Launch Delay Reason",                  fieldType: "picklist", options: ["Customer Readiness", "Technical Issues", "Resource Availability", "Scope Change", "Other"] },
    { key: "daysToMst",                     label: "Days to MST",                          fieldType: "number" },
    { key: "secondaryLaunchDelayReasons",   label: "Secondary Launch Delay Reasons",       fieldType: "textarea" },
  ]},
  { label: "Project Financials", fields: [
    { key: "billingType",                   label: "Billing Type",                             fieldType: "picklist", options: ["Fixed Fee", "T&M", "Milestone", "Subscription"] },
    { key: "revRecType",                    label: "Rev Rec Type",                             fieldType: "picklist", options: ["Milestone", "Percentage Completion", "As Delivered"] },
    { key: "projectBudget",                 label: "Project Budget",                           fieldType: "currency" },
    { key: "currentMargin",                 label: "Current Margin",                           fieldType: "currency" },
    { key: "reimbursableExpenseBudget",     label: "Reimbursable Expense Budget",              fieldType: "currency" },
    { key: "currentMarginPct",              label: "Current Margin %",                         fieldType: "percent" },
    { key: "goodwillAmount",                label: "Goodwill Amount",                          fieldType: "currency" },
    { key: "totalCompletedMilestone",       label: "Total Completed Milestone Amount",         fieldType: "currency" },
    { key: "subconBudget",                  label: "Subcon Budget",                            fieldType: "currency" },
    { key: "totalReimbursableMilestone",    label: "Total Reimbursable Milestone Amount",      fieldType: "currency" },
    { key: "asSoldMargin",                  label: "As Sold Margin (ASM)",                     fieldType: "currency" },
    { key: "totalRemainingReimbursable",    label: "Total Remaining Reimbursable Expense Bgt", fieldType: "currency" },
    { key: "totalProjectMilestone",         label: "Total Project Milestone Amount",           fieldType: "currency" },
    { key: "calculatedCost",               label: "Calculated Cost",                           fieldType: "currency" },
    { key: "totalForecastCost",             label: "Total Forecast Cost (Allocated Cost)",     fieldType: "currency" },
    { key: "calculatedRate",               label: "Calculated Rate",                           fieldType: "currency" },
  ]},
  { label: "Opportunity Information", fields: [
    { key: "salesAmount",               label: "Sales Amount",               fieldType: "currency" },
    { key: "opportunityOwner",          label: "Opportunity Owner",          fieldType: "text" },
    { key: "changeRequestAmount",       label: "Change Request Amount",      fieldType: "currency" },
    { key: "accountOwner",              label: "Account Owner",              fieldType: "text" },
    { key: "primaryProduct",            label: "Primary Product",            fieldType: "text" },
    { key: "sfAccount",                 label: "Account",                    fieldType: "text" },
    { key: "opportunityEarr",           label: "Opportunity eARR",           fieldType: "currency" },
    { key: "cyCommsTerritory",          label: "CY Comms Territory",         fieldType: "text" },
    { key: "linkToSegmentContract",     label: "Link to Segment Contract",   fieldType: "url" },
    { key: "opportunityServices",       label: "Opportunity (Services)",     fieldType: "text" },
    { key: "segmentCsm",                label: "Segment CSM",                fieldType: "text" },
    { key: "opportunityProduct",        label: "Opportunity (Product)",      fieldType: "text" },
    { key: "changeRequestOpportunity",  label: "Change Request Opportunity", fieldType: "text" },
    { key: "currentSegmentCsmPlan",     label: "Current Segment CSM Plan",   fieldType: "text" },
    { key: "rateCard",                  label: "Rate Card",                  fieldType: "picklist", options: ["Standard", "Enterprise", "Partner", "Custom"] },
  ]},
  { label: "Reporting Dimensions", fields: [
    { key: "deliveryRegion",    label: "Delivery Region",    fieldType: "picklist", options: ["Americas", "EMEA", "APAC", "LATAM"] },
    { key: "salesCountry",      label: "Sales Country",      fieldType: "text" },
    { key: "practice",          label: "Practice",           fieldType: "picklist", options: ["CX", "Data & AI", "Digital Engagement", "Security", "Other"] },
    { key: "salesRegion",       label: "Sales Region",       fieldType: "picklist", options: ["North America", "EMEA", "APAC", "LATAM"] },
    { key: "deliveryManager",   label: "Delivery Manager",   fieldType: "text" },
  ]},
  { label: "Project Team", fields: [
    { key: "integrationConsultant",           label: "Integration Consultant",           fieldType: "text" },
    { key: "projectManager",                  label: "Project Manager",                  fieldType: "text" },
    { key: "integrationConsultantComplete",   label: "Integration Consultant Complete",  fieldType: "checkbox" },
    { key: "projectManagerComplete",          label: "Project Manager Complete",         fieldType: "checkbox" },
    { key: "deliverabilityConsultant",        label: "Deliverability Consultant",        fieldType: "text" },
    { key: "technicalProgramManager",         label: "Technical Program Manager",        fieldType: "text" },
    { key: "deliverabilityConsultantComplete", label: "Deliverability Consultant Complete", fieldType: "checkbox" },
    { key: "solutionArchitectPrimary",        label: "Solution Architect (Primary)",     fieldType: "text" },
    { key: "solutionArchitectSecondary",      label: "Solution Architect (Secondary)",   fieldType: "text" },
    { key: "programManager",                  label: "Program Manager",                  fieldType: "text" },
  ]},
  { label: "Recurring Details", fields: [
    { key: "initialTerm",                  label: "Initial Term",                         fieldType: "text" },
    { key: "churnOfTerms",                 label: "Churn - OF Terms",                     fieldType: "number" },
    { key: "contractTermEndDate",          label: "Contract Term End Date",               fieldType: "date" },
    { key: "churnDateChargesCanceled",     label: "Churn Date - Charges Canceled",        fieldType: "date" },
    { key: "isRenewal",                    label: "Is Renewal",                           fieldType: "checkbox" },
    { key: "churnNotesBillingTicket",      label: "Churn Notes & Billing Ticket",         fieldType: "textarea" },
    { key: "renewalTerm",                  label: "Renewal Term",                         fieldType: "text" },
    { key: "churnReason",                  label: "Churn Reason",                         fieldType: "picklist", options: ["Budget", "Product Fit", "Competitor", "Acquisition", "Other"] },
    { key: "outClause",                    label: "Out Clause",                           fieldType: "text" },
    { key: "monthlyRecurringRevenue",      label: "Monthly Recurring Revenue (MRR)",      fieldType: "currency" },
    { key: "ofRenewalType",                label: "OF Renewal Type",                      fieldType: "picklist", options: ["Auto-Renew", "Manual", "Non-Renewable"] },
    { key: "churnRisk",                    label: "Churn Risk",                           fieldType: "picklist", options: ["High", "Medium", "Low", "None"] },
    { key: "terminationClauseOptOutDate",  label: "Termination Clause Opt Out Date",      fieldType: "date" },
  ]},
  { label: "Project Retrospective", fields: [
    { key: "whatDidWeDoWell",              label: "What did we do well?",              fieldType: "textarea" },
    { key: "retroActionItems",             label: "Action Items",                      fieldType: "textarea" },
    { key: "whatCouldHaveBeenDoneBetter",  label: "What could have been done better?", fieldType: "textarea" },
    { key: "retroParticipants",            label: "Participants",                      fieldType: "textarea" },
    { key: "dateOfRetrospective",          label: "Date of Retrospective",             fieldType: "date" },
    { key: "retroDelayReason",             label: "Delay Reason",                      fieldType: "text" },
  ]},
  { label: "Project Admin", fields: [
    { key: "surveyDoNotSend",              label: "Survey: Do not send",                       fieldType: "checkbox" },
    { key: "expertServicesProject",        label: "Expert Services Project",                   fieldType: "checkbox" },
    { key: "surveyDoNotSendReason",        label: "Survey: Do not send - Reason",              fieldType: "text" },
    { key: "allowUnassignedTimeEntry",     label: "Allow Un-Assigned Time Entry",              fieldType: "checkbox" },
    { key: "surveyEligibleStakeholders",   label: "# of Survey Eligible Stakeholders",         fieldType: "number" },
    { key: "selfAssignable",               label: "Self Assignable",                           fieldType: "checkbox" },
    { key: "daysBeforeSurvey",             label: "Days before Survey Sent/Proj Start Date",   fieldType: "number" },
    { key: "surveyOptOuts",                label: "# of Survey Opt Outs",                      fieldType: "number" },
  ]},
  { label: "System Information", fields: [
    { key: "createdBy",                 label: "Created By",                       fieldType: "text" },
    { key: "resourcingMode",             label: "Resourcing Mode",                  fieldType: "picklist", options: ["Time Based", "Unit Based"] },
    { key: "recurringService",           label: "Recurring Service",                fieldType: "checkbox" },
    { key: "lastModifiedBy",             label: "Last Modified By",                 fieldType: "text" },
    { key: "calculatedStartDate",        label: "Calculated Start Date",            fieldType: "date" },
    { key: "calculatedEndDate",          label: "Calculated End Date",              fieldType: "date" },
    { key: "weeklyTimeBasedAssignments", label: "Weekly Time Based Assignments",    fieldType: "checkbox" },
    { key: "projectTemplate",            label: "Project Template",                 fieldType: "checkbox" },
    { key: "clonedFrom",                 label: "Cloned From",                      fieldType: "text" },
    { key: "lastSurveySentDate",         label: "Last Survey Sent Date",            fieldType: "date" },
    { key: "daysSinceLastTimeLogged",    label: "Days Since Last Time Logged",      fieldType: "number" },
    { key: "segmentSideId",              label: "Segment Side Id",                  fieldType: "text" },
    { key: "segmentStatusCustom",        label: "Segment Status Custom",            fieldType: "text" },
    { key: "desiredStartDate",           label: "Desired Start Date",               fieldType: "date" },
    { key: "desiredEndDate",             label: "Desired End Date",                 fieldType: "date" },
  ]},
];

// All fields flattened for search
const ALL_FIELDS: (SFField & { sectionLabel: string })[] = SF_SECTIONS.flatMap((s) =>
  s.fields.map((f) => ({ ...f, sectionLabel: s.label }))
);

// ── Project-level aggregate views ───────────────────────────────────────────────
// A project's "Goals" tab shows its nested-goals tree (the default). The other tabs
// flatten every action item / artifact across the project *and* all of its goals into
// one searchable list, grouped by status for action items.

type ClusterView = "tree" | "artifacts" | "open" | "pending" | "closed" | "blocked";

const CLUSTER_VIEW_TABS: { key: ClusterView; label: string }[] = [
  { key: "tree", label: "Goals" },
  { key: "artifacts", label: "Artifacts" },
  { key: "open", label: "Open" },
  { key: "pending", label: "Pending" },
  { key: "closed", label: "Closed" },
  { key: "blocked", label: "Blocked/Backlogged" },
];

// Open → Open, In Progress → Pending, Done → Closed, Blocked/Backlogged → their own
// bucket (they don't read as "pending" or "closed"). Any other/unknown status has no
// bucket, so it simply doesn't appear in a status tab — still visible in the tree view.
function statusBucket(status: string): ClusterView | null {
  switch (status) {
    case "Open": return "open";
    case "In Progress": return "pending";
    case "Done": return "closed";
    case "Blocked":
    case "Backlogged": return "blocked";
    default: return null;
  }
}

type ClusterActionEntry = { kind: "action"; ownerId: string; ownerName: string; item: AirtableActionItem };
type ClusterResourceEntry = { kind: "resource"; ownerId: string; ownerName: string; resource: GoalResource };
type ClusterEntry = ClusterActionEntry | ClusterResourceEntry;

// ── Health dot ─────────────────────────────────────────────────────────────────

function HealthDot({ value }: { value?: string }) {
  if (!value) return null;
  const v = value.toLowerCase();
  const color = v === "green" ? "#16a34a" : v === "yellow" || v === "amber" ? "#d97706" : v === "red" ? "#dc2626" : "#9ca3af";
  return (
    <span title={value} style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0, marginTop: 1 }} />
  );
}

// ── Project Details Modal ─────────────────────────────────────────────────────

function ProjectDetailsModal({
  goal,
  members,
  accountTeamMembers,
  onClose,
  onSave,
  onAddMember,
  onRemoveMember,
}: {
  goal: GoalSection;
  members: ProjectMember[];
  accountTeamMembers: AccountTeamMember[];
  onClose: () => void;
  onSave: (updated: Partial<GoalSection>) => void;
  onAddMember?: (teamMemberId: number) => void;
  onRemoveMember?: (projectMemberId: number) => void;
}) {
  const [name, setName] = useState(goal.name);
  const [url, setUrl] = useState(goal.url ?? "");
  const [sfData, setSfData] = useState<SalesforceProjectData>(goal.sfData ?? {});
  const [sfProjectId, setSfProjectId] = useState(goal.sfProjectId ?? "");
  const [sfFetchState, setSfFetchState] = useState<"idle" | "loading" | "error">("idle");
  const [sfFieldsSkipped, setSfFieldsSkipped] = useState<string[] | null>(null);
  const [search, setSearch] = useState("");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fieldRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [addingMember, setAddingMember] = useState(false);

  // A brand-new project only exists as an in-memory draft (see `newGoalDraft` in
  // ProjectGoals) until Save is clicked — there's no id to attach members to yet.
  const isSaved = !Number.isNaN(Number(goal.id));

  async function handleFetchFromSalesforce() {
    if (!sfProjectId.trim()) return;
    setSfFetchState("loading");
    setSfFieldsSkipped(null);
    try {
      const { data } = await accountsApi.fetchProjectSalesforceData(sfProjectId.trim());
      // Manual edits win — only fill fields the user hasn't already typed into.
      setSfData((prev) => ({ ...data.sf_data, ...prev }));
      if (!name.trim() && data.name) setName(data.name);
      setSfFieldsSkipped(data.fields_skipped);
      setSfFetchState("idle");
    } catch {
      setSfFetchState("error");
    }
  }

  function toggleSection(label: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  }

  // Search: expand + highlight matching fields
  useEffect(() => {
    if (!search.trim()) return;
    const q = search.toLowerCase();
    const matchedSections = new Set<string>();
    let firstKey: string | null = null;
    ALL_FIELDS.forEach((f) => {
      if (f.label.toLowerCase().includes(q)) {
        matchedSections.add(f.sectionLabel);
        if (!firstKey) firstKey = f.key;
      }
    });
    setExpandedSections((prev) => new Set([...prev, ...matchedSections]));
    if (firstKey) {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      setHighlightKey(firstKey);
      // scroll to first match after DOM update
      setTimeout(() => { fieldRefs.current[firstKey!]?.scrollIntoView({ behavior: "smooth", block: "center" }); }, 60);
      highlightTimer.current = setTimeout(() => setHighlightKey(null), 3000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => () => { if (highlightTimer.current) clearTimeout(highlightTimer.current); }, []);

  // Close on Escape
  useEffect(() => {
    function handler(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  function handleSave() {
    onSave({ name: name.trim() || goal.name, url: url.trim(), sfData, sfProjectId: sfProjectId.trim() });
    onClose();
  }

  const searchQ = search.toLowerCase().trim();

  function isFieldMatch(f: SFField) {
    return !!searchQ && f.label.toLowerCase().includes(searchQ);
  }

  // Populated fields (non-null across all SF fields)
  const populatedFields = ALL_FIELDS.filter((f) => {
    const v = sfData[f.key];
    return v !== undefined && v !== null && v !== "";
  });

  function renderFieldInput(f: SFField) {
    const val = sfData[f.key] ?? "";
    const inputStyle: React.CSSProperties = {
      fontSize: "0.8125rem",
      border: "1px solid rgba(0,0,0,0.1)",
      borderRadius: 5,
      padding: "3px 8px",
      color: "var(--twilio-navy)",
      outline: "none",
      background: "#fafafa",
      width: "100%",
      boxSizing: "border-box",
    };
    const set = (v: string) => setSfData((d) => ({ ...d, [f.key]: v }));

    switch (f.fieldType) {
      case "textarea":
        return (
          <textarea
            value={val}
            onChange={(e) => set(e.target.value)}
            rows={3}
            style={{ ...inputStyle, padding: "4px 8px", resize: "vertical", lineHeight: 1.5 }}
          />
        );
      case "checkbox": {
        const checked = val === "true";
        return (
          <div style={{ display: "flex", alignItems: "center", height: 26 }}>
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => set(e.target.checked ? "true" : "false")}
              style={{ width: 15, height: 15, cursor: "pointer", accentColor: "var(--twilio-red,#e22)" }}
            />
          </div>
        );
      }
      case "date":
        return (
          <input
            type="date"
            value={val}
            onChange={(e) => set(e.target.value)}
            style={inputStyle}
          />
        );
      case "number":
        return (
          <input
            type="number"
            value={val}
            onChange={(e) => set(e.target.value)}
            style={inputStyle}
          />
        );
      case "currency":
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
            <span style={{ fontSize: "0.8125rem", color: "#6b7280", padding: "3px 6px 3px 8px", background: "#f3f4f6", border: "1px solid rgba(0,0,0,0.1)", borderRight: "none", borderRadius: "5px 0 0 5px", lineHeight: "1.6", flexShrink: 0 }}>$</span>
            <input
              type="number"
              value={val}
              onChange={(e) => set(e.target.value)}
              style={{ ...inputStyle, borderRadius: "0 5px 5px 0" }}
            />
          </div>
        );
      case "percent":
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
            <input
              type="number"
              min={0}
              max={100}
              value={val}
              onChange={(e) => set(e.target.value)}
              style={{ ...inputStyle, borderRadius: "5px 0 0 5px" }}
            />
            <span style={{ fontSize: "0.8125rem", color: "#6b7280", padding: "3px 8px 3px 6px", background: "#f3f4f6", border: "1px solid rgba(0,0,0,0.1)", borderLeft: "none", borderRadius: "0 5px 5px 0", lineHeight: "1.6", flexShrink: 0 }}>%</span>
          </div>
        );
      case "url":
        return (
          <input
            type="url"
            value={val}
            onChange={(e) => set(e.target.value)}
            placeholder="https://…"
            style={inputStyle}
          />
        );
      case "picklist":
        return (
          <select
            value={val}
            onChange={(e) => set(e.target.value)}
            style={{ ...inputStyle, cursor: "pointer" }}
          >
            <option value="">— select —</option>
            {(f.options ?? []).map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        );
      default:
        return (
          <input
            type="text"
            value={val}
            onChange={(e) => set(e.target.value)}
            style={inputStyle}
          />
        );
    }
  }

  function renderFieldRow(f: SFField, highlighted: boolean) {
    const isTopAligned = f.fieldType === "textarea";
    const isCheckbox = f.fieldType === "checkbox";
    return (
      <div
        key={f.key}
        ref={(el) => { fieldRefs.current[f.key] = el; }}
        style={{
          display: "grid",
          gridTemplateColumns: isCheckbox ? "1fr auto" : "180px 1fr",
          gap: "6px",
          alignItems: isTopAligned ? "flex-start" : "center",
          padding: "5px 12px",
          borderRadius: 6,
          transition: "box-shadow 0.2s, border 0.2s",
          border: highlighted ? "1.5px solid #6366f1" : "1.5px solid transparent",
          boxShadow: highlighted ? "0 0 0 3px rgba(99,102,241,0.12)" : "none",
          background: highlighted ? "rgba(99,102,241,0.03)" : "transparent",
        }}
      >
        <label style={{ fontSize: "0.6875rem", color: "#6b7280", fontWeight: 500, paddingTop: isTopAligned ? 3 : 0, cursor: isCheckbox ? "pointer" : undefined }}>
          {f.label}
        </label>
        {renderFieldInput(f)}
      </div>
    );
  }

  return (
    <div
      data-testid="project-details-modal"
      style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.35)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "#fff", borderRadius: 12, width: "min(700px,94vw)", maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.18)" }}>
        {/* Modal header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px 10px", borderBottom: "1px solid rgba(0,0,0,0.07)", flexShrink: 0 }}>
          <div style={{ flex: 1, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 200px", minWidth: 0 }}>
              <label style={{ fontSize: "0.625rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#6b7280" }}>
                Project Name <span style={{ color: "#e22" }}>*</span>
              </label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--twilio-navy)", border: "none", borderBottom: "2px solid var(--twilio-red,#e22)", outline: "none", background: "transparent", padding: "2px 0" }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 160px", minWidth: 0 }}>
              <label style={{ fontSize: "0.625rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#6b7280" }}>
                Project URL <span style={{ color: "#e22" }}>*</span>
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                style={{ fontSize: "0.8125rem", color: "var(--twilio-navy)", border: "none", borderBottom: "2px solid #c7d2fe", outline: "none", background: "transparent", padding: "2px 0" }}
              />
            </div>
          </div>
          <button onClick={onClose} style={{ fontSize: 18, color: "#9ca3af", background: "none", border: "none", cursor: "pointer", padding: "0 4px", lineHeight: 1 }}>✕</button>
        </div>

        {/* Salesforce fetch row */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, padding: "0 16px 10px", flexShrink: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 200px", minWidth: 0 }}>
            <label style={{ fontSize: "0.625rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#6b7280" }}>
              Salesforce Project ID
            </label>
            <input
              value={sfProjectId}
              onChange={(e) => setSfProjectId(e.target.value)}
              placeholder="a0B…"
              style={{ fontSize: "0.8125rem", color: "var(--twilio-navy)", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 5, outline: "none", background: "#fafafa", padding: "4px 8px" }}
            />
          </div>
          <button
            onClick={handleFetchFromSalesforce}
            disabled={!sfProjectId.trim() || sfFetchState === "loading"}
            title="Fetch the remaining fields from Salesforce"
            style={{
              fontSize: "0.75rem", fontWeight: 600, padding: "6px 12px", borderRadius: 6, whiteSpace: "nowrap",
              border: "1px solid var(--twilio-red,#e22)", background: "transparent", color: "var(--twilio-red,#e22)",
              cursor: sfProjectId.trim() && sfFetchState !== "loading" ? "pointer" : "not-allowed",
              opacity: sfProjectId.trim() ? 1 : 0.5,
            }}
          >
            {sfFetchState === "loading" ? "Fetching…" : "Fetch from Salesforce"}
          </button>
        </div>
        {sfFetchState === "error" && (
          <div style={{ padding: "0 16px 8px", fontSize: "0.75rem", color: "#dc2626", flexShrink: 0 }}>
            Could not fetch from Salesforce. Check the project ID and your connection.
          </div>
        )}
        {sfFieldsSkipped && sfFieldsSkipped.length > 0 && (
          <div style={{ padding: "0 16px 8px", fontSize: "0.75rem", color: "#9ca3af", flexShrink: 0 }}>
            {sfFieldsSkipped.length} field{sfFieldsSkipped.length === 1 ? "" : "s"} not found on the connected org and left as-is.
          </div>
        )}

        {/* Team Members */}
        <div style={{ padding: "0 16px 8px", flexShrink: 0 }}>
          <button
            onClick={() => toggleSection("__members__")}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", background: "#f8f8fb", border: "none", cursor: "pointer", borderRadius: 7 }}
          >
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{ width: 10, height: 10, color: "#9ca3af", flexShrink: 0, transition: "transform 0.15s", transform: expandedSections.has("__members__") ? "rotate(90deg)" : "rotate(0deg)" }}>
              <path d="M4 2l4 4-4 4"/>
            </svg>
            <span style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--twilio-navy)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Team Members {members.length > 0 ? `(${members.length})` : ""}
            </span>
          </button>
          {expandedSections.has("__members__") && (
            <div style={{ padding: "8px 12px 4px", display: "flex", flexDirection: "column", gap: 6 }}>
              {!isSaved ? (
                <p style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Save the project first to add team members.</p>
              ) : (
                <>
                  {members.map((m) => (
                    <div key={m.id} className="group" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.8125rem" }}>
                      <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#ede9fe", color: "#6366f1", fontSize: "0.625rem", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {m.team_member_name.slice(0, 1).toUpperCase()}
                      </span>
                      <span style={{ color: "var(--twilio-navy)", flex: 1 }}>{m.team_member_name}{m.role ? ` — ${m.role}` : ""}</span>
                      {onRemoveMember && (
                        <button onClick={() => onRemoveMember(m.id)} style={{ color: "#9ca3af", background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>✕</button>
                      )}
                    </div>
                  ))}
                  {members.length === 0 && <p style={{ fontSize: "0.75rem", color: "#9ca3af" }}>No team members yet.</p>}
                  {addingMember ? (
                    <select
                      autoFocus
                      defaultValue=""
                      onChange={(e) => {
                        const id = Number(e.target.value);
                        if (id && onAddMember) onAddMember(id);
                        setAddingMember(false);
                      }}
                      onBlur={() => setAddingMember(false)}
                      style={{ fontSize: "0.8125rem", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 5, padding: "3px 8px" }}
                    >
                      <option value="" disabled>Choose a team member…</option>
                      {accountTeamMembers
                        .filter((tm) => !members.some((m) => m.team_member === tm.id))
                        .map((tm) => (
                          <option key={tm.id} value={tm.id}>{tm.full_name}</option>
                        ))}
                    </select>
                  ) : (
                    <button onClick={() => setAddingMember(true)} style={{ fontSize: "0.75rem", color: "#6366f1", background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}>
                      + Add team member
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Search bar */}
        <div style={{ padding: "10px 16px 8px", borderBottom: "1px solid rgba(0,0,0,0.05)", flexShrink: 0 }}>
          <div style={{ position: "relative" }}>
            <svg viewBox="0 0 16 16" fill="none" stroke="#9ca3af" strokeWidth="1.5" style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, pointerEvents: "none" }}>
              <circle cx="6" cy="6" r="4.5"/><path d="M10 10l3 3" strokeLinecap="round"/>
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search fields…"
              style={{ width: "100%", paddingLeft: 28, paddingRight: 10, paddingTop: 6, paddingBottom: 6, fontSize: "0.8125rem", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 7, outline: "none", boxSizing: "border-box", background: "#f9fafb", color: "var(--twilio-navy)" }}
            />
            {search && (
              <button onClick={() => setSearch("")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 14, lineHeight: 1 }}>✕</button>
            )}
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 4px 12px" }}>

          {/* Populated fields section */}
          {populatedFields.length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <button
                onClick={() => toggleSection("__populated__")}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", background: "#f0fdf4", border: "none", cursor: "pointer", borderRadius: 7, marginBottom: 2 }}
              >
                <svg viewBox="0 0 12 12" fill="currentColor" style={{ width: 10, height: 10, color: "#16a34a", transition: "transform 0.15s", transform: expandedSections.has("__populated__") ? "rotate(90deg)" : "rotate(0deg)" }}>
                  <path d="M4 2l4 4-4 4"/>
                </svg>
                <span style={{ fontSize: "0.6875rem", fontWeight: 700, color: "#16a34a", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Populated Fields ({populatedFields.length})
                </span>
              </button>
              {expandedSections.has("__populated__") && (
                <div style={{ paddingTop: 2 }}>
                  {populatedFields.map((f) => renderFieldRow(f, highlightKey === f.key))}
                </div>
              )}
            </div>
          )}

          {/* SF sections */}
          {SF_SECTIONS.map((section) => {
            const visibleFields = searchQ
              ? section.fields.filter((f) => isFieldMatch(f))
              : section.fields;
            if (searchQ && visibleFields.length === 0) return null;
            const isOpen = expandedSections.has(section.label);
            return (
              <div key={section.label} style={{ marginBottom: 2 }}>
                <button
                  onClick={() => toggleSection(section.label)}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", background: isOpen ? "#f8f8fb" : "transparent", border: "none", cursor: "pointer", borderRadius: 7, marginBottom: 1 }}
                >
                  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{ width: 10, height: 10, color: "#9ca3af", flexShrink: 0, transition: "transform 0.15s", transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}>
                    <path d="M4 2l4 4-4 4"/>
                  </svg>
                  <span style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--twilio-navy)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {section.label}
                  </span>
                  {!isOpen && section.fields.some((f) => sfData[f.key]) && (
                    <span style={{ marginLeft: "auto", width: 6, height: 6, borderRadius: "50%", background: "#6366f1", flexShrink: 0 }} title="Has data" />
                  )}
                </button>
                {isOpen && (
                  <div style={{ paddingBottom: 6 }}>
                    {(searchQ ? visibleFields : section.fields).map((f) =>
                      renderFieldRow(f, highlightKey === f.key || isFieldMatch(f))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "10px 16px", borderTop: "1px solid rgba(0,0,0,0.07)", flexShrink: 0 }}>
          <button onClick={onClose} style={{ fontSize: "0.8125rem", padding: "6px 16px", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 7, cursor: "pointer", background: "transparent", color: "#6b7280" }}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            style={{ fontSize: "0.8125rem", fontWeight: 600, padding: "6px 20px", border: "none", borderRadius: 7, cursor: name.trim() ? "pointer" : "not-allowed", background: "var(--twilio-red,#e22)", color: "#fff", opacity: name.trim() ? 1 : 0.5 }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ProjectGoals ──────────────────────────────────────────────────────────────

export function ProjectGoals({
  goals,
  actionItems,
  meetings,
  onChange,
  onSelectAction,
  onNoteDropped,
  accountTeamMembers = [],
  projectMembers = [],
  onAddProjectMember,
  onRemoveProjectMember,
}: {
  goals: GoalSection[];
  actionItems: AirtableActionItem[];
  meetings: AirtableMeeting[];
  onChange: (g: GoalSection[]) => void;
  onSelectAction?: (i: AirtableActionItem) => void;
  onNoteDropped?: (noteText: string, goalId: string) => void;
  /** The account's own roster — the pool a project's Team Members are picked from. */
  accountTeamMembers?: AccountTeamMember[];
  /** Every ProjectMember for every project on this account (filtered per-card by project id). */
  projectMembers?: ProjectMember[];
  onAddProjectMember?: (projectId: number, teamMemberId: number) => void;
  onRemoveProjectMember?: (projectMemberId: number) => void;
}) {
  const [itemDropTarget, setItemDropTarget] = useState<string | null>(null);
  const [goalDropTarget, setGoalDropTarget] = useState<string | null>(null); // project accepting a dragged goal
  const [newGoalDraft, setNewGoalDraft] = useState<GoalSection | null>(null);
  const [modalGoalId, setModalGoalId] = useState<string | null>(null);
  const [expandedGoals, setExpandedGoals] = useState<Set<string>>(new Set());
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [newResourceTarget, setNewResourceTarget] = useState<string | null>(null);
  const [resourceForm, setResourceForm] = useState({ label: "", url: "" });
  // Per-project aggregate view (across all of a project's goals) — keyed by project id
  // since renderProjectCard is a plain function called from a .map, not a component.
  const [clusterViewByProject, setClusterViewByProject] = useState<Record<string, ClusterView>>({});
  const [clusterSearchByProject, setClusterSearchByProject] = useState<Record<string, string>>({});

  const actionMap = Object.fromEntries(actionItems.map((a) => [a.airtable_id, a]));
  const meetingMap = Object.fromEntries(meetings.map((m) => [m.airtable_id, m]));

  const modalGoal = newGoalDraft ?? (modalGoalId ? goals.find((g) => g.id === modalGoalId) ?? null : null);

  // Derived hierarchy
  const projects = goals.filter((g) => g.kind === "project");
  const assignedGoalIds = new Set(projects.flatMap((p) => p.goalIds ?? []));
  const standaloneGoals = goals.filter((g) => g.kind !== "project" && !assignedGoalIds.has(g.id));

  // ── Mutations ──────────────────────────────────────────────────────────────

  function removeGoal(id: string) { onChange(goals.filter((g) => g.id !== id)); }

  function updateGoalName(id: string, name: string) {
    onChange(goals.map((g) => g.id === id ? { ...g, name } : g));
  }

  // Assign a goal to a project; removes it from any previous project (single-parent rule)
  function assignGoalToProject(projectId: string, goalId: string) {
    onChange(goals.map((g) => {
      if (g.id === projectId) {
        const already = (g.goalIds ?? []).includes(goalId);
        return already ? g : { ...g, goalIds: [...(g.goalIds ?? []), goalId] };
      }
      // Remove from all other projects
      if (g.kind === "project" && (g.goalIds ?? []).includes(goalId)) {
        return { ...g, goalIds: (g.goalIds ?? []).filter((id) => id !== goalId) };
      }
      return g;
    }));
  }

  function unassignGoal(projectId: string, goalId: string) {
    onChange(goals.map((g) => g.id === projectId ? { ...g, goalIds: (g.goalIds ?? []).filter((x) => x !== goalId) } : g));
  }

  function removeAction(goalId: string, aid: string) {
    onChange(goals.map((g) => g.id === goalId ? { ...g, actionIds: g.actionIds.filter((x) => x !== aid) } : g));
  }
  function removeMeeting(goalId: string, mid: string) {
    onChange(goals.map((g) => g.id === goalId ? { ...g, meetingIds: g.meetingIds.filter((x) => x !== mid) } : g));
  }
  function removeResource(goalId: string, rid: string) {
    onChange(goals.map((g) => g.id === goalId ? { ...g, resources: g.resources.filter((r) => r.id !== rid) } : g));
  }
  function addResource(targetId: string) {
    if (!resourceForm.label.trim()) return;
    onChange(goals.map((g) => g.id === targetId
      ? { ...g, resources: [...g.resources, { id: uid(), label: resourceForm.label.trim(), url: resourceForm.url.trim() }] }
      : g));
    setResourceForm({ label: "", url: "" });
    setNewResourceTarget(null);
  }

  // Drop items (action items, meetings, artifacts, notes) onto a card
  // Action items, meetings and artifacts have exactly one owning project/goal at a time —
  // the same single-parent rule assignGoalToProject already applies to goal→project. A drop
  // therefore MOVES the item: it's stripped from every other goal/project before being added
  // to the target, so dragging a card from a project onto one of its goals (or vice versa, or
  // across two unrelated projects) can't leave it displayed in two places at once.
  function handleItemDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    setItemDropTarget(null);
    const actionId = e.dataTransfer.getData("goalActionId");
    const meetingId = e.dataTransfer.getData("goalMeetingId");
    const noteText = e.dataTransfer.getData("noteText");
    const artifactRaw = e.dataTransfer.getData("artifactDrop");
    if (noteText && onNoteDropped) { onNoteDropped(noteText, targetId); return; }
    if (artifactRaw) {
      try {
        const art = JSON.parse(artifactRaw) as { id: number; name: string; url: string; iconKey?: string };
        const resourceId = `artifact-${art.id}`;
        onChange(goals.map((g) => {
          if (g.id === targetId) {
            if (g.resources.some((r) => r.id === resourceId)) return g;
            return { ...g, resources: [...g.resources, { id: resourceId, label: art.name, url: art.url || "", iconKey: art.iconKey || getAutoIconKey(art.url || "") }] };
          }
          if (g.resources.some((r) => r.id === resourceId)) {
            return { ...g, resources: g.resources.filter((r) => r.id !== resourceId) };
          }
          return g;
        }));
      } catch { /* ignore */ }
      return;
    }
    onChange(goals.map((g) => {
      if (g.id === targetId) {
        let next = g;
        if (actionId && !next.actionIds.includes(actionId)) next = { ...next, actionIds: [...next.actionIds, actionId] };
        if (meetingId && !next.meetingIds.includes(meetingId)) next = { ...next, meetingIds: [...next.meetingIds, meetingId] };
        return next;
      }
      let next = g;
      if (actionId && next.actionIds.includes(actionId)) next = { ...next, actionIds: next.actionIds.filter((x) => x !== actionId) };
      if (meetingId && next.meetingIds.includes(meetingId)) next = { ...next, meetingIds: next.meetingIds.filter((x) => x !== meetingId) };
      return next;
    }));
  }

  const handleModalSave = useCallback((updated: Partial<GoalSection>) => {
    if (newGoalDraft) {
      onChange([...goals, { ...newGoalDraft, ...updated }]);
      setNewGoalDraft(null);
    } else if (modalGoalId) {
      onChange(goals.map((g) => g.id === modalGoalId ? { ...g, ...updated } : g));
    }
  }, [newGoalDraft, modalGoalId, goals, onChange]);

  const handleModalClose = useCallback(() => {
    setNewGoalDraft(null);
    setModalGoalId(null);
  }, []);

  // ── Shared goal body renderer (items inside a goal) ────────────────────────

  function renderGoalItems(goal: GoalSection) {
    const hasItems = goal.actionIds.length > 0 || goal.meetingIds.length > 0 || goal.resources.length > 0;
    if (!hasItems && itemDropTarget !== goal.id) return null;
    return (
      <div className="flex flex-col gap-2 pt-1.5">
        {goal.resources.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-[9px] font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide">Resources</p>
            {goal.resources.map((r) => (
              <div key={r.id} className="group flex items-center gap-1.5 bg-white rounded px-2 py-1 border border-gray-200 text-[11px]">
                {r.iconKey ? <ArtifactIconImg entry={CATALOG_BY_KEY[r.iconKey] ?? CATALOG_BY_KEY["link"]} size={10} /> : (
                  <svg viewBox="0 0 16 16" fill="currentColor" className="w-2.5 h-2.5 text-blue-400 shrink-0"><path d="M7.293 1.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L11.586 9H2a1 1 0 110-2h9.586L7.293 2.707a1 1 0 010-1.414z"/></svg>
                )}
                {r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="flex-1 underline truncate" style={{ color: "var(--twilio-red,#e22)" }}>{r.label}</a>
                  : <span className="flex-1 text-[var(--twilio-navy)] truncate">{r.label}</span>}
                <button onClick={() => removeResource(goal.id, r.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all shrink-0">✕</button>
              </div>
            ))}
          </div>
        )}
        {goal.meetingIds.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-[9px] font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide">Meetings</p>
            {goal.meetingIds.map((mid) => {
              const m = meetingMap[mid];
              if (!m) return null;
              return (
                <div key={mid} className="group flex items-center gap-1.5 bg-white rounded px-2 py-1 border border-gray-200 text-[11px] text-[var(--twilio-navy)]">
                  <svg viewBox="0 0 16 16" fill="currentColor" className="w-2.5 h-2.5 shrink-0" style={{ color: "var(--twilio-red,#e22)", opacity: 0.6 }}><path d="M2 3a2 2 0 012-2h8a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V3zm8 1H6v1h4V4zM6 7h4v1H6V7zm0 3h3v1H6v-1z"/></svg>
                  <span className="flex-1 truncate">{m.name || "Meeting"}</span>
                  {m.date && <span className="text-[var(--twilio-gray-60)] shrink-0 text-[10px]">{new Date(m.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
                  <button onClick={() => removeMeeting(goal.id, mid)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all shrink-0">✕</button>
                </div>
              );
            })}
          </div>
        )}
        {goal.actionIds.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[9px] font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide">Action Items</p>
            {goal.actionIds.map((aid) => {
              const item = actionMap[aid];
              if (!item) return null;
              return (
                <div key={aid} className="group relative">
                  <div className="cursor-pointer" onClick={() => onSelectAction?.(item)}>
                    <ActionItemCard item={item} projectName={goal.name} onDragStart={(e) => { e.dataTransfer.setData("goalActionId", aid); e.dataTransfer.setData("timelineActionId", aid); }} />
                  </div>
                  <button onClick={() => removeAction(goal.id, aid)} className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-gray-300 hover:text-red-400 text-xs leading-none" style={{ background: "rgba(255,255,255,0.9)", borderRadius: 3, padding: "1px 3px" }}>✕</button>
                </div>
              );
            })}
          </div>
        )}
        {itemDropTarget === goal.id && (
          <div className="rounded-md py-2 text-center text-[11px]" style={{ border: "1px dashed var(--twilio-red,#e22)", color: "var(--twilio-red,#e22)", background: "rgba(226,34,34,0.03)" }}>Drop here</div>
        )}
      </div>
    );
  }

  // ── Resource add form ──────────────────────────────────────────────────────
  function renderAddResource(targetId: string) {
    if (newResourceTarget !== targetId) return null;
    return (
      <div className="flex flex-col gap-1.5 mt-1">
        <input autoFocus placeholder="Label" value={resourceForm.label} onChange={(e) => setResourceForm((f) => ({ ...f, label: e.target.value }))} className="w-full text-[11px] rounded px-2 py-1 focus:outline-none" style={{ border: "1px solid rgba(0,0,0,0.08)", background: "#fff" }} />
        <input placeholder="URL (optional)" value={resourceForm.url} onChange={(e) => setResourceForm((f) => ({ ...f, url: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") addResource(targetId); }} className="w-full text-[11px] rounded px-2 py-1 focus:outline-none" style={{ border: "1px solid rgba(0,0,0,0.08)", background: "#fff" }} />
        <div className="flex gap-1">
          <button onClick={() => addResource(targetId)} className="flex-1 text-[11px] px-2 py-1 rounded" style={{ background: "var(--twilio-red,#e22)", color: "#fff" }}>Add</button>
          <button onClick={() => setNewResourceTarget(null)} className="text-[11px] px-2 py-1 border border-gray-300 rounded text-[var(--twilio-navy)] hover:bg-gray-50">✕</button>
        </div>
      </div>
    );
  }

  // ── Standalone goal card (draggable, can be dropped onto a project) ─────────

  function renderGoalCard(goal: GoalSection) {
    const isItemDrop = itemDropTarget === goal.id;
    const hasItems = goal.actionIds.length > 0 || goal.meetingIds.length > 0 || goal.resources.length > 0;
    return (
      <div
        key={goal.id}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("goalItemId", goal.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          // Only accept item drops (not goal drags onto a goal)
          if (!e.dataTransfer.types.includes("goalitemid")) {
            e.preventDefault();
            setItemDropTarget(goal.id);
          }
        }}
        onDragLeave={() => setItemDropTarget(null)}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes("goalitemid")) handleItemDrop(e, goal.id);
        }}
        className="flex flex-col rounded-lg transition-all shrink-0"
        style={{
          width: 220, minHeight: 80, cursor: "grab",
          ...(isItemDrop
            ? { border: "1px solid var(--twilio-red,#e22)", background: "rgba(226,34,34,0.04)", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }
            : { border: "1px solid rgba(99,102,241,0.3)", background: "#f5f3ff" }),
        }}
      >
        {/* Header */}
        <div className="flex flex-col rounded-t-lg shrink-0" style={{ background: "#ede9fe", padding: "9px 10px 7px", borderBottom: (hasItems || isItemDrop) ? "1px solid rgba(99,102,241,0.15)" : "none" }}>
          <div className="flex items-center gap-1.5">
            {/* drag handle */}
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-2.5 h-2.5 shrink-0 text-indigo-300"><title>Drag to assign to a project</title><path d="M4 4a1 1 0 100 2 1 1 0 000-2zm4 0a1 1 0 100 2 1 1 0 000-2zm4 0a1 1 0 100 2 1 1 0 000-2zM4 8a1 1 0 100 2 1 1 0 000-2zm4 0a1 1 0 100 2 1 1 0 000-2zm4 0a1 1 0 100 2 1 1 0 000-2zM4 12a1 1 0 100 2 1 1 0 000-2zm4 0a1 1 0 100 2 1 1 0 000-2zm4 0a1 1 0 100 2 1 1 0 000-2z"/></svg>
            {editingGoalId === goal.id ? (
              <input
                autoFocus
                value={goal.name}
                onChange={(e) => updateGoalName(goal.id, e.target.value)}
                onBlur={() => setEditingGoalId(null)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditingGoalId(null); }}
                className="flex-1 text-xs font-semibold rounded px-1 py-0 focus:outline-none min-w-0"
                style={{ background: "#fff", border: "1px solid #a5b4fc", color: "var(--text-primary,#111)" }}
              />
            ) : (
              <button onClick={() => setEditingGoalId(goal.id)} className="flex-1 text-left text-xs font-semibold leading-tight hover:opacity-70 truncate" style={{ color: "#4338ca" }}>
                {goal.name || <span className="italic opacity-40">Untitled Goal</span>}
              </button>
            )}
            {goal.url && (
              <a href={goal.url} target="_blank" rel="noreferrer" className="shrink-0 text-indigo-400 hover:text-indigo-600 transition-colors" onClick={(e) => e.stopPropagation()}>
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M8.636 3.5a.5.5 0 00-.5-.5H1.5A1.5 1.5 0 000 4.5v10A1.5 1.5 0 001.5 16h10a1.5 1.5 0 001.5-1.5V7.864a.5.5 0 00-1 0V14.5a.5.5 0 01-.5.5h-10a.5.5 0 01-.5-.5v-10a.5.5 0 01.5-.5h6.636a.5.5 0 00.5-.5z"/><path d="M16 .5a.5.5 0 00-.5-.5h-5a.5.5 0 000 1h3.793L6.146 9.146a.5.5 0 10.708.708L15 1.707V5.5a.5.5 0 001 0v-5z"/></svg>
              </a>
            )}
            <button onClick={() => removeGoal(goal.id)} className="shrink-0 text-indigo-300 hover:text-red-500 text-xs transition-colors leading-none">✕</button>
          </div>
          <p className="text-[9px] text-indigo-400 mt-0.5 select-none">Drag into a project ↑</p>
        </div>
        {/* Body */}
        <div className="flex-1 overflow-y-auto px-2.5 py-2" style={{ scrollbarWidth: "thin" }}>
          {renderGoalItems(goal)}
          {!hasItems && !isItemDrop && (
            <p className="text-[10px] text-center text-[var(--twilio-gray-60)]" style={{ opacity: 0.5 }}>Drag items here</p>
          )}
          {renderAddResource(goal.id)}
          {newResourceTarget !== goal.id && (
            <button onClick={() => { setNewResourceTarget(goal.id); setResourceForm({ label: "", url: "" }); }} className="text-[10px] mt-1 hover:opacity-70 transition-opacity" style={{ color: "var(--text-secondary,#888)" }}>+ Add resource</button>
          )}
        </div>
      </div>
    );
  }

  // ── Project-level aggregate views ───────────────────────────────────────────

  // Every action item / artifact directly on the project or on any of its nested goals,
  // tagged with which one actually owns it (for the goal-name chip and so remove buttons
  // still target the right record).
  function collectClusterEntries(project: GoalSection, nestedGoals: GoalSection[]): ClusterEntry[] {
    const owners = [{ section: project, name: "Project" }, ...nestedGoals.map((g) => ({ section: g, name: g.name || "Untitled" }))];
    const entries: ClusterEntry[] = [];
    for (const { section, name } of owners) {
      for (const aid of section.actionIds) {
        const item = actionMap[aid];
        if (item) entries.push({ kind: "action", ownerId: section.id, ownerName: name, item });
      }
      for (const resource of section.resources) {
        entries.push({ kind: "resource", ownerId: section.id, ownerName: name, resource });
      }
    }
    return entries;
  }

  function renderClusterEntry(entry: ClusterEntry) {
    if (entry.kind === "resource") {
      const r = entry.resource;
      return (
        <div key={`r-${r.id}`} className="group flex items-center gap-1.5 bg-white rounded px-2 py-1 border border-gray-200 text-[11px]">
          {r.iconKey ? <ArtifactIconImg entry={CATALOG_BY_KEY[r.iconKey] ?? CATALOG_BY_KEY["link"]} size={10} /> : (
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-2.5 h-2.5 text-blue-400 shrink-0"><path d="M7.293 1.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L11.586 9H2a1 1 0 110-2h9.586L7.293 2.707a1 1 0 010-1.414z"/></svg>
          )}
          {r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="flex-1 underline truncate" style={{ color: "var(--twilio-red,#e22)" }}>{r.label}</a>
            : <span className="flex-1 text-[var(--twilio-navy)] truncate">{r.label}</span>}
          <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-500">{entry.ownerName}</span>
          <button onClick={() => removeResource(entry.ownerId, r.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all shrink-0">✕</button>
        </div>
      );
    }
    const { item } = entry;
    return (
      <div key={`a-${item.airtable_id}`} className="group relative">
        <div className="cursor-pointer" onClick={() => onSelectAction?.(item)}>
          <ActionItemCard item={item} projectName={entry.ownerName} onDragStart={(e) => { e.dataTransfer.setData("goalActionId", item.airtable_id); e.dataTransfer.setData("timelineActionId", item.airtable_id); }} />
        </div>
        <span className="absolute top-1 right-6 text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-500" style={{ background: "rgba(255,255,255,0.9)" }}>{entry.ownerName}</span>
        <button onClick={() => removeAction(entry.ownerId, item.airtable_id)} className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-gray-300 hover:text-red-400 text-xs leading-none" style={{ background: "rgba(255,255,255,0.9)", borderRadius: 3, padding: "1px 3px" }}>✕</button>
      </div>
    );
  }

  function renderClusterView(project: GoalSection, nestedGoals: GoalSection[], view: ClusterView, search: string) {
    const all = collectClusterEntries(project, nestedGoals);
    let entries: ClusterEntry[];
    if (view === "artifacts") {
      entries = all.filter((e) => e.kind === "resource");
    } else if (view === "tree") {
      // Searching from the default view searches everything, not just one bucket.
      entries = all;
    } else {
      entries = all.filter((e) => e.kind === "action" && statusBucket(e.item.status) === view);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      entries = entries.filter((e) => (e.kind === "resource" ? e.resource.label : e.item.task || "").toLowerCase().includes(q));
    }
    return (
      <div className="flex flex-col gap-1.5">
        {entries.length === 0 && (
          <p className="text-[10px] text-center py-3" style={{ color: "#9ca3af" }}>
            {q ? "No matches." : "Nothing here yet."}
          </p>
        )}
        {entries.map(renderClusterEntry)}
      </div>
    );
  }

  // ── Project card with nested goals ─────────────────────────────────────────

  function renderProjectCard(project: GoalSection) {
    const sf = project.sfData ?? {};
    const nestedGoals = (project.goalIds ?? []).map((id) => goals.find((g) => g.id === id)).filter(Boolean) as GoalSection[];
    const isGoalDrop = goalDropTarget === project.id;
    const isItemDrop = itemDropTarget === project.id;
    const members = projectMembers.filter((m) => m.project === Number(project.id));
    // An action item / meeting / artifact belongs to exactly one place. handleItemDrop
    // already enforces that on every move, but this is a display-time backstop against
    // stale data ever rendering the same item under both the project and one of its goals.
    const claimedByGoals = {
      actionIds: new Set(nestedGoals.flatMap((g) => g.actionIds)),
      meetingIds: new Set(nestedGoals.flatMap((g) => g.meetingIds)),
      resourceIds: new Set(nestedGoals.flatMap((g) => g.resources.map((r) => r.id))),
    };
    const projectOwnItems: GoalSection = {
      ...project,
      actionIds: project.actionIds.filter((id) => !claimedByGoals.actionIds.has(id)),
      meetingIds: project.meetingIds.filter((id) => !claimedByGoals.meetingIds.has(id)),
      resources: project.resources.filter((r) => !claimedByGoals.resourceIds.has(r.id)),
    };
    const clusterView = clusterViewByProject[project.id] ?? "tree";
    const clusterSearch = clusterSearchByProject[project.id] ?? "";
    const showClusterView = clusterView !== "tree" || clusterSearch.trim().length > 0;

    return (
      <div
        key={project.id}
        data-testid={`project-row-${project.id}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (e.dataTransfer.types.includes("goalitemid")) {
            setGoalDropTarget(project.id);
          } else {
            setItemDropTarget(project.id);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setGoalDropTarget(null);
            setItemDropTarget(null);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          const goalId = e.dataTransfer.getData("goalItemId");
          if (goalId) {
            assignGoalToProject(project.id, goalId);
            setGoalDropTarget(null);
          } else {
            handleItemDrop(e, project.id);
          }
        }}
        className="flex flex-col rounded-lg transition-all shrink-0"
        style={{
          width: 268, minHeight: 90,
          ...(isGoalDrop
            ? { border: "2px dashed #6366f1", background: "rgba(99,102,241,0.06)", boxShadow: "0 4px 16px rgba(99,102,241,0.15)" }
            : isItemDrop
              ? { border: "1px solid var(--twilio-red,#e22)", background: "rgba(226,34,34,0.04)" }
              : { border: "1px solid var(--border,rgba(0,0,0,0.08))", background: "var(--bg,#f5f5f5)" }),
        }}
      >
        {/* Project header */}
        <div className="flex flex-col rounded-t-lg shrink-0" style={{ background: "var(--surface,#fff)", padding: "9px 10px 7px", borderBottom: "1px solid rgba(0,0,0,0.07)" }}>
          <div className="flex items-start gap-1.5">
            <div className="flex-1 min-w-0">
              <button
                onClick={() => setModalGoalId(project.id)}
                className="text-left w-full text-xs font-semibold leading-tight hover:opacity-70 truncate block"
                style={{ color: "var(--text-primary,#111)" }}
                title="Open project details"
              >{project.name || <span className="italic opacity-40">Untitled Project</span>}</button>
              <div className="flex items-center gap-2 mt-0.5">
                <HealthDot value={sf.health} />
                {sf.remainingHours && <span className="text-[10px] text-[var(--twilio-gray-60)]">{sf.remainingHours} hrs left</span>}
              </div>
              {members.length > 0 && (
                <div className="flex items-center -space-x-1 mt-1" title={members.map((m) => m.team_member_name).join(", ")}>
                  {members.slice(0, 5).map((m) => (
                    <span
                      key={m.id}
                      style={{ width: 16, height: 16, borderRadius: "50%", background: "#ede9fe", color: "#6366f1", fontSize: "0.5625rem", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", border: "1.5px solid var(--surface,#fff)" }}
                    >
                      {m.team_member_name.slice(0, 1).toUpperCase()}
                    </span>
                  ))}
                  {members.length > 5 && (
                    <span style={{ fontSize: "0.5625rem", color: "#9ca3af", marginLeft: 4 }}>+{members.length - 5}</span>
                  )}
                </div>
              )}
            </div>
            <button onClick={() => setModalGoalId(project.id)} title="Project details" className="shrink-0 hover:opacity-70 transition-opacity" style={{ color: "#9ca3af" }}>
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 1a6 6 0 110 12A6 6 0 018 2zm0 4a.75.75 0 100 1.5A.75.75 0 008 6zm-.75 2.25a.75.75 0 011.5 0v3.5a.75.75 0 01-1.5 0v-3.5z"/></svg>
            </button>
            {project.url && (
              <a href={project.url} target="_blank" rel="noreferrer" title={project.url} className="shrink-0 text-blue-400 hover:text-blue-600 transition-colors" onClick={(e) => e.stopPropagation()}>
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M8.636 3.5a.5.5 0 00-.5-.5H1.5A1.5 1.5 0 000 4.5v10A1.5 1.5 0 001.5 16h10a1.5 1.5 0 001.5-1.5V7.864a.5.5 0 00-1 0V14.5a.5.5 0 01-.5.5h-10a.5.5 0 01-.5-.5v-10a.5.5 0 01.5-.5h6.636a.5.5 0 00.5-.5z"/><path d="M16 .5a.5.5 0 00-.5-.5h-5a.5.5 0 000 1h3.793L6.146 9.146a.5.5 0 10.708.708L15 1.707V5.5a.5.5 0 001 0v-5z"/></svg>
              </a>
            )}
            <button onClick={() => removeGoal(project.id)} className="shrink-0 text-[var(--twilio-gray-60)] hover:text-red-500 text-xs transition-colors leading-none">✕</button>
          </div>
        </div>

        {/* Aggregate-view tabs — search across this project and every one of its goals */}
        <div className="flex flex-col gap-1 px-2.5 pt-2" style={{ borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
          <div className="flex items-center gap-1 flex-wrap">
            {CLUSTER_VIEW_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setClusterViewByProject((prev) => ({ ...prev, [project.id]: tab.key }))}
                className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full transition-colors"
                style={clusterView === tab.key
                  ? { background: "#6366f1", color: "#fff" }
                  : { background: "rgba(99,102,241,0.08)", color: "#6366f1" }}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <input
            value={clusterSearch}
            onChange={(e) => setClusterSearchByProject((prev) => ({ ...prev, [project.id]: e.target.value }))}
            placeholder="Search this project's goals…"
            className="w-full text-[10px] rounded px-2 py-1 mb-1.5 focus:outline-none"
            style={{ border: "1px solid rgba(0,0,0,0.08)", background: "#fff" }}
          />
        </div>

        {showClusterView ? (
          <div className="flex-1 overflow-y-auto px-2.5 pt-2 pb-2.5" style={{ scrollbarWidth: "thin" }}>
            {renderClusterView(project, nestedGoals, clusterView, clusterSearch)}
          </div>
        ) : (
        <div className="flex-1 overflow-y-auto px-2.5 pt-2 pb-1" style={{ scrollbarWidth: "thin" }}>
          {nestedGoals.length > 0 && (
            <div className="flex flex-col gap-1.5 mb-2">
              <p className="text-[9px] font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide">Goals</p>
              {nestedGoals.map((goal) => {
                const isExpanded = expandedGoals.has(goal.id);
                const itemCount = goal.actionIds.length + goal.meetingIds.length + goal.resources.length;
                const isGoalItemDrop = itemDropTarget === goal.id;
                return (
                  <div
                    key={goal.id}
                    data-testid={`goal-row-${goal.id}`}
                    onDragOver={(e) => {
                      if (!e.dataTransfer.types.includes("goalitemid")) {
                        e.preventDefault();
                        e.stopPropagation();
                        setItemDropTarget(goal.id);
                        setGoalDropTarget(null);
                        setItemDropTarget(goal.id);
                      }
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) setItemDropTarget(null);
                    }}
                    onDrop={(e) => {
                      if (!e.dataTransfer.types.includes("goalitemid")) {
                        e.stopPropagation();
                        handleItemDrop(e, goal.id);
                      }
                    }}
                    className="rounded-md transition-all"
                    style={{
                      background: isGoalItemDrop ? "rgba(226,34,34,0.04)" : "#ede9fe",
                      border: isGoalItemDrop ? "1px solid var(--twilio-red,#e22)" : "1px solid rgba(99,102,241,0.2)",
                    }}
                  >
                    {/* Goal row header */}
                    <div className="flex items-center gap-1 px-2 py-1.5">
                      <button
                        onClick={() => setExpandedGoals((prev) => { const n = new Set(prev); n.has(goal.id) ? n.delete(goal.id) : n.add(goal.id); return n; })}
                        className="shrink-0 transition-transform"
                        style={{ color: "#6366f1", transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
                      >
                        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-2.5 h-2.5"><path d="M4 2l4 4-4 4"/></svg>
                      </button>
                      {editingGoalId === goal.id ? (
                        <input
                          autoFocus
                          value={goal.name}
                          onChange={(e) => updateGoalName(goal.id, e.target.value)}
                          onBlur={() => setEditingGoalId(null)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditingGoalId(null); }}
                          className="flex-1 text-[11px] font-semibold rounded px-1 focus:outline-none"
                          style={{ background: "#fff", border: "1px solid #a5b4fc", color: "#4338ca" }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <button onDoubleClick={() => setEditingGoalId(goal.id)} className="flex-1 text-left text-[11px] font-semibold truncate hover:opacity-70" style={{ color: "#4338ca" }}>
                          {goal.name || <span className="italic opacity-40">Untitled</span>}
                        </button>
                      )}
                      {itemCount > 0 && (
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-500 shrink-0">{itemCount}</span>
                      )}
                      {/* Add resource to this goal */}
                      <button
                        onClick={() => { setNewResourceTarget(goal.id); setResourceForm({ label: "", url: "" }); }}
                        title="Add resource"
                        className="shrink-0 text-indigo-300 hover:text-indigo-500 transition-colors"
                      >
                        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-2.5 h-2.5"><path d="M6 2v8M2 6h8"/></svg>
                      </button>
                      {/* Unassign from project */}
                      <button
                        onClick={() => unassignGoal(project.id, goal.id)}
                        title="Remove from project"
                        className="shrink-0 text-indigo-200 hover:text-red-400 transition-colors text-xs leading-none"
                      >✕</button>
                    </div>
                    {/* Expanded goal body */}
                    {(isExpanded || isGoalItemDrop) && (
                      <div className="px-2 pb-2">
                        {renderGoalItems(goal)}
                        {renderAddResource(goal.id)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Goal drop hint */}
          {isGoalDrop ? (
            <div className="rounded-md py-3 text-center text-[11px] font-medium" style={{ border: "2px dashed #6366f1", color: "#6366f1", background: "rgba(99,102,241,0.04)" }}>
              Drop to add goal
            </div>
          ) : nestedGoals.length === 0 && !isItemDrop ? (
            <div className="rounded-md py-2.5 text-center text-[10px]" style={{ border: "1px dashed rgba(99,102,241,0.3)", color: "#9ca3af" }}>
              Drag a goal here
            </div>
          ) : null}

          {/* Project-level items (legacy / direct drops) — excludes anything already
              owned by a nested goal, so a moved item never renders in both places. */}
          {(projectOwnItems.actionIds.length > 0 || projectOwnItems.resources.length > 0 || projectOwnItems.meetingIds.length > 0 || isItemDrop) && (
            <div className="mt-2">
              <p className="text-[9px] font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide mb-1">Project Items</p>
              {renderGoalItems(projectOwnItems)}
            </div>
          )}

          {renderAddResource(project.id)}
        </div>
        )}

        {/* Footer */}
        <div className="shrink-0 px-2.5 pb-2.5 pt-1" style={{ borderTop: "1px solid rgba(0,0,0,0.05)" }}>
          {newResourceTarget !== project.id && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  const g: GoalSection = { id: uid(), name: "", kind: "goal", url: "", actionIds: [], meetingIds: [], goalIds: [], resources: [] };
                  // Add goal and assign to this project in a single update
                  const withNew = [...goals, g];
                  onChange(withNew.map((p) => {
                    if (p.id !== project.id) return p;
                    return { ...p, goalIds: [...(p.goalIds ?? []), g.id] };
                  }));
                  setEditingGoalId(g.id);
                  setExpandedGoals((prev) => new Set([...prev, g.id]));
                }}
                className="text-[10px] transition-colors hover:opacity-70"
                style={{ color: "#6366f1" }}
              >+ Add Goal</button>
              <button
                onClick={() => { setNewResourceTarget(project.id); setResourceForm({ label: "", url: "" }); }}
                className="text-[10px] transition-colors hover:opacity-70"
                style={{ color: "var(--text-secondary,#888)" }}
              >+ Add resource</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-row gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: "thin" }}>
        {projects.map(renderProjectCard)}
        {standaloneGoals.map(renderGoalCard)}
      </div>

      {/* Add buttons */}
      <div className="flex flex-row gap-2">
        <button
          onClick={() => setNewGoalDraft({ id: uid(), name: "", kind: "project", url: "", actionIds: [], meetingIds: [], goalIds: [], resources: [] })}
          className="rounded-lg flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors hover:opacity-80"
          style={{ color: "var(--twilio-red,#e22)", border: "1px dashed var(--twilio-red,#e22)", background: "rgba(226,34,34,0.03)" }}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-3 h-3"><path d="M8 3v10M3 8h10"/></svg>
          New Project
        </button>
        <button
          onClick={() => {
            const g: GoalSection = { id: uid(), name: "", kind: "goal", url: "", actionIds: [], meetingIds: [], goalIds: [], resources: [] };
            onChange([...goals, g]);
            setEditingGoalId(g.id);
          }}
          className="rounded-lg flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors hover:opacity-80"
          style={{ color: "#6366f1", border: "1px dashed rgba(99,102,241,0.4)", background: "#f5f3ff" }}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-3 h-3"><path d="M8 3v10M3 8h10"/></svg>
          New Goal
        </button>
      </div>

      {/* Project details modal */}
      {modalGoal && (
        <ProjectDetailsModal
          goal={modalGoal}
          members={projectMembers.filter((m) => m.project === Number(modalGoal.id))}
          accountTeamMembers={accountTeamMembers}
          onClose={handleModalClose}
          onSave={handleModalSave}
          onAddMember={onAddProjectMember ? (teamMemberId) => onAddProjectMember(Number(modalGoal.id), teamMemberId) : undefined}
          onRemoveMember={onRemoveProjectMember}
        />
      )}
    </div>
  );
}
