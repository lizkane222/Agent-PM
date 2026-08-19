/**
 * CommentCountBadge — icon + count, no button, for places too tight for a preview.
 *
 * Used inside calendar grid chips, where a three-line comment preview would not fit but
 * "this meeting has a conversation on it" still needs to be visible without right-clicking.
 * Inherits `currentColor` so it reads correctly on the user's chosen event colour.
 *
 * Renders `null` when the record has no comments.
 */
import CommentIcon from "../CommentIcon";
import { useCommentSummary } from "../../hooks/useCommentSummary";
import type { CommentResourceType } from "../../types";

interface Props {
  resourceType: CommentResourceType;
  resourceId: number | null | undefined;
  className?: string;
}

export default function CommentCountBadge({ resourceType, resourceId, className = "" }: Props) {
  const summary = useCommentSummary(resourceType, resourceId);
  if (!summary || summary.count === 0) return null;

  return (
    <span
      className={`inline-flex items-center gap-0.5 shrink-0 ${className}`}
      title={`${summary.count} comment${summary.count === 1 ? "" : "s"}`}
      data-testid="comment-count-badge"
    >
      <CommentIcon className="w-2.5 h-2.5" />
      <span className="text-[9px] font-semibold leading-none">{summary.count}</span>
    </span>
  );
}
