import { http, HttpResponse } from "msw";
import type { AgentSkill } from "../../types";

export const mockAgentSkill = (overrides: Partial<AgentSkill> = {}): AgentSkill => ({
  id: 1,
  name: "test-skill",
  description: "A test skill",
  instructions: "",
  allowed_tools: [],
  scripts: [],
  references: [],
  status: "approved",
  visibility: "public",
  review_verdict: "",
  review_findings: {},
  reviewed_at: null,
  pinned_to_roles: [],
  pinned_by_me: false,
  version: 1,
  created_by_username: "lizkane",
  created_at: "2026-08-18T00:00:00Z",
  updated_at: "2026-08-18T00:00:00Z",
  ...overrides,
});

const page = <T>(results: T[]) =>
  HttpResponse.json({ count: results.length, next: null, previous: null, results });

export const skillsHandlers = [
  http.get("/api/v1/skills/agent-skills/", () => page<AgentSkill>([])),
  http.get("/api/v1/skills/skills/", () => page([])),
];
