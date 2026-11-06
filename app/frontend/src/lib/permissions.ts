// Access tiers mirrored from core/mixins.py. The server enforces them; these only shape UI
// hints and error wording. Never rely on them for security.

import type { UserProfile } from "../types";

export type AccessLevel = "basic" | "pm" | "admin";

export function accessLevel(profile: Pick<UserProfile, "access_level" | "is_staff"> | null | undefined): AccessLevel {
  if (!profile) return "basic";
  return profile.access_level ?? (profile.is_staff ? "admin" : "basic");
}

/** PM and Admin may put anyone on an account; Basic only themselves. */
export function canManageAccountMembers(profile: Parameters<typeof accessLevel>[0]): boolean {
  return accessLevel(profile) !== "basic";
}

/** The server's refusal reason, or a fallback. */
export function permissionMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { status?: number; data?: { detail?: string; error?: string } } })?.response;
  if (data?.status === 403) return data.data?.detail ?? data.data?.error ?? "You don't have permission to do that.";
  return fallback;
}
