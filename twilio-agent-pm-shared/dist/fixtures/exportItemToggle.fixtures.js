const ITEM_A = { id: "account:1", type: "account", label: "Acme", summary: "Acme Corp", content: "..." };
const ITEM_B = { id: "action_item:abc", type: "action_item", label: "Fix bug", summary: "Fix the bug", content: "..." };
const ITEM_C = { id: "account:2", type: "account", label: "Beta Inc", summary: "Beta Inc Corp", content: "..." };
export const EXPORT_ITEM_TOGGLE_FIXTURES = [
    {
        initialItems: [],
        toggle: ITEM_A,
        expectedIds: ["account:1"],
        note: "add to empty list",
    },
    {
        initialItems: [ITEM_A],
        toggle: ITEM_B,
        expectedIds: ["account:1", "action_item:abc"],
        note: "add new item",
    },
    {
        initialItems: [ITEM_A, ITEM_B],
        toggle: ITEM_A,
        expectedIds: ["action_item:abc"],
        note: "remove existing item",
    },
    {
        initialItems: [ITEM_A, ITEM_B, ITEM_C],
        toggle: ITEM_B,
        expectedIds: ["account:1", "account:2"],
        note: "remove middle item",
    },
    {
        initialItems: [ITEM_A],
        toggle: ITEM_A,
        expectedIds: [],
        note: "remove only item → empty list",
    },
];
//# sourceMappingURL=exportItemToggle.fixtures.js.map