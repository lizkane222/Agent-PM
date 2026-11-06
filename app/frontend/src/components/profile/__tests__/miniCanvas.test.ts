import { describe, it, expect } from "vitest";
import {
  defaultPropsFor, defaultSizeFor, isInlineTextType, isPreviewType, miniNodesToCanvasNodes, PREVIEW_TYPES,
  type MiniNode,
} from "../miniCanvas";

const node = (over: Partial<MiniNode>): MiniNode => ({
  id: "mini-1", type: "Heading", icon: "H", label: "Heading", x: 30, y: 40, w: 200, h: 40, ...over,
});

describe("preview types", () => {
  it("covers every layout and content component the palette offers", () => {
    for (const t of ["Page", "Container", "Row", "Column", "Card", "Section", "Heading", "Text", "RichText", "Label", "Divider"]) {
      expect(isPreviewType(t)).toBe(true);
    }
    expect(PREVIEW_TYPES).toHaveLength(11);
    expect(isPreviewType("record")).toBe(false);
    expect(isPreviewType("Button")).toBe(false);
  });

  it("only Heading, Text and Label are edited in place", () => {
    expect(["Heading", "Text", "Label"].every(isInlineTextType)).toBe(true);
    expect(["RichText", "Card", "Divider"].some(isInlineTextType)).toBe(false);
  });
});

describe("defaultSizeFor", () => {
  it("sizes text to its content and a Page smaller than a real sheet", () => {
    expect(defaultSizeFor("Heading").h).toBeLessThan(72);
    expect(defaultSizeFor("Divider").h).toBeLessThanOrEqual(24);
    expect(defaultSizeFor("Page").w).toBeLessThan(816);
  });
  it("gives containers a usable box", () => {
    const { w, h } = defaultSizeFor("Card");
    expect(w).toBeGreaterThanOrEqual(120);
    expect(h).toBeGreaterThanOrEqual(72);
  });
});

describe("miniNodesToCanvasNodes", () => {
  it("keeps the component type instead of turning everything into a card", () => {
    const out = miniNodesToCanvasNodes([
      node({ type: "Heading" }), node({ id: "m2", type: "Divider" }), node({ id: "m3", type: "Card" }),
    ]);
    expect(out.map(n => n.type)).toEqual(["Heading", "Divider", "Card"]);
  });

  it("carries registry defaults and the user's edits", () => {
    const [h] = miniNodesToCanvasNodes([node({ props: { ...defaultPropsFor("Heading"), level: 2, text: "Q4 plan" } })]);
    expect(h.props).toMatchObject({ level: 2, text: "Q4 plan", color: "#121C2D" });
  });

  it("keeps position and width for top-level nodes", () => {
    const [h] = miniNodesToCanvasNodes([node({ x: 30, y: 40, w: 200 })]);
    expect(h.props).toMatchObject({ x: 30, y: 40, width: 200 });
  });

  it("assigns fresh unique ids, not the mini counter's", () => {
    const a = miniNodesToCanvasNodes([node({ id: "mini-1" })]);
    const b = miniNodesToCanvasNodes([node({ id: "mini-1" })]);
    expect(a[0].id).not.toBe("mini-1");
    expect(a[0].id).not.toBe(b[0].id);
  });

  it("writes legacy node text to the key the target type reads", () => {
    const [rich] = miniNodesToCanvasNodes([node({ type: "RichText", text: "a <b> & c" })]);
    expect(rich.props.html).toBe("<p>a &lt;b&gt; &amp; c</p>");
    const [text] = miniNodesToCanvasNodes([node({ type: "Text", text: "plain" })]);
    expect(text.props.text).toBe("plain");
  });

  it("lets text size itself instead of forcing the mini box height onto it", () => {
    const [h] = miniNodesToCanvasNodes([node({ type: "Heading", h: 12 })]);
    expect(h.props.height).toBeUndefined();
    const [c] = miniNodesToCanvasNodes([node({ type: "Card", h: 150 })]);
    expect(c.props.height).toBe(150);
  });

  it("converts an export-tray record into a real RecordCard", () => {
    const [r] = miniNodesToCanvasNodes([node({
      type: "record", label: "Follow up", w: 150,
      record: { id: "action_item:recABC", type: "action_item", label: "Follow up", summary: "Open · High", content: "", accountName: "Acme", url: "/accounts/1", accent: "#f97316" },
    })]);
    expect(r.type).toBe("RecordCard");
    expect(r.props).toMatchObject({
      recordTitle: "Follow up", typeLabel: "Action Item", accountName: "Acme", summary: "Open · High",
      url: "/accounts/1", accentColor: "#f97316", x: 30, y: 40,
    });
    expect(r.props.width).toBeGreaterThanOrEqual(200);
  });

  it("converts nested nodes, dropping their canvas position (they flow inside the parent)", () => {
    const [card] = miniNodesToCanvasNodes([node({
      type: "Card", children: [node({ id: "c1", type: "Text", x: 50, y: 60, props: { text: "inside" } })],
    })]);
    expect(card.children).toHaveLength(1);
    expect(card.children[0]).toMatchObject({ type: "Text", props: { text: "inside" } });
    expect(card.children[0].props.x).toBeUndefined();
    expect(card.children[0].props.y).toBeUndefined();
  });

  it("an empty canvas converts to nothing", () => {
    expect(miniNodesToCanvasNodes([])).toEqual([]);
  });
});
