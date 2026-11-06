import { describe, it, expect } from "vitest";
import { accessLevel, canManageAccountMembers, permissionMessage } from "../permissions";

describe("permissions helpers", () => {
  it("falls back to is_staff when no level is present", () => {
    expect(accessLevel({ is_staff: true })).toBe("admin");
    expect(accessLevel({ is_staff: false })).toBe("basic");
    expect(accessLevel({ is_staff: true, access_level: "pm" })).toBe("pm");
    expect(accessLevel(null)).toBe("basic");
  });

  it("only PM and Admin manage account members", () => {
    expect(canManageAccountMembers({ is_staff: false, access_level: "basic" })).toBe(false);
    expect(canManageAccountMembers({ is_staff: false, access_level: "pm" })).toBe(true);
  });

  it("surfaces the server's 403 reason", () => {
    const err = { response: { status: 403, data: { detail: "Only PMs and Admins can add or remove other people on an account." } } };
    expect(permissionMessage(err, "fallback")).toMatch(/Only PMs and Admins/);
    expect(permissionMessage({ response: { status: 500 } }, "fallback")).toBe("fallback");
  });
});
