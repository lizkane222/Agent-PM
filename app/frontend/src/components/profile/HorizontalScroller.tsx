import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A single row of cards that scrolls sideways. When there is more to see off either edge, that
 * edge gets an inner shadow — the cue that the row scrolls. The shadow disappears once the edge
 * is reached, so a row that fits shows no shadow at all.
 *
 * The shadows are overlays with `pointer-events: none`, so they never block a click or a drag
 * on the cards underneath.
 */
export function scrollEdges(el: Pick<HTMLElement, "scrollLeft" | "scrollWidth" | "clientWidth">) {
  const max = el.scrollWidth - el.clientWidth;
  // 1px of slack: fractional scroll positions on high-DPI screens never quite reach `max`.
  return { left: el.scrollLeft > 1, right: max > 1 && el.scrollLeft < max - 1 };
}

const SHADOW = "rgba(13, 27, 46, 0.22)";

export default function HorizontalScroller({
  children,
  label,
  gap = 10,
}: {
  children: ReactNode;
  /** Accessible name for the scrolling region. */
  label: string;
  gap?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const next = scrollEdges(el);
    setEdges((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
  }, []);

  // Re-measure after every render: cards come and go, and a new card is what creates overflow.
  useEffect(() => {
    update();
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    window.addEventListener("resize", update);
    // jsdom (and very old browsers) have no ResizeObserver; the window listener is the fallback.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      window.removeEventListener("resize", update);
      ro?.disconnect();
    };
  }, [update]);

  const overlay = (side: "left" | "right"): React.CSSProperties => ({
    position: "absolute",
    top: 0,
    bottom: 0,
    [side]: 0,
    width: 28,
    pointerEvents: "none",
    borderRadius: side === "left" ? "10px 0 0 10px" : "0 10px 10px 0",
    background: `linear-gradient(to ${side === "left" ? "right" : "left"}, ${SHADOW}, rgba(13, 27, 46, 0))`,
    transition: "opacity 0.15s",
  });

  return (
    <div style={{ position: "relative" }}>
      <div
        ref={ref}
        role="region"
        aria-label={label}
        tabIndex={0}
        onScroll={update}
        style={{ display: "flex", gap, overflowX: "auto", overflowY: "hidden", padding: "2px 2px 8px", scrollbarWidth: "thin" }}
      >
        {children}
      </div>
      {edges.left && <div data-testid="scroll-shadow-left" aria-hidden style={overlay("left")} />}
      {edges.right && <div data-testid="scroll-shadow-right" aria-hidden style={overlay("right")} />}
    </div>
  );
}
