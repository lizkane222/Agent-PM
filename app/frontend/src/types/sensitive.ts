/** Record types that can carry "sensitive text" marks (mirrors backend sensitive/visibility.py). */
export type SensitiveResourceType =
  | "account" | "airtable_account" | "action_item" | "action_item_step" | "meeting"
  | "calendar_event" | "reminder" | "task" | "account_note" | "artifact" | "meeting_note"
  | "claude_skill" | "account_ticket" | "customer_contact" | "contact_note" | "project"
  | "goal" | "comment" | "artifact_note" | "applet" | "public_item" | "team_member";

export interface SensitiveMark {
  id: number;
  /** Which field of the record (e.g. "task", "task_details", "notes"). */
  field: string;
  /** The hidden snippet. Blank = the whole field / line. */
  text: string;
  /** Identity of a line inside a field with no ids of its own (a bullet). */
  line_key: string;
}

export interface SensitiveMarksResponse {
  results: Record<string, SensitiveMark[]>;
}
