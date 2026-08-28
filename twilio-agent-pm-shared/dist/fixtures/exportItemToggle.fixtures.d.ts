import type { ExportItem } from "../types.js";
export interface ExportToggleFixture {
    initialItems: ExportItem[];
    toggle: ExportItem;
    expectedIds: string[];
    note?: string;
}
export declare const EXPORT_ITEM_TOGGLE_FIXTURES: ExportToggleFixture[];
//# sourceMappingURL=exportItemToggle.fixtures.d.ts.map