import type { CanvasNode } from "../pagebuilder/types";
import { COMPONENT_REGISTRY } from "../pagebuilder/registry";
import { makeNode } from "../pagebuilder/useCanvasState";
import type { ExportItemSnapshot } from "../../types";

/** A component on the profile page's mini canvas. */
export interface MiniNode {
  id: string;
  /** A registry type id ("Heading", "Card", …) or "record" for an export-tray drop. */
  type: string;
  icon: string;
  label: string;
  text?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fields?: Record<string, string>;
  children?: MiniNode[];
  record?: ExportItemSnapshot;
  /**
   * The registry props for this type (copied from `defaultProps` when dropped, then edited).
   * Rendering and the hand-off to the full builder both read these, which is what lets a
   * Heading look like a heading instead of a generic card.
   */
  props?: Record<string, unknown>;
}

/** Types the mini canvas draws as themselves. Anything else keeps the generic card. */
export const PREVIEW_TYPES = [
  "Page", "Container", "Row", "Column", "Card", "Section",
  "Heading", "Text", "RichText", "Label", "Divider",
] as const;
export type PreviewType = (typeof PREVIEW_TYPES)[number];

export function isPreviewType(type: string): type is PreviewType {
  return (PREVIEW_TYPES as readonly string[]).includes(type);
}

/** Types whose text can be edited in place on the canvas (double-click). */
export const INLINE_TEXT_TYPES = ["Heading", "Text", "Label"] as const;
export function isInlineTextType(type: string): boolean {
  return (INLINE_TEXT_TYPES as readonly string[]).includes(type);
}

export function defaultPropsFor(type: string): Record<string, unknown> {
  return { ...(COMPONENT_REGISTRY.find(c => c.type === type)?.defaultProps ?? {}) };
}

/** Starting size on the mini canvas. Text hugs its content; containers use their registry size. */
export function defaultSizeFor(type: string): { w: number; h: number } {
  const p = defaultPropsFor(type);
  const w = typeof p.width === "number" ? p.width : undefined;
  const h = typeof p.height === "number" ? p.height : undefined;
  switch (type) {
    case "Heading": return { w: 200, h: 40 };
    case "Text":
    case "RichText": return { w: 200, h: 48 };
    case "Label": return { w: 120, h: 24 };
    case "Divider": return { w: 200, h: 20 };
    // The mini canvas is a few hundred pixels wide; a full 816x1056 page would swallow it.
    case "Page": return { w: 240, h: 150 };
    default: return { w: Math.min(w ?? 120, 260), h: Math.min(h ?? 72, 160) };
  }
}

function humanizeType(t: string): string {
  return t.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

/** A hand-off node for an export-tray record: a real RecordCard, not an unknown type. */
function recordToCanvasNode(n: MiniNode): CanvasNode {
  const r = n.record as ExportItemSnapshot;
  const node = makeNode("RecordCard");
  node.props = {
    ...node.props,
    typeLabel: humanizeType(r.type),
    recordTitle: r.label,
    accountName: r.accountName ?? "",
    summary: r.summary ?? "",
    url: r.url ?? "",
    ...(r.accent ? { accentColor: r.accent } : {}),
    x: n.x,
    y: n.y,
    width: Math.max(n.w, 200),
  };
  return node;
}

/**
 * Convert mini-canvas nodes to full-builder nodes.
 *
 * Fresh ids come from `makeNode`: the mini counter restarts at 1 on every page load, so its ids
 * collide with whatever the builder already holds. Edited props survive, text goes to the key the
 * target type actually reads, and only top-level nodes keep their canvas position — a nested
 * node flows inside its parent in the builder.
 */
export function miniNodesToCanvasNodes(nodes: MiniNode[], nested = false): CanvasNode[] {
  return nodes.map((n): CanvasNode => {
    if (n.record) return recordToCanvasNode(n);

    const node = makeNode(n.type);
    const props: Record<string, unknown> = { ...node.props, ...(n.props ?? {}) };
    if (n.text) {
      if (n.type === "RichText") props.html = `<p>${n.text.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string))}</p>`;
      else props.text = n.text;
    }
    if (!nested) {
      props.x = n.x;
      props.y = n.y;
    }
    // Text sizes itself in the builder; forcing the mini box's height onto it would clip.
    props.width = n.w;
    if (!isInlineTextType(n.type) && n.type !== "RichText" && n.type !== "Divider") props.height = n.h;
    node.props = props;
    node.children = miniNodesToCanvasNodes(n.children ?? [], true);
    return node;
  });
}
