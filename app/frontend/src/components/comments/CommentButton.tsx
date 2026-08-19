/**
 * The one comment affordance in the app.
 *
 * Before this existed there were four different speech bubbles (a filled 43×43 one in
 * `components/CommentIcon.tsx`, a rounded outline blob in three modal headers, a square
 * outline one in `StepsPanel`, and a 💬 emoji in the calendar and reminder menus) plus
 * three different count formats. Every trigger now renders `CommentIcon` at one of two
 * sizes with the same colours and the same count badge.
 *
 * - Tinted (indigo) whenever the record already has comments, so the icon itself is a
 *   signal, not just a button.
 * - Focus outline suppressed. `index.css` applies a global `*:focus-visible` blue
 *   outline, which on a small round icon button reads as an unexplained blue ring
 *   sitting on the record after the panel opens.
 */
import CommentIcon from "../CommentIcon";

interface Props {
  /** Total comments on the record; `undefined` while the rollup is still loading. */
  count?: number;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** `sm` for inline card rails, `md` for modal and panel headers. */
  size?: "sm" | "md";
  /** Extra classes for positioning only — colours come from here. */
  className?: string;
  buttonRef?: React.Ref<HTMLButtonElement>;
}

export default function CommentButton({
  count,
  onClick,
  size = "md",
  className = "",
  buttonRef,
}: Props) {
  const hasComments = (count ?? 0) > 0;
  const iconSize = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      title={hasComments ? `${count} comment${count === 1 ? "" : "s"}` : "Add a comment"}
      aria-label={hasComments ? `Comments (${count})` : "Add a comment"}
      className={[
        "inline-flex items-center gap-0.5 rounded p-1 transition-colors shrink-0",
        "outline-none focus:outline-none focus-visible:outline-none",
        hasComments ? "text-indigo-600 hover:text-indigo-700" : "text-gray-400 hover:text-indigo-600",
        className,
      ].join(" ")}
    >
      <CommentIcon className={iconSize} />
      {hasComments && (
        <span className={`font-semibold leading-none ${size === "sm" ? "text-[9px]" : "text-[10px]"}`}>
          {count}
        </span>
      )}
    </button>
  );
}
