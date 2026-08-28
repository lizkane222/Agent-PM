// Fixtures for: findNode, removeNode, deepCloneNode
const LEAF_A = { id: "a", type: "Text", props: { text: "Hello" }, children: [] };
const LEAF_B = { id: "b", type: "Text", props: { text: "World" }, children: [] };
const LEAF_C = { id: "c", type: "Icon", props: { glyph: "✦" }, children: [] };
const PARENT = { id: "p", type: "Container", props: {}, children: [LEAF_A, LEAF_B] };
const NESTED = { id: "root", type: "Card", props: {}, children: [PARENT, LEAF_C] };
export const FIND_NODE_FIXTURES = [
    { root: [NESTED], id: "root", expectedId: "root", note: "root-level hit" },
    { root: [NESTED], id: "p", expectedId: "p", note: "one level deep" },
    { root: [NESTED], id: "a", expectedId: "a", note: "two levels deep" },
    { root: [NESTED], id: "c", expectedId: "c", note: "sibling of parent" },
    { root: [NESTED], id: "missing", expectedId: null, note: "not found → null" },
    { root: [], id: "a", expectedId: null, note: "empty tree → null" },
];
export const REMOVE_NODE_FIXTURES = [
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
export const DEEP_CLONE_FIXTURES = [
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
export const RICH_TEXT_PROPS_FIXTURES = [
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
//# sourceMappingURL=canvasTree.fixtures.js.map