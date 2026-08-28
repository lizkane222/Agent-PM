import { canvasReducer, INITIAL_HISTORY } from "../brain/canvasReducer.js";
import { CANVAS_REDUCER_FIXTURES } from "../fixtures/canvasReducer.fixtures.js";
describe("canvasReducer", () => {
    for (const f of CANVAS_REDUCER_FIXTURES) {
        it(f.label, () => {
            const state = f.actions.reduce((s, action) => canvasReducer(s, action), INITIAL_HISTORY);
            expect(state.present).toEqual(f.expectedPresent);
            expect(state.past).toHaveLength(f.expectedPastLength);
            expect(state.future).toHaveLength(f.expectedFutureLength);
        });
    }
});
//# sourceMappingURL=canvasReducer.test.js.map