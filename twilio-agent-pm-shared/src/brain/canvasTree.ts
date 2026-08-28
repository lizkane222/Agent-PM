import type { CanvasNode } from "../types.js";

export function findNode(root: CanvasNode[], id: string): CanvasNode | null {
  for (const n of root) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return null;
}

export function removeNode(root: CanvasNode[], id: string): CanvasNode[] {
  return root
    .filter((n) => n.id !== id)
    .map((n) => ({ ...n, children: removeNode(n.children, id) }));
}

export function updateNodeProps(
  root: CanvasNode[],
  id: string,
  props: Record<string, unknown>,
): CanvasNode[] {
  return root.map((n) => {
    if (n.id === id) return { ...n, props };
    return { ...n, children: updateNodeProps(n.children, id, props) };
  });
}

export function addChildToNode(
  root: CanvasNode[],
  parentId: string,
  child: CanvasNode,
): CanvasNode[] {
  return root.map((n) => {
    if (n.id === parentId) return { ...n, children: [...n.children, child] };
    return { ...n, children: addChildToNode(n.children, parentId, child) };
  });
}

// `makeId` is injected so callers control ID generation (deterministic in tests).
export function deepCloneNode(
  node: CanvasNode,
  offsetRoot: boolean,
  makeId: () => string,
): CanvasNode {
  const cloned: CanvasNode = {
    id: makeId(),
    type: node.type,
    props: { ...node.props },
    children: node.children.map((c) => deepCloneNode(c, false, makeId)),
  };
  if (offsetRoot && cloned.props["x"] !== undefined) {
    cloned.props = {
      ...cloned.props,
      x: (cloned.props["x"] as number) + 20,
      y: ((cloned.props["y"] as number) ?? 0) + 20,
    };
  }
  return cloned;
}

/** Flat BFS collection of all node IDs in a tree — used for assertions. */
export function collectIds(root: CanvasNode[]): string[] {
  const ids: string[] = [];
  const queue = [...root];
  while (queue.length > 0) {
    const node = queue.shift()!;
    ids.push(node.id);
    queue.push(...node.children);
  }
  return ids;
}
