/**
 * CommentPreviewList — the newest few comments, rendered on the record itself.
 *
 * Comments used to be invisible until you opened the floating panel, so a record with
 * an active conversation looked identical to one with none. This renders the latest
 * comments (3 by default, server-capped) inline on the card / modal, with a "+N more"
 * affordance that opens the full thread.
 *
 * Data comes from `useCommentSummary`, which coalesces every mounted preview on a page
 * into one batched request per resource type — so putting this on 80 cards costs one
 * request, not 80.
 *
 * Renders `null` when the record has no comments, so it adds nothing to the layout of
 * a record nobody has commented on.
 */
import { useCommentContext } from "./CommentContext";
import { useCommentSummary } from "../../hooks/useCommentSummary";
import type { CommentResourceType } from "../../types";

interface Props {
  resourceType: CommentResourceType;
  resourceId: number | null | undefined;
  resourceLabel?: string;
  /**
   * Override for opening the full thread, receiving viewport coords. Defaults to the
   * global comment panel — the same one the comment icon and right-click menu open, so
   * a card never has its own competing thread UI.
   */
  onOpen?: (x: number, y: number) => void;
  /** `card` = 1-line clamp for dense lists, `panel` = 2-line clamp with more room. */
  variant?: "card" | "panel";
  /**
   * Set false when this renders inside a `<button>` (e.g. an accounts list row).
   * Nested buttons are invalid HTML and Chrome drops the inner one's clicks; the
   * "+N more" affordance becomes plain text and the enclosing row's own right-click
   * handler is what opens the thread.
   */
  interactive?: boolean;
  className?: string;
}

export default function CommentPreviewList({
  resourceType,
  resourceId,
  resourceLabel = "",
  onOpen,
  variant = "card",
  interactive = true,
  className = "",
}: Props) {
  const summary = useCommentSummary(resourceType, resourceId);
  const { openComments } = useCommentContext();

  const openThread = onOpen ?? ((x: number, y: number) => {
    if (resourceId) openComments({ resourceType, resourceId, resourceLabel, x, y });
  });

  if (!summary || summary.count === 0) return null;

  const shown = summary.comments;
  const hidden = summary.count - shown.length;
  const clamp = variant === "card" ? 1 : 2;
  const label = hidden > 0
    ? `+${hidden} more comment${hidden === 1 ? "" : "s"}`
    : "View thread";

  function open(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openThread(rect.left, rect.bottom + 4);
  }

  return (
    <div
      className={`flex flex-col gap-1 border-l-2 border-indigo-200 pl-2 ${className}`}
      data-testid="comment-preview-list"
    >
      {shown.map((c) => (
        <div key={c.id} className="flex items-start gap-1.5 min-w-0">
          <span
            className="w-3.5 h-3.5 mt-px rounded-full bg-indigo-600 text-white text-[8px] font-bold flex items-center justify-center shrink-0"
            title={c.author_display}
          >
            {(c.author_display || "?")[0].toUpperCase()}
          </span>
          <p
            className="text-[10px] leading-snug text-[var(--twilio-navy)] opacity-70 min-w-0 flex-1"
            style={{
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: clamp,
              WebkitBoxOrient: "vertical",
              overflowWrap: "anywhere",
            }}
          >
            <span className="font-semibold opacity-90">{c.author_display}: </span>
            {c.content}
          </p>
        </div>
      ))}
      {interactive ? (
        <button
          type="button"
          onClick={open}
          className="self-start text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 hover:underline outline-none focus:outline-none focus-visible:outline-none"
        >
          {label}
        </button>
      ) : (
        <span className="self-start text-[10px] font-semibold text-indigo-600">{label}</span>
      )}
    </div>
  );
}
