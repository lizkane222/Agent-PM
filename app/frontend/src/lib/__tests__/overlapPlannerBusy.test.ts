import { describe, it, expect } from "vitest";
import {
  HOUR, MIN, busyIntervals, conflictsFor, freeWindows, isTeamPerson, mergeIntervals, nearestConflict,
  sharedWorkIntervals, subtractBusy, zoneMidnightUtc,
} from "../overlapPlanner";

const iv = (s: number, e: number) => ({ startMs: s, endMs: e });

describe("subtractBusy / mergeIntervals", () => {
  it("merges overlapping and touching ranges", () => {
    expect(mergeIntervals([iv(5, 8), iv(1, 3), iv(3, 4), iv(7, 9)])).toEqual([iv(1, 4), iv(5, 9)]);
  });
  it("splits a free window around busy time", () => {
    expect(subtractBusy([iv(0, 10)], [iv(2, 3), iv(6, 7)])).toEqual([iv(0, 2), iv(3, 6), iv(7, 10)]);
  });
  it("removes a window fully covered and trims edges", () => {
    expect(subtractBusy([iv(0, 10)], [iv(-5, 2), iv(8, 20)])).toEqual([iv(2, 8)]);
    expect(subtractBusy([iv(0, 10)], [iv(-5, 20)])).toEqual([]);
  });
  it("handles a busy range spanning several free windows", () => {
    expect(subtractBusy([iv(0, 4), iv(6, 10)], [iv(3, 7)])).toEqual([iv(0, 3), iv(7, 10)]);
  });
});

describe("freeWindows", () => {
  const axis = zoneMidnightUtc("America/Los_Angeles", "2026-03-02");
  // LA 9-17 and Chicago 9-17 share LA 9:00-15:00.
  const zones = ["America/Los_Angeles", "America/Chicago"];

  it("equals the shared 9-5 overlap with no busy time", () => {
    expect(freeWindows(zones, axis, [])).toEqual([iv(axis + 9 * HOUR, axis + 15 * HOUR)]);
  });
  it("returns widest first and drops slivers under 15 minutes", () => {
    const busy = [iv(axis + 12 * HOUR, axis + 13 * HOUR), iv(axis + 14 * HOUR + 50 * MIN, axis + 16 * HOUR)];
    expect(freeWindows(zones, axis, busy)).toEqual([iv(axis + 9 * HOUR, axis + 12 * HOUR), iv(axis + 13 * HOUR, axis + 14 * HOUR + 50 * MIN)]);
  });
  it("is empty when busy covers the whole shared window", () => {
    expect(freeWindows(zones, axis, [iv(axis, axis + 24 * HOUR)])).toEqual([]);
  });
  it("respects a half-hour zone (Asia/Kolkata 9-5 vs LA)", () => {
    const shared = sharedWorkIntervals(["Asia/Kolkata", "America/Los_Angeles"], axis);
    // IST 9:00-17:00 is LA 19:30(prev day)-03:30; LA 9-17 never meets it on this axis.
    expect(shared).toEqual([]);
    const k = freeWindows(["Asia/Kolkata", "Asia/Kathmandu"], zoneMidnightUtc("Asia/Kolkata", "2026-03-02"), []);
    // Kathmandu is +5:45, so 9:00 IST is 9:15 NPT and 17:00 NPT is 16:15 IST.
    expect(k).toHaveLength(1);
    expect(k[0].endMs - k[0].startMs).toBe(7.75 * HOUR);
  });
  it("handles a DST day (US spring forward 2026-03-08)", () => {
    const a = zoneMidnightUtc("America/New_York", "2026-03-08");
    const [w] = freeWindows(["America/New_York"], a, []);
    // 9:00 EDT = 13:00Z, 17:00 EDT = 21:00Z (the day lost an hour at 2 AM; work hours still 8h).
    expect(w).toEqual(iv(Date.UTC(2026, 2, 8, 13), Date.UTC(2026, 2, 8, 21)));
    const cut = freeWindows(["America/New_York"], a, [iv(Date.UTC(2026, 2, 8, 12), Date.UTC(2026, 2, 8, 14))]);
    expect(cut).toEqual([iv(Date.UTC(2026, 2, 8, 14), Date.UTC(2026, 2, 8, 21))]);
  });
  it("busy spanning the day boundary only removes what falls inside the axis", () => {
    const busy = [iv(axis - 3 * HOUR, axis + 10 * HOUR), iv(axis + 14 * HOUR, axis + 40 * HOUR)];
    expect(freeWindows(zones, axis, busy)).toEqual([iv(axis + 10 * HOUR, axis + 14 * HOUR)]);
  });
});

describe("busyIntervals, conflictsFor, nearestConflict", () => {
  const axis = zoneMidnightUtc("America/Los_Angeles", "2026-03-02");
  it("skips all-day and invalid blocks and merges the rest", () => {
    const r = busyIntervals([
      { start: "2026-03-02T17:00:00Z", end: "2026-03-02T18:00:00Z" },
      { start: "2026-03-02T17:30:00Z", end: "2026-03-02T19:00:00Z" },
      { start: "2026-03-02T00:00:00Z", end: "2026-03-03T00:00:00Z", all_day: true },
      { start: "garbage", end: "2026-03-02T19:00:00Z" },
    ]);
    expect(r).toEqual([iv(Date.UTC(2026, 2, 2, 17), Date.UTC(2026, 2, 2, 19))]);
  });
  it("lists who is busy inside a window", () => {
    const people = [{ name: "Jane", ranges: [iv(axis + 9 * HOUR, axis + 10 * HOUR)] }, { name: "Bo", ranges: [iv(axis + 12 * HOUR, axis + 13 * HOUR)] }];
    expect(conflictsFor(iv(axis + 9.5 * HOUR, axis + 11 * HOUR), people)).toEqual([{ name: "Jane", startMs: axis + 9.5 * HOUR, endMs: axis + 10 * HOUR }]);
    expect(conflictsFor(iv(axis + 10 * HOUR, axis + 12 * HOUR), people)).toEqual([]);
  });
  it("names the earliest blocker inside the shared 9-5", () => {
    const zones = ["America/Los_Angeles", "America/Chicago"];
    const people = [{ name: "Bo", ranges: [iv(axis + 11 * HOUR, axis + 20 * HOUR)] }, { name: "Jane", ranges: [iv(axis, axis + 10 * HOUR)] }];
    expect(nearestConflict(zones, axis, people)).toEqual({ name: "Jane", startMs: axis + 9 * HOUR, endMs: axis + 10 * HOUR });
    expect(nearestConflict(["Asia/Kolkata", "America/Los_Angeles"], axis, people)).toBeNull();
  });
});

describe("isTeamPerson", () => {
  it("uses kind, else the id prefix", () => {
    expect(isTeamPerson({ id: "m:1", name: "a", zone: null })).toBe(true);
    expect(isTeamPerson({ id: "c:1", name: "a", zone: null })).toBe(false);
    expect(isTeamPerson({ id: "x", name: "a", zone: null, kind: "team" })).toBe(true);
  });
});
