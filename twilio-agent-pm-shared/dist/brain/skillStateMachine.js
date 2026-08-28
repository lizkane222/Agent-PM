const CLAUDE_TRANSITIONS = {
    pending_review: { start_review: "reviewing" },
    reviewing: { approve: "approved", reject: "rejected" },
    approved: { disable: "disabled" },
    disabled: { enable: "approved" },
};
const AGENT_TRANSITIONS = {
    draft: { submit: "pending_review" },
    pending_review: { approve: "approved", reject: "rejected" },
    rejected: { resubmit: "pending_review" },
};
export function claudeSkillTransition(from, action) {
    return CLAUDE_TRANSITIONS[from]?.[action] ?? null;
}
export function agentSkillTransition(from, action) {
    return AGENT_TRANSITIONS[from]?.[action] ?? null;
}
//# sourceMappingURL=skillStateMachine.js.map