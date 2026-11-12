import { describe, expect, it } from "vitest";
import { fromLocalDatetimeValue, nextHourLocalValue, sameInstant, toLocalDatetimeValue } from "../datetimeLocal";

describe("datetimeLocal", () => {
  it("round-trips a local wall-clock value through an instant", () => {
    const local = "2026-12-01T15:00";
    const iso = fromLocalDatetimeValue(local);
    expect(iso.endsWith("Z")).toBe(true);
    expect(iso).toBe(new Date(local).toISOString());
    expect(toLocalDatetimeValue(iso)).toBe(local);
  });

  it("shows the user's local clock for a stored instant, not the UTC clock", () => {
    const d = new Date(2026, 11, 1, 9, 5); // 09:05 local, whatever the zone
    expect(toLocalDatetimeValue(d.toISOString())).toBe("2026-12-01T09:05");
  });

  it("returns empty strings for empty or invalid input instead of throwing", () => {
    expect(fromLocalDatetimeValue("")).toBe("");
    expect(fromLocalDatetimeValue("not a date")).toBe("");
    expect(toLocalDatetimeValue("")).toBe("");
    expect(toLocalDatetimeValue("garbage")).toBe("");
  });

  it("defaults a new reminder to the next whole hour", () => {
    expect(nextHourLocalValue(new Date(2026, 11, 1, 9, 5))).toBe("2026-12-01T10:00");
    expect(nextHourLocalValue(new Date(2026, 11, 1, 23, 30))).toBe("2026-12-02T00:00");
  });

  it("compares instants, not strings", () => {
    expect(sameInstant("2026-12-01T20:00:00Z", "2026-12-01T20:00:00.000Z")).toBe(true);
    expect(sameInstant("2026-12-01T20:00:00Z", "2026-12-01T12:00:00-08:00")).toBe(true);
    expect(sameInstant("2026-12-01T20:00:00Z", "2026-12-01T20:01:00Z")).toBe(false);
    expect(sameInstant("x", "x")).toBe(false);
  });
});
