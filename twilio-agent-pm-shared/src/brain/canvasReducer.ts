import type { CanvasNode } from "../types.js";

const MAX_HISTORY = 50;

export interface HistoryState {
  past: CanvasNode[][];
  present: CanvasNode[];
  future: CanvasNode[][];
}

export type CanvasAction =
  | { type: "COMMIT"; nodes: CanvasNode[] }
  | { type: "LIVE"; nodes: CanvasNode[] }
  | { type: "UNDO" }
  | { type: "REDO" };

export const INITIAL_HISTORY: HistoryState = { past: [], present: [], future: [] };

export function canvasReducer(state: HistoryState, action: CanvasAction): HistoryState {
  switch (action.type) {
    case "COMMIT":
      return {
        past: [...state.past, state.present].slice(-MAX_HISTORY),
        present: action.nodes,
        future: [],
      };
    case "LIVE":
      return { ...state, present: action.nodes };
    case "UNDO": {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1]!;
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future].slice(0, MAX_HISTORY),
      };
    }
    case "REDO": {
      if (state.future.length === 0) return state;
      const next = state.future[0]!;
      return {
        past: [...state.past, state.present].slice(-MAX_HISTORY),
        present: next,
        future: state.future.slice(1),
      };
    }
  }
}
