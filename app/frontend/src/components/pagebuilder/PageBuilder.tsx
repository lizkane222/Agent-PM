import { useCallback, useRef, useEffect, useState, useMemo } from "react";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";
import { useExport, type ExportItem } from "../../context/ExportContext";
import ComponentPalette from "./ComponentPalette";
import DraggableNode from "./DraggableNode";
import PropEditor from "./PropEditor";
import SaveLayoutModal from "./SaveLayoutModal";
import LayoutsLibrary from "./LayoutsLibrary";
import CanvasContextMenu from "./CanvasContextMenu";
import SaveVariantModal from "./SaveVariantModal";
import TeamMemberPicker, { type PickedMember } from "./TeamMemberPicker";
import TimelineFetchModal from "./TimelineFetchModal";
import { accountsApi } from "../../lib/api";
import { useCurrentUser } from "../../context/CurrentUserContext";
import type { Account, PageLayout } from "../../types";
import { loadVariants, addVariant, updateVariant, deleteVariant, type ComponentVariant } from "./variantStore";
import { useCanvasState, makeNode, removeNode, findNode, CANVAS_DRAFT_KEY } from "./useCanvasState";
import { EXPORT_ITEM_DRAG_KEY } from "../ExportBar";
import type { CanvasNode } from "./types";
import { COMPONENT_REGISTRY } from "./registry";
import { layoutsApi } from "../../lib/api";

