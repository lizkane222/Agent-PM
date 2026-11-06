import { describe, it, expect } from "vitest";
import { bottomNavItems } from "../navItems";

describe("bottomNavItems", () => {
  it("nests Admin Data under Settings for Admins", () => {
    const items = bottomNavItems({ is_staff: true, access_level: "admin" });
    expect(items.map((i) => i.to)).toEqual(["/logs", "/settings", "/settings/admin-data"]);
    expect(items[2].child).toBe(true);
  });

  it("hides Admin Data from PM and Basic — even a staff PM", () => {
    expect(bottomNavItems({ is_staff: true, access_level: "pm" }).map((i) => i.label)).not.toContain("Admin Data");
    expect(bottomNavItems({ is_staff: false, access_level: "basic" }).map((i) => i.label)).not.toContain("Admin Data");
    expect(bottomNavItems(null).map((i) => i.label)).not.toContain("Admin Data");
  });
});
