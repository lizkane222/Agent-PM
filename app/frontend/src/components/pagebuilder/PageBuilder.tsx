import { useCallback, useRef, useEffect, useState, useMemo } from "react";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  useDroppable,
} from "@dnd-kit/core";
import { useExport, type ExportItem } from "../../context/ExportContext";
import ComponentPalette from "./ComponentPalette";
import DraggableNode from "./DraggableNode";
import PropEditor from "./PropEditor";
import SaveLayoutModal from "./SaveLayoutModal";
import LayoutsLibrary from "./LayoutsLibrary";
import CanvasContextMenu from "./CanvasContextMenu";
import CanvasExportModal from "./CanvasExportModal";
import SaveVariantModal from "./SaveVariantModal";
import TeamMemberPicker, { type PickedMember } from "./TeamMemberPicker";
import TimelineFetchModal from "./TimelineFetchModal";
import { accountsApi } from "../../lib/api";
import { useCurrentUser } from "../../context/CurrentUserContext";
import type { Account, PageLayout } from "../../types";
import { loadVariants, addVariant, updateVariant, deleteVariant, type ComponentVariant } from "./variantStore";
import { useCanvasState, makeNode, removeNode, findNode, CANVAS_DRAFT_KEY } from "./useCanvasState";
import { useCanvasViewport, wheelZoomFactor } from "./useCanvasViewport";
import CanvasZoomSlider from "./CanvasZoomSlider";
import CanvasViewContext from "./CanvasViewContext";
import { EXPORT_ITEM_DRAG_KEY } from "../ExportBar";
import type { CanvasNode } from "./types";
import { COMPONENT_REGISTRY } from "./registry";
import { layoutsApi } from "../../lib/api";

const DEFAULT_SIZE: Record<string, { w: number; h: number }> = {
  Page:       { w: 816, h: 1056 }, // US Letter @96dpi; absent = silent 200×60 fallback
  Container:  { w: 320, h: 120 },
  Row:        { w: 320, h: 48 },
  Column:     { w: 160, h: 120 },
  Card:       { w: 260, h: 100 },
  Section:    { w: 360, h: 120 },
  Heading:    { w: 200, h: 40 },
  Text:       { w: 200, h: 32 },
  RichText:   { w: 280, h: 80 },
  Label:      { w: 120, h: 20 },
  Divider:    { w: 240, h: 16 },
  Button:     { w: 120, h: 40 },
  Badge:      { w: 80,  h: 28 },
  Pill:       { w: 80,  h: 28 },
  StatCard:   { w: 160, h: 72 },
  Table:      { w: 360, h: 100 },
  Avatar:     { w: 40,  h: 40 },
  Icon:       { w: 28,  h: 28 },
  Timeline:          { w: 560, h: 80 },
  ActionItemCard:    { w: 260, h: 40 },
  AccountCard:       { w: 240, h: 40 },
  ReminderCard:      { w: 240, h: 40 },
  CalendarEventCard: { w: 260, h: 40 },
  TeamMemberCard:    { w: 240, h: 40 },
};

function addChildToTree(root: CanvasNode[], parentId: string, child: CanvasNode): CanvasNode[] {
  return root.map((n) => {
    if (n.id === parentId) return { ...n, children: [...n.children, child] };
    return { ...n, children: addChildToTree(n.children, parentId, child) };
  });
}

function updateNodeXY(root: CanvasNode[], id: string, x: number, y: number): CanvasNode[] {
  return root.map((n) => {
    if (n.id === id) return { ...n, props: { ...n.props, x, y } };
    return { ...n, children: updateNodeXY(n.children, id, x, y) };
  });
}

type Rect = { x: number; y: number; w: number; h: number };

function getNodeRect(node: CanvasNode): Rect {
  const x = (node.props.x as number) ?? 0;
  const y = (node.props.y as number) ?? 0;
  const w = (node.props.width as number) ?? 120;
  const h = (node.props.height as number) ?? 40;
  return { x, y, w, h };
}

function rectsIntersect(a: Rect, b: Rect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * True if `id` sits inside a Page whose `locked` prop is set.
 *
 * A locked page's children are already unreachable by pointer (the sheet captures
 * events and the children container goes inert), so this is a belt-and-braces
 * guard for any path that doesn't go through the mouse.
 */
export function isInsideLockedPage(nodes: CanvasNode[], id: string): boolean {
  const walk = (list: CanvasNode[], lockedAbove: boolean): boolean => {
    for (const n of list) {
      const locked = lockedAbove || (n.type === "Page" && n.props.locked === true);
      if (n.id === id) return lockedAbove; // the page itself is movable when locked
      if (n.children.length > 0 && walk(n.children, locked)) return true;
    }
    return false;
  };
  return walk(nodes, false);
}

/**
 * Which nodes a rubber-band selection should grab.
 *
 * Rules, per the Page design:
 *  - A **Page is never selected by marquee** — it is a sheet that sits underneath,
 *    and is selected by clicking its title bar instead.
 *  - An **unlocked** Page's children *are* candidates, so sweeping over a page
 *    grabs the components on it. This is why the walk descends.
 *  - A **locked** Page contributes nothing, itself or its children: locked means
 *    the page and its contents are a single object, so there is nothing inside it
 *    to select individually.
 *
 * Hit-testing reads live DOM rects rather than `props.x/y/width/height`, because
 * a nested node's stored x/y are *parent-relative* (so comparing them against a
 * canvas-space box is meaningless), and auto-height nodes like `RecordCard` carry
 * no `height` prop at all — `getNodeRect` would score them as 120×40.
 *
 * `box` and the returned geometry are both in viewport pixels, so zoom and pan
 * need no compensation: they are already baked into `getBoundingClientRect`.
 */
