import { useRef, useCallback } from "react";

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

const HANDLE_STYLE: Record<Dir, React.CSSProperties> = {
  nw: { top: -4,    left: -4 },
  n:  { top: -4,    left: "50%", transform: "translateX(-50%)" },
  ne: { top: -4,    right: -4 },
  e:  { top: "50%", right: -4,  transform: "translateY(-50%)" },
  se: { bottom: -4, right: -4 },
  s:  { bottom: -4, left: "50%", transform: "translateX(-50%)" },
  sw: { bottom: -4, left: -4 },
  w:  { top: "50%", left: -4,   transform: "translateY(-50%)" },
};

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

  const startResize = useCallback((e: React.MouseEvent, dir: Dir) => {
    e.preventDefault();
    e.stopPropagation();

    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    const startX = e.clientX;
    const startY = e.clientY;
    const startW = width  !== undefined ? width  : rect.width;
    const startH = height !== undefined ? height : rect.height;
    // Canvas root nodes always have x/y; fall back to DOM rect if missing
    const startNodeX = x !== undefined ? x : Math.round(rect.left - (el.closest("[data-canvas]")?.getBoundingClientRect().left ?? 0));
    const startNodeY = y !== undefined ? y : Math.round(rect.top  - (el.closest("[data-canvas]")?.getBoundingClientRect().top  ?? 0));
    const movesW = dir.includes("w");
    const movesE = dir.includes("e");
    const movesN = dir.includes("n");
    const movesS = dir.includes("s");

    let liveW: number | undefined = width;
    let liveH: number | undefined = height;
    let liveX: number | undefined = x;
    let liveY: number | undefined = y;

    function onMove(ev: MouseEvent) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

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
  }, [width, height, onResizeLive, onResizeCommit]);

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
            ...HANDLE_STYLE[dir],
            width: 8, height: 8,
            background: "white",
            border: "1.5px solid var(--twilio-blue)",
            borderRadius: 2,
            cursor: CURSOR[dir],
            zIndex: 50,
          }}
          title="Drag to resize"
        />
      ))}
    </div>
  );
}
