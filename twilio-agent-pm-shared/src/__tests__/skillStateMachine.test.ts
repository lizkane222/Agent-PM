import { claudeSkillTransition, agentSkillTransition } from "../brain/skillStateMachine.js";
import {
  CLAUDE_SKILL_TRANSITION_FIXTURES,
  AGENT_SKILL_TRANSITION_FIXTURES,
} from "../fixtures/skillStateMachine.fixtures.js";

describe("claudeSkillTransition", () => {
  for (const f of CLAUDE_SKILL_TRANSITION_FIXTURES) {
    const label = f.note ?? `${f.from} + ${f.action} → ${f.expectedTo}`;
    it(label, () => {
      const result = claudeSkillTransition(f.from, f.action);
      if (f.expectedTo === "invalid") {
        expect(result).toBeNull();
      } else {
        expect(result).toBe(f.expectedTo);
      }
    });
  }
});

describe("agentSkillTransition", () => {
  for (const f of AGENT_SKILL_TRANSITION_FIXTURES) {
    const label = f.note ?? `${f.from} + ${f.action} → ${f.expectedTo}`;
    it(label, () => {
      const result = agentSkillTransition(f.from, f.action);
      if (f.expectedTo === "invalid") {
        expect(result).toBeNull();
      } else {
        expect(result).toBe(f.expectedTo);
      }
    });
  }
});
