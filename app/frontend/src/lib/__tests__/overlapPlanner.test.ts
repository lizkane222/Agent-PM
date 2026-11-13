import { describe, it, expect } from "vitest";
import {
  HOUR, MIN, hourCells, zoneMidnightUtc, workIntervalsUtc, intersect, intersectAll, findOverlap,
  formatWindowInZone, dayBoundaries, moveWindow, resizeWindow, snapToStep, groupByZone, buildCopyText, bandFor, todayISO,
} from "../overlapPlanner";

const iso = (ms: number) => new Date(ms).toISOString();

describe("zoneMidnightUtc", () => {
  it("finds local midnight, including across DST", () => {
    expect(iso(zoneMidnightUtc("America/New_York", "2026-11-01"))).toBe("2026-11-01T04:00:00.000Z"); // still EDT
    expect(iso(zoneMidnightUtc("America/New_York", "2026-11-02"))).toBe("2026-11-02T05:00:00.000Z"); // EST
    expect(iso(zoneMidnightUtc("Asia/Kolkata", "2026-06-10"))).toBe("2026-06-09T18:30:00.000Z");
    expect(iso(zoneMidnightUtc("Asia/Kathmandu", "2026-06-10"))).toBe("2026-06-09T18:15:00.000Z");
  });
});

describe("hourCells", () => {
  it("shows local hours per zone for the same stretch of time", () => {
    const start = zoneMidnightUtc("America/Los_Angeles", "2026-03-02");
    const la = hourCells("America/Los_Angeles", start);
    const ldn = hourCells("Europe/London", start);
    expect(la[0].hour).toBe(0);
    expect(ldn[0].hour).toBe(8);
    expect(la).toHaveLength(24);
    expect(la[9].band).toBe("work");
    expect(la[7].band).toBe("edge");
    expect(la[23].band).toBe("night");
  });
  it("repeats the 1 AM hour on the fall-back day", () => {
    const start = zoneMidnightUtc("America/New_York", "2026-11-01");
    expect(hourCells("America/New_York", start).slice(0, 4).map((c) => c.hour)).toEqual([0, 1, 1, 2]);
  });
  it("labels half-hour offsets with minutes", () => {
    const start = zoneMidnightUtc("America/Los_Angeles", "2026-03-02");
    const k = hourCells("Asia/Kolkata", start);
    expect(k.every((c) => c.minute === 30)).toBe(true);
    expect(k[0].label).toMatch(/:30/);
  });
  it("bands", () => {
    expect(bandFor(22, 0)).toBe("night");
    expect(bandFor(5, 59)).toBe("night");
    expect(bandFor(6, 0)).toBe("edge");
    expect(bandFor(9, 0)).toBe("work");
    expect(bandFor(17, 0)).toBe("edge");
  });
});

describe("dayBoundaries", () => {
  it("marks where the date changes in each zone", () => {
    const start = zoneMidnightUtc("America/Los_Angeles", "2026-03-02"); // Mon
    const m = dayBoundaries("Asia/Tokyo", start, start + 24 * HOUR);
    expect(m[0].label).toBe("Mon 3/2");
    expect(m).toHaveLength(2);
    expect(m[1].label).toBe("Tue 3/3");
    expect(iso(m[1].ms)).toBe("2026-03-02T15:00:00.000Z");
  });
  it("handles half-hour zones", () => {
    const start = zoneMidnightUtc("America/Los_Angeles", "2026-03-02");
    const m = dayBoundaries("Asia/Kolkata", start, start + 24 * HOUR);
    expect(iso(m[1].ms)).toBe("2026-03-02T18:30:00.000Z");
  });
});

describe("intervals", () => {
  it("computes working hours in UTC, with DST", () => {
    const day = Date.UTC(2026, 10, 1, 0); // Nov 1 UTC
    const iv = workIntervalsUtc("America/New_York", day, day + 24 * HOUR);
    expect(iv).toEqual([{ startMs: Date.UTC(2026, 10, 1, 14), endMs: Date.UTC(2026, 10, 1, 22) }]); // 9-17 EST
  });
  it("intersects", () => {
    const a = [{ startMs: 0, endMs: 10 }, { startMs: 20, endMs: 30 }];
    const b = [{ startMs: 5, endMs: 25 }];
    expect(intersect(a, b)).toEqual([{ startMs: 5, endMs: 10 }, { startMs: 20, endMs: 25 }]);
    expect(intersectAll([a, b, [{ startMs: 8, endMs: 22 }]])).toEqual([{ startMs: 8, endMs: 10 }, { startMs: 20, endMs: 22 }]);
    expect(intersectAll([])).toEqual([]);
  });
});

