export type BudgetState = "ok" | "warn" | "blocked";

export interface LimitView {
  tokens: number | null;
  /** Dollars at the blended rate, as a decimal string; null when no limit is set. */
  usd: string | null;
}

export interface TokenPricingView {
  input_usd_per_million: string;
  output_usd_per_million: string;
  output_share: string;
  blended_usd_per_million: string;
  example: { tokens: number; usd: string };
  updated_at: string;
}

export interface RoleBudgetRow {
  role: string;
  label: string;
  warn: LimitView;
  block: LimitView;
}

export interface UserBudgetRow {
  user_id: number;
  username: string;
  display_name: string;
  role: string;
  state: BudgetState;
  used_tokens: number;
  used_usd: string;
  warn: LimitView;
  warn_source: "user" | "role" | "none";
  block: LimitView;
  block_source: "user" | "role" | "none";
  block_at_warn: boolean;
  has_override: boolean;
  days_at_limit_14: number;
  days_blocked_14: number;
}

export interface TokenBudgetOverview {
  pricing: TokenPricingView;
  roles: RoleBudgetRow[];
  users: UserBudgetRow[];
  period: "daily";
  counts: string;
}

/** A limit edit: send tokens OR dollars (never both); null clears it. */
export interface LimitInput {
  warn_tokens?: number | null;
  warn_usd?: number | string | null;
  block_tokens?: number | null;
  block_usd?: number | string | null;
}

export interface MyBudget {
  state: BudgetState;
  used: number;
  used_usd: string;
  warn: number | null;
  block: number | null;
  block_at_warn: boolean;
  reason: "" | "block_limit" | "warn_limit_restricted";
}

export interface RecommendedTool {
  name: string;
  reason: string;
}

export interface TokenRun {
  rounds: number;
  input: number;
  output: number;
  total: number;
}

export interface SkillTokenEstimate {
  low: TokenRun;
  expected: TokenRun;
  high: TokenRun;
  params: { tool_result_tokens_per_round: number; output_tokens_per_round: number };
  facts: { base_round_input_tokens: number; skill_prompt_tokens: number; attachments: number; templates: number };
  rationale: string;
  model: string;
  assumptions: string;
}

export interface SkillEstimateRow {
  id: number;
  name: string;
  status: string;
  created_by_username: string | null;
  estimate: SkillTokenEstimate | null;
  estimated_at: string | null;
  stale: boolean;
  low_usd?: string;
  expected_usd?: string;
  high_usd?: string;
}
