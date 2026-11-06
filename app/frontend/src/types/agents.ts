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

/** A record picked with @# and kept as standing context for a skill. */
export interface SkillContextRecord {
  resource_type: string;
  resource_id: number | string;
  label: string;
  url?: string;
}

export interface SlackSource {
  id: string;
  kind: "channel" | "private_channel" | "dm" | "group_dm";
  label: string;
}

export interface SkillContextDefaults {
  records?: SkillContextRecord[];
  account_ids?: number[];
  slack?: SlackSource[];
  needs_accounts?: boolean;
}

/** One selectable variant of a skill's output, e.g. one tab of an update template. */
export interface SkillTemplate {
  key: string;
  title: string;
  body_html: string;
}

export interface AgentSkillAttachment {
  id: number;
  name: string;
  url: string;
  file_url: string;
  mime_type: string;
  file_size: number | null;
  has_text: boolean;
  artifact: number | null;
  uploaded_by_username: string | null;
  created_at: string;
}

export interface SkillRunInput {
  free_text?: string;
  account_ids?: number[];
  records?: SkillContextRecord[];
  slack?: SlackSource[];
  template_key?: string;
  args?: Record<string, string>;
}

export interface SkillRunResult {
  prompt: string;
  /** Plain, spoken-style brief — the voice launch context and the "script to read" fallback. */
  script: string;
  warnings: string[];
}

export interface KeywordTemplate {
  kind: string;
  template: string;
  description: string;
}

export interface KeywordExpansion {
  raw: string;
  ok: boolean;
  error?: string;
  label?: string;
  account?: string;
  total?: number;
  rows?: Record<string, unknown>[];
}

export interface SlackConversations {
  enabled: boolean;
  dms_available: boolean;
  conversations: SlackSource[];
  detail?: string;
}

export interface AgentSkill {
  id: number;
  name: string;
  description: string;
  instructions: string;
  allowed_tools: string[];
  scripts: AgentSkillScript[];
  references: string[];
  twilio_skills: string[];
  chained_skills: string[];
  context_defaults: SkillContextDefaults;
  templates: SkillTemplate[];
  attachments: AgentSkillAttachment[];
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

/** One agent tool as the server's policy layer sees it (GET /agents/tools/). */
export interface AgentTool {
  name: string;
  group: "read" | "create" | "update" | "delete" | "communicate" | "skills" | "other";
  description: string;
  /** A saved workflow may list it in allowed_tools. */
  skill_safe: boolean;
  /** The server refuses it until the user explicitly approves the exact call. */
  requires_confirmation: boolean;
}
