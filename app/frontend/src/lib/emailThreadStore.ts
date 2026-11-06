/**
 * Loaded Gmail threads, kept per account so they survive navigation (module memory) and
 * reloads (localStorage). Same pattern as lib/localStore.ts.
 *
 * Persistence decision: thread bodies can be large, so the persisted copy is trimmed to
 * the most recently loaded accounts and a size budget; anything dropped from disk stays in
 * memory for the session. A quota error never throws (createLocalStore swallows it).
 */
import { createLocalStore } from "./localStore";
import type { GmailThread } from "./api";

export interface LoadedThreads {
  threads: GmailThread[];
  loadedAt: number;
}

type ThreadMap = Record<string, LoadedThreads>;

export const EMAIL_THREADS_KEY = "emailThreadsByAccount-v1";
export const MAX_PERSIST_CHARS = 1_500_000;

function parse(raw: string | null): ThreadMap {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as ThreadMap) : {};
  } catch {
    return {};
  }
}

/** Newest accounts first, dropping the oldest until the JSON fits the budget. */
export function trimForStorage(map: ThreadMap, budget = MAX_PERSIST_CHARS): ThreadMap {
  const keys = Object.keys(map).sort((a, b) => map[b].loadedAt - map[a].loadedAt);
  const out: ThreadMap = {};
  let used = 2;
  for (const k of keys) {
    const size = JSON.stringify(map[k]).length + k.length + 6;
    if (used + size > budget) continue;
    out[k] = map[k];
    used += size;
  }
  return out;
}

const store = createLocalStore<ThreadMap>(EMAIL_THREADS_KEY, parse, (v) => JSON.stringify(trimForStorage(v)));
// Memory keeps everything; disk gets the trimmed copy. createLocalStore.set keeps `next`
// as the in-memory value, so trimming only affects what is written.

export const emailThreadStore = store;

export function accountThreadKey(accountId: number | string): string {
  return String(accountId);
}

export function getLoadedThreads(accountId: number | string): LoadedThreads | undefined {
  return store.get()[accountThreadKey(accountId)];
}

export function saveLoadedThreads(accountId: number | string, threads: GmailThread[], loadedAt = Date.now()) {
  store.update((prev) => ({ ...prev, [accountThreadKey(accountId)]: { threads, loadedAt } }));
}

/** Patch one thread in place (e.g. after the chat panel re-summarises it). Keeps the stamp. */
export function patchLoadedThread(accountId: number | string, threadId: string, patch: Partial<GmailThread>) {
  store.update((prev) => {
    const cur = prev[accountThreadKey(accountId)];
    if (!cur) return prev;
    return {
      ...prev,
      [accountThreadKey(accountId)]: {
        ...cur,
        threads: cur.threads.map((t) => (t.id === threadId ? { ...t, ...patch } : t)),
      },
    };
  });
}

export function resetEmailThreads() {
  try { localStorage.removeItem(EMAIL_THREADS_KEY); } catch { /* ignore */ }
  store.reload();
}
