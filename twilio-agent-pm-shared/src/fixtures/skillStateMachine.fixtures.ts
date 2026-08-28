import type { ClaudeSkillStatus, AgentSkillStatus } from "../types.js";

// Valid transitions for ClaudeSkill review workflow.
// submit → pending_review → reviewing → approved | rejected
// approved → disabled (via disable action)
// disabled → approved (via enable action)

export interface ClaudeSkillTransitionFixture {
  from: ClaudeSkillStatus;
  action: "submit" | "start_review" | "approve" | "reject" | "enable" | "disable";
  expectedTo: ClaudeSkillStatus | "invalid";
  note?: string;
}

export const CLAUDE_SKILL_TRANSITION_FIXTURES: ClaudeSkillTransitionFixture[] = [
  { from: "pending_review", action: "start_review", expectedTo: "reviewing" },
  { from: "reviewing", action: "approve", expectedTo: "approved" },
  { from: "reviewing", action: "reject", expectedTo: "rejected" },
  { from: "approved", action: "disable", expectedTo: "disabled" },
  { from: "disabled", action: "enable", expectedTo: "approved" },
  // Invalid transitions
  { from: "approved", action: "approve", expectedTo: "invalid", note: "already approved" },
  { from: "rejected", action: "approve", expectedTo: "invalid", note: "rejected cannot be approved without re-submit" },
  { from: "disabled", action: "reject", expectedTo: "invalid", note: "disabled → rejected is not a transition" },
];

// AgentSkill workflow: draft → pending_review → approved | rejected
// rejected can be re-submitted (back to pending_review via update)

export interface AgentSkillTransitionFixture {
  from: AgentSkillStatus;
  action: "submit" | "approve" | "reject" | "resubmit";
  expectedTo: AgentSkillStatus | "invalid";
  note?: string;
}

export const AGENT_SKILL_TRANSITION_FIXTURES: AgentSkillTransitionFixture[] = [
  { from: "draft", action: "submit", expectedTo: "pending_review" },
  { from: "pending_review", action: "approve", expectedTo: "approved" },
  { from: "pending_review", action: "reject", expectedTo: "rejected" },
  { from: "rejected", action: "resubmit", expectedTo: "pending_review" },
  // Invalid transitions
  { from: "approved", action: "submit", expectedTo: "invalid", note: "already approved" },
  { from: "draft", action: "approve", expectedTo: "invalid", note: "cannot approve a draft directly" },
];
