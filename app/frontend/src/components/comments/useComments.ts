import { useCallback, useEffect, useState } from "react";
import { commentsApi } from "../../lib/api";
import { invalidateCommentSummary } from "../../lib/commentSummaryStore";
import type { Comment, CommentMention, CommentReference, CommentResourceType } from "../../types";

export function useComments(resourceType: CommentResourceType | null, resourceId: number | null) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!resourceType || !resourceId) return;
    setLoading(true);
    try {
      const { data } = await commentsApi.list(resourceType, resourceId);
      setComments(data.results);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [resourceType, resourceId]);

  useEffect(() => { void load(); }, [load]);

  /**
   * Refresh the card-level rollup for this record. Without it, a comment posted in
   * the panel would not show up on the record itself until something remounted —
   * the panel and the cards are separate subscribers to the same server fact.
   */
  const invalidateSummary = useCallback(() => {
    if (resourceType && resourceId) invalidateCommentSummary(resourceType, resourceId);
  }, [resourceType, resourceId]);

  const addComment = useCallback(async (opts: {
    content: string;
    parentId?: number | null;
    references?: CommentReference[];
    mentions?: CommentMention[];
    resourceLabel?: string;
  }) => {
    if (!resourceType || !resourceId) return null;
    const { data } = await commentsApi.create({
      resource_type: resourceType,
      resource_id: resourceId,
      resource_label: opts.resourceLabel ?? "",
      content: opts.content,
      parent: opts.parentId ?? null,
      references: opts.references ?? [],
      mentions: opts.mentions ?? [],
    });
    await load();
    invalidateSummary();
    return data;
  }, [resourceType, resourceId, load, invalidateSummary]);

  const editComment = useCallback(async (id: number, content: string) => {
    await commentsApi.update(id, content);
    await load();
    invalidateSummary();
  }, [load, invalidateSummary]);

  const deleteComment = useCallback(async (id: number) => {
    await commentsApi.delete(id);
    await load();
    invalidateSummary();
  }, [load, invalidateSummary]);

  return { comments, loading, addComment, editComment, deleteComment, reload: load };
}
