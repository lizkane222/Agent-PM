import { describe, it, expect } from "vitest";
import { labelForStatus, STATUS_LABEL_OPTIONS, CANONICAL_STATUSES } from "../statusLabels";

describe("labelForStatus", () => {
  it("returns the canonical text with no preferences", () => {
    for (const s of CANONICAL_STATUSES) {
      expect(labelForStatus(s)).toBe(s);
      expect(labelForStatus(s, {})).toBe(s);
      expect(labelForStatus(s, null)).toBe(s);
    }
  });

  it("returns the chosen alternative", () => {
    const prefs = { Open: "Not Started", "In Progress": "Pending", Done: "Completed", Backlogged: "Not Going To Do" };
    expect(labelForStatus("Open", prefs)).toBe("Not Started");
    expect(labelForStatus("In Progress", prefs)).toBe("Pending");
    expect(labelForStatus("Done", prefs)).toBe("Completed");
    expect(labelForStatus("Backlogged", prefs)).toBe("Not Going To Do");
    expect(labelForStatus("Blocked", prefs)).toBe("Blocked");
  });

  it("ignores a preference that is not an allowed name for that status", () => {
    expect(labelForStatus("Open", { Open: "Done" })).toBe("Open");
  });

  it("passes unknown statuses through and blanks null", () => {
    expect(labelForStatus("Weird", { Open: "Not Started" })).toBe("Weird");
    expect(labelForStatus(null)).toBe("");
    expect(labelForStatus(undefined)).toBe("");
  });

  it("offers only Blocked for Blocked and keeps the canonical name first", () => {
    expect(STATUS_LABEL_OPTIONS.Blocked).toEqual(["Blocked"]);
    for (const s of CANONICAL_STATUSES) expect(STATUS_LABEL_OPTIONS[s][0]).toBe(s);
  });
});
