export type Zone =
  | "unstaged"
  | "today"
  | "active"
  | "complete"
  | "accounts"
  | "done-accounts";

export type ZonesMap = Record<string, Zone>;
export type AccountAssignMap = Record<string, string>;

export interface KanbanAccount {
  key: string;
  id: number;
  name: string;
  source: "airtable" | "app";
}

export type StepStatus = "Open" | "Done" | "Blocked" | "Archived";

export interface ActionItemStep {
  id: number;
  action_item: number;
  title: string;
  status: StepStatus;
  order: number;
  created_at: string;
}
