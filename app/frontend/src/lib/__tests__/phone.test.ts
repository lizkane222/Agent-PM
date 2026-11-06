import { describe, it, expect } from "vitest";
import { isValidE164, joinE164, splitE164 } from "../phone";

describe("phone helpers", () => {
  it("joins a country and national number into E.164, dropping formatting and trunk zero", () => {
    expect(joinE164("US", "(415) 555-0123")).toBe("+14155550123");
    expect(joinE164("GB", "07700 900123")).toBe("+447700900123");
    expect(joinE164("US", "")).toBe("");
  });

  it("splits E.164 back, preferring the longest dial code", () => {
    expect(splitE164("+447700900123")).toEqual({ iso: "GB", national: "7700900123" });
    expect(splitE164("+353861234567")).toEqual({ iso: "IE", national: "861234567" });
  });

  it("keeps a shared-code country (Canada) instead of flipping it to the US", () => {
    expect(splitE164("+14165550123", "CA")).toEqual({ iso: "CA", national: "4165550123" });
  });

  it("treats a legacy number with no + as national digits", () => {
    expect(splitE164("6692418922")).toEqual({ iso: "US", national: "6692418922" });
  });

  it("validates E.164 (blank allowed)", () => {
    expect(isValidE164("")).toBe(true);
    expect(isValidE164("+14155550123")).toBe(true);
    expect(isValidE164("+1415")).toBe(false);
    expect(isValidE164("4155550123")).toBe(false);
  });
});
