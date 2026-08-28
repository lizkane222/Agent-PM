// Fixture matrix for the undo/redo history reducer.
const NODE_A = { id: "a", type: "Text", props: {}, children: [] };
const NODE_B = { id: "b", type: "Icon", props: {}, children: [] };
const NODE_C = { id: "c", type: "Card", props: {}, children: [] };
export const CANVAS_REDUCER_FIXTURES = [
    {
        label: "COMMIT pushes to undo stack",
        actions: [
            { type: "COMMIT", nodes: [NODE_A] },
        ],
        expectedPresent: [NODE_A],
        expectedPastLength: 1,
        expectedFutureLength: 0,
    },
    {
        label: "LIVE does not push to undo stack",
        actions: [
            { type: "COMMIT", nodes: [NODE_A] },
            { type: "LIVE", nodes: [NODE_B] },
        ],
        expectedPresent: [NODE_B],
        expectedPastLength: 1,
        expectedFutureLength: 0,
    },
    {
        label: "UNDO restores previous state",
        actions: [
            { type: "COMMIT", nodes: [NODE_A] },
            { type: "COMMIT", nodes: [NODE_B] },
            { type: "UNDO" },
        ],
        expectedPresent: [NODE_A],
        expectedPastLength: 1,
        expectedFutureLength: 1,
    },
    {
        label: "REDO re-applies undone state",
        actions: [
            { type: "COMMIT", nodes: [NODE_A] },
            { type: "COMMIT", nodes: [NODE_B] },
            { type: "UNDO" },
            { type: "REDO" },
        ],
        expectedPresent: [NODE_B],
        expectedPastLength: 2,
        expectedFutureLength: 0,
    },
    {
        label: "COMMIT after UNDO clears future",
        actions: [
            { type: "COMMIT", nodes: [NODE_A] },
            { type: "COMMIT", nodes: [NODE_B] },
            { type: "UNDO" },
            { type: "COMMIT", nodes: [NODE_C] },
        ],
        expectedPresent: [NODE_C],
        expectedPastLength: 2,
        expectedFutureLength: 0,
    },
    {
        label: "UNDO on empty past is a no-op",
        actions: [
            { type: "UNDO" },
        ],
        expectedPresent: [],
        expectedPastLength: 0,
        expectedFutureLength: 0,
    },
    {
        label: "REDO on empty future is a no-op",
        actions: [
            { type: "COMMIT", nodes: [NODE_A] },
            { type: "REDO" },
        ],
        expectedPresent: [NODE_A],
        expectedPastLength: 1,
        expectedFutureLength: 0,
    },
];
//# sourceMappingURL=canvasReducer.fixtures.js.map