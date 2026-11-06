import { describe, it, expect } from "vitest";
import { initialsFor } from "../initials";

describe("initialsFor", () => {
  it("uses first and last name", () => expect(initialsFor("Liz Kane")).toBe("LK"));
  it("skips middle names", () => expect(initialsFor("Mary Jane Watson")).toBe("MW"));
  it("handles one word and blanks", () => {
    expect(initialsFor("lizkane")).toBe("L");
    expect(initialsFor("  ")).toBe("?");
  });
});

import { sidebarTitle } from "../initials";
describe("sidebarTitle", () => {
  it("drops seniority words", () => {
    expect(sidebarTitle("Senior Solutions Architect")).toBe("Solutions Architect");
    expect(sidebarTitle("Staff Principal Engineer")).toBe("Engineer");
    expect(sidebarTitle("Product Manager")).toBe("Product Manager");
    expect(sidebarTitle(undefined)).toBe("");
  });
});
