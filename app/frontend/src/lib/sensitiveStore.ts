/**
 * Request-coalescing store for "sensitive text" marks (screen-share masking).
 *
 * Marks are stored on the server, shared by every user who can see the record, and keyed
 * by (resource_type, resource_id). Every <SensitiveText> on every page registers its record
 * here; one batched request per resource type goes out on the next tick -- never one per
 * instance (the fan-out that caused this repo's 429s). Same shape as commentSummaryStore.
 *
 * Because it is a module-level store, a mark made on one page is already known to every
 * other instance of the same record, and an entry older than STALE_MS is re-read when a new
 * instance mounts, so another user's mark shows up on the next page visit.
 *
 * DISPLAY ONLY: marks mask text in this app's UI. The data stays stored and readable via the
 * API and exports. This is a screen-share aid, not access control.
 *
 * Not a `useResource` hook: cross-cutting shared cache (same exemption as commentSummaryStore).
 */
import type { SensitiveMark, SensitiveResourceType } from "../types/sensitive";

type Key = string;

export const EMPTY_MARKS: readonly SensitiveMark[] = Object.freeze([]);

const MAX_BATCH = 200;
const FLUSH_DELAY_MS = 0;
/** A cached entry older than this is re-read when another instance of the record mounts. */
export const STALE_MS = 60_000;

const cache = new Map<Key, { marks: readonly SensitiveMark[]; at: number }>();
const inFlight = new Set<Key>();
const pending = new Map<SensitiveResourceType, Set<string>>();
const subscribers = new Set<() => void>();
let flushHandle: ReturnType<typeof setTimeout> | null = null;

const keyOf = (t: SensitiveResourceType, id: string | number): Key => `${t}:${id}`;

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
  const batches: Array<[SensitiveResourceType, string[]]> = [];
  for (const [type, ids] of pending) {
    const all = [...ids];
    for (let i = 0; i < all.length; i += MAX_BATCH) batches.push([type, all.slice(i, i + MAX_BATCH)]);
  }
  pending.clear();
  if (batches.length === 0) return;

  // Lazy import: see commentSummaryStore -- a static import drags the axios client into the
  // test-setup module graph.
  const { sensitiveApi } = await import("./sensitiveApi");
  await Promise.all(batches.map(async ([type, ids]) => {
    try {
      const { data } = await sensitiveApi.list(type, ids);
      const now = Date.now();
      for (const id of ids) {
        cache.set(keyOf(type, id), { marks: data.results[id] ?? EMPTY_MARKS, at: now });
      }
    } catch {
      // Leave uncached so the next mount retries; rendering the raw text is the fallback.
    } finally {
      for (const id of ids) inFlight.delete(keyOf(type, id));
    }
  }));
  notify();
}

/** Cached marks for a record, or `undefined` until the first fetch lands. */
export function getSensitiveMarks(type: SensitiveResourceType, id: string | number) {
  return cache.get(keyOf(type, id))?.marks;
}

/** Queue a record for the next batched fetch (no-op when fresh or already in flight). */
export function requestSensitiveMarks(type: SensitiveResourceType, id: string | number): void {
  const sid = String(id);
  if (!sid || sid === "0" || sid.startsWith("local-")) return;
  const key = keyOf(type, sid);
  const hit = cache.get(key);
  if ((hit && Date.now() - hit.at < STALE_MS) || inFlight.has(key)) return;
  inFlight.add(key);
  const set = pending.get(type) ?? new Set<string>();
  set.add(sid);
  pending.set(type, set);
  scheduleFlush();
}

/** Re-read one record (after a create/delete). Keeps the old marks visible meanwhile. */
export function invalidateSensitiveMarks(type: SensitiveResourceType, id: string | number): void {
  const key = keyOf(type, id);
  const hit = cache.get(key);
  if (hit) cache.set(key, { marks: hit.marks, at: 0 });
  inFlight.delete(key);
  requestSensitiveMarks(type, id);
}

export function subscribeSensitiveMarks(cb: () => void): () => void {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}

export async function createSensitiveMark(args: {
  resourceType: SensitiveResourceType;
  resourceId: string | number;
  field: string;
  text: string;
  lineKey?: string;
}): Promise<SensitiveMark> {
  const { sensitiveApi } = await import("./sensitiveApi");
  const { data } = await sensitiveApi.create({
    resource_type: args.resourceType,
    resource_id: String(args.resourceId),
    field: args.field,
    text: args.text,
    line_key: args.lineKey ?? "",
  });
  // Apply immediately so the mask appears before the confirming refetch.
  const key = keyOf(args.resourceType, args.resourceId);
  const prev = cache.get(key)?.marks ?? EMPTY_MARKS;
  if (!prev.some((m) => m.id === data.id)) {
    cache.set(key, { marks: [...prev, data], at: 0 });
    notify();
  }
  invalidateSensitiveMarks(args.resourceType, args.resourceId);
  return data;
}

export async function removeSensitiveMark(
  resourceType: SensitiveResourceType,
  resourceId: string | number,
  markId: number,
): Promise<void> {
  const { sensitiveApi } = await import("./sensitiveApi");
  await sensitiveApi.remove(markId);
  const key = keyOf(resourceType, resourceId);
  const prev = cache.get(key)?.marks;
  if (prev) {
    cache.set(key, { marks: prev.filter((m) => m.id !== markId), at: 0 });
    notify();
  }
  invalidateSensitiveMarks(resourceType, resourceId);
}

/** Test-only: wipe cache + queues. */
export function resetSensitiveMarks(): void {
  cache.clear();
  pending.clear();
  inFlight.clear();
  if (flushHandle !== null) {
    clearTimeout(flushHandle);
    flushHandle = null;
  }
  notify();
}
