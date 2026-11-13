import type { CanvasNode } from "../pagebuilder/types";
import { COMPONENT_REGISTRY } from "../pagebuilder/registry";
import { makeNode } from "../pagebuilder/useCanvasState";
import type { ExportItemSnapshot } from "../../types";
import { fieldLabel, fieldType, type MiniFieldDef } from "./miniFields";

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

/** Rich Text is also edited in place, but with a formatting editor rather than a plain text box. */
export function isRichEditType(type: string): boolean {
  return type === "RichText";
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

/** A field the user has filled in on a component. */
export interface FilledField {
  key: string;
  label: string;
  value: string;
  fieldType: MiniFieldDef["fieldType"];
}

/**
 * The fields on a node that actually have a value, in the order they were added. A field that was
 * picked but left blank is not data, so it is neither drawn nor handed to the builder.
 */
export function filledFields(node: Pick<MiniNode, "fields">): FilledField[] {
  return Object.entries(node.fields ?? {})
    .map(([key, value]) => ({ key, label: fieldLabel(key), value: String(value ?? "").trim(), fieldType: fieldType(key) }))
    .filter(f => f.value !== "");
}

const escapeHtml = (v: string) => v.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

/** Field values as the HTML the builder's Rich Text renders: bold label, then the value. */
export function fieldsToHtml(fields: FilledField[]): string {
  return fields
    .map(f => `<p><strong>${escapeHtml(f.label)}</strong><br>${escapeHtml(f.value).replace(/\n/g, "<br>")}</p>`)
    .join("");
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

/** Builder nodes for a field list: one Rich Text holding every field, label then value. */
function fieldsNode(fields: FilledField[], extra: Record<string, unknown> = {}): CanvasNode {
  const node = makeNode("RichText");
  node.props = { ...node.props, html: fieldsToHtml(fields), ...extra };
  return node;
}

/**
 * Convert mini-canvas nodes to full-builder nodes.
 *
 * Fresh ids come from `makeNode`: the mini counter restarts at 1 on every page load, so its ids
 * collide with whatever the builder already holds. Edited props survive, text goes to the key the
 * target type actually reads, and only top-level nodes keep their canvas position — a nested
 * node flows inside its parent in the builder.
 *
 * **Fields come across as visible content**, because the builder has no "fields" concept. A
 * container (Card, Section, …) gets a Rich Text child listing them; a Rich Text component gets them
 * appended to its own body; any other component (Heading, Text, Label, Divider) is followed by a
 * Rich Text sibling directly beneath it. Blank fields are not carried.
 */
export function miniNodesToCanvasNodes(nodes: MiniNode[], nested = false): CanvasNode[] {
  return nodes.flatMap((n): CanvasNode[] => {
    if (n.record) return [recordToCanvasNode(n)];

    const node = makeNode(n.type);
    const props: Record<string, unknown> = { ...node.props, ...(n.props ?? {}) };
    if (n.text) {
      if (n.type === "RichText") props.html = `<p>${escapeHtml(n.text)}</p>`;
      else props.text = n.text;
    }
    if (!nested) {
      props.x = n.x;
      props.y = n.y;
    }
    // Text sizes itself in the builder; forcing the mini box's height onto it would clip.
    props.width = n.w;
    if (!isInlineTextType(n.type) && n.type !== "RichText" && n.type !== "Divider") props.height = n.h;

    const fields = filledFields(n);
    node.children = miniNodesToCanvasNodes(n.children ?? [], true);

    if (fields.length > 0) {
      const def = COMPONENT_REGISTRY.find(c => c.type === n.type);
      if (def?.canHaveChildren) {
        node.children = [...node.children, fieldsNode(fields)];
      } else if (n.type === "RichText") {
        props.html = `${String(props.html ?? "")}${fieldsToHtml(fields)}`;
      } else {
        node.props = props;
        const below = nested
          ? fieldsNode(fields)
          : fieldsNode(fields, { x: n.x, y: n.y + Math.max(n.h, 24) + 6, width: n.w });
        return [node, below];
      }
    }
    node.props = props;
    return [node];
  });
}

// ── Persistence and saved canvases ───────────────────────────────────────────

const MAX_RESTORED_NODES = 200;
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

function parseNode(raw: unknown, depth: number): MiniNode | null {
  if (!raw || typeof raw !== "object" || depth > 8) return null;
  const n = raw as Record<string, unknown>;
  if (typeof n.id !== "string" || typeof n.type !== "string" || !n.id || !n.type) return null;
  const node: MiniNode = {
    id: n.id,
    type: n.type,
    icon: typeof n.icon === "string" ? n.icon : "",
    label: typeof n.label === "string" ? n.label : n.type,
    x: Math.max(0, num(n.x, 0)),
    y: Math.max(0, num(n.y, 0)),
    w: Math.max(20, num(n.w, 120)),
    h: Math.max(12, num(n.h, 72)),
  };
  if (typeof n.text === "string") node.text = n.text;
  if (n.props && typeof n.props === "object" && !Array.isArray(n.props)) node.props = n.props as Record<string, unknown>;
  if (n.fields && typeof n.fields === "object" && !Array.isArray(n.fields)) {
    node.fields = Object.fromEntries(
      Object.entries(n.fields as Record<string, unknown>).filter(([, v]) => typeof v === "string"),
    ) as Record<string, string>;
  }
  if (n.record && typeof n.record === "object" && typeof (n.record as { id?: unknown }).id === "string") {
    node.record = n.record as ExportItemSnapshot;
  }
  if (Array.isArray(n.children)) {
    const kids = n.children.map(c => parseNode(c, depth + 1)).filter((c): c is MiniNode => c !== null);
    if (kids.length) node.children = kids;
  }
  return node;
}

/**
 * Nodes read back from storage. Storage is user-editable and survives code changes, so nothing is
 * trusted: malformed entries are dropped, numbers are clamped, and the count is capped. Never throws.
 */
export function parseMiniNodes(raw: unknown): MiniNode[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_RESTORED_NODES)
    .map(n => parseNode(n, 0))
    .filter((n): n is MiniNode => n !== null);
}

/** A snapshot of the canvas, kept as a button that can be dragged into a working session. */
export interface SavedCanvas {
  id: string;
  label: string;
  savedAt: number;
  nodes: MiniNode[];
}

export const MAX_SAVED_CANVASES = 12;

export function parseSavedCanvases(raw: unknown): SavedCanvas[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s): SavedCanvas | null => {
      if (!s || typeof s !== "object") return null;
      const o = s as Record<string, unknown>;
      const nodes = parseMiniNodes(o.nodes);
      if (typeof o.id !== "string" || !o.id || nodes.length === 0) return null;
      return { id: o.id, label: typeof o.label === "string" && o.label ? o.label : "Canvas", savedAt: num(o.savedAt, 0), nodes };
    })
    .filter((s): s is SavedCanvas => s !== null)
    .slice(0, MAX_SAVED_CANVASES);
}

