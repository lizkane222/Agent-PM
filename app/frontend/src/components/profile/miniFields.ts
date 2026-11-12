/**
 * The fields a mini-canvas component can carry (spans all entity types in the app).
 *
 * Lives in its own module so the page's field picker, the canvas preview and the hand-off to the
 * full builder all read labels from one place.
 */

export interface MiniFieldDef {
  key: string;
  label: string;
  fieldType: "text" | "textarea" | "date" | "select" | "number" | "url";
  options?: string[];
}
export interface MiniFieldCategory { category: string; icon: string; fields: MiniFieldDef[]; }

export const MINI_FIELD_CATALOG: MiniFieldCategory[] = [
  {
    category: "General", icon: "📝",
    fields: [
      { key: "g_title",       label: "Title",       fieldType: "text" },
      { key: "g_description", label: "Description", fieldType: "textarea" },
      { key: "g_notes",       label: "Notes",       fieldType: "textarea" },
      { key: "g_url",         label: "URL",         fieldType: "url" },
      { key: "g_date",        label: "Date",        fieldType: "date" },
      { key: "g_tags",        label: "Tags",        fieldType: "text" },
      { key: "g_status",      label: "Status",      fieldType: "text" },
      { key: "g_priority",    label: "Priority",    fieldType: "select", options: ["urgent", "high", "normal", "low"] },
    ],
  },
  {
    category: "Action Item", icon: "✅",
    fields: [
      { key: "ai_title",    label: "Title",    fieldType: "text" },
      { key: "ai_notes",    label: "Notes",    fieldType: "textarea" },
      { key: "ai_priority", label: "Priority", fieldType: "select", options: ["urgent", "high", "normal", "low"] },
      { key: "ai_status",   label: "Status",   fieldType: "select", options: ["open", "in_progress", "done", "dismissed"] },
      { key: "ai_due_date", label: "Due Date", fieldType: "date" },
      { key: "ai_assignee", label: "Assignee", fieldType: "text" },
      { key: "ai_account",  label: "Account",  fieldType: "text" },
      { key: "ai_est_time", label: "Est. Time (h)", fieldType: "number" },
    ],
  },
  {
    category: "Meeting", icon: "🗓",
    fields: [
      { key: "m_title",       label: "Title",          fieldType: "text" },
      { key: "m_date",        label: "Date",           fieldType: "date" },
      { key: "m_duration",    label: "Duration (min)", fieldType: "number" },
      { key: "m_location",    label: "Location",       fieldType: "text" },
      { key: "m_description", label: "Description",    fieldType: "textarea" },
      { key: "m_attendees",   label: "Attendees",      fieldType: "text" },
      { key: "m_status",      label: "Status",         fieldType: "select", options: ["confirmed", "tentative", "cancelled"] },
      { key: "m_meet_link",   label: "Meet Link",      fieldType: "url" },
      { key: "m_account",     label: "Account",        fieldType: "text" },
    ],
  },
  {
    category: "Account", icon: "🏢",
    fields: [
      { key: "acct_name",     label: "Company Name", fieldType: "text" },
      { key: "acct_website",  label: "Website",      fieldType: "url" },
      { key: "acct_industry", label: "Industry",     fieldType: "text" },
      { key: "acct_status",   label: "Status",       fieldType: "select", options: ["prospect", "active", "inactive", "churned"] },
      { key: "acct_arr",      label: "ARR ($)",      fieldType: "number" },
      { key: "acct_owner",    label: "Owner",        fieldType: "text" },
    ],
  },
  {
    category: "Task", icon: "📋",
    fields: [
      { key: "t_title",       label: "Title",       fieldType: "text" },
      { key: "t_description", label: "Description", fieldType: "textarea" },
      { key: "t_priority",    label: "Priority",    fieldType: "select", options: ["urgent", "high", "normal", "low"] },
      { key: "t_status",      label: "Status",      fieldType: "select", options: ["backlog", "todo", "in_progress", "review", "done", "archived"] },
      { key: "t_due_date",    label: "Due Date",    fieldType: "date" },
      { key: "t_tags",        label: "Tags",        fieldType: "text" },
      { key: "t_assignee",    label: "Assignee",    fieldType: "text" },
    ],
  },
  {
    category: "Reminder", icon: "🔔",
    fields: [
      { key: "r_title",  label: "Title",  fieldType: "text" },
      { key: "r_body",   label: "Body",   fieldType: "textarea" },
      { key: "r_due_at", label: "Due At", fieldType: "date" },
      { key: "r_status", label: "Status", fieldType: "select", options: ["pending", "sent", "dismissed", "snoozed"] },
    ],
  },
  {
    category: "Calendar Event", icon: "📅",
    fields: [
      { key: "ce_title",       label: "Title",         fieldType: "text" },
      { key: "ce_start",       label: "Start",         fieldType: "date" },
      { key: "ce_end",         label: "End",           fieldType: "date" },
      { key: "ce_location",    label: "Location",      fieldType: "text" },
      { key: "ce_description", label: "Description",   fieldType: "textarea" },
      { key: "ce_attendees",   label: "Attendees",     fieldType: "text" },
      { key: "ce_status",      label: "Status",        fieldType: "select", options: ["confirmed", "tentative", "cancelled"] },
      { key: "ce_meet_link",   label: "Meet Link",     fieldType: "url" },
      { key: "ce_account",     label: "Account",       fieldType: "text" },
    ],
  },
];

export const ALL_FIELD_DEFS: MiniFieldDef[] = MINI_FIELD_CATALOG.flatMap(c => c.fields);

const LABEL_BY_KEY: Record<string, string> = Object.fromEntries(ALL_FIELD_DEFS.map(f => [f.key, f.label]));
const TYPE_BY_KEY: Record<string, MiniFieldDef["fieldType"]> = Object.fromEntries(ALL_FIELD_DEFS.map(f => [f.key, f.fieldType]));

/** "g_description" -> "Description". An unknown key is shown as itself rather than hidden. */
export function fieldLabel(key: string): string {
  return LABEL_BY_KEY[key] ?? key;
}

export function fieldType(key: string): MiniFieldDef["fieldType"] {
  return TYPE_BY_KEY[key] ?? "text";
}
