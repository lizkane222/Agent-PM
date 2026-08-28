import type { CanvasNode } from "../types.js";
export type ReducerAction = {
    type: "COMMIT";
    nodes: CanvasNode[];
} | {
    type: "LIVE";
    nodes: CanvasNode[];
} | {
    type: "UNDO";
} | {
    type: "REDO";
};
export interface ReducerFixture {
    label: string;
    actions: ReducerAction[];
    expectedPresent: CanvasNode[];
    expectedPastLength: number;
    expectedFutureLength: number;
}
export declare const CANVAS_REDUCER_FIXTURES: ReducerFixture[];
//# sourceMappingURL=canvasReducer.fixtures.d.ts.map