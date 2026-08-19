/**
 * GET de-duplication and short-TTL caching for the API client.
 *
 * Two separate problems produced HTTP 429s from the backend's DRF `UserRateThrottle`
 * (`core/settings.py`, `user: 200/min`):
 *
 *  1. **Fan-out** — effects fetching one request per item. Fixed at the call sites by
 *     batching (see lib/api.ts batch helpers) and bounded by the concurrency cap in
 *     lib/rateLimit.ts.
 *  2. **Duplicate volume** — the same endpoint fetched several times over. `/team/profiles/me/`
 *     has nine independent callers, three of which live in the app shell
 *     (CurrentUserContext, NotificationDefaultsContext, Layout). React `StrictMode`
 *     double-invokes every mount effect in dev, so those three become six identical
 *     requests in the same second. A concurrency cap does not help here: it spreads a
 *     burst out but the throttle counts requests per minute, not requests at once.
 *
 * This module addresses (2), at the axios *adapter* layer so every existing
 * `apiClient.get(...)` benefits without touching ~200 call sites:
 *
 *  - **In-flight coalescing** — concurrent identical GETs share one network request.
 *    No staleness is possible; the requests overlap in time by definition.
 *  - **Short-TTL cache** — an identical GET within `GET_CACHE_TTL_MS` is served from
 *    memory. This is what catches sequential duplicates (StrictMode's second effect,
 *    a remount on navigation).
 *
 * Staleness is bounded three ways: the TTL is short, **any** mutation through this
 * client clears the whole cache, and endpoints whose state changes out-of-band are
 * never cached at all (see `NEVER_CACHE`). Individual calls can opt out with
 * `{ noCache: true }`.
 */

import type {
  AxiosAdapter,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";

/**
 * Declare `noCache` as a first-class axios config key.
 *
 * Without this augmentation, passing `{ noCache: true }` as a request config makes
 * TypeScript fall back to a loose overload and lose the response-type generic, so
 * `apiClient.get<UserProfile>(...)` stops resolving to `UserProfile`.
 */
declare module "axios" {
  export interface AxiosRequestConfig {
    /** Skip GET coalescing and the TTL cache for this request. */
    noCache?: boolean;
  }
}

/** How long a GET response stays servable from memory. */
export const GET_CACHE_TTL_MS = 10_000;

/** Per-request escape hatch: `apiClient.get(url, { noCache: true })`. */
export type CacheableRequestConfig = InternalAxiosRequestConfig & {
  noCache?: boolean;
};

/**
 * Endpoints that must never be served from cache because their state changes
 * outside this client, so a cached read would report a stale world.
 *
 * - integrations: OAuth connection status flips in a popup window, and the caller
 *   re-reads it the moment the popup closes.
 * - sync / scraper status: advanced by background workers.
 * - auth: token endpoints must always hit the server.
 */
const NEVER_CACHE: RegExp[] = [
  /\/integrations\//,
  /\/sync/,
  /\/auth\//,
  /\/scraper-status/,
];

interface CacheEntry {
  ts: number;
  response: AxiosResponse;
}

const responseCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<AxiosResponse>>();

/** Stable serialization of query params — key order must not change the key. */
function stableParams(params: unknown): string {
  if (params == null) return "";
  if (typeof params !== "object") return String(params);
  if (params instanceof URLSearchParams) {
    return [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).join("&");
  }
  const entries = Object.entries(params as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  // No params, `{}`, and `{a: undefined}` all describe the same request, so they must
  // produce the same key — callers pass all three forms for the same endpoint.
  if (entries.length === 0) return "";
  return JSON.stringify(entries);
}

export function cacheKey(config: InternalAxiosRequestConfig): string {
  const base = config.baseURL ?? "";
  return `${base}${config.url ?? ""}?${stableParams(config.params)}`;
}

function isNeverCached(url: string): boolean {
  return NEVER_CACHE.some((re) => re.test(url));
}

/**
 * Whether this request is eligible for coalescing/caching.
 *
 * Non-JSON responses (blobs, file downloads) are excluded — they're large, they're
 * not safely cloneable across consumers, and they aren't the duplicated traffic.
 */
export function isCacheable(config: CacheableRequestConfig): boolean {
  if ((config.method ?? "get").toLowerCase() !== "get") return false;
  if (config.noCache) return false;
  if (config.responseType && config.responseType !== "json") return false;
  return !isNeverCached(config.url ?? "");
}

function deepClone<T>(value: T): T {
  // Only plain JSON structures are cloned. Anything else (Blob, FormData, a class
  // instance) is handed back by reference — those aren't the duplicated GET payloads.
  if (value == null || typeof value !== "object") return value;
  try {
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value)) as T;
    } catch {
      return value;
    }
  }
}

/**
 * Hand a consumer its own copy of a shared response.
 *
 * Every consumer of a coalesced or cached GET gets a cloned `data`, including the
 * first. Sharing one array/object across callers would mean an in-place `.sort()` in
 * one component silently reordering another's state — a bug far more confusing than
 * the extra requests this module removes. Cloning small JSON is orders of magnitude
 * cheaper than the network round trip it replaces.
 */
function cloneFor(response: AxiosResponse, config: InternalAxiosRequestConfig): AxiosResponse {
  return { ...response, config, data: deepClone(response.data) };
}

/** Drop every cached GET. Called after any mutation, and on sign-out. */
export function clearGetCache(): void {
  responseCache.clear();
}

/** Test/diagnostic helper — also clears pending coalescing state. */
export function resetRequestCache(): void {
  responseCache.clear();
  inFlight.clear();
}

/** Diagnostics for tests. */
export function requestCacheStats(): { cached: number; inFlight: number } {
  return { cached: responseCache.size, inFlight: inFlight.size };
}

/**
 * Wrap an axios adapter with GET coalescing + TTL caching and mutation invalidation.
 */
export function createCachingAdapter(base: AxiosAdapter): AxiosAdapter {
  return async function cachingAdapter(config: InternalAxiosRequestConfig) {
    const cfg = config as CacheableRequestConfig;

    if (!isCacheable(cfg)) {
      const response = await base(config);
      // Any successful write invalidates every cached read. Blunt on purpose: it means
      // a refetch after a mutation can never be served a pre-mutation body, without
      // needing a correct URL→resource dependency map for every endpoint.
      if ((config.method ?? "get").toLowerCase() !== "get") {
        clearGetCache();
      }
      return response;
    }

    const key = cacheKey(config);

    const hit = responseCache.get(key);
    if (hit && Date.now() - hit.ts < GET_CACHE_TTL_MS) {
      return cloneFor(hit.response, config);
    }
    if (hit) responseCache.delete(key);

    const pending = inFlight.get(key);
    if (pending) {
      return pending.then((shared) => cloneFor(shared, config));
    }

    const request = base(config)
      .then((response) => {
        responseCache.set(key, { ts: Date.now(), response });
        return response;
      })
      .finally(() => {
        inFlight.delete(key);
      });

    inFlight.set(key, request);
    // Errors are deliberately not cached — a failed GET must be retryable at once.
    return request.then((shared) => cloneFor(shared, config));
  };
}
