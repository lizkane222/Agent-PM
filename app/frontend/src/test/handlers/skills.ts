import { http, HttpResponse } from "msw";
import type { AgentSkill, SkillRunResult } from "../../types";

export const mockAgentSkill = (overrides: Partial<AgentSkill> = {}): AgentSkill => ({
  id: 1,
  name: "test-skill",
  description: "A test skill",
  instructions: "",
  allowed_tools: [],
  scripts: [],
  references: [],
  twilio_skills: [],
  chained_skills: [],
  context_defaults: {},
  templates: [],
  attachments: [],
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

export const mockRunResult = (overrides: Partial<SkillRunResult> = {}): SkillRunResult => ({
  prompt: "/test-skill\n\nDo the thing",
  script: "Workflow: test-skill. Steps: do the thing",
  warnings: [],
  ...overrides,
});

export const skillsHandlers = [
  http.get("/api/v1/skills/agent-skills/resolve-keywords/", () =>
    HttpResponse.json({ keywords: [
      { kind: "all-action-items", template: "@#--all-action-items-${account_name}", description: "Every action item on the account" },
      { kind: "all-meeting-notes", template: "@#--all-meeting-notes-${account_name}-${date-range}", description: "Meetings and notes in a date range" },
    ] })),
  http.post("/api/v1/skills/agent-skills/resolve-keywords/", () => HttpResponse.json({ results: [] })),
  http.get("/api/v1/integrations/slack/conversations/", () =>
    HttpResponse.json({ enabled: false, dms_available: false, conversations: [], detail: "Slack isn't connected yet." })),
  http.get("/api/v1/skills/agent-skills/", () => page<AgentSkill>([])),
  http.get("/api/v1/skills/skills/", () => page([])),
];
