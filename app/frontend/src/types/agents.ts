// ── Agent domain types ────────────────────────────────────────────────────────

export interface SessionParticipant {
  id: number;
  username: string;
  email: string;
  display_name: string;
}

export interface AgentMessage {
  id: number;
  role: "user" | "assistant" | "tool_result";
  content: string;
  input_tokens: number;
  output_tokens: number;
  tool_calls: ToolCall[];
  created_at: string;
}

export interface ToolCall {
  id: number;
  tool_name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  status: "pending" | "success" | "error";
  error_message: string;
  duration_ms: number;
  created_at: string;
}

export interface AgentSession {
  id: number;
  title: string;
  status: "active" | "completed" | "error";
  is_shared: boolean;
  owner_username: string;
  participants: SessionParticipant[];
  started_at: string;
  ended_at: string | null;
  messages: AgentMessage[];
  created_at: string;
  updated_at: string;
}

export type AgentSkillStatus = "draft" | "pending_review" | "approved" | "rejected";
export type AgentSkillVisibility = "private" | "team" | "public";

export interface AgentSkillScript {
  filename: string;
  language: string;
  code: string;
}

export interface AgentSkill {
  id: number;
  name: string;
  description: string;
  instructions: string;
  allowed_tools: string[];
  scripts: AgentSkillScript[];
  references: string[];
  status: AgentSkillStatus;
  visibility: AgentSkillVisibility;
  review_verdict: string;
  review_findings: Record<string, string>;
  reviewed_at: string | null;
  pinned_to_roles: string[];
  pinned_by_me: boolean;
  version: number;
  created_by_username: string | null;
  created_at: string;
  updated_at: string;
}
