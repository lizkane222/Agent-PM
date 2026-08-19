/**
 * Tests for GET coalescing + short-TTL caching, exercised through the real apiClient
 * against MSW so the adapter wiring is covered, not just the module in isolation.
 *
 * These guard the fix for the second source of 429s: duplicate request volume.
 * `/team/profiles/me/` has nine callers, three in the app shell, and StrictMode
 * doubles each mount effect — six identical requests in one second.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { apiClient, teamApi, accountsApi } from "../api";
import {
  GET_CACHE_TTL_MS,
  cacheKey,
  clearGetCache,
  isCacheable,
  requestCacheStats,
  resetRequestCache,
} from "../requestCache";
import type { InternalAxiosRequestConfig } from "axios";

const PROFILE_PATH = "/api/v1/team/profiles/me/";
const PROBE_PATH = "/api/v1/cache-probe/";
const PROBE = "/cache-probe/";

describe("requestCache — unit", () => {
  describe("cacheKey", () => {
    function cfg(url: string, params?: unknown): InternalAxiosRequestConfig {
      return { url, params, method: "get", headers: {} } as InternalAxiosRequestConfig;
    }

    it("is stable across param key order", () => {
      expect(cacheKey(cfg("/x/", { a: 1, b: 2 }))).toBe(cacheKey(cfg("/x/", { b: 2, a: 1 })));
    });

    it("distinguishes different param values", () => {
      expect(cacheKey(cfg("/x/", { a: 1 }))).not.toBe(cacheKey(cfg("/x/", { a: 2 })));
    });

    it("distinguishes different URLs", () => {
      expect(cacheKey(cfg("/x/"))).not.toBe(cacheKey(cfg("/y/")));
    });

    it("treats no params and empty params alike", () => {
      expect(cacheKey(cfg("/x/"))).toBe(cacheKey(cfg("/x/", {})));
    });

    it("ignores undefined param values, which axios would not send", () => {
      expect(cacheKey(cfg("/x/", { a: 1, b: undefined }))).toBe(cacheKey(cfg("/x/", { a: 1 })));
    });
  });

  describe("isCacheable", () => {
    function cfg(over: Partial<InternalAxiosRequestConfig> & { noCache?: boolean }) {
      return { url: "/x/", method: "get", headers: {}, ...over } as never;
    }

    it("accepts a plain GET", () => {
      expect(isCacheable(cfg({}))).toBe(true);
    });

    it("rejects mutations", () => {
      for (const method of ["post", "patch", "put", "delete"]) {
        expect(isCacheable(cfg({ method }))).toBe(false);
      }
    });

    it("respects an explicit noCache opt-out", () => {
      expect(isCacheable(cfg({ noCache: true }))).toBe(false);
    });

    it("never caches integrations status — OAuth state changes in a popup", () => {
      expect(isCacheable(cfg({ url: "/integrations/status/" }))).toBe(false);
    });

    it("never caches sync endpoints — advanced by background workers", () => {
      expect(isCacheable(cfg({ url: "/airtable/sync-status/" }))).toBe(false);
    });

    it("never caches auth endpoints", () => {
      expect(isCacheable(cfg({ url: "/auth/token/refresh/" }))).toBe(false);
    });

    it("rejects non-JSON responses such as file downloads", () => {
      expect(isCacheable(cfg({ responseType: "blob" }))).toBe(false);
    });
  });
});

describe("requestCache — through apiClient", () => {
  beforeEach(() => {
    resetRequestCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetRequestCache();
  });

  it("coalesces concurrent identical GETs into one network request", async () => {
    let hits = 0;
    server.use(
      http.get(PROFILE_PATH, () => {
        hits += 1;
        return HttpResponse.json({ id: 1, username: "alice" });
      })
    );

    // The shape the app shell produces: three components x StrictMode's double-invoke.
    const results = await Promise.all(
      Array.from({ length: 6 }, () => teamApi.getMyProfile())
    );

    expect(hits).toBe(1);
    expect(results).toHaveLength(6);
    results.forEach((r) => expect(r.data).toMatchObject({ username: "alice" }));
  });

  it("serves a repeat GET from cache within the TTL", async () => {
    let hits = 0;
    server.use(
      http.get(PROBE_PATH, () => {
        hits += 1;
        return HttpResponse.json({ n: hits });
      })
    );

    const first = await apiClient.get(PROBE);
    const second = await apiClient.get(PROBE);

    expect(hits).toBe(1);
    expect(second.data).toEqual(first.data);
  });

  it("refetches once the TTL has elapsed", async () => {
    let hits = 0;
    server.use(
      http.get(PROBE_PATH, () => {
        hits += 1;
        return HttpResponse.json({ n: hits });
      })
    );

    await apiClient.get(PROBE);
    expect(hits).toBe(1);

    // Advance wall-clock past the TTL without faking timers (which breaks MSW's XHR).
    const realNow = Date.now;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + GET_CACHE_TTL_MS + 1);

    await apiClient.get(PROBE);
    expect(hits).toBe(2);
  });

  it("treats different query params as different entries", async () => {
    let hits = 0;
    server.use(
      http.get(PROBE_PATH, () => {
        hits += 1;
        return HttpResponse.json({ n: hits });
      })
    );

    await apiClient.get(PROBE, { params: { page: "1" } });
    await apiClient.get(PROBE, { params: { page: "2" } });

    expect(hits).toBe(2);
  });

  it("bypasses the cache when the caller asks for fresh data", async () => {
    let hits = 0;
    server.use(
      http.get(PROFILE_PATH, () => {
        hits += 1;
        return HttpResponse.json({ id: 1, username: "alice" });
      })
    );

    await teamApi.getMyProfile();
    await teamApi.getMyProfile({ fresh: true });

    expect(hits).toBe(2);
  });

  it("does not cache a failed GET, so it can be retried at once", async () => {
    let hits = 0;
    server.use(
      http.get(PROBE_PATH, () => {
        hits += 1;
        return new HttpResponse(null, { status: 500 });
      })
    );

    await apiClient.get(PROBE).catch(() => {});
    await apiClient.get(PROBE).catch(() => {});

    expect(hits).toBe(2);
    expect(requestCacheStats().cached).toBe(0);
  });

  it("leaves no in-flight state behind after a request settles", async () => {
    server.use(http.get(PROBE_PATH, () => HttpResponse.json({ ok: true })));

    await apiClient.get(PROBE);

    expect(requestCacheStats().inFlight).toBe(0);
  });

  // ── Invalidation ──────────────────────────────────────────────────────────

  it("a mutation invalidates cached reads, so a refetch sees the new state", async () => {
    let name = "before";
    let getHits = 0;
    server.use(
      http.get("/api/v1/accounts/accounts/", () => {
        getHits += 1;
        return HttpResponse.json({
          count: 1, next: null, previous: null,
          results: [{ id: 1, company_name: name }],
        });
      }),
      http.patch("/api/v1/accounts/accounts/1/", async () => {
        name = "after";
        return HttpResponse.json({ id: 1, company_name: name });
      })
    );

    const before = await accountsApi.listAccounts();
    expect(before.data.results[0]!.company_name).toBe("before");

    await accountsApi.updateAccount(1, { company_name: "after" });

    // The critical assertion: this must NOT be served the pre-mutation body.
    const after = await accountsApi.listAccounts();
    expect(after.data.results[0]!.company_name).toBe("after");
    expect(getHits).toBe(2);
  });

  it("clearGetCache forces the next GET back to the network", async () => {
    let hits = 0;
    server.use(
      http.get(PROBE_PATH, () => {
        hits += 1;
        return HttpResponse.json({ n: hits });
      })
    );

    await apiClient.get(PROBE);
    clearGetCache();
    await apiClient.get(PROBE);

    expect(hits).toBe(2);
  });

  // ── Consumer isolation ────────────────────────────────────────────────────

  it("gives each consumer its own copy, so one cannot mutate another's data", async () => {
    server.use(
      http.get(PROBE_PATH, () =>
        HttpResponse.json({ items: [{ id: 3 }, { id: 1 }, { id: 2 }] })
      )
    );

    const [a, b] = await Promise.all([apiClient.get(PROBE), apiClient.get(PROBE)]);

    // An in-place sort in one component must not reorder the other's array.
    (a.data as { items: { id: number }[] }).items.sort((x, y) => x.id - y.id);

    expect((a.data as { items: { id: number }[] }).items.map((i) => i.id)).toEqual([1, 2, 3]);
    expect((b.data as { items: { id: number }[] }).items.map((i) => i.id)).toEqual([3, 1, 2]);
  });

  it("isolates a cached consumer from a previous consumer's mutation", async () => {
    server.use(http.get(PROBE_PATH, () => HttpResponse.json({ items: [1, 2] })));

    const first = await apiClient.get(PROBE);
    (first.data as { items: number[] }).items.push(999);

    const second = await apiClient.get(PROBE);
    expect((second.data as { items: number[] }).items).toEqual([1, 2]);
  });

  it("reports the requesting config on a cached response, not the original", async () => {
    server.use(http.get(PROBE_PATH, () => HttpResponse.json({ ok: true })));

    await apiClient.get(PROBE);
    const cached = await apiClient.get(PROBE, { headers: { "X-Marker": "second" } });

    expect(cached.config.headers["X-Marker"]).toBe("second");
    expect(cached.status).toBe(200);
  });
});
