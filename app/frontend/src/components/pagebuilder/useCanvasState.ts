import { useReducer, useCallback } from "react";
import type { CanvasNode } from "./types";
import { findNode, removeNode } from "twilio-agent-pm-shared";
export { findNode, removeNode };
import { COMPONENT_REGISTRY } from "./registry";

// ── ID generation ─────────────────────────────────────────────────────────────

let _counter = 0;
function uid() { return `node-${++_counter}-${Math.random().toString(36).slice(2, 7)}`; }

// ── Clipboard (module-level — survives re-renders) ────────────────────────────

let _clipboard: CanvasNode | null = null;

export function setClipboard(node: CanvasNode) { _clipboard = node; }
export function getClipboard(): CanvasNode | null { return _clipboard; }

// ── Tree helpers (pure) ───────────────────────────────────────────────────────

export function makeNode(type: string): CanvasNode {
  const def = COMPONENT_REGISTRY.find((c) => c.type === type);
  return {
    id: uid(),
    type,
    props: { ...(def?.defaultProps ?? {}) },
    children: [],
  };
}


function updateNodeProps(root: CanvasNode[], id: string, props: Record<string, unknown>): CanvasNode[] {
  return root.map((n) => {
    if (n.id === id) return { ...n, props };
    return { ...n, children: updateNodeProps(n.children, id, props) };
  });
}

function addChildToNode(root: CanvasNode[], parentId: string, child: CanvasNode): CanvasNode[] {
  return root.map((n) => {
    if (n.id === parentId) return { ...n, children: [...n.children, child] };
    return { ...n, children: addChildToNode(n.children, parentId, child) };
  });
}

// Deep-clone a node tree, assigning fresh IDs throughout.
// If `offsetRoot` is true, bumps x/y by 20px so the clone doesn't land exactly on top.
export function deepCloneNode(node: CanvasNode, offsetRoot = false): CanvasNode {
  const cloned: CanvasNode = {
    id: uid(),
    type: node.type,
    props: { ...node.props },
    children: node.children.map((c) => deepCloneNode(c)),
  };
  if (offsetRoot && cloned.props.x !== undefined) {
    cloned.props = { ...cloned.props, x: (cloned.props.x as number) + 20, y: (cloned.props.y as number ?? 0) + 20 };
  }
  return cloned;
}

// ── History reducer ───────────────────────────────────────────────────────────

const MAX_HISTORY = 50;

interface HistoryState {
  past:    CanvasNode[][];
  present: CanvasNode[];
  future:  CanvasNode[][];
}

type Action =
  | { type: "COMMIT"; nodes: CanvasNode[] }  // push to undo stack
  | { type: "LIVE";   nodes: CanvasNode[] }  // no history (mid-drag)
  | { type: "UNDO" }
  | { type: "REDO" };

function reducer(state: HistoryState, action: Action): HistoryState {
  switch (action.type) {
    case "COMMIT":
      return {
        past:    [...state.past, state.present].slice(-MAX_HISTORY),
        present: action.nodes,
        future:  [],
      };
    case "LIVE":
      return { ...state, present: action.nodes };
    case "UNDO": {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        past:    state.past.slice(0, -1),
        present: previous,
        future:  [state.present, ...state.future].slice(0, MAX_HISTORY),
      };
    }
    case "REDO": {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return {
        past:    [...state.past, state.present].slice(-MAX_HISTORY),
        present: next,
        future:  state.future.slice(1),
      };
    }
    default:
      return state;
  }
}

export const MINI_CANVAS_HANDOFF_KEY = "mini_canvas_handoff";
export const CANVAS_DRAFT_KEY = "agentpm_canvas_draft";

