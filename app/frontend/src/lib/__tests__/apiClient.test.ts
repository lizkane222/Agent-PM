/**
 * Integration tests for the apiClient rate guard: the 429 retry interceptor and the
 * concurrency cap. Exercises the real axios instance against MSW so interceptor
 * ordering (release-before-retry) is actually covered — that ordering is what keeps
 * a burst of retries from deadlocking the semaphore.
 */
import { describe, it, expect, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { apiClient } from "../api";
import { MAX_CONCURRENT_REQUESTS, requestSemaphore } from "../rateLimit";

// Collapse the retry backoff so these tests don't sleep for real seconds. Only `sleep`
// is stubbed — faking global timers instead would break MSW's XHR interceptor, and the
// delay arithmetic itself is covered directly in rateLimit.test.ts. Spreading the actual
// module keeps `requestSemaphore` the same instance api.ts holds.
vi.mock("../rateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../rateLimit")>();
  return { ...actual, sleep: () => Promise.resolve() };
});

/** Handler path — matches the relative-path convention in src/test/handlers/. */
const HANDLER_PATH = "/api/v1/rate-guard-probe/";
/** The same endpoint as apiClient sees it, relative to its /api/v1 baseURL. */
const PROBE = "/rate-guard-probe/";

describe("apiClient rate guard", () => {

  it("retries a 429 and resolves once the server relents", async () => {
    let calls = 0;
    server.use(
      http.get(HANDLER_PATH, () => {
        calls += 1;
        if (calls === 1) return new HttpResponse(null, { status: 429 });
        return HttpResponse.json({ ok: true });
      })
    );

    const res = await apiClient.get(PROBE);

    expect(res.data).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it("retries repeatedly while the throttle holds, then succeeds", async () => {
    let calls = 0;
    server.use(
      http.get(HANDLER_PATH, () => {
        calls += 1;
        if (calls <= 3) return new HttpResponse(null, { status: 429 });
        return HttpResponse.json({ ok: true });
      })
    );

    const res = await apiClient.get(PROBE);

    expect(res.data).toEqual({ ok: true });
    expect(calls).toBe(4);
  });

  it("gives up after the retry budget and rejects so callers' .catch() still runs", async () => {
    let calls = 0;
    server.use(
      http.get(HANDLER_PATH, () => {
        calls += 1;
        return new HttpResponse(null, { status: 429 });
      })
    );

    let caught: unknown = null;
    await apiClient.get(PROBE).catch((err: unknown) => { caught = err; });

    expect(caught).not.toBeNull();
    expect((caught as { response?: { status?: number } }).response?.status).toBe(429);
    // Original attempt plus MAX_429_RETRIES retries.
    expect(calls).toBe(4);
  });

  it("honors Retry-After when the server sends one", async () => {
    let calls = 0;
    server.use(
      http.get(HANDLER_PATH, () => {
        calls += 1;
        if (calls === 1) {
          return new HttpResponse(null, { status: 429, headers: { "Retry-After": "1" } });
        }
        return HttpResponse.json({ ok: true });
      })
    );

    const res = await apiClient.get(PROBE);
    expect(res.data).toEqual({ ok: true });
  });

  it("passes non-429 errors straight through without retrying", async () => {
    let calls = 0;
    server.use(
      http.get(HANDLER_PATH, () => {
        calls += 1;
        return new HttpResponse(null, { status: 500 });
      })
    );

    await expect(apiClient.get(PROBE)).rejects.toBeTruthy();
    expect(calls).toBe(1);
  });

  it("releases its slot on success, so the semaphore does not leak", async () => {
    server.use(http.get(HANDLER_PATH, () => HttpResponse.json({ ok: true })));

    const before = requestSemaphore.inFlight;
    await apiClient.get(PROBE);

    expect(requestSemaphore.inFlight).toBe(before);
  });

  it("releases its slot on failure, so the semaphore does not leak", async () => {
    server.use(http.get(HANDLER_PATH, () => new HttpResponse(null, { status: 500 })));

    const before = requestSemaphore.inFlight;
    await apiClient.get(PROBE).catch(() => {});

    expect(requestSemaphore.inFlight).toBe(before);
  });

  it("releases its slot after exhausting 429 retries", async () => {
    server.use(http.get(HANDLER_PATH, () => new HttpResponse(null, { status: 429 })));

    const before = requestSemaphore.inFlight;
    await apiClient.get(PROBE).catch(() => {});

    expect(requestSemaphore.inFlight).toBe(before);
  });

  it("caps concurrent in-flight requests, so a fan-out queues instead of bursting", async () => {
    let concurrent = 0;
    let peak = 0;
    server.use(
      http.get(HANDLER_PATH, async () => {
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        await new Promise((r) => globalThis.queueMicrotask(() => r(null)));
        concurrent -= 1;
        return HttpResponse.json({ ok: true });
      })
    );

    // Fire well past the cap at once — the shape that used to produce 429s. Each
    // request carries a distinct param so the GET cache doesn't coalesce them into
    // one; coalescing is covered separately in requestCache.test.ts, and this test
    // needs genuinely distinct requests to measure the concurrency cap.
    await Promise.all(
      Array.from({ length: 30 }, (_, i) => apiClient.get(PROBE, { params: { i: String(i) } }))
    );

    expect(peak).toBeLessThanOrEqual(MAX_CONCURRENT_REQUESTS);
    // Guards against the assertion above passing vacuously: if requests were being
    // serialized by the test harness rather than throttled by the semaphore, peak
    // would be 1 and the cap would prove nothing.
    expect(peak).toBeGreaterThan(1);
    expect(requestSemaphore.inFlight).toBe(0);
  });

  // Explicit short timeout: the failure mode this guards against is a wedged queue,
  // which otherwise hangs the run instead of reporting a failure.
  it("does not deadlock when a burst of requests is all throttled at once", async () => {
    // The interceptor-ordering regression guard: if the release interceptor ran after
    // the retry handler, each retry would acquire a second slot while still holding
    // the first and the queue would wedge permanently.
    const seen = new Map<string, number>();
    server.use(
      http.get(HANDLER_PATH, ({ request }) => {
        const key = new URL(request.url).searchParams.get("i") ?? "";
        const n = (seen.get(key) ?? 0) + 1;
        seen.set(key, n);
        if (n === 1) return new HttpResponse(null, { status: 429 });
        return HttpResponse.json({ i: key });
      })
    );

    const results = await Promise.all(
      Array.from({ length: MAX_CONCURRENT_REQUESTS * 3 }, (_, i) =>
        apiClient.get(PROBE, { params: { i: String(i) } })
      )
    );

    expect(results).toHaveLength(MAX_CONCURRENT_REQUESTS * 3);
    // Every request was throttled once and then succeeded.
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(requestSemaphore.inFlight).toBe(0);
  }, 5_000);
});
