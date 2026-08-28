import type { CanvasNode } from "../types.js";

// Fixtures for: findNode, removeNode, deepCloneNode

const LEAF_A: CanvasNode = { id: "a", type: "Text", props: { text: "Hello" }, children: [] };
const LEAF_B: CanvasNode = { id: "b", type: "Text", props: { text: "World" }, children: [] };
const LEAF_C: CanvasNode = { id: "c", type: "Icon", props: { glyph: "✦" }, children: [] };
const PARENT: CanvasNode = { id: "p", type: "Container", props: {}, children: [LEAF_A, LEAF_B] };
const NESTED: CanvasNode = { id: "root", type: "Card", props: {}, children: [PARENT, LEAF_C] };

export interface FindNodeFixture {
  root: CanvasNode[];
  id: string;
  expectedId: string | null;
  note?: string;
}

export const FIND_NODE_FIXTURES: FindNodeFixture[] = [
  { root: [NESTED], id: "root", expectedId: "root", note: "root-level hit" },
  { root: [NESTED], id: "p", expectedId: "p", note: "one level deep" },
  { root: [NESTED], id: "a", expectedId: "a", note: "two levels deep" },
  { root: [NESTED], id: "c", expectedId: "c", note: "sibling of parent" },
  { root: [NESTED], id: "missing", expectedId: null, note: "not found → null" },
  { root: [], id: "a", expectedId: null, note: "empty tree → null" },
];

export interface RemoveNodeFixture {
  root: CanvasNode[];
  id: string;
  expectedIds: string[]; // flat list of all remaining node ids (BFS)
  note?: string;
}

export const REMOVE_NODE_FIXTURES: RemoveNodeFixture[] = [
  {
    root: [PARENT],
    id: "a",
    expectedIds: ["p", "b"],
    note: "remove leaf child",
  },
  {
    root: [NESTED],
    id: "p",
    expectedIds: ["root", "c"],
    note: "remove intermediate node removes its subtree",
  },
  {
    root: [NESTED],
    id: "root",
    expectedIds: [],
    note: "remove root node clears tree",
  },
  {
    root: [NESTED],
    id: "missing",
    expectedIds: ["root", "p", "a", "b", "c"],
    note: "missing id → tree unchanged",
  },
];

export interface DeepCloneFixture {
  source: CanvasNode;
  offsetRoot: boolean;
  note?: string;
}

export const DEEP_CLONE_FIXTURES: DeepCloneFixture[] = [
  {
    source: LEAF_A,
    offsetRoot: false,
    note: "clone leaf — new id, same props",
  },
  {
    source: PARENT,
    offsetRoot: false,
    note: "clone with children — all ids regenerated",
  },
  {
    source: { ...PARENT, props: { x: 100, y: 200 } },
    offsetRoot: true,
    note: "offsetRoot bumps x/y by 20",
  },
];

// ── RichText props — sanitization invariant ───────────────────────────────────
//
// props.html on a RichText node is untrusted user content. The core package
// stores it as-is (schema: z.record(z.unknown())) because sanitization is a
// rendering concern — the Brain/Arms boundary means no DOM APIs here.
//
// The XSS payloads below verify that the schema round-trips arbitrary HTML
// without corruption. They are NOT rendered by this package. Any rendering
// surface that sets innerHTML from props.html without first calling
// DOMPurify.sanitize (or equivalent) introduces an XSS vulnerability.
// See: NodeRenderer.tsx RichText case (security fix applied in WEBAPP_PATH).

export interface RichTextPropsFixture {
  node: CanvasNode;
  /** Always true — marks this fixture as testing the untrusted-HTML invariant. */
  propsHtmlIsUntrusted: true;
  note: string;
}

export const RICH_TEXT_PROPS_FIXTURES: RichTextPropsFixture[] = [
  {
    node: { id: "rt1", type: "RichText", props: { html: "<p>Hello world</p>" }, children: [] },
    propsHtmlIsUntrusted: true,
    note: "benign HTML — schema stores as-is; consumer must still sanitize",
  },
  {
    node: { id: "rt2", type: "RichText", props: { html: "<script>alert(1)</script>" }, children: [] },
    propsHtmlIsUntrusted: true,
    note: "XSS via script tag — schema accepts as data; consumer must sanitize before render",
  },
  {
    node: { id: "rt3", type: "RichText", props: { html: "<img src=x onerror=alert(1)>" }, children: [] },
    propsHtmlIsUntrusted: true,
    note: "XSS via onerror attribute — schema accepts as data; consumer must sanitize before render",
  },
  {
    node: {
      id: "rt4",
      type: "RichText",
      props: { html: '<a href="javascript:alert(1)">click</a>' },
      children: [],
    },
    propsHtmlIsUntrusted: true,
    note: "XSS via javascript: href — schema accepts as data; consumer must sanitize before render",
  },
];