function readHandoff(): CanvasNode[] | null {
  try {
    const raw = sessionStorage.getItem(MINI_CANVAS_HANDOFF_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(MINI_CANVAS_HANDOFF_KEY);
    return JSON.parse(raw) as CanvasNode[];
  } catch { return null; }
}

function readDraft(): CanvasNode[] | null {
  try {
    const raw = localStorage.getItem(CANVAS_DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CanvasNode[];
  } catch { return null; }
}

const INITIAL: HistoryState = { past: [], present: [], future: [] };

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useCanvasState() {
  const [history, dispatch] = useReducer(reducer, INITIAL, () => {
    const handoff = readHandoff();
    if (handoff && handoff.length > 0) return { past: [], present: handoff, future: [] };
    const draft = readDraft();
    if (draft && draft.length > 0) return { past: [], present: draft, future: [] };
    return INITIAL;
  });
  const [selectedId, setSelectedId] = useStateWithCallback<string | null>(null);

  const nodes = history.present;

  // Commit: persists a new snapshot to the undo stack
  const commit = useCallback((nodes: CanvasNode[]) => {
    dispatch({ type: "COMMIT", nodes });
  }, []);

  // Live: update view without touching undo stack (e.g. mid-drag resize)
  const live = useCallback((nodes: CanvasNode[]) => {
    dispatch({ type: "LIVE", nodes });
  }, []);

  const undo = useCallback(() => dispatch({ type: "UNDO" }), []);
  const redo = useCallback(() => dispatch({ type: "REDO" }), []);

  // ── Convenience mutators ───────────────────────────────────────────────────

  const deleteNode = useCallback((id: string) => {
    dispatch({ type: "COMMIT", nodes: removeNode(nodes, id) });
    setSelectedId((sel) => (sel === id ? null : sel));
  }, [nodes]);

  const updateProps = useCallback((id: string, props: Record<string, unknown>) => {
    dispatch({ type: "COMMIT", nodes: updateNodeProps(nodes, id, props) });
  }, [nodes]);

  const clearCanvas = useCallback(() => {
    dispatch({ type: "COMMIT", nodes: [] });
    setSelectedId(null);
    localStorage.removeItem(CANVAS_DRAFT_KEY);
  }, []);

  // resizeLive: visual feedback only, no history entry
  const resizeLive = useCallback((id: string, w: number | undefined, h: number | undefined, x?: number, y?: number) => {
    const node = findNode(nodes, id);
    if (!node) return;
    const next = { ...node.props };
    if (w !== undefined) next.width = Math.round(w); else delete next.width;
    if (h !== undefined) next.height = Math.round(h); else delete next.height;
    if (x !== undefined) next.x = Math.round(x);
    if (y !== undefined) next.y = Math.round(y);
    dispatch({ type: "LIVE", nodes: updateNodeProps(nodes, id, next) });
  }, [nodes]);

  // resizeCommit: called on mouseup — pushes to undo stack
  const resizeCommit = useCallback((id: string, w: number | undefined, h: number | undefined, x?: number, y?: number) => {
    const node = findNode(nodes, id);
    if (!node) return;
    const next = { ...node.props };
    if (w !== undefined) next.width = Math.round(w); else delete next.width;
    if (h !== undefined) next.height = Math.round(h); else delete next.height;
    if (x !== undefined) next.x = Math.round(x);
    if (y !== undefined) next.y = Math.round(y);
    dispatch({ type: "COMMIT", nodes: updateNodeProps(nodes, id, next) });
  }, [nodes]);

  const getSelectedNode = useCallback((): CanvasNode | null => {
    if (!selectedId) return null;
    return findNode(nodes, selectedId);
  }, [nodes, selectedId]);

  // Duplicate: clone the selected node with fresh IDs, offset by 20px, append at root level.
  const duplicateNode = useCallback((id: string) => {
    const node = findNode(nodes, id);
    if (!node) return;
    const clone = deepCloneNode(node, true);
    // If the source is a root node it has x/y; nested nodes don't — place them at root with offset
    if (clone.props.x === undefined) {
      clone.props = { ...clone.props, x: 120, y: 120 };
    }
    dispatch({ type: "COMMIT", nodes: [...nodes, clone] });
    setSelectedId(clone.id);
  }, [nodes]);

  // Copy: stash a deep clone in the module clipboard (no offset yet — applied on paste).
  const copyNode = useCallback((id: string) => {
    const node = findNode(nodes, id);
    if (node) setClipboard(deepCloneNode(node));
  }, [nodes]);

  // Paste: insert clipboard contents as a new root node, offset from original.
  const pasteNode = useCallback(() => {
    const src = getClipboard();
    if (!src) return;
    const clone = deepCloneNode(src, true);
    if (clone.props.x === undefined) {
      clone.props = { ...clone.props, x: 140, y: 140 };
    }
    dispatch({ type: "COMMIT", nodes: [...nodes, clone] });
    setSelectedId(clone.id);
  }, [nodes]);

  return {
    nodes,
    commit,
    live,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    selectedId,
    setSelectedId,
    deleteNode,
    duplicateNode,
    copyNode,
    pasteNode,
    hasClipboard: () => _clipboard !== null,
    updateProps,
    clearCanvas,
    resizeLive,
    resizeCommit,
    getSelectedNode,
    addChildToNode: (parentId: string, child: CanvasNode) =>
      dispatch({ type: "COMMIT", nodes: addChildToNode(nodes, parentId, child) }),
  };
}

// Tiny helper — useState that accepts a functional updater (like setState)
function useStateWithCallback<T>(initial: T) {
  const [value, setValue] = useReducer(
    (prev: T, action: T | ((prev: T) => T)) =>
      typeof action === "function" ? (action as (p: T) => T)(prev) : action,
    initial
  );
  return [value, setValue] as const;
}
