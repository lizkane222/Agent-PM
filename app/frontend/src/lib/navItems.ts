import { accessLevel } from "./permissions";
import type { UserProfile } from "../types";

export interface BottomNavItem { to: string; label: string; child: boolean }

/** Sidebar bottom links. Admin Data is nested under Settings and shown to Admins only. */
export function bottomNavItems(profile: Pick<UserProfile, "access_level" | "is_staff"> | null | undefined): BottomNavItem[] {
  return [
    { to: "/logs", label: "Activity Log", child: false },
    { to: "/settings", label: "Settings", child: false },
    ...(accessLevel(profile) === "admin" ? [{ to: "/settings/admin-data", label: "Admin Data", child: true }] : []),
  ];
}
