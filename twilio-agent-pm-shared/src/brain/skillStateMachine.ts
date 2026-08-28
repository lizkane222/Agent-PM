import type { ClaudeSkillStatus, AgentSkillStatus } from "../types.js";

export type ClaudeSkillAction = "submit" | "start_review" | "approve" | "reject" | "enable" | "disable";
export type AgentSkillAction = "submit" | "approve" | "reject" | "resubmit";

const CLAUDE_TRANSITIONS: Partial<Record<ClaudeSkillStatus, Partial<Record<ClaudeSkillAction, ClaudeSkillStatus>>>> = {
  pending_review: { start_review: "reviewing" },
  reviewing:      { approve: "approved", reject: "rejected" },
  approved:       { disable: "disabled" },
  disabled:       { enable: "approved" },
};

const AGENT_TRANSITIONS: Partial<Record<AgentSkillStatus, Partial<Record<AgentSkillAction, AgentSkillStatus>>>> = {
  draft:          { submit: "pending_review" },
  pending_review: { approve: "approved", reject: "rejected" },
  rejected:       { resubmit: "pending_review" },
};

export function claudeSkillTransition(
  from: ClaudeSkillStatus,
  action: ClaudeSkillAction,
): ClaudeSkillStatus | null {
  return CLAUDE_TRANSITIONS[from]?.[action] ?? null;
}

export function agentSkillTransition(
  from: AgentSkillStatus,
  action: AgentSkillAction,
): AgentSkillStatus | null {
  return AGENT_TRANSITIONS[from]?.[action] ?? null;
}
