import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { localDateKey, instantDayKey, dateFieldDayKey } from "../timelineDay";

describe("timeline day keys", () => {
  const prev = process.env.TZ;
  beforeAll(() => { process.env.TZ = "America/Los_Angeles"; });
  afterAll(() => { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev; });

  it("puts a 4:30 PM Pacific event on its own local day, not the next UTC day", () => {
    // Mon Nov 9 2026 4:30 PM PST == Tue Nov 10 00:30 UTC (the reported 'yesterday on today' case)
    expect(instantDayKey("2026-11-10T00:30:00Z")).toBe("2026-11-09");
    expect(instantDayKey("2026-11-10T00:30:00+00:00")).toBe("2026-11-09");
  });

  it("keeps a morning event on the same day", () => {
    expect(instantDayKey("2026-11-10T17:00:00Z")).toBe("2026-11-10");
  });

  it("uses a date-only value as written (no UTC shift)", () => {
    expect(dateFieldDayKey("2026-11-09")).toBe("2026-11-09");
    expect(dateFieldDayKey("2026-11-09T00:00:00Z")).toBe("2026-11-09");
  });

  it("converts a date field that carries a real time of day to the local day", () => {
    expect(dateFieldDayKey("2026-11-10T00:30:00Z")).toBe("2026-11-09");
  });

  it("formats a local Date by its local calendar day", () => {
    expect(localDateKey(new Date(2026, 10, 9, 23, 59))).toBe("2026-11-09");
    expect(localDateKey(new Date(2026, 10, 10, 0, 0))).toBe("2026-11-10");
  });
});
