import type { AirtableActionItem } from "../types.js";
export type DueDateGroup = "Overdue" | "Today" | "This Week" | "Later" | "No Date";
export declare const DUE_GROUP_ORDER: DueDateGroup[];
export declare const DUE_GROUP_STYLES: Record<DueDateGroup, {
    badge: string;
    label: string;
}>;
export declare function dueDateGroup(item: Pick<AirtableActionItem, "due_date">, now?: Date): DueDateGroup;
//# sourceMappingURL=dueDateGroup.d.ts.map