import { matchResourceLabel } from "../brain/resourceLabelMatcher.js";
import { RESOURCE_LABEL_FIXTURES } from "../fixtures/resourceLabelMatcher.fixtures.js";
describe("matchResourceLabel", () => {
    for (const f of RESOURCE_LABEL_FIXTURES) {
        const label = f.note ?? `${f.method} ${f.url} → ${f.expectedLabel ?? "null"}`;
        it(label, () => {
            const result = matchResourceLabel(f.url);
            expect(result).toBe(f.expectedLabel);
        });
    }
});
//# sourceMappingURL=resourceLabelMatcher.test.js.map