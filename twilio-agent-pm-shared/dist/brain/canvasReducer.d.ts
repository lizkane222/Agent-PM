import type { CanvasNode } from "../types.js";
export interface HistoryState {
    past: CanvasNode[][];
    present: CanvasNode[];
    future: CanvasNode[][];
}
export type CanvasAction = {
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
export declare const INITIAL_HISTORY: HistoryState;
export declare function canvasReducer(state: HistoryState, action: CanvasAction): HistoryState;
//# sourceMappingURL=canvasReducer.d.ts.map