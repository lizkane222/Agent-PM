export type CommentResourceType =
  | "account"
  | "airtable_account"
  | "action_item"
  | "action_item_step"
  | "meeting"
  | "calendar_event"
  | "reminder"
  | "task"
  | "account_note"
  | "artifact"
  | "meeting_note"
  | "claude_skill";

export interface CommentReference {
  resource_type: CommentResourceType;
  resource_id: number;
  label: string;
  url: string;
}

export interface CommentMention {
  user_id: number;
  username: string;
  display_name: string;
}

export interface Comment {
  id: number;
  resource_type: CommentResourceType;
  resource_id: number;
  resource_label: string;
  author: number | null;
  author_username: string | null;
  author_display: string;
  content: string;
  parent: number | null;
  references: CommentReference[];
  mentions: CommentMention[];
  replies: Comment[];
  created_at: string;
  updated_at: string;
}
