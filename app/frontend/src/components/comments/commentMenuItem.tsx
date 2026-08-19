/**
 * The shared "Comments" context-menu entry.
 *
 * Mirrors `focusPinMenuItem` in `components/action-items/ContextMenu.tsx`: one place
 * that owns the label and icon so every right-click menu in the app offers the same
 * thing. Previously each call site inlined its own SVG (or a 💬 emoji) and its own
 * label ("Add comment" / "Comment").
 *
 * The label carries the count when there is one, so right-click alone tells you a
 * record has a conversation on it.
 */
import CommentIcon from "../CommentIcon";
import { useCommentContext } from "./CommentContext";
import { useCommentSummary } from "../../hooks/useCommentSummary";
import type { ContextMenuItem } from "../action-items/ContextMenu";
import type { CommentResourceType } from "../../types";

export function commentMenuItem(onClick: () => void, count?: number): ContextMenuItem {
  const n = count ?? 0;
  return {
    label: n > 0 ? `Comments (${n})` : "Add comment",
    icon: <CommentIcon className="w-3.5 h-3.5" />,
    onClick,
  };
}

/**
 * The comment entry for a card's right-click menu, wired to the record.
 *
 * `pos` is the right-click point the card already captured for its own `ContextMenu`,
 * so the panel opens where the menu was — matching the behaviour every card had
 * before, minus the copy-pasted `openComments({...})` literal.
 */
export function useCommentMenuItem(
  resourceType: CommentResourceType,
  resourceId: number | null | undefined,
  resourceLabel: string,
  pos: { x: number; y: number } | null,
): ContextMenuItem {
  const { openComments } = useCommentContext();
  const summary = useCommentSummary(resourceType, resourceId);

  return commentMenuItem(() => {
    if (!resourceId) return;
    openComments({
      resourceType,
      resourceId,
      resourceLabel,
      x: pos?.x ?? 200,
      y: pos?.y ?? 200,
    });
  }, summary?.count);
}
