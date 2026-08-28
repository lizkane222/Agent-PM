export function toggleExportItem(items, item) {
    const exists = items.some((i) => i.id === item.id);
    return exists ? items.filter((i) => i.id !== item.id) : [...items, item];
}
//# sourceMappingURL=exportItems.js.map