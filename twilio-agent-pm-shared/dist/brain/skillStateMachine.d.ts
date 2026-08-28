import type { ClaudeSkillStatus, AgentSkillStatus } from "../types.js";
export type ClaudeSkillAction = "submit" | "start_review" | "approve" | "reject" | "enable" | "disable";
export type AgentSkillAction = "submit" | "approve" | "reject" | "resubmit";
export declare function claudeSkillTransition(from: ClaudeSkillStatus, action: ClaudeSkillAction): ClaudeSkillStatus | null;
export declare function agentSkillTransition(from: AgentSkillStatus, action: AgentSkillAction): AgentSkillStatus | null;
//# sourceMappingURL=skillStateMachine.d.ts.map