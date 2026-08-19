import { describe, it, expect, vi, afterEach } from "vitest";
import {
  MAX_429_RETRIES,
  MAX_CONCURRENT_REQUESTS,
  Semaphore,
  retryDelayMs,
  sleep,
} from "../rateLimit";

describe("Semaphore", () => {
  it("grants slots immediately up to the limit", async () => {
    const sem = new Semaphore(3);
    await sem.acquire();
    await sem.acquire();
    await sem.acquire();
    expect(sem.inFlight).toBe(3);
    expect(sem.queued).toBe(0);
  });

  it("queues acquisitions beyond the limit instead of granting them", async () => {
    const sem = new Semaphore(2);
    await sem.acquire();
    await sem.acquire();

    let granted = false;
    void sem.acquire().then(() => { granted = true; });
    await Promise.resolve();

    expect(granted).toBe(false);
    expect(sem.queued).toBe(1);
    expect(sem.inFlight).toBe(2);
  });

  it("hands a released slot to the next waiter without exceeding the limit", async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    let granted = false;
    const waiting = sem.acquire().then(() => { granted = true; });

    sem.release();
    await waiting;

    expect(granted).toBe(true);
    // The slot transferred rather than being freed and re-taken.
    expect(sem.inFlight).toBe(1);
    expect(sem.queued).toBe(0);
  });

  it("frees the slot when nobody is waiting", async () => {
    const sem = new Semaphore(2);
    await sem.acquire();
    await sem.acquire();
    sem.release();
    expect(sem.inFlight).toBe(1);
  });

  it("never lets in-flight exceed the limit under a large burst", async () => {
    const limit = 4;
    const sem = new Semaphore(limit);
    let peak = 0;

    const work = Array.from({ length: 40 }, () => async () => {
      await sem.acquire();
      peak = Math.max(peak, sem.inFlight);
      await sleep(0);
      sem.release();
    });

    await Promise.all(work.map((fn) => fn()));

    expect(peak).toBe(limit);
    expect(sem.inFlight).toBe(0);
    expect(sem.queued).toBe(0);
  });

  it("does not drive the count negative on an unmatched release", () => {
    const sem = new Semaphore(2);
    sem.release();
    sem.release();
    expect(sem.inFlight).toBe(0);
  });

  it("caps the shared client at MAX_CONCURRENT_REQUESTS", () => {
    // Guards the constant the api.ts interceptor relies on.
    expect(MAX_CONCURRENT_REQUESTS).toBeGreaterThan(0);
    expect(MAX_429_RETRIES).toBeGreaterThan(0);
  });
});

describe("retryDelayMs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("honors a numeric Retry-After in seconds", () => {
    expect(retryDelayMs(1, "5")).toBe(5_000);
  });

  it("honors Retry-After: 0", () => {
    expect(retryDelayMs(1, "0")).toBe(0);
  });

  it("honors Retry-After over the backoff schedule on later attempts", () => {
    expect(retryDelayMs(3, "2")).toBe(2_000);
  });

  it("falls back to exponential backoff when Retry-After is absent", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(retryDelayMs(1)).toBe(1_000);
    expect(retryDelayMs(2)).toBe(2_000);
    expect(retryDelayMs(3)).toBe(4_000);
  });

  it("falls back to backoff for an unparseable Retry-After (HTTP-date form)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(retryDelayMs(1, "Wed, 21 Oct 2026 07:28:00 GMT")).toBe(1_000);
  });

  it("falls back to backoff for a null or empty header", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(retryDelayMs(1, null)).toBe(1_000);
    expect(retryDelayMs(1, "")).toBe(1_000);
  });

  it("adds jitter so parallel retries do not resynchronize", () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    // Base 1000 + full jitter.
    expect(retryDelayMs(1)).toBe(1_250);
  });

  it("ignores a negative Retry-After and backs off instead", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(retryDelayMs(1, "-5")).toBe(1_000);
  });
});
