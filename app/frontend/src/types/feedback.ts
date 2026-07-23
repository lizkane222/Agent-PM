// ── Feedback domain types ─────────────────────────────────────────────────────

export type FeedbackStatus = "open" | "in_progress" | "resolved" | "wont_fix";

export interface FeedbackComment {
  id: number;
  feedback: number;
  author: number | null;
  author_username: string | null;
  author_display: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface FeedbackItem {
  id: number;
  author: number | null;
  author_username: string | null;
  author_display: string;
  description: string;
  element_label: string;
  element_path: string;
  page_url: string;
  attachment: string | null;
  status: FeedbackStatus;
  comments: FeedbackComment[];
  comment_count: number;
  created_at: string;
  updated_at: string;
}