export function marqueeHits(nodes: CanvasNode[], box: Rect, viewportRect: { left: number; top: number }): string[] {
  const hits: string[] = [];

  const rectFor = (id: string): Rect | null => {
    const el = document.querySelector(`[data-node-id="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    // jsdom (and a not-yet-laid-out node) reports all zeros; a zero-area rect
    // would intersect nothing, so skip rather than score it as a hit at 0,0.
    if (r.width === 0 && r.height === 0) return null;
    return { x: r.left - viewportRect.left, y: r.top - viewportRect.top, w: r.width, h: r.height };
  };

  const walk = (list: CanvasNode[]) => {
    for (const n of list) {
      if (n.type === "Page") {
        if (n.props.locked !== true) walk(n.children);
        continue; // never the page itself
      }
      const r = rectFor(n.id);
      if (r && rectsIntersect(r, box)) hits.push(n.id);
    }
  };

  walk(nodes);
  return hits;
}

// Snap guides: lines to draw when active node aligns with others
type SnapLine = { kind: "h" | "v"; pos: number; from: number; to: number };

function computeSnapLines(activeId: string | null, nodes: CanvasNode[]): SnapLine[] {
  if (!activeId) return [];
  const active = nodes.find((n) => n.id === activeId);
  if (!active) return [];
  const ar = getNodeRect(active);
  const lines: SnapLine[] = [];
  const SNAP_THRESH = 6;

  for (const n of nodes) {
    if (n.id === activeId) continue;
    const r = getNodeRect(n);
    const aEdges = { l: ar.x, r: ar.x + ar.w, cx: ar.x + ar.w / 2, t: ar.y, b: ar.y + ar.h, cy: ar.y + ar.h / 2 };
    const bEdges = { l: r.x,  r: r.x + r.w,   cx: r.x + r.w / 2,   t: r.y,  b: r.y + r.h,   cy: r.y + r.h / 2  };

    const vPairs: [number, number][] = [[aEdges.l, bEdges.l],[aEdges.r, bEdges.r],[aEdges.cx, bEdges.cx],[aEdges.l, bEdges.r],[aEdges.r, bEdges.l]];
    for (const [a, b] of vPairs) {
      if (Math.abs(a - b) < SNAP_THRESH) {
        lines.push({ kind: "v", pos: b, from: Math.min(ar.y, r.y), to: Math.max(ar.y + ar.h, r.y + r.h) });
      }
    }
    const hPairs: [number, number][] = [[aEdges.t, bEdges.t],[aEdges.b, bEdges.b],[aEdges.cy, bEdges.cy],[aEdges.t, bEdges.b],[aEdges.b, bEdges.t]];
    for (const [a, b] of hPairs) {
      if (Math.abs(a - b) < SNAP_THRESH) {
        lines.push({ kind: "h", pos: b, from: Math.min(ar.x, r.x), to: Math.max(ar.x + ar.w, r.x + r.w) });
      }
    }
  }
  return lines;
}

/**
 * Screen-space dot spacing for the infinite grid.
 *
 * The content grid is 24px, so at zoom 0.1 the dots would be 2.4px apart
 * (a grey moiré smear) and at zoom 5 they'd be 120px apart (a mostly empty
 * page). Doubling/halving keeps the spacing between 12 and 96 screen px at
 * every zoom, and because the factor is always a power of two the visible dots
 * stay a subset — or superset — of the real 24px grid rather than drifting off it.
 */
export function gridSpacingFor(zoom: number): number {
  let spacing = 24 * zoom;
  if (!Number.isFinite(spacing) || spacing <= 0) return 24;
  while (spacing < 12) spacing *= 2;
  while (spacing > 96) spacing /= 2;
  return spacing;
}

// Viewport (clips, paints the infinite grid, owns the gestures) wrapping a
// zero-size transform layer (the content origin — pan/zoom live here).
function CanvasArea({
  nodes, selectedId, multiSelectedIds, onSelect, onDelete, onResizeLive, onResizeCommit, onUpdateProps, canvasRef, viewportRef, onDeselect, onMarqueeSelect, onExportItemDrop, onNodeContextMenu, onImportTeamMembers, onFetchTimelineMeetings, zoom, panX, panY, onZoomByAt, onPanBy,
}: {
  nodes: CanvasNode[];
  selectedId: string | null;
  multiSelectedIds: string[];
  onSelect: (id: string, shift: boolean) => void;
  onDelete: (id: string) => void;
  onResizeLive:   (id: string, w: number | undefined, h: number | undefined, x?: number, y?: number) => void;
  onResizeCommit: (id: string, w: number | undefined, h: number | undefined, x?: number, y?: number) => void;
  onUpdateProps: (id: string, props: Record<string, unknown>) => void;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  onDeselect: () => void;
  onMarqueeSelect: (ids: string[]) => void;
  onExportItemDrop: (item: ExportItem, x: number, y: number, targetNodeId: string | null) => void;
  onNodeContextMenu: (id: string, e: React.MouseEvent) => void;
  onImportTeamMembers: (anchorNodeId: string) => void;
  onFetchTimelineMeetings: (nodeId: string) => void;
  zoom: number;
  panX: number;
  panY: number;
  onZoomByAt: (factor: number, anchorX: number, anchorY: number) => void;
  onPanBy: (dx: number, dy: number) => void;
}) {
  // The droppable is the viewport, not the transform layer: the transform layer
  // is 0×0 (its children are absolutely positioned), so dnd-kit would measure
  // an empty rect and `pointerWithin` would never resolve `drop:root`.
  const { setNodeRef, isOver } = useDroppable({ id: "drop:root" });

  // Marquee is tracked in *screen* px relative to the viewport, so its border
  // stays a hairline at every zoom; hit-testing converts to content space.
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const marqueeRef = useRef(marquee);
  marqueeRef.current = marquee;
  const [isPanning, setIsPanning] = useState(false);

  const mergedViewportRef = useCallback((el: HTMLDivElement | null) => {
    setNodeRef(el);
    (viewportRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
  }, [setNodeRef, viewportRef]);

  // Callback ref (not `ref={canvasRef}`) so the nullable ref object typechecks
  // the same way `mergedViewportRef` does.
  const setCanvasRef = useCallback((el: HTMLDivElement | null) => {
    (canvasRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
  }, [canvasRef]);

  // Snap guide computation (only while dragging selected node)
  const snapLines = useMemo(() => computeSnapLines(selectedId, nodes), [selectedId, nodes]);

  // Screen (viewport-relative) → content coordinates.
  const toContent = useCallback((clientX: number, clientY: number) => {
    const el = viewportRef.current;
    const rect = el?.getBoundingClientRect();
    const vx = clientX - (rect?.left ?? 0);
    const vy = clientY - (rect?.top ?? 0);
    return { x: (vx - panX) / zoom, y: (vy - panY) / zoom };
  }, [viewportRef, panX, panY, zoom]);

  // ── Wheel: zoom the canvas, never the page ────────────────────────────────
  // Registered natively with `passive: false`. React's onWheel is attached
  // passively at the root, so preventDefault() there is ignored and ⌘/ctrl+wheel
  // falls through to the browser's own page zoom.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      // ctrlKey is also how trackpad pinch arrives, so pinch zooms too.
      if (e.ctrlKey || e.metaKey) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        onZoomByAt(wheelZoomFactor(e.deltaY, e.deltaMode), e.clientX - rect.left, e.clientY - rect.top);
      } else {
        onPanBy(-e.deltaX, -e.deltaY);
      }
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [viewportRef, onZoomByAt, onPanBy]);

  // ── Mouse down on the background: marquee (left) or pan (middle) ──────────
  function onViewportMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    // Middle-drag pans, anywhere — including over a node.
    if (e.button === 1) {
      e.preventDefault();
      setIsPanning(true);
      let lastX = e.clientX;
      let lastY = e.clientY;

      const onMove = (ev: MouseEvent) => {
        onPanBy(ev.clientX - lastX, ev.clientY - lastY);
        lastX = ev.clientX;
        lastY = ev.clientY;
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        setIsPanning(false);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      return;
    }

    if (e.button !== 0) return;
    // Only start a marquee on the background — the viewport itself or the
    // (empty) transform layer, never on a node.
    const target = e.target as HTMLElement;
    if (target !== e.currentTarget && target !== canvasRef.current) return;
    e.preventDefault();

    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    setMarquee({ x: sx, y: sy, w: 0, h: 0 });

    function onMove(ev: MouseEvent) {
      const mx = ev.clientX - rect.left;
      const my = ev.clientY - rect.top;
      setMarquee({
        x: Math.min(sx, mx),
        y: Math.min(sy, my),
        w: Math.abs(mx - sx),
        h: Math.abs(my - sy),
      });
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const m = marqueeRef.current;
      if (m && (m.w > 4 || m.h > 4)) {
        // The marquee box is already in viewport pixels, and so are the DOM rects
        // we compare against, so no zoom/pan conversion is needed here at all.
        onMarqueeSelect(marqueeHits(nodes, { x: m.x, y: m.y, w: m.w, h: m.h }, rect));
      } else {
        onDeselect();
      }
      setMarquee(null);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const gridSpacing = gridSpacingFor(zoom);

  return (
    <div
      ref={mergedViewportRef}
      onMouseDown={onViewportMouseDown}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
      onDrop={(e) => {
        e.preventDefault();
        const raw = e.dataTransfer.getData(EXPORT_ITEM_DRAG_KEY);
        if (!raw) return;
        try {
          const item = JSON.parse(raw) as ExportItem;
          const canvas = canvasRef.current;
          if (!canvas) return;
          // Walk up from the drop target to find if we landed on a canvas node
          let targetNodeId: string | null = null;
          let el = e.target as HTMLElement | null;
          while (el && el !== canvas) {
            const id = el.getAttribute("data-node-id");
            if (id) { targetNodeId = id; break; }
            el = el.parentElement;
          }
          const p = toContent(e.clientX, e.clientY);
          // `|| 0` guards a drop event with no coordinates: NaN would otherwise be
          // written into props.x/y, and a NaN position renders as no position at
          // all (React drops the style), stranding the card at the origin with a
          // corrupt value persisted into the saved layout.
          const cx = Math.max(0, Math.round(p.x) || 0);
          const cy = Math.max(0, Math.round(p.y) || 0);
          onExportItemDrop(item, cx, cy, targetNodeId);
        } catch { /* malformed payload */ }
      }}
      data-canvas-viewport
      className="flex-1 relative"
      style={{
        overflow: "hidden",
        backgroundColor: "var(--twilio-gray-10)",
        // The grid is painted on the viewport, offset by the pan and scaled by
        // the zoom, so it fills the visible area at every zoom and in every
        // direction — there is no canvas edge to reach.
        backgroundImage: "radial-gradient(circle, #AEBBC1 1px, transparent 1px)",
        backgroundSize: `${gridSpacing}px ${gridSpacing}px`,
        backgroundPosition: `${panX}px ${panY}px`,
        userSelect: marquee || isPanning ? "none" : undefined,
        cursor: isPanning ? "grabbing" : undefined,
      }}
    >
      {isOver && (
        <div className="absolute inset-0 pointer-events-none bg-indigo-50/30 z-0" />
      )}
      {nodes.length === 0 && !isOver && (
        <div className="absolute inset-0 flex flex-col items-center justify-center select-none pointer-events-none">
          <p className="text-5xl mb-3 opacity-10">⬡</p>
          <p className="text-sm text-[var(--twilio-gray-60)] font-medium">Drag components from the left panel</p>
          <p className="text-xs text-[var(--twilio-gray-40)] mt-1">Components are placed where you drop them</p>
        </div>
      )}

      {/* Transform layer — the content origin. Zero-size on purpose: every
          child is absolutely positioned, so it needs no extent, and having none
          is what makes the canvas unbounded in all four directions. */}
      <div
        ref={setCanvasRef}
        data-canvas
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          overflow: "visible",
          transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
          transformOrigin: "0 0",
        }}
      >
        {nodes.map((node) => (
          <DraggableNode
            key={node.id}
            node={node}
            selectedId={selectedId}
            multiSelectedIds={multiSelectedIds}
            onSelect={onSelect}
            onDelete={onDelete}
            onResizeLive={onResizeLive}
            onResizeCommit={onResizeCommit}
            onUpdateProps={onUpdateProps}
            onContextMenu={onNodeContextMenu}
            onImportTeamMembers={onImportTeamMembers}
            onFetchTimelineMeetings={onFetchTimelineMeetings}
            isRoot
          />
        ))}

        {/* Snap guides — 1 screen px at any zoom */}
        {snapLines.map((line, i) =>
          line.kind === "v" ? (
            <div key={i} className="pointer-events-none absolute z-50" style={{
              left: line.pos, top: line.from,
              width: 1 / zoom, height: line.to - line.from,
              background: "#F22F46", opacity: 0.8,
            }} />
          ) : (
            <div key={i} className="pointer-events-none absolute z-50" style={{
              top: line.pos, left: line.from,
              height: 1 / zoom, width: line.to - line.from,
              background: "#F22F46", opacity: 0.8,
            }} />
          )
        )}
      </div>

      {/* Marquee — screen space, so the border stays a hairline */}
      {marquee && marquee.w > 2 && marquee.h > 2 && (
        <div className="pointer-events-none absolute z-50" data-testid="canvas-marquee" style={{
          left: marquee.x, top: marquee.y,
          width: marquee.w, height: marquee.h,
          border: "1.5px solid #0263E0",
          background: "rgba(2,99,224,0.07)",
        }} />
      )}
    </div>
  );
}

// ExportRecordPill and ExportRecordModal removed — the global red ExportBar
// (rendered by Layout.tsx above the page) is now the single export tray.
// Its DraggablePill fires kind="export-item" which handleDragEnd handles below.

export default function PageBuilder() {
  const {
    nodes, commit,
    undo, redo, canUndo, canRedo,
    selectedId, setSelectedId,
    deleteNode,
    duplicateNode,
    copyNode,
    pasteNode,
    hasClipboard,
    updateProps,
    resizeLive,
    resizeCommit,
    getSelectedNode,
    clearCanvas,
  } = useCanvasState();

  const { zoom, panX, panY, zoomByAt, zoomToAt, panBy, resetView } = useCanvasViewport();

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  // Slider and keyboard zoom have no pointer to anchor on, so they anchor on the
  // middle of the viewport — whatever you are looking at stays centred.
  const zoomAtViewportCenter = useCallback((next: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    zoomToAt(next, (rect?.width ?? 0) / 2, (rect?.height ?? 0) / 2);
  }, [zoomToAt]);

  const zoomByAtViewportCenter = useCallback((factor: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    zoomByAt(factor, (rect?.width ?? 0) / 2, (rect?.height ?? 0) / 2);
  }, [zoomByAt]);

  // Memoised so every node inside the canvas doesn't re-render on unrelated
  // PageBuilder state changes (this context is read by every DraggableNode).
  const canvasView = useMemo(() => ({ zoom }), [zoom]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [multiSelectedIds, setMultiSelectedIds] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string; nodeType: string } | null>(null);
  const [saveVariantNodeId, setSaveVariantNodeId] = useState<string | null>(null);
  const [variants, setVariants] = useState<ComponentVariant[]>(() => loadVariants());
  const [teamPickerAnchorId, setTeamPickerAnchorId] = useState<string | null>(null);
  const [timelineNodeId, setTimelineNodeId] = useState<string | null>(null);
  const [currentLayout, setCurrentLayout] = useState<PageLayout | null>(null);
  const currentUser = useCurrentUser();
  const canEditCurrent = !!(
    currentLayout && currentUser &&
    (currentLayout.creator === currentUser.id || currentUser.is_staff)
  );

  // ── Auto-save draft to localStorage (debounced 1.5s) ─────────────────────
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (nodes.length === 0) return; // don't write an empty draft
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(CANVAS_DRAFT_KEY, JSON.stringify(nodes));
        setDraftSaved(true);
        setTimeout(() => setDraftSaved(false), 2000);
      } catch { /* storage full — ignore */ }
    }, 1500);
    return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current); };
  }, [nodes]);

  // Export tray — display is handled by ExportBar; drop handler receives the full item directly
  useExport();

  const handleShiftSelect = useCallback((id: string) => {
    setMultiSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
    setSelectedId(id);
  }, [setSelectedId]);

  const handleMarqueeSelect = useCallback((ids: string[]) => {
    setMultiSelectedIds(ids);
    if (ids.length === 1) setSelectedId(ids[0]);
    else if (ids.length === 0) setSelectedId(null);
  }, [setSelectedId]);

  async function handleSaveLayout(name: string, isPublic: boolean, mode: "update" | "create") {
    if (mode === "update" && currentLayout && canEditCurrent) {
      const { data } = await layoutsApi.update(currentLayout.id, { name, nodes, is_public: isPublic });
      setCurrentLayout(data);
    } else {
      const { data } = await layoutsApi.create({ name, nodes, is_public: isPublic });
      setCurrentLayout(data);
    }
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  }

  function handleLoadLayout(layout: PageLayout) {
    commit(layout.nodes as CanvasNode[]);
    setCurrentLayout(layout);
    setSelectedId(null);
  }

  function handleImportTeamMembers(anchorNodeId: string, picked: PickedMember[]) {
    const anchor = findNode(nodes, anchorNodeId);
    const ax = (anchor?.props.x as number) ?? 100;
    const ay = (anchor?.props.y as number) ?? 100;
    const W = 240;
    const GAP = 12;

    // Fill the anchor card itself with the first picked member, then spawn extra cards
    const newNodes: CanvasNode[] = [];
    picked.forEach((m, i) => {
      if (i === 0 && anchor) {
        updateProps(anchorNodeId, {
          ...anchor.props,
          fullName: m.fullName,
          title: m.title,
          email: m.email,
          role: m.role,
          accentColor: m.accentColor,
        });
      } else {
        const card = makeNode("TeamMemberCard");
        card.props.x = ax + (i * (W + GAP));
        card.props.y = ay;
        card.props.width = W;
        card.props.fullName = m.fullName;
        card.props.title = m.title;
        card.props.email = m.email;
        card.props.role = m.role;
        card.props.accentColor = m.accentColor;
        newNodes.push(card);
      }
    });
    if (newNodes.length > 0) commit([...nodes, ...newNodes]);
    setTeamPickerAnchorId(null);
  }

  async function handleTimelineFetch(nodeId: string, account: Account) {
    setTimelineNodeId(null);
    const node = findNode(nodes, nodeId);
    if (!node) return;
    const startDate = (node.props.startDate as string) || "";
    const endDate = (node.props.endDate as string) || "";
    try {
      const res = await accountsApi.listMeetings(account.id);
      const all = Array.isArray(res.data) ? res.data : [];
      const filtered = all.filter((m) => {
        if (!startDate && !endDate) return true;
        const t = new Date(m.start_datetime).getTime();
        const start = startDate ? new Date(startDate).getTime() : -Infinity;
        const end = endDate ? new Date(endDate + "T23:59:59").getTime() : Infinity;
        return t >= start && t <= end;
      });
      updateProps(nodeId, {
        ...node.props,
        accountId: account.id,
        accountName: account.company_name,
        meetings: filtered,
      });
    } catch { /* network error — leave props unchanged */ }
  }

  function handleSaveVariant(nodeId: string, name: string, scope: "me" | "all") {
    const node = findNode(nodes, nodeId);
    if (!node) return;
    const variant: ComponentVariant = {
      id: `variant-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      baseType: node.type,
      name,
      node: JSON.parse(JSON.stringify(node)),
      scope,
      pinned: false,
      hearted: false,
      createdAt: new Date().toISOString(),
    };
    const next = addVariant(variant);
    setVariants(next);
    setSaveVariantNodeId(null);
  }

  function fillAgentPMComponentProps(nodeType: string, item: ExportItem): Record<string, unknown> | null {
    const base: Record<string, unknown> = { accentColor: item.accent || "#0263E0" };
    if (nodeType === "ActionItemCard") {
      return {
        ...base,
        taskTitle: item.label,
        accountName: item.accountName || "",
        status: item.detail?.includes("in_progress") ? "In Progress" : "Open",
      };
    }
    if (nodeType === "AccountCard") {
      return { ...base, companyName: item.label };
    }
    if (nodeType === "ReminderCard") {
      return { ...base, title: item.label, body: item.summary || "" };
    }
    if (nodeType === "CalendarEventCard") {
      return { ...base, title: item.label };
    }
    if (nodeType === "TeamMemberCard") {
      return { ...base, fullName: item.label };
    }
    return null;
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      const tag = (e.target as HTMLElement).tagName;
      const isEditing = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable;

      if (!isEditing) {
        // Escape — deselect
        if (e.key === "Escape") { e.preventDefault(); setSelectedId(null); return; }

        // Delete / Backspace — remove selected node
        if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
          e.preventDefault();
          deleteNode(selectedId);
          return;
        }

        // Arrow keys — nudge selected node (1px, or 10px with Shift)
        const ARROW_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
        if (ARROW_KEYS.includes(e.key) && selectedId) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          const node = nodes.find((n) => n.id === selectedId);
          if (node) {
            const cx = Math.max(0, ((node.props.x as number) ?? 0) + (e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0));
            const cy = Math.max(0, ((node.props.y as number) ?? 0) + (e.key === "ArrowDown"  ? step : e.key === "ArrowUp"   ? -step : 0));
            commit(updateNodeXY(nodes, selectedId, cx, cy));
          }
          return;
        }
      }

      if (!mod) return;
      if (isEditing) return;

      if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if (e.key === "y")                { e.preventDefault(); redo(); }
      if (e.key === "z" && e.shiftKey)  { e.preventDefault(); redo(); }
      if (e.key === "d") {
        e.preventDefault();
        if (selectedId) duplicateNode(selectedId);
      }
      if (e.key === "c") {
        e.preventDefault();
        if (selectedId) copyNode(selectedId);
      }
      if (e.key === "v") {
        e.preventDefault();
        pasteNode();
      }
      // Zoom shortcuts. preventDefault also stops the browser's own ⌘+/⌘-/⌘0
      // page zoom, so these only ever move the canvas.
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        zoomByAtViewportCenter(1.2);
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomByAtViewportCenter(1 / 1.2);
      }
      if (e.key === "0") {
        e.preventDefault();
        resetView();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, selectedId, deleteNode, duplicateNode, copyNode, pasteNode, nodes, commit, setSelectedId, zoomByAtViewportCenter, resetView]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over, delta } = event;
    if (!over) return;

    // dnd-kit reports `delta` and every `rect` in *screen* pixels. The canvas
    // stores content pixels, so each screen-space difference below is divided by
    // `zoom` before it becomes an x/y. Sizes that are already content-space
    // (`def.w`) are applied after that division, never before.
    const s = 1 / zoom;

    const overId = over.id as string;
    const activeData = active.data.current as {
      kind: string;
      componentType?: string;
      nodeId?: string;
      isRoot?: boolean;
      isNested?: boolean;
      presetProps?: Record<string, unknown>;
    };

    // ── Palette → canvas root ────────────────────────────────────────────────
    if (activeData.kind === "palette" && activeData.componentType && overId === "drop:root") {
      const type = activeData.componentType;
      const def = DEFAULT_SIZE[type] ?? { w: 200, h: 60 };
      const canvas = canvasRef.current;
      let x = 100, y = 100;
      if (canvas && event.activatorEvent instanceof PointerEvent) {
        const rect = canvas.getBoundingClientRect();
        const pointerX = (event.activatorEvent as PointerEvent).clientX + delta.x;
        const pointerY = (event.activatorEvent as PointerEvent).clientY + delta.y;
        x = Math.max(0, (pointerX - rect.left) * s - def.w / 2);
        y = Math.max(0, (pointerY - rect.top)  * s - def.h / 2);
      }
      const newNode = makeNode(type);
      if (activeData.presetProps) Object.assign(newNode.props, activeData.presetProps);
      newNode.props.x = Math.round(x);
      newNode.props.y = Math.round(y);
      // Pages go to the front of the array so paint order keeps them under
      // everything else (equal z-index ties break on DOM order).
      commit(type === "Page" ? [newNode, ...nodes] : [...nodes, newNode]);
      setSelectedId(newNode.id);
      return;
    }

    // ── Palette → child drop zone ────────────────────────────────────────────
    if (activeData.kind === "palette" && activeData.componentType && overId.startsWith("drop:")) {
      const parentId = overId.replace("drop:", "");
      const type = activeData.componentType;
      const def = DEFAULT_SIZE[type] ?? { w: 120, h: 40 };
      const newNode = makeNode(type);
      if (activeData.presetProps) Object.assign(newNode.props, activeData.presetProps);
      if (over.rect && event.activatorEvent instanceof PointerEvent) {
        const ptr = event.activatorEvent as PointerEvent;
        newNode.props.x = Math.max(0, Math.round((ptr.clientX + delta.x - over.rect.left) * s - def.w / 2));
        newNode.props.y = Math.max(0, Math.round((ptr.clientY + delta.y - over.rect.top)  * s - def.h / 2));
      } else {
        newNode.props.x = 16;
        newNode.props.y = 16;
      }
      commit(addChildToTree(nodes, parentId, newNode));
      setSelectedId(newNode.id);
      return;
    }

    // ── Canvas root node → reposition OR nest into container ────────────────
    if (activeData.kind === "canvas" && activeData.nodeId && activeData.isRoot) {
      const nodeId = activeData.nodeId;
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;

      // Dropped onto a child drop zone → nest it inside that container
      if (overId.startsWith("drop:") && overId !== "drop:root") {
        const parentId = overId.replace("drop:", "");
        if (parentId === nodeId) return;
        const withoutNode = removeNode(nodes, nodeId);
        // Use the element's initial screen rect to preserve grab-point accuracy
        const initialRect = active.rect.current?.initial;
        let nx = 16, ny = 16;
        if (initialRect && over.rect) {
          nx = Math.max(0, Math.round((initialRect.left + delta.x - over.rect.left) * s));
          ny = Math.max(0, Math.round((initialRect.top  + delta.y - over.rect.top)  * s));
        }
        const nestedNode = { ...node, props: { ...node.props, x: nx, y: ny } };
        commit(addChildToTree(withoutNode, parentId, nestedNode));
        return;
      }

      // Staying on canvas root — delta from original position is exact.
      // If the dragged node is part of a multi-selection, every selected node
      // moves by the same delta. Without this, marquee selection is inert:
      // selecting five components and dragging one moved that one and silently
      // left the other four behind. One `commit` = one undo entry for the group.
      if (multiSelectedIds.length > 1 && multiSelectedIds.includes(nodeId)) {
        const moving = new Set(multiSelectedIds);
        let next = nodes;
        for (const n of nodes) {
          if (!moving.has(n.id)) continue;
          if (isInsideLockedPage(nodes, n.id)) continue;
          const mx = Math.max(0, Math.round(((n.props.x as number) ?? 0) + delta.x * s));
          const my = Math.max(0, Math.round(((n.props.y as number) ?? 0) + delta.y * s));
          next = updateNodeXY(next, n.id, mx, my);
        }
        // Children of an unlocked page are selectable, so they can be in the
        // selection too — they live deeper than the root list.
        for (const id of moving) {
          if (nodes.some((n) => n.id === id)) continue; // already handled above
          const nested = findNode(nodes, id);
          if (!nested || isInsideLockedPage(nodes, id)) continue;
          const mx = Math.max(0, Math.round(((nested.props.x as number) ?? 0) + delta.x * s));
          const my = Math.max(0, Math.round(((nested.props.y as number) ?? 0) + delta.y * s));
          next = updateNodeXY(next, id, mx, my);
        }
        commit(next);
        return;
      }

      const cx = Math.max(0, Math.round(((node.props.x as number) ?? 0) + delta.x * s));
      const cy = Math.max(0, Math.round(((node.props.y as number) ?? 0) + delta.y * s));
      commit(updateNodeXY(nodes, nodeId, cx, cy));
      return;
    }

    // ── Canvas nested node → move within parent, re-nest, or unnest ─────────
    if (activeData.kind === "canvas" && activeData.nodeId && (activeData.isNested || !activeData.isRoot)) {
      const nodeId = activeData.nodeId;
      const movedNode = findNode(nodes, nodeId);
      if (!movedNode) return;
      // A locked page and its contents are one object: nothing inside it moves
      // on its own. Pointer-events already prevent this drag from starting, so
      // this only catches non-pointer paths.
      if (isInsideLockedPage(nodes, nodeId)) return;

      // Group move for a marquee selection inside a page. Deliberately a move in
      // place, not a re-nest: dragging a group is repositioning, and re-parenting
      // several nodes at once has no obvious correct target.
      if (multiSelectedIds.length > 1 && multiSelectedIds.includes(nodeId)) {
        let next = nodes;
        for (const id of multiSelectedIds) {
          const sel = findNode(nodes, id);
          if (!sel || isInsideLockedPage(nodes, id)) continue;
          const mx = Math.max(0, Math.round(((sel.props.x as number) ?? 0) + delta.x * s));
          const my = Math.max(0, Math.round(((sel.props.y as number) ?? 0) + delta.y * s));
          next = updateNodeXY(next, id, mx, my);
        }
        commit(next);
        return;
      }
      const withoutNode = removeNode(nodes, nodeId);
      const initialRect = active.rect.current?.initial;

      // Unnest: dropped onto the canvas root
      if (overId === "drop:root" || !overId.startsWith("drop:")) {
        const canvas = canvasRef.current;
        let x = 100, y = 100;
        if (initialRect && canvas) {
          const canvasRect = canvas.getBoundingClientRect();
          x = Math.max(0, Math.round((initialRect.left + delta.x - canvasRect.left) * s));
          y = Math.max(0, Math.round((initialRect.top  + delta.y - canvasRect.top)  * s));
        }
        commit([...withoutNode, { ...movedNode, props: { ...movedNode.props, x, y } }]);
        return;
      }

      const parentId = overId.replace("drop:", "");
      if (parentId === nodeId) return;

      // Move within same parent or into a different container
      let nx = Math.max(0, (movedNode.props.x as number ?? 16) + delta.x * s);
      let ny = Math.max(0, (movedNode.props.y as number ?? 16) + delta.y * s);
      if (initialRect && over.rect) {
        nx = Math.max(0, Math.round((initialRect.left + delta.x - over.rect.left) * s));
        ny = Math.max(0, Math.round((initialRect.top  + delta.y - over.rect.top)  * s));
      }
      const placedNode = { ...movedNode, props: { ...movedNode.props, x: Math.round(nx), y: Math.round(ny) } };
      commit(addChildToTree(withoutNode, parentId, placedNode));
    }

  }, [nodes, commit, setSelectedId, zoom, multiSelectedIds]);

  // ── Build a RecordCard node from an ExportItem ────────────────────────────
  // One self-contained node, no children and no `height`.
  //
  // This used to be a `Card` with a Badge/Text/Label/Text stack pinned at y
  // offsets 0/24/46/62, with `height` derived from those same constants. Card
  // children are absolutely positioned (DraggableNode), so nothing reflowed: a
  // title that wrapped to two lines needed 42px in a 22px slot and painted
  // straight over the account name, and an 80-char account-note title (three
  // lines) covered the account name *and* the summary. The summary had a 36px
  // budget for up to 140 chars — about 72px of text — so it also spilled out
  // below the card border. None of those constants can be made correct without
  // measuring text, hence a flow-layout node instead.
  const buildExportCard = useCallback((item: ExportItem, x: number, y: number): CanvasNode => {
    const card = makeNode("RecordCard");
    card.props.x = x;
    card.props.y = y;
    card.props.width = 280;
    card.props.accentColor = item.accent || "#6366f1";
    // Prefer the human label ("Action Item") over the raw enum ("action_item"),
    // which is all the non-search producers set.
    card.props.typeLabel = item.typeLabel || item.type.replace(/_/g, " ");
    card.props.recordTitle = item.label;
    card.props.accountName = item.accountName || "";
    // No truncation: the card grows to fit, so there is nothing to protect.
    card.props.summary = item.summary || item.detail || item.content || "";
    card.props.url = item.url || "";
    return card;
  }, []);

  // ── Handle HTML5 drop from ExportBar ─────────────────────────────────────
  const handleExportItemDrop = useCallback((item: ExportItem, x: number, y: number, targetNodeId: string | null) => {
    // If dropped onto an existing canvas node, try to fill it
    if (targetNodeId) {
      const target = findNode(nodes, targetNodeId);
      if (target) {
        const fill = fillAgentPMComponentProps(target.type, item);
        if (fill) {
          updateProps(target.id, { ...target.props, ...fill });
          setSelectedId(target.id);
          return;
        }
        // For any non-AgentPM node, still create a new card at the drop point
      }
    }
    const card = buildExportCard(item, x, y);
    commit([...nodes, card]);
    setSelectedId(card.id);
  }, [nodes, commit, setSelectedId, buildExportCard, updateProps]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedNode = getSelectedNode();

  return (
    <>
    {showSaveModal && (
      <SaveLayoutModal
        initialName={canEditCurrent ? currentLayout?.name : ""}
        initialIsPublic={canEditCurrent ? (currentLayout?.is_public ?? true) : true}
        editingOwned={canEditCurrent}
        onSave={handleSaveLayout}
        onClose={() => setShowSaveModal(false)}
      />
    )}
    {showExportModal && (
      <CanvasExportModal
        nodes={nodes}
        selectedId={selectedId}
        viewportRef={viewportRef}
        onClose={() => setShowExportModal(false)}
        onDeselectAll={() => { setSelectedId(null); setMultiSelectedIds([]); }}
      />
    )}
    {showLibrary && (
      <LayoutsLibrary
        currentUserId={currentUser?.id ?? null}
        isStaff={!!currentUser?.is_staff}
        activeLayoutId={currentLayout?.id ?? null}
        onLoad={handleLoadLayout}
        onDeleted={(id) => {
          if (currentLayout?.id === id) setCurrentLayout(null);
        }}
        onClose={() => setShowLibrary(false)}
      />
    )}
    {contextMenu && (
      <CanvasContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        nodeId={contextMenu.nodeId}
        nodeType={contextMenu.nodeType}
        pageLocked={findNode(nodes, contextMenu.nodeId)?.props.locked === true}
        onToggleLock={(id) => {
          const page = findNode(nodes, id);
          if (!page) return;
          const nowLocked = page.props.locked !== true;
          updateProps(id, { ...page.props, locked: nowLocked });
          // Same reason as the title-bar toggle: don't leave a child selected
          // inside a subtree that has just gone pointer-inert.
          if (nowLocked) setSelectedId(id);
          setContextMenu(null);
        }}
        onClose={() => setContextMenu(null)}
        onDelete={(id) => { deleteNode(id); setContextMenu(null); }}
        onDuplicate={(id) => { duplicateNode(id); setContextMenu(null); }}
        onCopy={(id) => { copyNode(id); setContextMenu(null); }}
        onSaveVariant={(id) => { setSaveVariantNodeId(id); setContextMenu(null); }}
      />
    )}
    {saveVariantNodeId && (() => {
      const node = findNode(nodes, saveVariantNodeId);
      return node ? (
        <SaveVariantModal
          nodeId={saveVariantNodeId}
          baseType={node.type}
          onSave={(name, scope) => handleSaveVariant(saveVariantNodeId, name, scope)}
          onClose={() => setSaveVariantNodeId(null)}
        />
      ) : null;
    })()}
    {teamPickerAnchorId && (
      <TeamMemberPicker
        onConfirm={(picked) => handleImportTeamMembers(teamPickerAnchorId, picked)}
        onClose={() => setTeamPickerAnchorId(null)}
      />
    )}
    {timelineNodeId && (
      <TimelineFetchModal
        onConfirm={(account) => handleTimelineFetch(timelineNodeId, account)}
        onClose={() => setTimelineNodeId(null)}
      />
    )}
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={handleDragEnd}>

      <div className="flex flex-col overflow-hidden" style={{ height: "calc(100vh - 56px)" }}>

        {/* ── Top toolbar ───────────────────────────────────────────────── */}
        <div className="h-10 shrink-0 border-b border-gray-200 bg-white flex items-center px-4 gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-[var(--twilio-gray-60)] mr-2">
            Page Builder
          </span>
          <div className="flex-1" />
          {draftSaved && (
            <span className="text-xs text-[var(--twilio-gray-60)] font-medium flex items-center gap-1">
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 4L6 11l-3-3"/>
              </svg>
              Draft saved
            </span>
          )}
          {saveSuccess && (
            <span className="text-xs text-emerald-600 font-medium">Layout saved!</span>
          )}
          <CanvasZoomSlider
            zoom={zoom}
            onZoomTo={zoomAtViewportCenter}
            onReset={resetView}
          />
          <button
            onClick={() => setShowLibrary(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-[var(--twilio-gray-60)] hover:border-gray-300 hover:text-[var(--twilio-navy)] transition-colors"
          >
            <span>⬡</span> Layout Library
          </button>
          <button
            onClick={() => nodes.length > 0 && setShowExportModal(true)}
            disabled={nodes.length === 0}
            title={nodes.length === 0 ? "Add components before exporting" : "Export pages or the whole canvas"}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-[var(--twilio-gray-60)] hover:border-gray-300 hover:text-[var(--twilio-navy)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <span>⤓</span> Export
          </button>
          <button
            onClick={() => nodes.length > 0 && setShowSaveModal(true)}
            disabled={nodes.length === 0}
            title={nodes.length === 0 ? "Add components before saving" : "Save current canvas as a layout"}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--twilio-blue)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            Save Layout
          </button>
        </div>

        {/* Export tray is shown in the global red ExportBar at the top of the page.
            Dragging a pill from that bar fires kind="export-item" which is handled
            in handleDragEnd below — no second tray needed here. */}

        <div className="flex flex-1 overflow-hidden">

        {/* ── Left: Component palette ──────────────────────────────────── */}
        <div className="w-52 shrink-0 border-r border-gray-200 bg-white overflow-hidden flex flex-col">
          <ComponentPalette
            variants={variants}
            onToggleVariantPin={(id) => setVariants(updateVariant(id, { pinned: !variants.find((v) => v.id === id)?.pinned }))}
            onToggleVariantHeart={(id) => setVariants(updateVariant(id, { hearted: !variants.find((v) => v.id === id)?.hearted }))}
            onDeleteVariant={(id) => setVariants(deleteVariant(id))}
          />
        </div>

        {/* ── Center: Free-position canvas ─────────────────────────────── */}
        <CanvasViewContext.Provider value={canvasView}>
          <CanvasArea
            nodes={nodes}
            selectedId={selectedId}
            multiSelectedIds={multiSelectedIds}
            onSelect={(id, shift) => {
              if (shift) {
                handleShiftSelect(id);
              } else {
                setMultiSelectedIds([]);
                setSelectedId(id);
              }
            }}
            onDelete={deleteNode}
            onResizeLive={resizeLive}
            onResizeCommit={resizeCommit}
            onUpdateProps={updateProps}
            canvasRef={canvasRef}
            onDeselect={() => { setSelectedId(null); setMultiSelectedIds([]); }}
            onMarqueeSelect={handleMarqueeSelect}
            onExportItemDrop={handleExportItemDrop as (item: ExportItem, x: number, y: number, targetNodeId: string | null) => void}
            onNodeContextMenu={(id, e) => {
              const node = findNode(nodes, id);
              if (node) setContextMenu({ x: e.clientX, y: e.clientY, nodeId: id, nodeType: node.type });
            }}
            onImportTeamMembers={(id) => setTeamPickerAnchorId(id)}
            onFetchTimelineMeetings={(id) => setTimelineNodeId(id)}
            viewportRef={viewportRef}
            zoom={zoom}
            panX={panX}
            panY={panY}
            onZoomByAt={zoomByAt}
            onPanBy={panBy}
          />
        </CanvasViewContext.Provider>

        {/* ── Right: Inspector panel ────────────────────────────────────── */}
        <div className="w-64 shrink-0 border-l border-gray-200 bg-white overflow-y-auto flex flex-col">

          {/* Header with undo/redo + copy/duplicate */}
          <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between shrink-0">
            <p className="text-xs font-bold uppercase tracking-widest text-[var(--twilio-gray-60)]">
              {selectedNode ? "Properties" : "Inspector"}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={undo}
                disabled={!canUndo}
                title="Undo (⌘Z)"
                className={`px-1.5 py-0.5 rounded text-xs font-semibold transition-colors ${
                  canUndo
                    ? "text-[var(--twilio-navy)] hover:bg-gray-100"
                    : "text-[var(--twilio-gray-40)] cursor-not-allowed"
                }`}
              >
                ↩
              </button>
              <button
                onClick={redo}
                disabled={!canRedo}
                title="Redo (⌘Y)"
                className={`px-1.5 py-0.5 rounded text-xs font-semibold transition-colors ${
                  canRedo
                    ? "text-[var(--twilio-navy)] hover:bg-gray-100"
                    : "text-[var(--twilio-gray-40)] cursor-not-allowed"
                }`}
              >
                ↪
              </button>
              {selectedNode && (
                <>
                  <div className="w-px h-3 bg-gray-200 mx-0.5" />
                  <button
                    onClick={() => copyNode(selectedNode.id)}
                    title="Copy (⌘C)"
                    className="px-1.5 py-0.5 rounded text-xs font-semibold text-[var(--twilio-navy)] hover:bg-gray-100 transition-colors"
                  >
                    ⎘
                  </button>
                  <button
                    onClick={() => duplicateNode(selectedNode.id)}
                    title="Duplicate (⌘D)"
                    className="px-1.5 py-0.5 rounded text-xs font-semibold text-[var(--twilio-navy)] hover:bg-gray-100 transition-colors"
                  >
                    ⧉
                  </button>
                </>
              )}
              {hasClipboard() && !selectedNode && (
                <>
                  <div className="w-px h-3 bg-gray-200 mx-0.5" />
                  <button
                    onClick={pasteNode}
                    title="Paste (⌘V)"
                    className="px-1.5 py-0.5 rounded text-xs font-semibold text-[var(--twilio-navy)] hover:bg-gray-100 transition-colors"
                  >
                    ⌘V
                  </button>
                </>
              )}
              {nodes.length > 0 && (
                <button
                  onClick={clearCanvas}
                  title="Clear canvas"
                  className="ml-1 text-[11px] text-red-400 hover:text-red-600 font-medium"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {selectedNode ? (
            <>
              <SizeControls node={selectedNode} onResize={resizeCommit} />
              <PropEditor node={selectedNode} onChange={updateProps} />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="text-center">
                <p className="text-3xl opacity-20 mb-2">⚙</p>
                <p className="text-xs text-[var(--twilio-gray-40)]">Select a component to edit its properties</p>
                {(canUndo || canRedo) && (
                  <p className="text-[10px] text-[var(--twilio-gray-40)] mt-3">
                    ⌘Z undo · ⌘Y redo
                  </p>
                )}
              </div>
            </div>
          )}

          {nodes.length > 0 && (
            <div className="border-t border-gray-100 px-3 py-2 shrink-0">
              <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--twilio-gray-60)] mb-1.5">Layers</p>
              <LayerTree nodes={nodes} selectedId={selectedId} onSelect={setSelectedId} onDelete={deleteNode} depth={0} />
            </div>
          )}
        </div>
        </div>
      </div>
    </DndContext>
    </>
  );
}

function SizeControls({ node, onResize }: {
  node: CanvasNode;
  onResize: (id: string, w: number | undefined, h: number | undefined, x?: number, y?: number) => void;
}) {
  const w = node.props.width  as number | undefined;
  const h = node.props.height as number | undefined;
  const x = node.props.x     as number | undefined;
  const y = node.props.y     as number | undefined;

  return (
    <div className="grid grid-cols-2 gap-1 px-3 py-2 border-b border-gray-100 bg-[#F8FAFC]">
      {([
        { label: "W", val: w, cb: (v: number | undefined) => onResize(node.id, v, h) },
        { label: "H", val: h, cb: (v: number | undefined) => onResize(node.id, w, v) },
      ] as const).map(({ label, val, cb }) => (
        <div key={label} className="flex items-center gap-1">
          <span className="text-[10px] text-[var(--twilio-gray-60)] font-semibold w-3">{label}</span>
          <input
            type="number" placeholder="auto" value={val ?? ""} min={20}
            onChange={(e) => cb(e.target.value === "" ? undefined : Number(e.target.value))}
            className="flex-1 rounded border border-gray-200 px-1 py-0.5 text-xs text-center"
          />
        </div>
      ))}
      {(x !== undefined || y !== undefined) && (
        [{ label: "X", val: x }, { label: "Y", val: y }].map(({ label, val }) => (
          <div key={label} className="flex items-center gap-1">
            <span className="text-[10px] text-[var(--twilio-gray-60)] font-semibold w-3">{label}</span>
            <input readOnly value={val !== undefined ? Math.round(val) : ""}
              className="flex-1 rounded border border-gray-100 bg-gray-50 px-1 py-0.5 text-xs text-center text-[var(--twilio-gray-60)] cursor-default"
            />
          </div>
        ))
      )}
      {(w !== undefined || h !== undefined) && (
        <div className="col-span-2 flex justify-end">
          <button onClick={() => onResize(node.id, undefined, undefined)}
            className="text-[10px] text-[var(--twilio-gray-40)] hover:text-red-500">
            ↺ reset size
          </button>
        </div>
      )}
    </div>
  );
}

function LayerTree({ nodes, selectedId, onSelect, onDelete, depth }: {
  nodes: CanvasNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  depth: number;
}) {
  return (
    <>
      {nodes.map((node) => {
        const def = COMPONENT_REGISTRY.find((c) => c.type === node.type);
        return (
          <div key={node.id}>
            <div
              className={`flex items-center gap-1 py-0.5 rounded cursor-pointer text-[11px] group ${
                selectedId === node.id
                  ? "bg-indigo-50 text-[var(--twilio-blue)]"
                  : "hover:bg-gray-50 text-[var(--twilio-navy)]"
              }`}
              style={{ paddingLeft: `${8 + depth * 12}px` }}
              onClick={() => onSelect(node.id)}
            >
              <span className="opacity-50 text-[10px] w-3 text-center">{def?.icon ?? "·"}</span>
              <span className="truncate flex-1">{node.type}</span>
              <button
                className="opacity-0 group-hover:opacity-100 text-[var(--twilio-gray-40)] hover:text-red-500 pr-1 text-[10px]"
                onClick={(e) => { e.stopPropagation(); onDelete(node.id); }}
              >✕</button>
            </div>
            {node.children.length > 0 && (
              <LayerTree nodes={node.children} selectedId={selectedId} onSelect={onSelect} onDelete={onDelete} depth={depth + 1} />
            )}
          </div>
        );
      })}
    </>
  );
}
