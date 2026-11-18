import { describe, it, expect } from "vitest";
import { accountSlug, accountPath, resolveAccountParam, hasUniqueSlug } from "../accountSlug";

const a = (id: number, company_name: string) => ({ id, company_name });

describe("accountSlug", () => {
  it("removes every non-letter and lowercases", () => {
    expect(accountSlug("Autodesk")).toBe("autodesk");
    expect(accountSlug("Festival Foods & Schnucks")).toBe("festivalfoodsschnucks");
    expect(accountSlug("Twilio / Segment Data-Deletion 2.0")).toBe("twiliosegmentdatadeletion");
    expect(accountSlug("Admin")).toBe("admin");
  });
  it("drops non-ASCII letters", () => {
    expect(accountSlug("Café")).toBe("caf");
  });
  it("is empty for digit/symbol-only or missing names", () => {
    expect(accountSlug("1234 & 5")).toBe("");
    expect(accountSlug(null)).toBe("");
  });
});

describe("accountPath", () => {
  const list = [a(1, "Admin"), a(2, "Autodesk"), a(3, "Acme, Inc."), a(4, "Acme Inc"), a(5, "123")];
  it("uses the slug for a unique name, including the per-user Admin account", () => {
    expect(accountPath(list[1], list)).toBe("/accounts/autodesk");
    expect(accountPath(list[0], list)).toBe("/accounts/admin");
  });
  it("falls back to the id when two accounts share a slug", () => {
    expect(accountPath(list[2], list)).toBe("/accounts/3");
    expect(accountPath(list[3], list)).toBe("/accounts/4");
  });
  it("falls back to the id for an empty slug, no list, or an account missing from the list", () => {
    expect(accountPath(list[4], list)).toBe("/accounts/5");
    expect(accountPath(list[1])).toBe("/accounts/2");
    expect(accountPath(a(9, "Ghost"), list)).toBe("/accounts/9");
  });
  it("hasUniqueSlug agrees", () => {
    expect(hasUniqueSlug(list[1], list)).toBe(true);
    expect(hasUniqueSlug(list[2], list)).toBe(false);
  });
});

describe("resolveAccountParam", () => {
  const list = [a(1, "Admin"), a(2, "Autodesk"), a(3, "Acme, Inc."), a(4, "Acme Inc"), a(5, "Café")];
  it("resolves numbers by id", () => {
    expect(resolveAccountParam("2", list)?.id).toBe(2);
    expect(resolveAccountParam("99", list)).toBeNull();
  });
  it("resolves slugs (case-insensitive)", () => {
    expect(resolveAccountParam("autodesk", list)?.id).toBe(2);
    expect(resolveAccountParam("Autodesk", list)?.id).toBe(2);
    expect(resolveAccountParam("caf", list)?.id).toBe(5);
    expect(resolveAccountParam("admin", list)?.id).toBe(1);
  });
  it("returns null for ambiguous, unknown or missing params", () => {
    expect(resolveAccountParam("acmeinc", list)).toBeNull();
    expect(resolveAccountParam("nope", list)).toBeNull();
    expect(resolveAccountParam(undefined, list)).toBeNull();
  });
});