describe("findOverlap", () => {
  const axis = zoneMidnightUtc("America/Chicago", "2026-03-02");
  it("finds the shared 9-5 window of two zones", () => {
    const r = findOverlap(["America/Chicago", "America/New_York"], axis);
    expect(r.tier).toBe(0);
    // NY 9-17 = CT 8-16; CT 9-17 -> shared 9-16 Central
    expect(formatWindowInZone(r.window!.startMs, r.window!.endMs, "America/Chicago")).toBe("Mon 9:00 AM - 4:00 PM");
  });
  it("is the whole working day for one zone", () => {
    const r = findOverlap(["America/Chicago"], axis);
    expect(r.window!.endMs - r.window!.startMs).toBe(8 * HOUR);
  });
  it("handles half-hour zones", () => {
    const a = zoneMidnightUtc("Asia/Kolkata", "2026-03-02");
    const r = findOverlap(["Asia/Kolkata", "Asia/Kathmandu"], a);
    // Kathmandu is 15 minutes ahead of Kolkata: Kolkata 9:00 = Kathmandu 9:15, Kathmandu 5:00 = Kolkata 4:45.
    expect(formatWindowInZone(r.window!.startMs, r.window!.endMs, "Asia/Kathmandu")).toBe("Mon 9:15 AM - 5:00 PM");
    expect(formatWindowInZone(r.window!.startMs, r.window!.endMs, "Asia/Kolkata")).toBe("Mon 9:00 AM - 4:45 PM");
  });
  it("falls back to extended hours when 9-5 never lines up", () => {
    // Los Angeles (UTC-8) and Berlin (UTC+1): 9 hour gap. LA 8-19 = Berlin 17-04, Berlin 8-19 -> shared Berlin 17-19.
    const a = zoneMidnightUtc("America/Los_Angeles", "2026-03-02");
    const r = findOverlap(["America/Los_Angeles", "Europe/Berlin"], a);
    expect(r.noCoreOverlap).toBe(true);
    expect(r.tier).toBe(1);
    expect(formatWindowInZone(r.window!.startMs, r.window!.endMs, "Europe/Berlin")).toBe("Mon 5:00 PM - 7:00 PM");
  });
  it("reports nothing when even waking hours do not meet", () => {
    const a = zoneMidnightUtc("America/Los_Angeles", "2026-03-02");
    const r = findOverlap(["America/Los_Angeles", "Asia/Singapore", "Europe/London"], a);
    expect(r.tier).toBe(-1);
    expect(r.window).toBeNull();
  });
  it("is DST-correct on the fall-back date", () => {
    const a = zoneMidnightUtc("America/New_York", "2026-11-01");
    const r = findOverlap(["America/New_York", "Europe/London"], a);
    // London already on GMT (since Oct 25), New York still EDT until 2 AM: gap 4h before, 5h after.
    expect(r.tier).toBe(0);
    expect(formatWindowInZone(r.window!.startMs, r.window!.endMs, "America/New_York")).toMatch(/^Sun /);
  });
});

describe("window editing", () => {
  const axis = { startMs: 0, endMs: 24 * HOUR };
  it("snaps to 15 minutes", () => {
    expect(snapToStep(7 * MIN)).toBe(0);
    expect(snapToStep(8 * MIN)).toBe(15 * MIN);
  });
  it("moves within the axis", () => {
    expect(moveWindow({ startMs: HOUR, endMs: 2 * HOUR }, 20 * MIN, axis)).toEqual({ startMs: HOUR + 15 * MIN, endMs: 2 * HOUR + 15 * MIN });
    expect(moveWindow({ startMs: HOUR, endMs: 2 * HOUR }, 99 * HOUR, axis)).toEqual({ startMs: 23 * HOUR, endMs: 24 * HOUR });
    expect(moveWindow({ startMs: HOUR, endMs: 2 * HOUR }, -99 * HOUR, axis).startMs).toBe(0);
  });
  it("resizes edges but keeps at least 15 minutes", () => {
    const w = { startMs: HOUR, endMs: 2 * HOUR };
    expect(resizeWindow(w, "end", 30 * MIN, axis)).toEqual({ startMs: HOUR, endMs: 2.5 * HOUR });
    expect(resizeWindow(w, "end", -5 * HOUR, axis).endMs).toBe(HOUR + 15 * MIN);
    expect(resizeWindow(w, "start", -30 * MIN, axis).startMs).toBe(0.5 * HOUR);
    expect(resizeWindow(w, "start", 5 * HOUR, axis).startMs).toBe(2 * HOUR - 15 * MIN);
  });
});

describe("formatting and grouping", () => {
  it("formats a window across midnight", () => {
    const s = Date.UTC(2026, 2, 3, 3, 0); // 7 PM Mon in LA (PST)
    expect(formatWindowInZone(s, s + 6 * HOUR, "America/Los_Angeles")).toBe("Mon 7:00 PM - Tue 1:00 AM");
  });
  it("groups people by distinct zone with the viewer first", () => {
    const rows = groupByZone([
      { id: "1", name: "Ann", zone: "America/Chicago" },
      { id: "2", name: "Bo", zone: "America/Chicago" },
      { id: "3", name: "Cy", zone: null },
      { id: "4", name: "Di", zone: "America/Los_Angeles" },
    ], "America/Los_Angeles");
    expect(rows.map((r) => [r.zone, r.names, r.isYou])).toEqual([
      ["America/Los_Angeles", ["Di"], true],
      ["America/Chicago", ["Ann", "Bo"], false],
    ]);
  });
  it("builds copy text per zone", () => {
    const rows = groupByZone([{ id: "1", name: "Ann", zone: "America/Chicago" }], "America/Los_Angeles");
    const s = Date.UTC(2026, 2, 2, 17, 0);
    const text = buildCopyText(rows, { startMs: s, endMs: s + HOUR });
    expect(text).toContain("You (America/Los_Angeles): Mon 9:00 AM - 10:00 AM PST");
    expect(text).toContain("Ann (America/Chicago): Mon 11:00 AM - 12:00 PM CST");
  });
  it("todayISO uses the zone's date", () => {
    const now = new Date("2026-03-02T03:00:00Z");
    expect(todayISO("America/Los_Angeles", now)).toBe("2026-03-01");
    expect(todayISO("Asia/Tokyo", now)).toBe("2026-03-02");
  });
});
