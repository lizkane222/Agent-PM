import { describe, it, expect } from "vitest";
import { findFreeSlots, isCompareEvent, overlayEvents, type PersonAvailability } from "../availability";

const local = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString(); // Oct 2026

describe("overlayEvents", () => {
  const person: PersonAvailability = {
    email: "ana@x.com", name: "Ana", source: "app", error: null,
    busy: [{ start: local(19, 10), end: local(19, 11), all_day: false, title: "Busy", title_visible: false }],
  };
  it("makes read-only compare events prefixed with the person", () => {
    const [e] = overlayEvents(person);
    expect(e.title).toBe("Ana: Busy");
    expect(e.id).toBeLessThan(0);
    expect(isCompareEvent(e)).toBe(true);
    expect(e.agentpm_airtable_id).toBe("");
  });
});

describe("findFreeSlots", () => {
  const range: [Date, Date] = [new Date(2026, 9, 19), new Date(2026, 9, 20)]; // Mon Oct 19
  const opts = { now: new Date(2026, 9, 1) };

  it("returns the working-hour gaps around everyone's busy blocks", () => {
    const slots = findFreeSlots([
      { start: local(19, 9), end: local(19, 10) },
      { start: local(19, 10, 30), end: local(19, 12) },
      { start: local(19, 11), end: local(19, 13) }, // overlaps the previous one
    ], ...range, opts);
    expect(slots.map((s) => [s.start.getHours(), s.start.getMinutes(), s.end.getHours()])).toEqual([
      [10, 0, 10], [13, 0, 17],
    ]);
  });

  it("drops gaps shorter than the minimum", () => {
    const slots = findFreeSlots([
      { start: local(19, 9), end: local(19, 12) },
      { start: local(19, 12, 15), end: local(19, 17) },
    ], ...range, opts);
    expect(slots).toEqual([]);
  });

  it("skips weekends unless asked, and ignores all-day blocks", () => {
    const sat: [Date, Date] = [new Date(2026, 9, 24), new Date(2026, 9, 25)];
    expect(findFreeSlots([], ...sat, opts)).toEqual([]);
    expect(findFreeSlots([], ...sat, { ...opts, includeWeekends: true })).toHaveLength(1);
    expect(findFreeSlots([{ start: local(19, 0), end: local(20, 0), all_day: true }], ...range, opts)).toHaveLength(1);
  });

  it("never offers time in the past", () => {
    const slots = findFreeSlots([], ...range, { now: new Date(2026, 9, 19, 15, 0) });
    expect(slots).toHaveLength(1);
    expect(slots[0].start.getHours()).toBe(15);
  });
});
