export const DUE_GROUP_ORDER = [
    "Overdue", "Today", "This Week", "Later", "No Date",
];
export const DUE_GROUP_STYLES = {
    Overdue: { badge: "bg-red-100 text-red-700", label: "text-red-700" },
    Today: { badge: "bg-amber-100 text-amber-700", label: "text-amber-700" },
    "This Week": { badge: "bg-indigo-50 text-indigo-700", label: "text-indigo-700" },
    Later: { badge: "bg-gray-100 text-gray-600", label: "text-gray-600" },
    "No Date": { badge: "bg-gray-100 text-gray-400", label: "text-gray-400" },
};
// `now` is injected so this function is deterministic in tests.
export function dueDateGroup(item, now = new Date()) {
    if (!item.due_date)
        return "No Date";
    const due = new Date(item.due_date);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrowStart = new Date(todayStart.getTime() + 86_400_000);
    const weekEnd = new Date(todayStart.getTime() + 7 * 86_400_000);
    if (due < todayStart)
        return "Overdue";
    if (due < tomorrowStart)
        return "Today";
    if (due < weekEnd)
        return "This Week";
    return "Later";
}
//# sourceMappingURL=dueDateGroup.js.map