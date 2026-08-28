import { toLocalISO, addMsToLocalISO } from "../brain/dateUtils.js";
import { TO_LOCAL_ISO_FIXTURES, ADD_MS_TO_LOCAL_ISO_FIXTURES } from "../fixtures/dateUtils.fixtures.js";

describe("toLocalISO", () => {
  for (const f of TO_LOCAL_ISO_FIXTURES) {
    it(f.note ?? `"${f.input}" preserves date/time`, () => {
      const result = toLocalISO(f.input);
      expect(result.slice(0, 10)).toBe(f.expectedDate);
      expect(result.slice(11, 19)).toBe(f.expectedTime);
      // Must contain a UTC offset suffix, not end with Z
      expect(result).toMatch(/[+-]\d{2}:\d{2}$/);
    });
  }
});

describe("addMsToLocalISO", () => {
  for (const f of ADD_MS_TO_LOCAL_ISO_FIXTURES) {
    it(f.note ?? `"${f.localStr}" + ${f.ms}ms`, () => {
      const result = addMsToLocalISO(f.localStr, f.ms);
      expect(result.slice(0, 10)).toBe(f.expectedDate);
      expect(result.slice(11, 19)).toBe(f.expectedTime);
      expect(result).toMatch(/[+-]\d{2}:\d{2}$/);
    });
  }
});
