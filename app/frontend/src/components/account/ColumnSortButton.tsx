import { useStatusLabels } from "../../hooks/useStatusLabels";
import type { ColumnSortDirection } from "../../hooks/useStatusArrivalOrder";

interface Props {
  status: string;
  direction: ColumnSortDirection | null;
  onToggle: (status: string) => void;
  className?: string;
}

/** Header toggle for a kanban column. The label names what a click will do. */
export default function ColumnSortButton({ status, direction, onToggle, className = "" }: Props) {
  const { label } = useStatusLabels();
  const shown = label(status);
  const next = direction === "newest" ? "oldest first" : "newest first";
  return (
    <button
      type="button"
      aria-label={`Sort ${shown} ${next}`}
      title={`Sort ${shown} ${next}`}
      data-sort={direction ?? "default"}
      onClick={(e) => { e.stopPropagation(); onToggle(status); }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={`shrink-0 text-[11px] leading-none font-normal px-1 rounded hover:bg-black/5 ${direction ? "opacity-100" : "opacity-50"} ${className}`}
    >
      {direction === "oldest" ? "↑" : "↓"}
    </button>
  );
}
