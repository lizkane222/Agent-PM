import { describe, expect, it } from "vitest";
import { decideTeamLayout } from "../teamLayout";

describe("decideTeamLayout", () => {
  it("one team is always stacked", () => {
    expect(decideTeamLayout({ containerWidth: 100, teamWidths: [500], gap: 8 })).toBe("stacked");
  });
  it("unknown or zero measurements default to stacked", () => {
    expect(decideTeamLayout({ containerWidth: 0, teamWidths: [100, 100], gap: 8 })).toBe("stacked");
    expect(decideTeamLayout({ containerWidth: 500, teamWidths: [0, 100], gap: 8 })).toBe("stacked");
  });
  it("everything fits on one row -> separate rows", () => {
    expect(decideTeamLayout({ containerWidth: 300, teamWidths: [100, 100], gap: 8 })).toBe("stacked");
  });
  it("too wide for one row -> teams side by side", () => {
    expect(decideTeamLayout({ containerWidth: 300, teamWidths: [150, 150], gap: 8 })).toBe("row");
  });
  it("the gaps count toward the total", () => {
    expect(decideTeamLayout({ containerWidth: 216, teamWidths: [100, 100], gap: 16 })).toBe("stacked");
    expect(decideTeamLayout({ containerWidth: 215, teamWidths: [100, 100], gap: 16 })).toBe("row");
  });
});
