import { describe, it, expect } from "vitest";
import { groupContactsByTeam, teamSuggestions } from "../contactGroups";
import { mockContact } from "../../test/handlers/accounts";

const c = (id: number, name: string, team = "", star = false) => ({ ...mockContact, id, name, team, is_main_poc: star });

describe("groupContactsByTeam", () => {
  it("sorts groups alphabetically with No team last", () => {
    const g = groupContactsByTeam([c(1, "A"), c(2, "B", "Zeta"), c(3, "C", "alpha")]);
    expect(g.map((x) => x.label)).toEqual(["alpha", "Zeta", "No team"]);
  });
  it("puts starred contacts first within a group, then by name", () => {
    const g = groupContactsByTeam([c(1, "Amy", "T"), c(2, "Zed", "T", true), c(3, "Bob", "T")]);
    expect(g[0].contacts.map((x) => x.name)).toEqual(["Zed", "Amy", "Bob"]);
  });
  it("treats whitespace-only team as no team", () => {
    expect(groupContactsByTeam([c(1, "A", "  ")])[0].label).toBe("No team");
  });
  it("returns nothing for no contacts", () => {
    expect(groupContactsByTeam([])).toEqual([]);
  });
});

describe("teamSuggestions", () => {
  it("dedupes case-insensitively and sorts", () => {
    expect(teamSuggestions([c(1, "A", "Data"), c(2, "B", "data"), c(3, "C", "Apps"), c(4, "D")])).toEqual(["Apps", "Data"]);
  });
});
