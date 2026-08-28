import type { CanvasNode } from "../types.js";
export declare function findNode(root: CanvasNode[], id: string): CanvasNode | null;
export declare function removeNode(root: CanvasNode[], id: string): CanvasNode[];
export declare function updateNodeProps(root: CanvasNode[], id: string, props: Record<string, unknown>): CanvasNode[];
export declare function addChildToNode(root: CanvasNode[], parentId: string, child: CanvasNode): CanvasNode[];
export declare function deepCloneNode(node: CanvasNode, offsetRoot: boolean, makeId: () => string): CanvasNode;
/** Flat BFS collection of all node IDs in a tree — used for assertions. */
export declare function collectIds(root: CanvasNode[]): string[];
//# sourceMappingURL=canvasTree.d.ts.map