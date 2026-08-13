// ── Claude Skills ─────────────────────────────────────────────────────────────
// Moved from types/index.ts. types/index.ts re-exports all of these for
// backwards compatibility — call sites importing from "../types" are unaffected.

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
