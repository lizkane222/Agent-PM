export function findNode(root, id) {
    for (const n of root) {
        if (n.id === id)
            return n;
        const found = findNode(n.children, id);
        if (found)
            return found;
    }
    return null;
}
export function removeNode(root, id) {
    return root
        .filter((n) => n.id !== id)
        .map((n) => ({ ...n, children: removeNode(n.children, id) }));
}
export function updateNodeProps(root, id, props) {
    return root.map((n) => {
        if (n.id === id)
            return { ...n, props };
        return { ...n, children: updateNodeProps(n.children, id, props) };
    });
}
export function addChildToNode(root, parentId, child) {
    return root.map((n) => {
        if (n.id === parentId)
            return { ...n, children: [...n.children, child] };
        return { ...n, children: addChildToNode(n.children, parentId, child) };
    });
}
// `makeId` is injected so callers control ID generation (deterministic in tests).
export function deepCloneNode(node, offsetRoot, makeId) {
    const cloned = {
        id: makeId(),
        type: node.type,
        props: { ...node.props },
        children: node.children.map((c) => deepCloneNode(c, false, makeId)),
    };
    if (offsetRoot && cloned.props["x"] !== undefined) {
        cloned.props = {
            ...cloned.props,
            x: cloned.props["x"] + 20,
            y: (cloned.props["y"] ?? 0) + 20,
        };
    }
    return cloned;
}
/** Flat BFS collection of all node IDs in a tree — used for assertions. */
export function collectIds(root) {
    const ids = [];
    const queue = [...root];
    while (queue.length > 0) {
        const node = queue.shift();
        ids.push(node.id);
        queue.push(...node.children);
    }
    return ids;
}
//# sourceMappingURL=canvasTree.js.map