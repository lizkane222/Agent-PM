import { describe, expect, it } from "vitest";
import { Z } from "../zLayers";

describe("z-index scale", () => {
  it("orders nav < dropdown < modal < popover < toast", () => {
    expect(Z.nav).toBeLessThan(Z.dropdown);
    expect(Z.dropdown).toBeLessThan(Z.modal);
    expect(Z.modal).toBeLessThan(Z.popover);
    expect(Z.popover).toBeLessThan(Z.toast);
    expect(Z.sticky).toBeLessThan(Z.nav);
  });
});
