import { describe, it, expect } from "vitest";
import { computeDailyTotals, overlapSeconds } from "../calendarDailyTotals";

describe("overlapSeconds", () => {
  it("returns the full duration when the event sits entirely inside the day", () => {
    const dayStart = new Date(2026, 8, 14).getTime(); // Mon 2026-09-14 local midnight
    const dayEnd = new Date(2026, 8, 15).getTime();
    const secs = overlapSeconds(
      { start_datetime: "2026-09-14T10:00:00", end_datetime: "2026-09-14T11:30:00" },
      dayStart,
      dayEnd,
    );
    expect(secs).toBe(90 * 60);
  });

  it("returns 0 when the event doesn't touch the day at all", () => {
    const dayStart = new Date(2026, 8, 14).getTime();
    const dayEnd = new Date(2026, 8, 15).getTime();
    const secs = overlapSeconds(
      { start_datetime: "2026-09-10T10:00:00", end_datetime: "2026-09-10T11:00:00" },
      dayStart,
      dayEnd,
    );
    expect(secs).toBe(0);
  });

  it("clips a multi-day event to at most this day's 24 hours", () => {
    const dayStart = new Date(2026, 8, 14).getTime();
    const dayEnd = new Date(2026, 8, 15).getTime();
    // Spans Sun 9/13 18:00 through Wed 9/16 06:00 — well over 24h of overlap with 9/14 alone.
    const secs = overlapSeconds(
      { start_datetime: "2026-09-13T18:00:00", end_datetime: "2026-09-16T06:00:00" },
      dayStart,
      dayEnd,
    );
    expect(secs).toBe(24 * 60 * 60);
  });
});

describe("computeDailyTotals", () => {
  const days = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"];

  it("splits a forgotten multi-day active-timer event across every day it spans", () => {
    // Regression for the reported bug: a timer started Monday 9/14 at 9:00am and never
    // stopped, still "running" as of Thursday 9/17 at 4:30pm — 79.5 hours total. The old
    // all-or-nothing bucketing would have dumped the whole 79.5h onto Monday alone.
    const events = [
      { start_datetime: "2026-09-14T09:00:00", end_datetime: "2026-09-17T16:30:00" },
    ];
    const totals = computeDailyTotals(events, days);

    // Monday only gets its own 15 remaining hours (9:00am → midnight), not all 127.5h.
    expect(totals["2026-09-14"]).toBe(15 * 60 * 60);
    // The three full days in between get a full 24h each.
    expect(totals["2026-09-15"]).toBe(24 * 60 * 60);
    expect(totals["2026-09-16"]).toBe(24 * 60 * 60);
    // Thursday gets its partial share up to 4:30pm.
    expect(totals["2026-09-17"]).toBe(16.5 * 60 * 60);
    // Friday (not yet reached by the timer) gets nothing.
    expect(totals["2026-09-18"]).toBe(0);

    const total = Object.values(totals).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(79.5 * 60 * 60, 5);
  });

  it("excludes events explicitly marked as not attended", () => {
    const events = [
      {
        start_datetime: "2026-09-15T10:00:00",
        end_datetime: "2026-09-15T11:00:00",
        attended: false,
      },
    ];
    const totals = computeDailyTotals(events, days);
    expect(totals["2026-09-15"]).toBe(0);
  });

  it("still counts an event with attended left unset (tri-state, not falsy)", () => {
    const events = [
      { start_datetime: "2026-09-15T10:00:00", end_datetime: "2026-09-15T11:00:00" },
    ];
    const totals = computeDailyTotals(events, days);
    expect(totals["2026-09-15"]).toBe(60 * 60);
  });

  it("sums multiple same-day events without letting one clip the other", () => {
    const events = [
      { start_datetime: "2026-09-16T09:00:00", end_datetime: "2026-09-16T09:30:00" },
      { start_datetime: "2026-09-16T13:00:00", end_datetime: "2026-09-16T14:00:00" },
    ];
    const totals = computeDailyTotals(events, days);
    expect(totals["2026-09-16"]).toBe(90 * 60);
  });

  it("returns 0 for a day with no overlapping events, not undefined", () => {
    const totals = computeDailyTotals([], days);
    for (const day of days) {
      expect(totals[day]).toBe(0);
    }
  });
});
