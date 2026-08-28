import type { ClaudeSkillStatus, AgentSkillStatus } from "../types.js";
export interface ClaudeSkillTransitionFixture {
    from: ClaudeSkillStatus;
    action: "submit" | "start_review" | "approve" | "reject" | "enable" | "disable";
    expectedTo: ClaudeSkillStatus | "invalid";
    note?: string;
}
export declare const CLAUDE_SKILL_TRANSITION_FIXTURES: ClaudeSkillTransitionFixture[];
export interface AgentSkillTransitionFixture {
    from: AgentSkillStatus;
    action: "submit" | "approve" | "reject" | "resubmit";
    expectedTo: AgentSkillStatus | "invalid";
    note?: string;
}
export declare const AGENT_SKILL_TRANSITION_FIXTURES: AgentSkillTransitionFixture[];
//# sourceMappingURL=skillStateMachine.fixtures.d.ts.map