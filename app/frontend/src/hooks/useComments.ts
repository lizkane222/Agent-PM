import { useCallback } from "react";
import { commentsApi } from "../lib/api";
import { invalidateCommentSummary } from "../lib/commentSummaryStore";
import { useResource } from "./useResource";
import type { Comment, CommentMention, CommentReference, CommentResourceType } from "../types";

export function useComments(
  resourceType: CommentResourceType | null,
  resourceId: number | null,
) {
  const { data: comments, loading, error, refetch } = useResource<Comment>(
    () => {
      if (!resourceType || !resourceId) return Promise.resolve([]);
      return commentsApi.list(resourceType, resourceId).then((r) => r.data.results);
    },
    [resourceType, resourceId],
  );

  /** Keep the card-level rollup in `lib/commentSummaryStore` in step with mutations. */
  const invalidateSummary = useCallback(() => {
    if (resourceType && resourceId) invalidateCommentSummary(resourceType, resourceId);
  }, [resourceType, resourceId]);

  const addComment = useCallback(
    async (opts: {
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
      refetch();
      invalidateSummary();
      return data;
    },
    [resourceType, resourceId, refetch, invalidateSummary],
  );

  const editComment = useCallback(
    async (id: number, content: string) => {
      await commentsApi.update(id, content);
      refetch();
      invalidateSummary();
    },
    [refetch, invalidateSummary],
  );

  const deleteComment = useCallback(
    async (id: number) => {
      await commentsApi.delete(id);
      refetch();
      invalidateSummary();
    },
    [refetch, invalidateSummary],
  );

  return { comments, loading, error, addComment, editComment, deleteComment, refetch };
}