const DEFAULT_SIZE: Record<string, { w: number; h: number }> = {
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

function updateNodeXYProps(root: CanvasNode[], id: string, props: Record<string, unknown>): CanvasNode[] {
  return root.map((n) => {
    if (n.id === id) return { ...n, props: { ...n.props, ...props } };
    return { ...n, children: updateNodeXYProps(n.children, id, props) };
  });
}

function updateNodeXY(root: CanvasNode[], id: string, x: number, y: number): CanvasNode[] {
  return root.map((n) => {
    if (n.id === id) return { ...n, props: { ...n.props, x, y } };
    return { ...n, children: updateNodeXY(n.children, id, x, y) };
  });
}

// Returns position of pointer relative to a DOM element's top-left, accounting for drag delta.
function pointerRelativeTo(
  el: Element,
  activatorEvent: Event,
  delta: { x: number; y: number },
  nodeSize: { w: number; h: number },
): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  if (activatorEvent instanceof PointerEvent) {
    const x = Math.max(0, Math.round(activatorEvent.clientX + delta.x - rect.left - nodeSize.w / 2));
    const y = Math.max(0, Math.round(activatorEvent.clientY + delta.y - rect.top  - nodeSize.h / 2));
    return { x, y };
  }
  return { x: 16, y: 16 };
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

// Single droppable canvas — one div, no nested wrappers
function CanvasArea({
  nodes, selectedId, multiSelectedIds, onSelect, onDelete, onResizeLive, onResizeCommit, onUpdateProps, canvasRef, onDeselect, onMarqueeSelect, onExportItemDrop, onNodeContextMenu, onImportTeamMembers,
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
  onDeselect: () => void;
  onMarqueeSelect: (ids: string[]) => void;
  onExportItemDrop: (item: ExportItem, x: number, y: number, targetNodeId: string | null) => void;
  onNodeContextMenu: (id: string, e: React.MouseEvent) => void;
  onImportTeamMembers: (anchorNodeId: string) => void;
  onFetchTimelineMeetings: (nodeId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "drop:root" });
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Marquee state
  const [marquee, setMarquee] = useState<{ startX: number; startY: number; x: number; y: number; w: number; h: number } | null>(null);
  const marqueeRef = useRef(marquee);
  marqueeRef.current = marquee;

  const mergedRef = useCallback((el: HTMLDivElement | null) => {
    setNodeRef(el);
    (canvasRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
  }, [setNodeRef, canvasRef]);

  // Snap guide computation (only while dragging selected node)
  const snapLines = useMemo(() => computeSnapLines(selectedId, nodes), [selectedId, nodes]);

  // Marquee drag on canvas background
  function onCanvasMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // Only start marquee when clicking the canvas background itself
    if (target !== e.currentTarget) return;
    e.preventDefault();

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    setMarquee({ startX: sx, startY: sy, x: sx, y: sy, w: 0, h: 0 });

    function onMove(ev: MouseEvent) {
      const mx = ev.clientX - rect.left;
      const my = ev.clientY - rect.top;
      const x = Math.min(sx, mx);
      const y = Math.min(sy, my);
      const w = Math.abs(mx - sx);
      const h = Math.abs(my - sy);
      setMarquee({ startX: sx, startY: sy, x, y, w, h });
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const m = marqueeRef.current;
      if (m && (m.w > 4 || m.h > 4)) {
        const sel = nodes.filter((n) => rectsIntersect(getNodeRect(n), { x: m.x, y: m.y, w: m.w, h: m.h }));
        onMarqueeSelect(sel.map((n) => n.id));
      } else {
        onDeselect();
      }
      setMarquee(null);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-auto relative">
      <div
        ref={mergedRef}
        onMouseDown={onCanvasMouseDown}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
        onDrop={(e) => {
          e.preventDefault();
          const raw = e.dataTransfer.getData(EXPORT_ITEM_DRAG_KEY);
          if (!raw) return;
          try {
            const item = JSON.parse(raw) as ExportItem;
            const canvas = canvasRef.current;
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            // Walk up from the drop target to find if we landed on a canvas node
            let targetNodeId: string | null = null;
            let el = e.target as HTMLElement | null;
            while (el && el !== canvas) {
              const id = el.getAttribute("data-node-id");
              if (id) { targetNodeId = id; break; }
              el = el.parentElement;
            }
            const x = Math.max(0, Math.round(e.clientX - rect.left));
            const y = Math.max(0, Math.round(e.clientY - rect.top));
            onExportItemDrop(item, x, y, targetNodeId);
          } catch { /* malformed payload */ }
        }}
        data-canvas
        style={{
          position: "relative",
          overflow: "visible",
          minWidth: 800,
          minHeight: "100%",
          background: "var(--twilio-gray-10)",
          backgroundImage: "radial-gradient(circle, #AEBBC1 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          padding: 20,
          userSelect: marquee ? "none" : undefined,
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

        {/* Snap guides */}
        {snapLines.map((line, i) =>
          line.kind === "v" ? (
            <div key={i} className="pointer-events-none absolute z-50" style={{
              left: line.pos, top: line.from,
              width: 1, height: line.to - line.from,
              background: "#F22F46", opacity: 0.8,
            }} />
          ) : (
            <div key={i} className="pointer-events-none absolute z-50" style={{
              top: line.pos, left: line.from,
              height: 1, width: line.to - line.from,
              background: "#F22F46", opacity: 0.8,
            }} />
          )
        )}

        {/* Marquee selection rectangle */}
        {marquee && marquee.w > 2 && marquee.h > 2 && (
          <div className="pointer-events-none absolute z-50" style={{
            left: marquee.x, top: marquee.y,
            width: marquee.w, height: marquee.h,
            border: "1.5px solid #0263E0",
            background: "rgba(2,99,224,0.07)",
          }} />
        )}
      </div>
    </div>
  );
}

// ExportRecordPill and ExportRecordModal removed — the global red ExportBar
// (rendered by Layout.tsx above the page) is now the single export tray.
// Its DraggablePill fires kind="export-item" which handleDragEnd handles below.

export default function PageBuilder() {
  const {
    nodes, commit, live,
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

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
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

  // Export tray — only need items list for drop logic; display is handled by ExportBar
  const { items: exportItems } = useExport();

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
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, selectedId, deleteNode, duplicateNode, copyNode, pasteNode, nodes, commit, setSelectedId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over, delta } = event;
    if (!over) return;

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
        x = Math.max(0, pointerX - rect.left - def.w / 2);
        y = Math.max(0, pointerY - rect.top  - def.h / 2);
      }
      const newNode = makeNode(type);
      if (activeData.presetProps) Object.assign(newNode.props, activeData.presetProps);
      newNode.props.x = Math.round(x);
      newNode.props.y = Math.round(y);
      commit([...nodes, newNode]);
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
        newNode.props.x = Math.max(0, Math.round(ptr.clientX + delta.x - over.rect.left - def.w / 2));
        newNode.props.y = Math.max(0, Math.round(ptr.clientY + delta.y - over.rect.top  - def.h / 2));
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
          nx = Math.max(0, Math.round(initialRect.left + delta.x - over.rect.left));
          ny = Math.max(0, Math.round(initialRect.top  + delta.y - over.rect.top));
        }
        const nestedNode = { ...node, props: { ...node.props, x: nx, y: ny } };
        commit(addChildToTree(withoutNode, parentId, nestedNode));
        return;
      }

      // Staying on canvas root — delta from original position is exact
      const cx = Math.max(0, Math.round(((node.props.x as number) ?? 0) + delta.x));
      const cy = Math.max(0, Math.round(((node.props.y as number) ?? 0) + delta.y));
      commit(updateNodeXY(nodes, nodeId, cx, cy));
      return;
    }

    // ── Canvas nested node → move within parent, re-nest, or unnest ─────────
    if (activeData.kind === "canvas" && activeData.nodeId && (activeData.isNested || !activeData.isRoot)) {
      const nodeId = activeData.nodeId;
      const movedNode = findNode(nodes, nodeId);
      if (!movedNode) return;
      const withoutNode = removeNode(nodes, nodeId);
      const initialRect = active.rect.current?.initial;

      // Unnest: dropped onto the canvas root
      if (overId === "drop:root" || !overId.startsWith("drop:")) {
        const canvas = canvasRef.current;
        let x = 100, y = 100;
        if (initialRect && canvas) {
          const canvasRect = canvas.getBoundingClientRect();
          x = Math.max(0, Math.round(initialRect.left + delta.x - canvasRect.left));
          y = Math.max(0, Math.round(initialRect.top  + delta.y - canvasRect.top));
        }
        commit([...withoutNode, { ...movedNode, props: { ...movedNode.props, x, y } }]);
        return;
      }

      const parentId = overId.replace("drop:", "");
      if (parentId === nodeId) return;

      // Move within same parent or into a different container
      let nx = Math.max(0, (movedNode.props.x as number ?? 16) + delta.x);
      let ny = Math.max(0, (movedNode.props.y as number ?? 16) + delta.y);
      if (initialRect && over.rect) {
        nx = Math.max(0, Math.round(initialRect.left + delta.x - over.rect.left));
        ny = Math.max(0, Math.round(initialRect.top  + delta.y - over.rect.top));
      }
      const placedNode = { ...movedNode, props: { ...movedNode.props, x: Math.round(nx), y: Math.round(ny) } };
      commit(addChildToTree(withoutNode, parentId, placedNode));
    }

  }, [nodes, commit, setSelectedId]);

  // ── Build a Card node from an ExportItem ─────────────────────────────────
  const buildExportCard = useCallback((item: ExportItem, x: number, y: number): CanvasNode => {
    const accent = item.accent || "#6366f1";
    const cardW = 280;

    const card = makeNode("Card");
    card.props.x = x;
    card.props.y = y;
    card.props.width = cardW;
    card.props.background = `${accent}10`;
    card.props.borderColor = accent;
    card.props.borderRadius = 8;
    card.props.padding = 10;

    // Type badge
    const badge = makeNode("Badge");
    badge.props.text = item.typeLabel || item.type;
    badge.props.x = 0; badge.props.y = 0;
    badge.props.background = `${accent}22`;
    badge.props.color = accent;
    badge.props.fontSize = 11;

    // Title
    const heading = makeNode("Text");
    heading.props.text = item.label;
    heading.props.x = 0; heading.props.y = 24;
    heading.props.color = accent;
    heading.props.fontSize = 14;
    heading.props.fontWeight = 700;
    heading.props.width = cardW - 20;

    // Account name (if present)
    const accountName = item.accountName || "";
    const acctNode = makeNode("Label");
    acctNode.props.text = accountName;
    acctNode.props.x = 0; acctNode.props.y = 46;
    acctNode.props.color = "#888";
    acctNode.props.fontSize = 10;
    acctNode.props.fontWeight = 500;
    acctNode.props.width = cardW - 20;

    // Summary / body
    const rawSummary = item.summary || item.detail || item.content || "";
    const summary = rawSummary.length > 140 ? rawSummary.slice(0, 140).trimEnd() + "…" : rawSummary;
    const body = makeNode("Text");
    body.props.text = summary;
    body.props.x = 0; body.props.y = accountName ? 62 : 46;
    body.props.color = "#555";
    body.props.fontSize = 12;
    body.props.width = cardW - 20;

    card.children = [
      badge,
      heading,
      ...(accountName ? [acctNode] : []),
      ...(summary ? [body] : []),
    ];

    // Auto-height: fit children
    const lastY = summary ? (accountName ? 62 : 46) + 36 : (accountName ? 62 : 46);
    card.props.height = lastY + 20;

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
          <button
            onClick={() => setShowLibrary(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-[var(--twilio-gray-60)] hover:border-gray-300 hover:text-[var(--twilio-navy)] transition-colors"
          >
            <span>⬡</span> Layout Library
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
        />

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
