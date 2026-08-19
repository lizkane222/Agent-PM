/**
 * Request-coalescing cache for per-record comment rollups.
 *
 * Every record card in the app (action items, calendar events, meetings, accounts,
 * reminders, skills…) now shows a comment badge and an inline preview. Asking for
 * that per card would be one request per card — the exact fan-out that produced the
 * 429s documented in `lib/rateLimit.ts`. So cards don't fetch: they *register* their
 * (resource_type, resource_id) here, and the store issues one batched request per
 * resource type on the next tick.
 *
 * It is a module-level external store for the same reason `lib/localStore.ts` is one:
 * N sibling components each holding a `useState` copy of the same server fact drift
 * apart, and a card needs to update when the comment panel — mounted in a portal on
 * the other side of the tree — posts a comment. Snapshot references are stable until
 * the underlying value actually changes, so it is safe with `useSyncExternalStore`.
 *
 * This is a cross-cutting cache, not an entity list, so `useResource` / HOOK_SPEC
 * rules do not apply (same exemption `useCalendarColors` and `localStore` claim).
 */
import type { CommentResourceType, CommentSummary } from "../types";

type Key = string;

/** Stable snapshot handed to every consumer of a record with no comments. */
export const EMPTY_SUMMARY: CommentSummary = Object.freeze({
  count: 0,
  comments: Object.freeze([]) as unknown as CommentSummary["comments"],
});

function keyOf(resourceType: CommentResourceType, resourceId: number): Key {
  return `${resourceType}:${resourceId}`;
}

const cache = new Map<Key, CommentSummary>();
const subscribers = new Set<() => void>();

/** Keys awaiting their first fetch, grouped by resource type when the batch flushes. */
const pending = new Map<CommentResourceType, Set<number>>();
/** Keys with a request in flight — so a re-render doesn't queue them a second time. */
const inFlight = new Set<Key>();
let flushHandle: ReturnType<typeof setTimeout> | null = null;

/**
 * Max ids per request. The backend rejects more than 500; staying below that keeps a
 * very long list (every action item on the Views grid) split into a few requests
 * instead of one 400.
 */
const MAX_BATCH = 200;

/** Coalescing window. 0ms = "after the current render pass", which is all we need. */
const FLUSH_DELAY_MS = 0;

function notify() {
  for (const cb of subscribers) cb();
}

function scheduleFlush() {
  if (flushHandle !== null) return;
  flushHandle = setTimeout(() => {
    flushHandle = null;
    void flush();
  }, FLUSH_DELAY_MS);
}

async function flush() {
  const batches: Array<[CommentResourceType, number[]]> = [];
  for (const [resourceType, ids] of pending) {
    const all = [...ids];
    for (let i = 0; i < all.length; i += MAX_BATCH) {
      batches.push([resourceType, all.slice(i, i + MAX_BATCH)]);
    }
  }
  pending.clear();
  if (batches.length === 0) return;

  // Imported lazily, not at module scope, so this file has no static dependency on
  // lib/api. `src/test/setup.ts` imports this module to reset the cache between tests;
  // a static import would drag the whole axios client into the setup module graph,
  // where it evaluates against the *real* lib/rateLimit and so escapes the `sleep`
  // mock in lib/__tests__/apiClient.test.ts (the 429 retry tests then sleep for real
  // and time out). Same reason api.ts lazy-imports ./analytics.
  const { commentsApi } = await import("./api");

  await Promise.all(batches.map(async ([resourceType, ids]) => {
    try {
      const { data } = await commentsApi.summary(resourceType, ids);
      for (const id of ids) {
        // A record absent from `results` genuinely has no comments — cache the
        // empty snapshot so it isn't re-requested on every render.
        cache.set(keyOf(resourceType, id), data.results[String(id)] ?? EMPTY_SUMMARY);
      }
    } catch {
      // Leave the ids uncached. They stay out of `inFlight` below, so the next
      // mount retries rather than pinning a wrong "0 comments" forever.
    } finally {
      for (const id of ids) inFlight.delete(keyOf(resourceType, id));
    }
  }));

  notify();
}

/**
 * Cached rollup for a record, or `undefined` when it has not been fetched yet.
 * Callers should render nothing (not "0 comments") for `undefined`.
 */
export function getCommentSummary(
  resourceType: CommentResourceType,
  resourceId: number,
): CommentSummary | undefined {
  return cache.get(keyOf(resourceType, resourceId));
}

/** Queue a record for the next batched fetch. No-op if already cached or in flight. */
export function requestCommentSummary(
  resourceType: CommentResourceType,
  resourceId: number,
): void {
  if (!resourceId || resourceId <= 0) return;
  const key = keyOf(resourceType, resourceId);
  if (cache.has(key) || inFlight.has(key)) return;
  inFlight.add(key);
  const set = pending.get(resourceType) ?? new Set<number>();
  set.add(resourceId);
  pending.set(resourceType, set);
  scheduleFlush();
}

/**
 * Drop a record's cached rollup and refetch it.
 *
 * Called by `useComments` after every add / edit / delete, which is what makes a
 * card's badge and preview update the moment a comment is posted in the panel —
 * the bug where a new comment only appeared after reopening the comment icon.
 *
 * The refetch getting a *fresh* body depends on `lib/requestCache.ts` clearing the
 * whole GET cache after any write through `apiClient`. That holds because this is only
 * ever called immediately after a comment POST/PATCH/DELETE. Calling it in isolation
 * within the 10s TTL would re-read the cached body.
 */
export function invalidateCommentSummary(
  resourceType: CommentResourceType,
  resourceId: number,
): void {
  const key = keyOf(resourceType, resourceId);
  cache.delete(key);
  inFlight.delete(key);
  notify();
  requestCommentSummary(resourceType, resourceId);
}

export function subscribeCommentSummaries(cb: () => void): () => void {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}

/** Test-only: wipe cache + queues so each test starts from a clean slate. */
export function resetCommentSummaries(): void {
  cache.clear();
  pending.clear();
  inFlight.clear();
  if (flushHandle !== null) {
    clearTimeout(flushHandle);
    flushHandle = null;
  }
  notify();
}
