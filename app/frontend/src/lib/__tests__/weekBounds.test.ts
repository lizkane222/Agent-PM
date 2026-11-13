import { describe, it, expect } from "vitest";
import { endOfWeek, startOfWeek } from "../weekBounds";

describe("weekBounds", () => {
  it("mid-week ends on Saturday 23:59:59.999 local", () => {
    const e = endOfWeek(new Date(2026, 10, 11, 9, 30)); // Wed 11 Nov 2026
    expect([e.getFullYear(), e.getMonth(), e.getDate(), e.getDay()]).toEqual([2026, 10, 14, 6]);
    expect([e.getHours(), e.getMinutes(), e.getSeconds(), e.getMilliseconds()]).toEqual([23, 59, 59, 999]);
  });
  it("Saturday night is still in the current week", () => {
    const e = endOfWeek(new Date(2026, 10, 14, 23, 59, 59));
    expect(e.getDate()).toBe(14);
  });
  it("Sunday 00:00 starts a new week ending the following Saturday", () => {
    const e = endOfWeek(new Date(2026, 10, 15, 0, 0, 0));
    expect([e.getMonth(), e.getDate(), e.getDay()]).toEqual([10, 21, 6]);
    expect(startOfWeek(new Date(2026, 10, 15)).getDate()).toBe(15);
  });
  it("supports Monday-start weeks (Sunday belongs to the week ending that day)", () => {
    const e = endOfWeek(new Date(2026, 10, 15, 12), 1);
    expect([e.getDate(), e.getDay()]).toEqual([15, 0]);
  });
  it("is correct in the weeks containing DST changes", () => {
    for (const d of [new Date(2026, 2, 10, 12), new Date(2026, 10, 4, 12), new Date(2026, 9, 28, 12)]) {
      const e = endOfWeek(d);
      expect(e.getDay()).toBe(6);
      expect([e.getHours(), e.getMinutes(), e.getSeconds()]).toEqual([23, 59, 59]);
      expect(e.getTime()).toBeGreaterThanOrEqual(d.getTime());
      expect(e.getTime() - d.getTime()).toBeLessThan(8 * 24 * 3600 * 1000);
    }
  });
});
