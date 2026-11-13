import { describe, it, expect } from "vitest";
import {
  canvasNodesFromSnapshot, defaultPropsFor, defaultSizeFor, describeMiniNodes, fieldsToHtml, filledFields,
  isInlineTextType, isPreviewType, isRichEditType, MAX_SAVED_CANVASES, MINI_CANVAS_ITEM_TYPE,
  miniNodesToCanvasNodes, parseMiniNodes, parseSavedCanvases, PREVIEW_TYPES, savedCanvasToSnapshot,
  type MiniNode, type SavedCanvas,
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

describe("filledFields", () => {
  it("returns labelled values in the order they were added", () => {
    const out = filledFields({ fields: { g_description: "the body", g_title: "A title" } });
    expect(out.map(f => [f.label, f.value])).toEqual([["Description", "the body"], ["Title", "A title"]]);
  });

  it("skips fields that were picked but left blank or whitespace", () => {
    expect(filledFields({ fields: { g_title: "", g_notes: "   ", g_url: "https://x.test" } }).map(f => f.key)).toEqual(["g_url"]);
  });

  it("trims values, and copes with no fields at all", () => {
    expect(filledFields({ fields: { g_title: "  hi  " } })[0].value).toBe("hi");
    expect(filledFields({})).toEqual([]);
  });

  it("keeps a field whose key is not in the catalog", () => {
    expect(filledFields({ fields: { odd_key: "v" } })[0]).toMatchObject({ label: "odd_key", value: "v" });
  });
});

describe("fieldsToHtml", () => {
  it("renders each field as a bold label over its value", () => {
    const html = fieldsToHtml(filledFields({ fields: { g_title: "Hello" } }));
    expect(html).toBe("<p><strong>Title</strong><br>Hello</p>");
  });

  it("escapes markup in values so data cannot inject HTML into the builder", () => {
    const html = fieldsToHtml(filledFields({ fields: { g_notes: '<img src=x onerror="a">&' } }));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
  });

  it("keeps line breaks", () => {
    expect(fieldsToHtml(filledFields({ fields: { g_notes: "a\nb" } }))).toContain("a<br>b");
  });
});

describe("fields travel into the full builder", () => {
  const base = (over: Partial<MiniNode>): MiniNode => ({
    id: "m", type: "Card", icon: "", label: "", x: 30, y: 40, w: 200, h: 100, ...over,
  });
  const textOf = (nodes: { props: Record<string, unknown> }[]) => nodes.map(n => String(n.props.html ?? n.props.text ?? ""));

  it("a Rich Text component keeps its content and gets the fields appended (the reported case)", () => {
    const [rich] = miniNodesToCanvasNodes([base({
      type: "RichText", props: { html: "<p>Rich text content…</p>" },
      fields: { g_title: "Test Rich text title", g_description: "test rich text description" },
    })]);
    const html = String(rich.props.html);
    expect(html).toContain("Rich text content…");
    expect(html).toContain("<strong>Title</strong><br>Test Rich text title");
    expect(html).toContain("<strong>Description</strong><br>test rich text description");
  });

  it("a container gets one Rich Text child listing the fields, after its existing children", () => {
    const [card] = miniNodesToCanvasNodes([base({
      type: "Card",
      children: [base({ id: "c", type: "Text", props: { text: "inner" } })],
      fields: { g_title: "T", g_notes: "N" },
    })]);
    expect(card.children.map(c => c.type)).toEqual(["Text", "RichText"]);
    expect(String(card.children[1].props.html)).toContain("<strong>Title</strong><br>T");
    expect(String(card.children[1].props.html)).toContain("<strong>Notes</strong><br>N");
  });

  it("a Heading is followed by a Rich Text directly beneath it, same left edge and width", () => {
    const out = miniNodesToCanvasNodes([base({ type: "Heading", h: 40, props: { text: "H" }, fields: { g_title: "T" } })]);
    expect(out.map(n => n.type)).toEqual(["Heading", "RichText"]);
    expect(out[1].props).toMatchObject({ x: 30, width: 200 });
    expect(out[1].props.y as number).toBeGreaterThan(40 + 40);
    expect(String(out[1].props.html)).toContain("T");
  });

  it("the heading itself is unchanged by having fields", () => {
    const [plain] = miniNodesToCanvasNodes([base({ type: "Heading", props: { text: "H" } })]);
    const [withFields] = miniNodesToCanvasNodes([base({ type: "Heading", props: { text: "H" }, fields: { g_title: "T" } })]);
    expect(withFields.props.text).toBe(plain.props.text);
  });

  it("a text component nested in a container is followed by its fields inside that container", () => {
    const [card] = miniNodesToCanvasNodes([base({
      type: "Card",
      children: [base({ id: "c", type: "Text", props: { text: "inner" }, fields: { g_title: "T" } })],
    })]);
    expect(card.children.map(c => c.type)).toEqual(["Text", "RichText"]);
    expect(card.children[1].props.x).toBeUndefined();
  });

  it("blank fields add nothing", () => {
    const out = miniNodesToCanvasNodes([base({ type: "Heading", fields: { g_title: "", g_notes: "  " } })]);
    expect(out).toHaveLength(1);
    expect(miniNodesToCanvasNodes([base({ type: "Card", fields: { g_title: "" } })])[0].children).toEqual([]);
  });

  it("every filled value reaches the builder, whichever kind of component it was on", () => {
    for (const type of ["Heading", "Text", "RichText", "Label", "Divider", "Card", "Section", "Row", "Column", "Container", "Page"]) {
      const all = miniNodesToCanvasNodes([base({ type, fields: { g_title: "VALUE-A", g_description: "VALUE-B" } })]);
      const blob = JSON.stringify(all);
      expect(blob, type).toContain("VALUE-A");
      expect(blob, type).toContain("VALUE-B");
    }
  });

  it("records are unaffected", () => {
    const [r] = miniNodesToCanvasNodes([base({
      type: "record", record: { id: "x:1", type: "account", label: "Acme", summary: "", content: "" },
    })]);
    expect(r.type).toBe("RecordCard");
    expect(textOf([r])).not.toContain("Title");
  });
});

describe("Text and Rich Text both edit in place", () => {
  it("Text is a plain in-place edit and Rich Text is the formatted one — neither opens the picker", () => {
    expect(isInlineTextType("Text")).toBe(true);
    expect(isRichEditType("RichText")).toBe(true);
    expect(isRichEditType("Text")).toBe(false);
    expect(isInlineTextType("RichText")).toBe(false);
  });
});

describe("parseMiniNodes (restoring a saved canvas)", () => {
  const good = { id: "a", type: "Card", icon: "◻", label: "Card", x: 10, y: 20, w: 100, h: 50 };

  it("round-trips a valid canvas, including props, fields and children", () => {
    const nodes: MiniNode[] = [{ ...good, props: { html: "<p>x</p>" }, fields: { g_title: "T" }, children: [{ ...good, id: "b" }] }];
    expect(parseMiniNodes(JSON.parse(JSON.stringify(nodes)))).toEqual(nodes);
  });

  it("returns nothing for anything that is not an array", () => {
    for (const bad of [null, undefined, "x", 5, {}, { 0: good }]) expect(parseMiniNodes(bad)).toEqual([]);
  });

  it("drops malformed entries but keeps the good ones", () => {
    const out = parseMiniNodes([good, null, "s", { id: "x" }, { type: "Card" }, { ...good, id: "" }, { ...good, id: "ok" }]);
    expect(out.map(n => n.id)).toEqual(["a", "ok"]);
  });

  it("clamps nonsense numbers instead of trusting them", () => {
    const [n] = parseMiniNodes([{ ...good, x: -50, y: "no", w: NaN, h: 0 }]);
    expect(n.x).toBe(0);
    expect(n.y).toBe(0);
    expect(n.w).toBeGreaterThanOrEqual(20);
    expect(n.h).toBeGreaterThanOrEqual(12);
  });

  it("keeps only string field values", () => {
    const [n] = parseMiniNodes([{ ...good, fields: { g_title: "ok", g_notes: 5, g_url: null } }]);
    expect(n.fields).toEqual({ g_title: "ok" });
  });

  it("caps the number of nodes and the nesting depth", () => {
    expect(parseMiniNodes(Array.from({ length: 500 }, (_, i) => ({ ...good, id: `n${i}` })))).toHaveLength(200);
    let deep: Record<string, unknown> = { ...good, id: "leaf" };
    for (let i = 0; i < 20; i++) deep = { ...good, id: `d${i}`, children: [deep] };
    const out = parseMiniNodes([deep]);
    let depth = 0;
    for (let cur: MiniNode | undefined = out[0]; cur; cur = cur.children?.[0]) depth++;
    expect(depth).toBeLessThanOrEqual(9);
  });

  it("ignores a record that has no id", () => {
    expect(parseMiniNodes([{ ...good, type: "record", record: { label: "x" } }])[0].record).toBeUndefined();
  });
});

describe("saved canvases", () => {
  const node = (over: Partial<MiniNode> = {}): MiniNode => ({ id: "n", type: "Heading", icon: "H", label: "Heading", x: 5, y: 6, w: 200, h: 40, ...over });
  const saved = (nodes: MiniNode[], over: Partial<SavedCanvas> = {}): SavedCanvas => ({ id: "sv1", label: "Canvas · Nov 6", savedAt: 1, nodes, ...over });

  it("describeMiniNodes gives one readable line per component, with fields and rich text stripped of markup", () => {
    const lines = describeMiniNodes([
      node({ props: { text: "Q4 plan" }, fields: { g_title: "Draft" } }),
      node({ id: "r", type: "RichText", label: "Rich Text", props: { html: "<p>Hello <strong>there</strong></p>" } }),
      node({ id: "c", type: "Card", label: "Card" }),
      node({ id: "x", type: "record", label: "Acme", record: { id: "a:1", type: "account", label: "Acme", summary: "", content: "" } }),
    ]);
    expect(lines).toEqual(["Heading: Q4 plan (Title: Draft)", "Rich Text: Hello there", "Card", "Acme (record)"]);
  });

  it("the card snapshot carries the label, a count, a preview and a stable id", () => {
    const snap = savedCanvasToSnapshot(saved([node({ props: { text: "A" } }), node({ id: "m", type: "Card", label: "Card" })]));
    expect(snap.id).toBe("mini_canvas:sv1");
    expect(snap.type).toBe(MINI_CANVAS_ITEM_TYPE);
    expect(snap.label).toBe("Canvas · Nov 6");
    expect(snap.summary).toContain("2 components");
    expect(snap.summary).toContain("Heading: A");
  });

  it("a one-component canvas says 'component', not 'components'; a long one is truncated with a count", () => {
    expect(savedCanvasToSnapshot(saved([node()])).summary).toMatch(/^1 component\n/);
    const many = Array.from({ length: 9 }, (_, i) => node({ id: `n${i}`, props: { text: `T${i}` } }));
    expect(savedCanvasToSnapshot(saved(many)).summary).toContain("+ 3 more");
  });

  it("the card's content reopens as builder nodes — with fields and formatting intact", () => {
    const snap = savedCanvasToSnapshot(saved([
      node({ type: "RichText", label: "Rich Text", props: { html: "<p><u>under</u></p>" }, fields: { g_title: "T" } }),
    ]));
    const nodes = canvasNodesFromSnapshot(snap);
    expect(nodes).toHaveLength(1);
    expect(String(nodes?.[0].props.html)).toContain("<u>under</u>");
    expect(String(nodes?.[0].props.html)).toContain("<strong>Title</strong><br>T");
  });

  it("canvasNodesFromSnapshot is null for other cards and for damaged content", () => {
    expect(canvasNodesFromSnapshot({ type: "action_item", content: "{}" })).toBeNull();
    expect(canvasNodesFromSnapshot({ type: MINI_CANVAS_ITEM_TYPE, content: "{not json" })).toBeNull();
    expect(canvasNodesFromSnapshot({ type: MINI_CANVAS_ITEM_TYPE, content: JSON.stringify({ kind: "other", nodes: [{}] }) })).toBeNull();
    expect(canvasNodesFromSnapshot({ type: MINI_CANVAS_ITEM_TYPE, content: JSON.stringify({ kind: MINI_CANVAS_ITEM_TYPE, nodes: [] }) })).toBeNull();
  });

  it("parseSavedCanvases keeps valid ones, drops empty or malformed ones, and caps the list", () => {
    const ok = saved([node()]);
    const out = parseSavedCanvases([ok, null, { id: "e", label: "x", nodes: [] }, { label: "no id", nodes: [node()] }, "s"]);
    expect(out.map(c => c.id)).toEqual(["sv1"]);
    const many = Array.from({ length: 40 }, (_, i) => saved([node()], { id: `s${i}` }));
    expect(parseSavedCanvases(many)).toHaveLength(MAX_SAVED_CANVASES);
    expect(parseSavedCanvases("nope")).toEqual([]);
  });
});
