import { dueDateGroup } from "../brain/dueDateGroup.js";
import { DUE_DATE_GROUP_FIXTURES } from "../fixtures/dueDateGroup.fixtures.js";
describe("dueDateGroup", () => {
    for (const fixture of DUE_DATE_GROUP_FIXTURES) {
        const label = fixture.note ?? `due=${fixture.due_date ?? "null"} now=${fixture.nowIso}`;
        it(`${label} → "${fixture.expected}"`, () => {
            const now = new Date(fixture.nowIso);
            expect(dueDateGroup({ due_date: fixture.due_date }, now)).toBe(fixture.expected);
        });
    }
});
//# sourceMappingURL=dueDateGroup.test.js.map