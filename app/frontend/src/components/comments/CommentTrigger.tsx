/**
 * CommentTrigger — drop-in comment button for any record.
 *
 * Bundles the three things every call site used to wire by hand (a ref for the anchor
 * rect, `useCommentContext().openComments`, and an icon) plus the one thing none of
 * them had: the current comment count. Four modal headers had near-identical 12-line
 * copies of this with three different SVGs; they are all one line now.
 *
 *   <CommentTrigger resourceType="action_item" resourceId={item.id} resourceLabel={item.task} />
 */
import { useRef } from "react";
import CommentButton from "./CommentButton";
import { useCommentContext } from "./CommentContext";
import { useCommentSummary } from "../../hooks/useCommentSummary";
import type { CommentResourceType } from "../../types";

interface Props {
  resourceType: CommentResourceType;
  resourceId: number | null | undefined;
  resourceLabel?: string;
  size?: "sm" | "md";
  className?: string;
  /** Rendered as nothing when there is no id to comment on (e.g. an unsaved draft). */
  disabled?: boolean;
}

export default function CommentTrigger({
  resourceType,
  resourceId,
  resourceLabel = "",
  size = "md",
  className,
  disabled = false,
}: Props) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const { openComments } = useCommentContext();
  const summary = useCommentSummary(resourceType, disabled ? null : resourceId);

  if (disabled || !resourceId) return null;

  return (
    <CommentButton
      buttonRef={btnRef}
      count={summary?.count}
      size={size}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // Anchor to the button, not the click point — the panel should hang off the
        // icon consistently whether it was clicked, tapped or keyboard-activated.
        const rect = btnRef.current?.getBoundingClientRect();
        openComments({
          resourceType,
          resourceId,
          resourceLabel,
          x: rect ? rect.left : 200,
          y: rect ? rect.bottom + 4 : 200,
        });
      }}
    />
  );
}
