const MAX_HISTORY = 50;
export const INITIAL_HISTORY = { past: [], present: [], future: [] };
export function canvasReducer(state, action) {
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
            if (state.past.length === 0)
                return state;
            const previous = state.past[state.past.length - 1];
            return {
                past: state.past.slice(0, -1),
                present: previous,
                future: [state.present, ...state.future].slice(0, MAX_HISTORY),
            };
        }
        case "REDO": {
            if (state.future.length === 0)
                return state;
            const next = state.future[0];
            return {
                past: [...state.past, state.present].slice(-MAX_HISTORY),
                present: next,
                future: state.future.slice(1),
            };
        }
    }
}
//# sourceMappingURL=canvasReducer.js.map