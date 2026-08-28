import { calendarEventDisplayProps } from "../brain/calendarEventDisplay.js";
import { CALENDAR_EVENT_DISPLAY_FIXTURES } from "../fixtures/calendarEventDisplay.fixtures.js";
describe("calendarEventDisplayProps", () => {
    for (const f of CALENDAR_EVENT_DISPLAY_FIXTURES) {
        it(f.note ?? `calendar_id="${f.input.calendar_id}" google_event_id="${f.input.google_event_id}"`, () => {
            const result = calendarEventDisplayProps(f.input);
            expect(result.backgroundColor).toBe(f.expected.backgroundColor);
            expect(result.borderColor).toBe(f.expected.borderColor);
            expect(result.textColor).toBe(f.expected.textColor);
            expect(result.editable).toBe(f.expected.editable);
            if (f.expected.titlePrefix) {
                expect(result.title).toMatch(new RegExp(`^${f.expected.titlePrefix}`));
            }
        });
    }
});
//# sourceMappingURL=calendarEventDisplay.test.js.map