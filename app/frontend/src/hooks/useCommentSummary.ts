/**
 * useCommentSummary — comment count + short preview for one record.
 *
 * Reads from the request-coalescing store in `lib/commentSummaryStore.ts`, so a page
 * rendering 80 cards produces one batched request per resource type, not 80 requests.
 * Returns `undefined` until the first fetch lands; render nothing in that window
 * rather than a misleading "0".
 *
 * Not a `useResource` hook: this is a shared cross-cutting cache keyed by
 * (resource_type, resource_id), not a single entity list owned by a page.
 */
import { useEffect, useSyncExternalStore } from "react";
import {
  getCommentSummary,
  requestCommentSummary,
  subscribeCommentSummaries,
} from "../lib/commentSummaryStore";
import type { CommentResourceType, CommentSummary } from "../types";

export function useCommentSummary(
  resourceType: CommentResourceType,
  resourceId: number | null | undefined,
): CommentSummary | undefined {
  const id = resourceId ?? 0;

  useEffect(() => {
    if (id > 0) requestCommentSummary(resourceType, id);
  }, [resourceType, id]);

  return useSyncExternalStore(
    subscribeCommentSummaries,
    () => (id > 0 ? getCommentSummary(resourceType, id) : undefined),
    () => undefined,
  );
}