/** The export-item `type` a saved canvas carries into a working session. */
export const MINI_CANVAS_ITEM_TYPE = "mini_canvas";

const stripHtml = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** One readable line per component, e.g. `Heading: Q4 plan (Title: Draft)`. */
export function describeMiniNodes(nodes: MiniNode[]): string[] {
  return nodes.map(n => {
    if (n.record) return `${n.label} (record)`;
    const p = { ...defaultPropsFor(n.type), ...(n.props ?? {}) };
    const own = n.type === "RichText" ? stripHtml(String(p.html ?? "")) : typeof p.text === "string" ? p.text : "";
    const extras = filledFields(n).map(f => `${f.label}: ${f.value}`);
    const base = own ? `${n.label}: ${own}` : n.label;
    return extras.length ? `${base} (${extras.join("; ")})` : base;
  });
}

/**
 * The working-session card for a saved canvas. `summary` is what the card shows; `content` carries
 * the full canvas, already converted to builder nodes, so the card can reopen it in the builder.
 */
export function savedCanvasToSnapshot(saved: SavedCanvas): ExportItemSnapshot {
  const lines = describeMiniNodes(saved.nodes);
  const summary = `${saved.nodes.length} component${saved.nodes.length === 1 ? "" : "s"}\n${lines.slice(0, 6).join("\n")}${lines.length > 6 ? `\n+ ${lines.length - 6} more` : ""}`;
  return {
    id: `${MINI_CANVAS_ITEM_TYPE}:${saved.id}`,
    type: MINI_CANVAS_ITEM_TYPE,
    label: saved.label,
    summary,
    content: JSON.stringify({ kind: MINI_CANVAS_ITEM_TYPE, nodes: miniNodesToCanvasNodes(saved.nodes) }),
    accent: "#6366f1",
  };
}

/** The builder nodes inside a saved-canvas card, or null if the card is not one (or is damaged). */
export function canvasNodesFromSnapshot(item: Pick<ExportItemSnapshot, "type" | "content">): CanvasNode[] | null {
  if (item.type !== MINI_CANVAS_ITEM_TYPE) return null;
  try {
    const parsed = JSON.parse(item.content);
    return parsed?.kind === MINI_CANVAS_ITEM_TYPE && Array.isArray(parsed.nodes) && parsed.nodes.length > 0
      ? (parsed.nodes as CanvasNode[])
      : null;
  } catch {
    return null;
  }
}
