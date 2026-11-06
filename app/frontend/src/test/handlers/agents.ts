import { http, HttpResponse } from "msw";
import type { AgentSession, AgentTool } from "../../types";
import type { MyBudget, SkillEstimateRow, TokenBudgetOverview, UserBudgetRow } from "../../types/tokenBudget";

export const mockAgentSessions: AgentSession[] = [
  {
    id: 1,
    title: "Q3 Planning Session",
    status: "completed",
    is_shared: false,
    owner_username: "alice",
    participants: [],
    started_at: "2026-07-01T10:00:00Z",
    ended_at: "2026-07-01T11:00:00Z",
    messages: [],
    created_at: "2026-07-01T10:00:00Z",
    updated_at: "2026-07-01T11:00:00Z",
  },
];

/**
 * A slice of the real registry: skill-safe create/read/update tools, plus the tools a
 * skill must never be offered (deletes, outbound). Mirrors GET /agents/tools/.
 */
export const mockAgentTools: AgentTool[] = [
  { name: "search_records", group: "read", description: "Search records.", skill_safe: true, requires_confirmation: false },
  { name: "create_action_item", group: "create", description: "Create an action item.", skill_safe: true, requires_confirmation: false },
  { name: "create_reminder", group: "create", description: "Create a reminder.", skill_safe: true, requires_confirmation: false },
  { name: "update_meeting", group: "update", description: "Set meeting notes.", skill_safe: true, requires_confirmation: false },
  { name: "delete_action_item", group: "delete", description: "Delete an action item.", skill_safe: false, requires_confirmation: true },
  { name: "send_sms", group: "communicate", description: "Send an SMS.", skill_safe: false, requires_confirmation: true },
];

export const mockMyBudget = (overrides: Partial<MyBudget> = {}): MyBudget => ({
  state: "ok", used: 0, used_usd: "0.0000", warn: null, block: null, block_at_warn: false, reason: "", ...overrides,
});

export const mockBudgetUser = (overrides: Partial<UserBudgetRow> = {}): UserBudgetRow => ({
  user_id: 1, username: "alice", display_name: "Alice Adams", role: "SA", state: "ok",
  used_tokens: 0, used_usd: "0.0000",
  warn: { tokens: null, usd: null }, warn_source: "none",
  block: { tokens: null, usd: null }, block_source: "none",
  block_at_warn: false, has_override: false, days_at_limit_14: 0, days_blocked_14: 0, ...overrides,
});

const ROLE_ROWS: [string, string][] = [
  ["SA", "Solutions Architect"], ["PM", "Product Manager"], ["PgM", "Program Manager"],
  ["CSM", "Customer Success Manager"], ["MA", "Manager"], ["TAM", "Technical Account Manager"],
  ["AE", "Account Executive"], ["ENG", "Engineer"], ["other", "Other / no recognised title"],
];

export const mockBudgetOverview = (overrides: Partial<TokenBudgetOverview> = {}): TokenBudgetOverview => ({
  pricing: {
    input_usd_per_million: "3.0000", output_usd_per_million: "15.0000", output_share: "0.200",
    blended_usd_per_million: "5.4000", example: { tokens: 1_000_000, usd: "5.4000" }, updated_at: "2026-11-04T00:00:00Z",
  },
  roles: ROLE_ROWS.map(([role, label]) => ({ role, label, warn: { tokens: null, usd: null }, block: { tokens: null, usd: null } })),
  users: [mockBudgetUser()],
  period: "daily",
  counts: "Chat and voice turns, including skill runs.",
  ...overrides,
});

export const mockSkillEstimate = (overrides: Partial<SkillEstimateRow> = {}): SkillEstimateRow => ({
  id: 1, name: "weekly-update", status: "approved", created_by_username: "alice",
  estimate: null, estimated_at: null, stale: true, ...overrides,
});

export const agentsHandlers = [
  http.get("/api/v1/agents/token-budgets/me/", () => HttpResponse.json(mockMyBudget())),
  http.get("/api/v1/agents/token-budgets/", () => HttpResponse.json(mockBudgetOverview())),
  http.get("/api/v1/skills/agent-skills/token-estimates/", () => HttpResponse.json({ results: [] })),
  http.get("/api/v1/agents/sessions/", () =>
    HttpResponse.json({ results: mockAgentSessions, count: mockAgentSessions.length })
  ),
  http.get("/api/v1/agents/tools/", () => HttpResponse.json({ tools: mockAgentTools })),
];
