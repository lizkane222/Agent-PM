import { http, HttpResponse } from "msw";
import type { AgentSkill, PagePin, SkillRunDetail, SkillRunResult, SkillRunRow } from "../../types";

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

export const mockPagePin = (overrides: Partial<PagePin> = {}): PagePin => ({
  id: 1, page: "calendar", scope: "mine", can_remove: true, skill: mockAgentSkill(), ...overrides,
});

/** A page-pins handler that answers only for `page` (like the server), so other pages stay empty. */
export const pagePinsFor = (page: string, pins: PagePin[]) =>
  http.get("/api/v1/skills/page-pins/", ({ request }) =>
    HttpResponse.json({ results: new URL(request.url).searchParams.get("page") === page ? pins : [] }));

export const mockSkillRun = (overrides: Partial<SkillRunRow> = {}): SkillRunRow => ({
  id: "11111111-1111-1111-1111-111111111111", skill: 1, skill_name: "test-skill", surface: "chat", page: "calendar",
  params: {}, status: "completed", started_at: "2026-11-11T10:00:00Z", finished_at: "2026-11-11T10:01:00Z",
  tool_count: 0, records_created: 0, records_updated: 0, input_tokens: 0, output_tokens: 0, user_username: "alice", ...overrides,
});

export const mockSkillRunDetail = (overrides: Partial<SkillRunDetail> = {}): SkillRunDetail => ({
  ...mockSkillRun(), events: [], ...overrides,
});

export const skillsHandlers = [
  http.get("/api/v1/skills/page-pins/", () => HttpResponse.json({ results: [] })),
  http.get("/api/v1/skills/runs/", () => HttpResponse.json({ count: 0, next: null, previous: null, results: [] })),
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
