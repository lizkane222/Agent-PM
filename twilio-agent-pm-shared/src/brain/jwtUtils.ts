import type { AuthUser } from "../types.js";

export function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const base64 = token.split(".")[1];
    if (!base64) return {};
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    return JSON.parse(
      typeof Buffer !== "undefined"
        ? Buffer.from(padded, "base64").toString("utf8")
        : atob(padded),
    ) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// `nowSecs` is injected so this function is deterministic in tests.
export function isTokenExpired(token: string, nowSecs: number = Date.now() / 1000): boolean {
  const payload = decodeJwtPayload(token);
  const exp = payload["exp"];
  if (typeof exp !== "number") return true;
  return nowSecs > exp;
}

export function getCurrentUser(token: string, nowSecs?: number): AuthUser | null {
  if (!token || isTokenExpired(token, nowSecs)) return null;
  const payload = decodeJwtPayload(token);
  return {
    id: payload["user_id"] as number,
    username: payload["username"] as string,
    email: (payload["email"] as string) ?? "",
  };
}
