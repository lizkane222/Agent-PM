import { http, HttpResponse } from "msw";
import type { Comment, CommentPreview, CommentSummaryResponse } from "../../types";

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

export const mockCommentPreview: CommentPreview = {
  id: mockComment.id,
  resource_id: mockComment.resource_id,
  author: mockComment.author,
  author_display: mockComment.author_display,
  content: mockComment.content,
  created_at: mockComment.created_at,
};

/**
 * Default `/summary/` handler: every requested id comes back with no comments.
 *
 * Deliberately empty rather than populated — `CommentPreviewList` renders `null` for
 * a count of 0, so the default keeps every existing page/card test's DOM unchanged.
 * Tests that want a preview override this with `commentSummaryResponse(...)` below.
 */
export const commentsHandlers = [
  http.get("/api/v1/comments/comments/summary/", () =>
    HttpResponse.json<CommentSummaryResponse>({ results: {} })
  ),
  http.get("/api/v1/comments/comments/", () =>
    HttpResponse.json({ results: [mockComment], count: 1 })
  ),
];

/** Build a `/summary/` body for the given `{ resourceId: previews }` map. */
export function commentSummaryResponse(
  byId: Record<number, { count?: number; comments: CommentPreview[] }>,
): CommentSummaryResponse {
  const results: CommentSummaryResponse["results"] = {};
  for (const [id, entry] of Object.entries(byId)) {
    results[id] = { count: entry.count ?? entry.comments.length, comments: entry.comments };
  }
  return { results };
}
