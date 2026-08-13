// ── Account Feed domain types ──────────────────────────────────────────────────

export type AirtableFieldType =
  | "singleLineText"
  | "multilineText"
  | "url"
  | "number"
  | "checkbox"
  | "date"
  | "singleSelect"
  | "multipleSelects"
  | "multipleAttachments";

export interface AirtableFieldTypeChoice {
  value: AirtableFieldType;
  label: string;
}

export interface AccountFeedCustomField {
  id: number;
  name: string;
  value: string;
  airtable_field_type: AirtableFieldType | "";
  airtable_field_id: string;
  created_by: number | null;
  created_at: string;
}

export interface AccountFeedConfig {
  id: number;
  account: number;
  drive_folders: Array<{ url: string; label: string }>;
  name_aliases: string[];
  email_domains: string[];
  confluence_spaces: string[];
  jira_projects: string[];
  zendesk_groups: number[];
  custom_fields: AccountFeedCustomField[];
  airtable_field_type_choices: AirtableFieldTypeChoice[];
  updated_at: string;
  updated_by: number | null;
}
