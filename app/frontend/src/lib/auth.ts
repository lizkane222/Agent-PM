/**
 * JWT authentication helpers.
 *
 * Tokens are stored in localStorage under the keys defined below.
 * Import `authHeaders()` to attach the Bearer token to any manual fetch call;
 * the axios client (api.ts) adds the header automatically via an interceptor.
 */

import axios from "axios";
import type { TokenPair } from "../types";
import { track, reset as analyticsReset } from "./analytics";
import { decodeJwtPayload, isTokenExpired } from "twilio-agent-pm-shared";
export { decodeJwtPayload, isTokenExpired };

const BASE_URL = import.meta.env["VITE_API_BASE_URL"] ?? "/api/v1";

const ACCESS_TOKEN_KEY = "agentpm_access";
const REFRESH_TOKEN_KEY = "agentpm_refresh";

// ── Storage helpers ───────────────────────────────────────────────────────────

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function storeTokens(tokens: TokenPair): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, tokens.access);
  localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

// ── Auth API calls ────────────────────────────────────────────────────────────

export async function login(
  username: string,
  password: string
): Promise<TokenPair> {
  const { data } = await axios.post<TokenPair>(`${BASE_URL}/auth/token/`, {
    username,
    password,
  });
  storeTokens(data);
  track("Signed In", { method: "password" });
  return data;
}

// Single in-flight refresh promise — prevents parallel callers from rotating
// the refresh token twice (ROTATE_REFRESH_TOKENS=True blacklists on first use).
let _refreshInFlight: Promise<string> | null = null;

export async function refreshAccessToken(): Promise<string> {
  if (_refreshInFlight) return _refreshInFlight;

  const refresh = getRefreshToken();
  if (!refresh) throw new Error("No refresh token available.");

  // Use raw axios (not apiClient) to avoid triggering the request interceptor,
  // which would itself attempt another token refresh and rotate/blacklist the
  // refresh token before this call can use it.
  _refreshInFlight = axios
    .post<TokenPair>(`${BASE_URL}/auth/token/refresh/`, { refresh })
    .then(({ data }) => { storeTokens(data); return data.access; })
    .finally(() => { _refreshInFlight = null; });

  return _refreshInFlight;
}

export async function logout(): Promise<void> {
  track("Signed Out");
  analyticsReset();
  clearTokens();
  // Redirect handled by the caller.
}

// ── Header helper ─────────────────────────────────────────────────────────────

export function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function getCurrentUser() {
  const token = getAccessToken();
  if (!token || isTokenExpired(token)) return null;
  const payload = decodeJwtPayload(token);
  return {
    id: payload["user_id"] as number,
    username: payload["username"] as string,
    email: (payload["email"] as string) ?? "",
  };
}
