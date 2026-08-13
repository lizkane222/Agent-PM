import { http, HttpResponse } from "msw";
import type { Comment } from "../../types";

export const mockComment: Comment = {
  id: 1,
  resource_type: "action_item",
  resource_id: 10,
  resource_label: "Fix billing issue",
  author: 42,
  author_username: "alice",
  author_display: "Alice",
  content: "This needs more context.",
  parent: null,
  references: [],
  mentions: [],
  replies: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

export const commentsHandlers = [
  http.get("/api/v1/comments/comments/", () =>
    HttpResponse.json({ results: [mockComment], count: 1 })
  ),
];
