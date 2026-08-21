import { useRef, useCallback } from "react";
import { useCanvasView } from "./CanvasViewContext";

type Dir = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

const CURSOR: Record<Dir, string> = {
  n:  "ns-resize",
  ne: "nesw-resize",
  e:  "ew-resize",
  se: "nwse-resize",
  s:  "ns-resize",
  sw: "nesw-resize",
  w:  "ew-resize",
  nw: "nwse-resize",
};

/**
 * Handle placement. Offsets are divided by the canvas zoom because this wrapper
 * renders inside the scaled transform layer — a literal `-4` would become -20px
 * at 500% and -0.4px at 10%, so the handles would drift off the corner and
 * become unclickable. Percentage transforms are scale-invariant and stay put.
 */
function handleOffsets(dir: Dir, zoom: number): React.CSSProperties {
  const o = -4 / zoom;
  switch (dir) {
    case "nw": return { top: o,        left: o };
    case "n":  return { top: o,        left: "50%", transform: "translateX(-50%)" };
    case "ne": return { top: o,        right: o };
    case "e":  return { top: "50%",    right: o,    transform: "translateY(-50%)" };
    case "se": return { bottom: o,     right: o };
    case "s":  return { bottom: o,     left: "50%", transform: "translateX(-50%)" };
    case "sw": return { bottom: o,     left: o };
    case "w":  return { top: "50%",    left: o,     transform: "translateY(-50%)" };
  }
}

const ALL_DIRS: Dir[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

interface Props {
  width:          number | undefined;
  height:         number | undefined;
  x?:             number;
  y?:             number;
  /** Called on every mousemove — no history entry */
  onResizeLive:   (w: number | undefined, h: number | undefined, x?: number, y?: number) => void;
  /** Called on mouseup — commits to undo stack */
  onResizeCommit: (w: number | undefined, h: number | undefined, x?: number, y?: number) => void;
  isSelected:     boolean;
  children:       React.ReactNode;
}

export default function ResizableWrapper({
  width, height, x, y, onResizeLive, onResizeCommit, isSelected, children,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { zoom } = useCanvasView();

  const startResize = useCallback((e: React.MouseEvent, dir: Dir) => {
    e.preventDefault();
    e.stopPropagation();

    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    const startX = e.clientX;
    const startY = e.clientY;
    // getBoundingClientRect is post-transform, so an auto-sized node measures
    // `zoom`× its content size — divide back out before using it as a width.
    const startW = width  !== undefined ? width  : rect.width  / zoom;
    const startH = height !== undefined ? height : rect.height / zoom;
    // Canvas root nodes always have x/y; fall back to DOM rect if missing
    const startNodeX = x !== undefined ? x : Math.round((rect.left - (el.closest("[data-canvas]")?.getBoundingClientRect().left ?? 0)) / zoom);
    const startNodeY = y !== undefined ? y : Math.round((rect.top  - (el.closest("[data-canvas]")?.getBoundingClientRect().top  ?? 0)) / zoom);
    const movesW = dir.includes("w");
    const movesE = dir.includes("e");
    const movesN = dir.includes("n");
    const movesS = dir.includes("s");

    let liveW: number | undefined = width;
    let liveH: number | undefined = height;
    let liveX: number | undefined = x;
    let liveY: number | undefined = y;

    function onMove(ev: MouseEvent) {
      // Pointer travel is screen px; the node's width/height are content px.
      const dx = (ev.clientX - startX) / zoom;
      const dy = (ev.clientY - startY) / zoom;

      // E/S: right and bottom edges move — position unchanged
      if (movesE) liveW = Math.max(60, startW + dx);
      if (movesS) liveH = Math.max(24, startH + dy);

      // W: left edge moves — widen and shift x so right edge stays fixed
      if (movesW) {
        liveW = Math.max(60, startW - dx);
        liveX = startNodeX + (startW - liveW);
      }

      // N: top edge moves — heighten and shift y so bottom edge stays fixed
      if (movesN) {
        liveH = Math.max(24, startH - dy);
        liveY = startNodeY + (startH - liveH);
      }

      onResizeLive(liveW, liveH, liveX, liveY);
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
      onResizeCommit(liveW, liveH, liveX, liveY);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
  }, [width, height, x, y, onResizeLive, onResizeCommit, zoom]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width:    width  ? `${width}px`  : undefined,
        height:   height ? `${height}px` : undefined,
        overflow: "visible",
        display:  "block",
      }}
    >
      {children}

      {isSelected && ALL_DIRS.map((dir) => (
        <div
          key={dir}
          onMouseDown={(e) => startResize(e, dir)}
          style={{
            position: "absolute",
            ...handleOffsets(dir, zoom),
            width: 8 / zoom, height: 8 / zoom,
            background: "white",
            border: `${1.5 / zoom}px solid var(--twilio-blue)`,
            borderRadius: 2 / zoom,
            cursor: CURSOR[dir],
            zIndex: 50,
          }}
          title="Drag to resize"
        />
      ))}
    </div>
  );
}
