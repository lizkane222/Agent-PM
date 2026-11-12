import { describe, it, expect } from "vitest";
import { resolveInput, suggestZones, describeZone, isValidZone, localTimeLabel, formatOffset, _tables, ABBREVIATIONS } from "../timezones";

const zoneOf = (q: string) => resolveInput(q).zone;

describe("resolveInput", () => {
  it("resolves IANA names, cities and aliases", () => {
    expect(zoneOf("America/Chicago")).toBe("America/Chicago");
    expect(zoneOf("Chicago")).toBe("America/Chicago");
    expect(zoneOf("london")).toBe("Europe/London");
    expect(zoneOf("Bangalore")).toBe("Asia/Kolkata");
    expect(zoneOf("Kolkata")).toBe("Asia/Kolkata");
  });
  it("resolves abbreviations", () => {
    expect(zoneOf("PST")).toBe("America/Los_Angeles");
    expect(zoneOf("pdt")).toBe("America/Los_Angeles");
    expect(zoneOf("EST")).toBe("America/New_York");
    expect(zoneOf("CET")).toBe("Europe/Berlin");
    expect(zoneOf("IST")).toBe("Asia/Kolkata");
    expect(zoneOf("JST")).toBe("Asia/Tokyo");
    expect(zoneOf("AEST")).toBe("Australia/Sydney");
    expect(zoneOf("GMT")).toBe("Etc/GMT");
  });
  it("resolves states by name and code, with the other zone offered for split states", () => {
    expect(zoneOf("Texas")).toBe("America/Chicago");
    expect(zoneOf("TX")).toBe("America/Chicago");
    const tx = resolveInput("Texas");
    expect(tx.alternatives.map((a) => a.zone)).toEqual(["America/Denver"]);
    expect(tx.alternatives[0].hint).toBe("Other zone in this state");
    expect(zoneOf("Florida")).toBe("America/New_York");
    expect(resolveInput("Florida").alternatives[0].zone).toBe("America/Chicago");
    expect(zoneOf("Arizona")).toBe("America/Phoenix");
    expect(resolveInput("Arizona").alternatives).toEqual([]);
  });
  it("resolves provinces", () => {
    expect(zoneOf("British Columbia")).toBe("America/Los_Angeles");
    expect(zoneOf("Alberta")).toBe("America/Denver");
    expect(zoneOf("Ontario")).toBe("America/Toronto");
  });
  it("resolves single-zone countries by name and ISO code", () => {
    expect(zoneOf("Germany")).toBe("Europe/Berlin");
    expect(zoneOf("India")).toBe("Asia/Kolkata");
    expect(zoneOf("Japan")).toBe("Asia/Tokyo");
    expect(zoneOf("JP")).toBe("Asia/Tokyo");
    expect(zoneOf("China")).toBe("Asia/Shanghai");
    expect(zoneOf("UK")).toBe("Europe/London");
  });
  it("offers a chooser (no automatic answer) for multi-zone countries", () => {
    for (const c of ["United States", "Canada", "Brazil", "Australia", "Russia", "Mexico"]) {
      const r = resolveInput(c);
      expect(r.zone, c).toBeNull();
      expect(r.suggestions.length, c).toBeGreaterThan(1);
    }
    expect(resolveInput("Brazil").suggestions.map((s) => s.zone)).toContain("America/Manaus");
  });
  it("keeps ambiguous codes as a choice between the state and the country", () => {
    const de = resolveInput("DE");
    expect(de.zone).toBeNull();
    expect(de.suggestions.map((s) => s.zone)).toEqual(expect.arrayContaining(["America/New_York", "Europe/Berlin"]));
  });
  it("suggests while typing", () => {
    expect(suggestZones("chi").map((s) => s.zone)).toContain("America/Chicago");
    expect(suggestZones("new y").map((s) => s.zone)).toContain("America/New_York");
    expect(suggestZones("zzzzqq")).toEqual([]);
    expect(suggestZones("")).toEqual([]);
  });
});

describe("tables", () => {
  it("only reference valid IANA zones", () => {
    const zones = new Set<string>([...Object.values(ABBREVIATIONS), ...Object.values(_tables.CITY_ALIASES)]);
    _tables.COUNTRIES.forEach((c) => c[2].forEach((z) => zones.add(z)));
    [..._tables.ROWS_US, ..._tables.ROWS_CA].forEach((r) => { zones.add(r[2]); if (r[3]) zones.add(r[3]); });
    for (const z of zones) expect(isValidZone(z), z).toBe(true);
  });
  it("covers all 50 states plus DC", () => expect(_tables.ROWS_US).toHaveLength(51));
  it("has the split states from the brief", () => {
    const split = _tables.ROWS_US.filter((r) => r[3]).map((r) => r[0]).sort();
    for (const s of ["TX", "FL", "KY", "TN", "IN", "MI", "ND", "SD", "NE", "KS", "OR", "ID"]) expect(split).toContain(s);
  });
});

describe("describeZone", () => {
  it("formats zone, abbreviation, offset and local time", () => {
    const d = describeZone("America/Chicago", new Date("2026-01-15T20:14:00Z"));
    expect(d.text).toBe("America/Chicago · CST (UTC-6) · 2:14 PM");
  });
  it("shows the daylight abbreviation in summer", () => {
    expect(describeZone("America/Chicago", new Date("2026-07-15T20:14:00Z")).abbr).toBe("CDT");
  });
  it("handles half and quarter hour offsets", () => {
    expect(describeZone("Asia/Kolkata", new Date("2026-01-15T00:00:00Z")).offset).toBe("UTC+5:30");
    expect(describeZone("Asia/Kathmandu", new Date("2026-01-15T00:00:00Z")).offset).toBe("UTC+5:45");
    expect(formatOffset(0)).toBe("UTC");
  });
  it("labels chips", () => {
    expect(localTimeLabel("America/Chicago", new Date("2026-01-15T20:14:00Z"))).toBe("2:14 PM CST");
    expect(localTimeLabel("Not/AZone")).toBe("");
  });
});
