// ── Sync Review domain types ───────────────────────────────────────────────────

export type SyncReviewSource = "gdrive" | "gmail" | "confluence" | "jira" | "zendesk";

export type SyncReviewContentType = "document" | "email" | "ticket" | "page" | "internal_email";

export type SyncReviewStatus =
  | "pending_agent"
  | "pending_human"
  | "accepted"
  | "rejected"
  | "unassigned";

export type SyncDeleteRequestStatus = "pending" | "approved" | "rejected";

export interface SyncReviewItem {
  id: number;
  source: SyncReviewSource;
  source_id: string;
  source_url: string;
  content_type: SyncReviewContentType;
  raw_content: Record<string, unknown>;
  status: SyncReviewStatus;
  suggested_account: number | null;
  suggested_account_name: string | null;
  confidence_score: number | null;
  claude_analysis: string;
  is_sensitive: boolean;
  reviewed_by: number | null;
  reviewed_by_email: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SyncDeleteRequest {
  id: number;
  review_item: number;
  account: number;
  account_name: string;
  requested_by: number;
  requested_by_email: string;
  status: SyncDeleteRequestStatus;
  reviewed_by: number | null;
  reviewed_by_email: string | null;
  reason: string;
  claude_mismatch_analysis: string;
  created_at: string;
  resolved_at: string | null;
}
