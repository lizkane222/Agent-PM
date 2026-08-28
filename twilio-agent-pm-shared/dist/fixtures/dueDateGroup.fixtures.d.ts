export type DueDateGroup = "Overdue" | "Today" | "This Week" | "Later" | "No Date";
export interface DueDateGroupFixture {
    nowIso: string;
    due_date: string | null;
    expected: DueDateGroup;
    note?: string;
}
export declare const DUE_DATE_GROUP_FIXTURES: DueDateGroupFixture[];
//# sourceMappingURL=dueDateGroup.fixtures.d.ts.map