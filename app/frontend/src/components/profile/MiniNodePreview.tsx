import type { CSSProperties, ReactNode } from "react";
import DOMPurify from "dompurify";
import { defaultPropsFor, filledFields, isPreviewType, type FilledField, type MiniNode } from "./miniCanvas";

const HEADING_SIZES: Record<number, string> = { 1: "1.875rem", 2: "1.5rem", 3: "1.25rem", 4: "1.125rem" };
const HAIRLINE = "#E1E3EA";

/** Props for a node: registry defaults, then whatever the user edited. */
export function resolveProps(node: Pick<MiniNode, "type" | "props" | "text">): Record<string, unknown> {
  const merged = { ...defaultPropsFor(node.type), ...(node.props ?? {}) };
  // `text` on the node is the older, pre-props way of storing edited text.
  if (node.text && merged.text === defaultPropsFor(node.type).text) merged.text = node.text;
  return merged;
}

const str = (v: unknown, fallback: string) => (typeof v === "string" && v ? v : fallback);
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/**
 * The data the user attached to a component through the field picker: each filled field as its
 * label over its value. Drawn on the component itself so what you entered is what you see, and
 * mirrored into the full builder by `miniNodesToCanvasNodes`.
 */
export function MiniFieldList({ fields }: { fields: FilledField[] }) {
  return (
    <div data-mini-fields style={{ display: "flex", flexDirection: "column", gap: 4, padding: "6px 8px", textAlign: "left", boxSizing: "border-box" }}>
      {fields.map(f => (
        <div key={f.key} data-mini-field={f.key}>
          <div style={{ fontSize: "0.5rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#64748b" }}>
            {f.label}
          </div>
          <div style={{ fontSize: "0.6875rem", color: "#111827", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {f.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Draws a mini-canvas node as the component it is: a Heading reads as a heading, a Card has a
 * card's border and shadow, a Divider is a rule. This mirrors the styling in
 * pagebuilder/NodeRenderer so what you sketch here looks like what the full builder shows.
 *
 * Any fields filled in on the node are drawn with it — inside a container, beneath a text
 * component — and the box grows to fit them rather than clipping. `children` are nested nodes.
 * Returns null for a type with no preview, so the caller can fall back to the generic card.
 */
export default function MiniNodePreview({ node, children }: { node: MiniNode; children?: ReactNode }) {
  if (!isPreviewType(node.type)) return null;
  const p = resolveProps(node);
  const fields = filledFields(node);
  const hasFields = fields.length > 0;
  const hasChildren = (node.children ?? []).length > 0;
  const fieldBlock = hasFields ? <MiniFieldList fields={fields} /> : null;

  // A box with fields cannot keep a fixed height or the values would be clipped.
  const fill: CSSProperties = {
    width: "100%", boxSizing: "border-box", position: "relative",
    ...(hasFields ? { height: "auto", minHeight: node.h } : { height: "100%" }),
  };
  const emptyHint = !hasChildren && !hasFields ? (
    <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.5625rem", color: "#94a3b8", pointerEvents: "none" }}>
      {node.type}
    </span>
  ) : null;

  /** Text-like components: their own content, then the fields beneath. */
  const leaf = (content: ReactNode) => (hasFields ? <div data-mini-with-fields>{content}{fieldBlock}</div> : content);

  switch (node.type) {
    case "Heading": {
      const level = Math.min(4, Math.max(1, num(p.level, 1)));
      const Tag = `h${level}` as keyof JSX.IntrinsicElements;
      return leaf(
        <Tag data-mini-preview="Heading" style={{
          margin: 0, display: "block", overflow: "hidden", overflowWrap: "anywhere",
          color: str(p.color, "#121C2D"), fontWeight: num(p.fontWeight, 700),
          fontStyle: str(p.fontStyle, "normal"), textDecoration: str(p.textDecoration, "none"),
          letterSpacing: str(p.letterSpacing, "0em"), fontSize: HEADING_SIZES[level],
          lineHeight: num(p.lineHeight, 1.25),
        }}>{str(p.text, "Heading")}</Tag>,
      );
    }

    case "Text":
      return leaf(
        <p data-mini-preview="Text" style={{
          margin: 0, overflow: "hidden", whiteSpace: "pre-wrap", overflowWrap: "anywhere",
          color: str(p.color, "#39476A"), fontSize: `${num(p.fontSize, 14)}px`,
          fontWeight: num(p.fontWeight, 400), fontStyle: str(p.fontStyle, "normal"),
          textDecoration: str(p.textDecoration, "none"), letterSpacing: str(p.letterSpacing, "0em"),
          lineHeight: num(p.lineHeight, 1.5),
        }}>{str(p.text, "Text")}</p>,
      );

    case "RichText":
      return leaf(
        <div
          data-mini-preview="RichText"
          className="prose prose-sm max-w-none rich-text"
          style={{ color: str(p.color, "#39476A"), overflow: "hidden", fontSize: "0.8125rem" }}
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(str(p.html, "<p>Rich text content…</p>")) }}
        />,
      );

    case "Label":
      return leaf(
        <span data-mini-preview="Label" style={{
          display: "block", overflow: "hidden", overflowWrap: "anywhere", textTransform: "uppercase",
          color: str(p.color, "#606B85"), fontSize: `${num(p.fontSize, 10)}px`,
          fontWeight: num(p.fontWeight, 600), fontStyle: str(p.fontStyle, "normal"),
          textDecoration: str(p.textDecoration, "none"), letterSpacing: str(p.letterSpacing, "0.08em"),
          lineHeight: num(p.lineHeight, 1.2),
        }}>{str(p.text, "LABEL")}</span>,
      );

    case "Divider":
      return leaf(
        <div data-mini-preview="Divider" style={{ width: "100%", height: hasFields ? 16 : "100%", display: "flex", alignItems: "center" }}>
          <hr style={{
            width: "100%", margin: 0, border: "none",
            borderTop: `${num(p.thickness, 1)}px solid ${str(p.color, HAIRLINE)}`,
          }} />
        </div>,
      );

    case "Page":
      return (
        <div data-mini-preview="Page" style={{ ...fill, display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: "0.5rem", fontWeight: 600, color: "#64748b", padding: "0 2px 2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            📄 {str(p.label, "Page")}
          </div>
          <div style={{ flex: 1, position: "relative", background: str(p.background, "#ffffff"), border: `1px solid ${HAIRLINE}`, boxShadow: "0 2px 8px rgba(15,23,42,0.12)" }}>
            {fieldBlock}{children}{emptyHint}
          </div>
        </div>
      );

    case "Card":
      return (
        <div data-mini-preview="Card" style={{
          ...fill, background: str(p.background, "#FFFFFF"), borderRadius: `${num(p.borderRadius, 12)}px`,
          border: `1px solid ${HAIRLINE}`, boxShadow: str(p.shadow, "0 1px 3px 0 rgba(0,0,0,0.06)"),
        }}>{fieldBlock}{children}{emptyHint}</div>
      );

    case "Section":
      return (
        <div data-mini-preview="Section" style={{
          ...fill, background: str(p.background, "rgba(255,255,255,0.5)"),
          borderRadius: `${num(p.borderRadius, 16)}px`, border: `1px solid ${HAIRLINE}`,
        }}>{fieldBlock}{children}{emptyHint}</div>
      );

    // Container, Row and Column are layout wrappers; the dashed outline is what makes an empty
    // one findable, the same affordance the full builder gives them.
    default:
      return (
        <div data-mini-preview={node.type} style={{
          ...fill, background: str(p.background, "rgba(255,255,255,0.5)"),
          borderRadius: `${num(p.borderRadius, node.type === "Container" ? 8 : 0)}px`,
          border: hasChildren || hasFields ? str(p.border, "1px solid " + HAIRLINE) : "1px dashed #94a3b8",
          display: "flex", flexDirection: node.type === "Row" ? "row" : "column",
        }}>{fieldBlock}{children}{emptyHint}</div>
      );
  }
}
