/**
 * Client-side rate guard for the API client.
 *
 * The Django backend applies a global DRF `UserRateThrottle` (see
 * `core/settings.py` DEFAULT_THROTTLE_RATES — `user: 200/min`). Effects that
 * fetched one-request-per-item used to burst hundreds of requests at once and
 * trip it, surfacing HTTP 429 to the user.
 *
 * The call sites are batched now, but this module is the durable backstop: a
 * concurrency cap keeps any future fan-out from bursting, and 429 retry makes
 * the throttle self-healing instead of user-visible.
 *
 * Kept separate from `api.ts` so the queueing and backoff logic is unit-testable
 * without standing up the whole typed client.
 */

/** Max requests allowed in flight at once. Bursts beyond this queue rather than send. */
export const MAX_CONCURRENT_REQUESTS = 6;

/** How many times a 429'd request is retried before the error reaches the caller. */
export const MAX_429_RETRIES = 3;

/** Base for exponential backoff: 1s, then 2s, then 4s. */
const BACKOFF_BASE_MS = 1_000;

/** Random spread added to each backoff so parallel retries don't resynchronize. */
const BACKOFF_JITTER_MS = 250;

/**
 * Counting semaphore. `release()` hands its slot straight to the next waiter
 * rather than decrementing and re-incrementing, so the in-flight count can never
 * transiently exceed the limit.
 */
export class Semaphore {
  private active = 0;
  private waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  /** Requests currently holding a slot. Exposed for tests and diagnostics. */
  get inFlight(): number {
    return this.active;
  }

  /** Callers queued waiting for a slot. */
  get queued(): number {
    return this.waiters.length;
  }

  acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Hand the slot over directly — `active` stays constant.
      next();
      return;
    }
    this.active = Math.max(0, this.active - 1);
  }
}

export const requestSemaphore = new Semaphore(MAX_CONCURRENT_REQUESTS);

/**
 * How long to wait before retrying a throttled request.
 *
 * Honors a `Retry-After` header when the server sends one (DRF sends integer
 * seconds), including `0`. Falls back to jittered exponential backoff when the
 * header is absent or unparseable — including the HTTP-date form, which DRF
 * doesn't emit.
 *
 * @param attempt 1-based retry number.
 * @param retryAfter Raw `Retry-After` header value, if present.
 */
export function retryDelayMs(attempt: number, retryAfter?: string | null): number {
  if (retryAfter != null && retryAfter !== "") {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.round(seconds * 1_000);
    }
  }
  const exponential = BACKOFF_BASE_MS * 2 ** (attempt - 1);
  return exponential + Math.round(Math.random() * BACKOFF_JITTER_MS);
}

export function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
